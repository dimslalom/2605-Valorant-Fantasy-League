import {
  CITIES,
  ROUND_KEYS,
  ROUND_META,
  hashSeed,
  simNpcMatch,
  teamPower,
} from './perfectRun.js';

export const MAX_COMPETITORS = 16;
export const MAX_SPECTATORS = 32;
export const DRAFT_DEADLINE_MS = 30_000;
export const TRANSITION_DEADLINE_MS = 10_000;
export const HOST_MIGRATION_MS = 30_000;
export const LOBBY_TTL_MS = 24 * 60 * 60 * 1000;

const SEED_ORDER = [
  [0, 15], [7, 8], [3, 12], [4, 11],
  [1, 14], [6, 9], [2, 13], [5, 10],
];

export class GameError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function normalizeSquadName(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 28);
}

export function createLobbyState({ code, hostId, squadName, settings, seed, now }) {
  const name = normalizeSquadName(squadName);
  if (!name) throw new GameError('invalid_name', 'Enter a squad name.');
  if (!['year', 'endless'].includes(settings?.gameLength)) {
    throw new GameError('invalid_settings', 'Choose Year or Endless.');
  }
  if (!['normal', 'enc'].includes(settings?.unboxing)) {
    throw new GameError('invalid_settings', 'Choose Normal or ENC unboxing.');
  }
  return {
    schemaVersion: 1,
    code,
    version: 1,
    seed: seed >>> 0,
    rngCounter: 0,
    settings: { ...settings },
    phase: 'lobby',
    hostId,
    hostMigrationAt: null,
    competitors: [{
      id: hostId, squadName: name, joinedAt: now, connected: false,
      rosterIds: [], iglId: null, eliminated: false,
    }],
    spectators: [],
    draftedCardIds: [],
    processedCommandIds: [],
    draft: null,
    season: null,
    tournament: null,
    consolation: null,
    pendingTransition: null,
    animationEvent: null,
    endEndlessRequested: false,
    lastActiveAt: now,
  };
}

export function addCompetitor(state, { id, squadName, now }) {
  if (state.phase !== 'lobby') throw new GameError('game_started', 'The game has already started.');
  if (state.competitors.length >= MAX_COMPETITORS) throw new GameError('lobby_full', 'The lobby is full.');
  const name = normalizeSquadName(squadName);
  if (!name) throw new GameError('invalid_name', 'Enter a squad name.');
  if (state.competitors.some(p => p.squadName.toLowerCase() === name.toLowerCase())) {
    throw new GameError('name_taken', 'That squad name is already in use.');
  }
  state.competitors.push({
    id, squadName: name, joinedAt: now, connected: false,
    rosterIds: [], iglId: null, eliminated: false,
  });
  touch(state, now);
}

export function addSpectator(state, { id, now }) {
  if (state.spectators.length >= MAX_SPECTATORS) throw new GameError('spectators_full', 'Spectator seats are full.');
  state.spectators.push({ id, joinedAt: now, connected: false });
  touch(state, now);
}

export function setConnection(state, participantId, connected, now) {
  const participant = findParticipant(state, participantId);
  if (!participant) return;
  participant.connected = connected;
  touch(state, now);
  if (participantId === state.hostId) {
    state.hostMigrationAt = connected ? null : now + HOST_MIGRATION_MS;
  }
}

export function applyCommand(state, actorId, command, cards, now) {
  const { type, commandId, expectedVersion, payload = {} } = command ?? {};
  if (!commandId || typeof commandId !== 'string') throw new GameError('invalid_command', 'commandId is required.');
  if (state.processedCommandIds.includes(commandId)) return { duplicate: true, events: [] };
  if (expectedVersion !== state.version) throw new GameError('stale_version', 'The lobby state has changed.');
  const actor = state.competitors.find(p => p.id === actorId);
  if (!actor) throw new GameError('unauthorized', 'Spectators cannot control the game.');

  const events = [];
  switch (type) {
    case 'start_game':
      requireHost(state, actorId);
      if (state.phase !== 'lobby') throw new GameError('invalid_phase', 'The game is already running.');
      if (state.competitors.length < 2) throw new GameError('not_enough_players', 'At least two squads are required.');
      startDraft(state, cards, now);
      break;
    case 'choose_card':
      chooseCard(state, actorId, payload.cardId, cards, now, events);
      break;
    case 'choose_igl':
      chooseIgl(state, actorId, payload.cardId, cards, now, events);
      break;
    case 'choose_swap':
      chooseSwap(state, actorId, payload.replaceCardId, cards, now, events);
      break;
    case 'skip_consolation':
      skipConsolation(state, actorId, cards, now, events);
      break;
    case 'play_match':
      requireHost(state, actorId);
      playHumanMatch(state, cards, now, events);
      break;
    case 'advance_early':
      requireHost(state, actorId);
      if (state.phase !== 'match_transition' || !state.pendingTransition) {
        throw new GameError('invalid_phase', 'There is no transition to advance.');
      }
      advanceMatchTransition(state, cards, now, events);
      break;
    case 'end_endless':
      requireHost(state, actorId);
      if (state.settings.gameLength !== 'endless' || state.phase === 'lobby') {
        throw new GameError('invalid_phase', 'Endless mode is not running.');
      }
      state.endEndlessRequested = true;
      break;
    case 'kick_player':
      requireHost(state, actorId);
      kickPlayer(state, payload.competitorId);
      break;
    case 'return_to_lobby':
      requireHost(state, actorId);
      if (state.phase !== 'season_over') throw new GameError('invalid_phase', 'Results are not ready.');
      resetToLobby(state, now);
      break;
    default:
      throw new GameError('unknown_command', `Unknown command: ${type}`);
  }
  state.processedCommandIds.push(commandId);
  state.processedCommandIds = state.processedCommandIds.slice(-256);
  touch(state, now);
  return { duplicate: false, events };
}

export function advanceDeadlines(state, cards, now) {
  const events = [];
  let changed = false;
  if (state.hostMigrationAt && now >= state.hostMigrationAt) {
    const nextHost = state.competitors
      .filter(p => p.connected)
      .sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (nextHost) state.hostId = nextHost.id;
    state.hostMigrationAt = null;
    changed = true;
  }
  if (state.phase === 'draft' && state.draft?.deadlineAt <= now) {
    const best = bestCard(state.draft.offers, cards);
    chooseCard(state, state.draft.activeCompetitorId, best.id, cards, now, events);
    changed = true;
  } else if (state.phase === 'igl_select' && state.draft?.deadlineAt <= now) {
    for (const competitor of state.competitors) {
      if (!state.draft.iglSelections[competitor.id]) {
        state.draft.iglSelections[competitor.id] = bestIgl(competitor.rosterIds, cards);
        competitor.iglId = state.draft.iglSelections[competitor.id];
      }
    }
    startSeason(state, cards, now, events);
    changed = true;
  } else if (state.phase === 'match_transition' && state.pendingTransition?.deadlineAt <= now) {
    advanceMatchTransition(state, cards, now, events);
    changed = true;
  } else if (state.phase === 'consolation' && state.consolation?.deadlineAt <= now) {
    finishConsolationTurn(state, cards, now, events);
    changed = true;
  }
  if (changed) touch(state, now);
  return { changed, events };
}

export function nextAlarmAt(state) {
  const phaseDeadline = state.phase === 'draft' || state.phase === 'igl_select'
    ? state.draft?.deadlineAt
    : state.phase === 'match_transition'
      ? state.pendingTransition?.deadlineAt
      : state.phase === 'consolation'
        ? state.consolation?.deadlineAt
        : null;
  return [
    state.hostMigrationAt,
    phaseDeadline,
    state.lastActiveAt ? state.lastActiveAt + LOBBY_TTL_MS : null,
  ].filter(Number.isFinite).sort((a, b) => a - b)[0] ?? null;
}

export function publicSnapshot(state, serverNow = Date.now()) {
  const copy = structuredClone(state);
  delete copy.processedCommandIds;
  copy.serverNow = serverNow;
  return copy;
}

export function makeSnakeOrder(seatOrder, rounds = 5) {
  const turns = [];
  for (let round = 0; round < rounds; round++) {
    const seats = round % 2 === 0 ? seatOrder : [...seatOrder].reverse();
    for (const competitorId of seats) turns.push({ round, competitorId });
  }
  return turns;
}

export function buildMultiplayerBracket(state, cards, kind) {
  const humanTeams = state.competitors.map(p => makeHumanTeam(p, cards));
  const drafted = new Set(state.draftedCardIds);
  const byOrg = {};
  for (const card of cards) {
    if (!card.org || drafted.has(card.id)) continue;
    (byOrg[card.org] ??= []).push(card);
  }
  const eligible = Object.entries(byOrg)
    .filter(([, roster]) => roster.length >= 5)
    .map(([org, roster]) => {
      const top = [...roster].sort(cardSort).slice(0, 5);
      return {
        id: `npc:${org}`, name: top[0].org_name ?? org, tag: org,
        logo: top[0].org_logo ?? null, rosterIds: top.map(c => c.id),
        roster: top, power: top.reduce((sum, c) => sum + c.rating, 0) / 5,
        human: false,
      };
    })
    .sort((a, b) => b.power - a.power || a.id.localeCompare(b.id));
  const needed = 16 - humanTeams.length;
  const candidates = kind === 'champions' ? eligible : eligible.slice(0, 30);
  const npcs = kind === 'champions'
    ? candidates.slice(0, needed)
    : sample(state, candidates, needed);
  if (npcs.length !== needed) throw new GameError('insufficient_npcs', 'Not enough eligible organizations to fill the bracket.');
  const seeded = [...humanTeams, ...npcs]
    .sort((a, b) => b.power - a.power || a.id.localeCompare(b.id));
  const teams = Object.fromEntries(seeded.map(team => [team.id, team]));
  const matches = SEED_ORDER.map(([a, b], index) => makeMatch(seeded[a], seeded[b], 'r16', index));
  return {
    kind, teams, seeds: seeded.map(t => t.id), roundIdx: 0,
    rounds: [{ key: 'r16', label: ROUND_META.r16.label, bestOf: 3, matches }],
    currentHumanMatchId: null,
  };
}

function startDraft(state, cards, now) {
  for (const competitor of state.competitors) {
    competitor.rosterIds = [];
    competitor.iglId = null;
  }
  state.draftedCardIds = [];
  const seatOrder = shuffle(state, state.competitors.map(p => p.id));
  state.draft = {
    seatOrder,
    turns: makeSnakeOrder(seatOrder),
    turnIndex: 0,
    activeCompetitorId: seatOrder[0],
    offers: [], nation: null, deadlineAt: null, iglSelections: {},
  };
  state.phase = 'draft';
  dealDraftOffer(state, cards, now);
}

function dealDraftOffer(state, cards, now) {
  const available = cards.filter(card => !state.draftedCardIds.includes(card.id));
  if (!available.length) throw new GameError('cards_exhausted', 'No cards remain.');
  if (state.settings.unboxing === 'normal') {
    state.draft.nation = null;
    state.draft.offers = sample(state, available, Math.min(3, available.length)).map(c => c.id);
  } else {
    const pools = Object.groupBy
      ? Object.groupBy(available, card => card.nationality)
      : available.reduce((out, card) => ((out[card.nationality] ??= []).push(card), out), {});
    const nations = Object.keys(pools).sort();
    const nation = nations[Math.floor(nextRandom(state) * nations.length)];
    state.draft.nation = nation;
    state.draft.offers = pools[nation].sort(cardSort).map(c => c.id);
  }
  state.draft.deadlineAt = now + DRAFT_DEADLINE_MS;
}

function chooseCard(state, actorId, cardId, cards, now) {
  if (state.phase === 'draft') {
    if (state.draft.activeCompetitorId !== actorId) throw new GameError('not_your_turn', 'Another squad is drafting.');
    if (!state.draft.offers.includes(cardId)) throw new GameError('invalid_card', 'That card is not in this pack.');
    const competitor = state.competitors.find(p => p.id === actorId);
    competitor.rosterIds.push(cardId);
    state.draftedCardIds.push(cardId);
    state.draft.turnIndex++;
    if (state.draft.turnIndex >= state.draft.turns.length) {
      state.phase = 'igl_select';
      state.draft.activeCompetitorId = null;
      state.draft.offers = [];
      state.draft.nation = null;
      state.draft.deadlineAt = now + DRAFT_DEADLINE_MS;
    } else {
      state.draft.activeCompetitorId = state.draft.turns[state.draft.turnIndex].competitorId;
      dealDraftOffer(state, cards, now);
    }
    return;
  }
  if (state.phase !== 'consolation') throw new GameError('invalid_phase', 'There is no card to choose.');
  if (state.consolation.activeCompetitorId !== actorId) throw new GameError('not_your_turn', 'Another squad is opening a pack.');
  if (!state.consolation.offers.includes(cardId)) throw new GameError('invalid_card', 'That card is not in this pack.');
  state.consolation.selectedCardId = cardId;
}

function chooseIgl(state, actorId, cardId, cards, now, events) {
  if (state.phase !== 'igl_select') throw new GameError('invalid_phase', 'IGL selection is closed.');
  const competitor = state.competitors.find(p => p.id === actorId);
  if (!competitor.rosterIds.includes(cardId)) throw new GameError('invalid_card', 'Choose an IGL from your squad.');
  competitor.iglId = cardId;
  state.draft.iglSelections[actorId] = cardId;
  if (state.competitors.every(p => state.draft.iglSelections[p.id])) startSeason(state, cards, now, events);
}

function startSeason(state, cards, now, events) {
  state.draft.deadlineAt = null;
  state.season = { cycle: 0, eventIndex: 0, events: makeEventCycle(state), standings: makeStandings(state) };
  startTournament(state, cards, now, events);
}

function makeEventCycle(state) {
  const cities = sample(state, CITIES, 3);
  return [
    { kind: 'masters', city: cities[0], label: `Masters ${cities[0]}` },
    { kind: 'masters', city: cities[1], label: `Masters ${cities[1]}` },
    { kind: 'champions', city: cities[2], label: `Champions ${cities[2]}` },
  ];
}

function startTournament(state, cards, now, events) {
  const meta = state.season.events[state.season.eventIndex];
  state.tournament = { ...buildMultiplayerBracket(state, cards, meta.kind), meta, championId: null };
  state.phase = 'tournament';
  resolveUntilPresentation(state, cards, now, events);
}

function resolveUntilPresentation(state, cards, now, events) {
  const tournament = state.tournament;
  while (true) {
    const round = tournament.rounds[tournament.roundIdx];
    const unresolved = round.matches.find(match => !match.winner);
    if (unresolved) {
      if (unresolved.humanInvolved) {
        tournament.currentHumanMatchId = unresolved.id;
        state.pendingTransition = null;
        state.phase = 'match_ready';
        return;
      }
      simulateMatch(state, unresolved, cards);
      continue;
    }
    if (round.key === 'final') {
      tournament.championId = round.matches[0].winner;
      finishTournament(state, cards, now, events);
      return;
    }
    const nextKey = ROUND_KEYS[tournament.roundIdx + 1];
    const winners = round.matches.map(match => match.winner);
    const nextMatches = [];
    for (let i = 0; i < winners.length; i += 2) {
      nextMatches.push(makeMatch(tournament.teams[winners[i]], tournament.teams[winners[i + 1]], nextKey, i / 2));
    }
    const moves = winners.map((teamId, index) => ({
      teamId,
      sourceSlot: `${round.key}:${index}`,
      destinationSlot: `${nextKey}:${Math.floor(index / 2)}`,
    }));
    tournament.roundIdx++;
    tournament.rounds.push({ key: nextKey, label: ROUND_META[nextKey].label, bestOf: ROUND_META[nextKey].bestOf, matches: nextMatches });
    state.animationEvent = { id: `${state.season.cycle}:${state.season.eventIndex}:${nextKey}`, moves };
    events.push({ type: 'round_advance', ...state.animationEvent });
  }
}

function playHumanMatch(state, cards, now, events) {
  if (state.phase !== 'match_ready' || !state.tournament?.currentHumanMatchId) {
    throw new GameError('invalid_phase', 'There is no human match ready to play.');
  }
  const round = state.tournament.rounds[state.tournament.roundIdx];
  const match = round.matches.find(item => item.id === state.tournament.currentHumanMatchId);
  if (!match || match.winner || !match.humanInvolved) {
    throw new GameError('invalid_match', 'That human match is not available.');
  }
  simulateMatch(state, match, cards);
  state.phase = 'match_transition';
  state.pendingTransition = { type: 'next_match', matchId: match.id, deadlineAt: now + TRANSITION_DEADLINE_MS };
  events.push({ type: 'deadline', serverNow: now, deadlineAt: state.pendingTransition.deadlineAt });
}

function advanceMatchTransition(state, cards, now, events) {
  state.pendingTransition = null;
  state.animationEvent = null;
  state.phase = 'tournament';
  resolveUntilPresentation(state, cards, now, events);
}

function simulateMatch(state, match, cards) {
  const a = state.tournament.teams[match.a];
  const b = state.tournament.teams[match.b];
  const result = simNpcMatch(() => nextRandom(state), hydrateTeam(a, cards), hydrateTeam(b, cards), match.bestOf);
  Object.assign(match, { maps: result.maps, scoreA: result.scoreA, scoreB: result.scoreB, winner: result.winner });
  for (const competitor of state.competitors) {
    if (competitor.id !== match.a && competitor.id !== match.b) continue;
    const row = state.season.standings[competitor.id];
    const isA = competitor.id === match.a;
    row.mapsWon += isA ? result.scoreA : result.scoreB;
    row.mapsLost += isA ? result.scoreB : result.scoreA;
    if (result.winner === competitor.id) row.matchWins++;
  }
}

function finishTournament(state, cards, now, events) {
  const championId = state.tournament.championId;
  if (state.season.standings[championId]) {
    state.season.standings[championId].titles++;
    state.season.standings[championId].score += 500;
  }
  for (const row of Object.values(state.season.standings)) row.score = row.titles * 500 + row.matchWins * 100 + row.mapsWon * 20 - row.mapsLost;
  state.season.results ??= [];
  state.season.results.push({
    cycle: state.season.cycle,
    eventIndex: state.season.eventIndex,
    label: state.tournament.meta.label,
    championId,
  });
  const finalYearEvent = state.settings.gameLength === 'year' && state.season.eventIndex === 2;
  if (finalYearEvent) {
    state.phase = 'season_over';
    state.pendingTransition = null;
    return;
  }
  const seatOrder = state.draft?.seatOrder ?? state.competitors.map(p => p.id);
  const recipients = seatOrder.filter(id => id !== championId);
  if (recipients.length) {
    state.consolation = { order: recipients, turnIndex: 0, activeCompetitorId: recipients[0], offers: [], nation: null, selectedCardId: null, deadlineAt: null };
    state.phase = 'consolation';
    dealConsolationOffer(state, cards, now);
  } else {
    afterConsolation(state, cards, now, events);
  }
}

function dealConsolationOffer(state, cards, now) {
  const available = cards.filter(card => !state.draftedCardIds.includes(card.id));
  if (state.settings.unboxing === 'normal') {
    state.consolation.nation = null;
    state.consolation.offers = sample(state, available, Math.min(3, available.length)).map(c => c.id);
  } else {
    const grouped = available.reduce((out, card) => ((out[card.nationality] ??= []).push(card), out), {});
    const nations = Object.keys(grouped).sort();
    const nation = nations[Math.floor(nextRandom(state) * nations.length)];
    state.consolation.nation = nation;
    state.consolation.offers = grouped[nation].sort(cardSort).map(c => c.id);
  }
  state.consolation.selectedCardId = null;
  state.consolation.deadlineAt = now + DRAFT_DEADLINE_MS;
}

function chooseSwap(state, actorId, replaceCardId, cards, now, events) {
  if (state.phase !== 'consolation' || state.consolation.activeCompetitorId !== actorId) throw new GameError('not_your_turn', 'Another squad has the consolation pack.');
  const selected = state.consolation.selectedCardId;
  if (!selected) throw new GameError('choose_card_first', 'Choose the new card first.');
  const competitor = state.competitors.find(p => p.id === actorId);
  const index = competitor.rosterIds.indexOf(replaceCardId);
  if (index < 0) throw new GameError('invalid_card', 'Choose a card from your squad to replace.');
  competitor.rosterIds[index] = selected;
  state.draftedCardIds = state.draftedCardIds.filter(id => id !== replaceCardId);
  state.draftedCardIds.push(selected);
  if (competitor.iglId === replaceCardId) competitor.iglId = bestIgl(competitor.rosterIds, cards);
  finishConsolationTurn(state, cards, now, events);
}

function skipConsolation(state, actorId, cards, now, events) {
  if (state.phase !== 'consolation' || state.consolation.activeCompetitorId !== actorId) throw new GameError('not_your_turn', 'Another squad has the consolation pack.');
  finishConsolationTurn(state, cards, now, events);
}

function finishConsolationTurn(state, cards, now, events) {
  state.consolation.turnIndex++;
  if (state.consolation.turnIndex >= state.consolation.order.length) {
    afterConsolation(state, cards, now, events);
    return;
  }
  state.consolation.activeCompetitorId = state.consolation.order[state.consolation.turnIndex];
  dealConsolationOffer(state, cards, now);
}

function afterConsolation(state, cards, now, events) {
  state.consolation = null;
  if (state.settings.gameLength === 'endless' && state.endEndlessRequested) {
    state.phase = 'season_over';
    return;
  }
  state.season.eventIndex++;
  if (state.season.eventIndex >= 3) {
    state.season.cycle++;
    state.season.eventIndex = 0;
    state.season.events = makeEventCycle(state);
  }
  startTournament(state, cards, now, events);
}

function resetToLobby(state, now) {
  state.phase = 'lobby';
  state.draftedCardIds = [];
  state.draft = null;
  state.season = null;
  state.tournament = null;
  state.consolation = null;
  state.pendingTransition = null;
  state.animationEvent = null;
  state.endEndlessRequested = false;
  for (const competitor of state.competitors) {
    competitor.rosterIds = [];
    competitor.iglId = null;
  }
  touch(state, now);
}

function kickPlayer(state, competitorId) {
  if (state.phase !== 'lobby') throw new GameError('invalid_phase', 'Players can only be removed before starting.');
  if (competitorId === state.hostId) throw new GameError('invalid_player', 'The host cannot remove themselves.');
  const before = state.competitors.length;
  state.competitors = state.competitors.filter(p => p.id !== competitorId);
  if (state.competitors.length === before) throw new GameError('invalid_player', 'Competitor not found.');
}

function makeMatch(a, b, roundKey, index) {
  return {
    id: `${roundKey}:${index}`,
    a: a.id, b: b.id, bestOf: ROUND_META[roundKey].bestOf,
    maps: null, scoreA: 0, scoreB: 0, winner: null,
    humanInvolved: Boolean(a.human || b.human),
  };
}

function makeHumanTeam(competitor, cards) {
  const roster = competitor.rosterIds.map(id => cardById(cards, id));
  return {
    id: competitor.id, name: competitor.squadName, tag: competitor.squadName.slice(0, 8).toUpperCase(),
    logo: null, rosterIds: competitor.rosterIds, roster,
    power: teamPower(roster, competitor.iglId).power, human: true,
  };
}

function hydrateTeam(team, cards) {
  const roster = team.roster?.length ? team.roster : team.rosterIds.map(id => cardById(cards, id));
  return { ...team, roster };
}

function makeStandings(state) {
  return Object.fromEntries(state.competitors.map(p => [p.id, {
    competitorId: p.id, squadName: p.squadName,
    titles: 0, matchWins: 0, mapsWon: 0, mapsLost: 0, score: 0,
  }]));
}

function bestIgl(rosterIds, cards) {
  const roster = rosterIds.map(id => cardById(cards, id));
  return [...rosterIds].sort((a, b) => {
    const powerDiff = teamPower(roster, b).power - teamPower(roster, a).power;
    return powerDiff || String(a).localeCompare(String(b));
  })[0];
}

function bestCard(ids, cards) {
  return ids.map(id => cardById(cards, id)).sort(cardSort)[0];
}

function cardSort(a, b) {
  return (b.rating ?? 0) - (a.rating ?? 0) || String(a.id).localeCompare(String(b.id));
}

function cardById(cards, id) {
  const card = cards.find(item => item.id === id);
  if (!card) throw new GameError('missing_card', `Card not found: ${id}`);
  return card;
}

function shuffle(state, values) {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(nextRandom(state) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function sample(state, values, count) {
  return shuffle(state, values).slice(0, count);
}

function nextRandom(state) {
  const value = hashSeed(`${state.seed}:${state.rngCounter++}`);
  return value / 4294967296;
}

function requireHost(state, actorId) {
  if (state.hostId !== actorId) throw new GameError('unauthorized', 'Only the host can do that.');
}

function findParticipant(state, id) {
  return state.competitors.find(p => p.id === id) ?? state.spectators.find(p => p.id === id);
}

function touch(state, now) {
  state.version++;
  state.lastActiveAt = now;
}
