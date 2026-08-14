// Perfect Run game engine.
// Draft-by-nationality rolls, team chemistry, and a seeded SEASON of three
// single-elimination tournaments (two Masters, then Champions), each a 16-team
// bracket named after a random world city. Every match is simulated, not just
// the player's. Ratings come from cards.json (approximations for game balance,
// not official stats).
//
// Tournament objects are plain data (teams, rounds, matches) so a future
// multiplayer mode can assign any match to a human instead of the sim.

import { getCardSpecialties } from '../data/specialties.js';

// ── Seeded RNG ───────────────────────────────────────────────────────────────

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function todaySeed() {
  const d = new Date();
  return hashSeed(`vfl-daily-${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`);
}

function pickN(rng, arr, n) {
  const pool = [...arr];
  const out = [];
  while (out.length < n && pool.length) {
    out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  }
  return out;
}

function weightedPick(rng, items, weights) {
  const usable = items.slice(0, weights.length);
  const total = weights.slice(0, usable.length).reduce((sum, weight) => sum + weight, 0);
  let roll = rng() * total;
  for (let i = 0; i < usable.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return usable[i];
  }
  return usable[usable.length - 1];
}

function shuffle(rng, items) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ── Draft ────────────────────────────────────────────────────────────────────

export const ROSTER_SIZE = 5;
export const MIN_NATIONAL_POOL = 7;

// Roll a nationality, weighted by sqrt of its remaining player pool so big
// regions are more common without drowning out everyone else.
export function rollNationality(rng, cards, pickedIds) {
  const pools = {};
  for (const c of cards) {
    if (pickedIds.has(c.id)) continue;
    (pools[c.nationality] ??= []).push(c);
  }
  const entries = Object.entries(pools).filter(([, list]) => list.length >= 1);
  const weights = entries.map(([, list]) => Math.sqrt(list.length));
  const total = weights.reduce((s, w) => s + w, 0);
  let roll = rng() * total;
  for (let i = 0; i < entries.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return entries[i][0];
  }
  return entries[entries.length - 1][0];
}

// Every available player of that nationality, best rating first.
export function draftChoices(cards, nationality, pickedIds) {
  return cards
    .filter(c => c.nationality === nationality && !pickedIds.has(c.id))
    .sort((a, b) => b.rating - a.rating);
}

// "Normal" unboxing: a pack of PACK_SIZE uniformly-random cards, pick one.
// Sampling consumes exactly n rng calls (pickN) so the stream stays stable
// for the shared daily seed; the display sort never touches the rng.
export const PACK_SIZE = 5;

export function samplePack(rng, cards, pickedIds, n = PACK_SIZE) {
  const available = cards.filter(c => !pickedIds.has(c.id));
  return pickN(rng, available, Math.min(n, available.length))
    .sort((a, b) => b.rating - a.rating);
}

// Countries available in the Esports Nations Cup. UN is a data fallback, not
// a playable nation. Sorting here keeps the country picker deterministic.
export function eligibleNationalPools(cards, minimum = MIN_NATIONAL_POOL) {
  const pools = {};
  for (const card of cards) {
    if (!card.nationality || card.nationality === 'UN') continue;
    (pools[card.nationality] ??= []).push(card);
  }
  return Object.entries(pools)
    .filter(([, pool]) => pool.length >= minimum)
    .map(([nationality, pool]) => ({
      nationality,
      cards: [...pool].sort((a, b) => b.rating - a.rating || a.player.localeCompare(b.player)),
    }))
    .sort((a, b) => a.nationality.localeCompare(b.nationality));
}

// ── Chemistry & team power ───────────────────────────────────────────────────

const ROLE_CLASSES = ['Duelist', 'Initiator', 'Controller', 'Sentinel'];

// Specialties are looked up from the shared catalog so every mode (solo,
// daily, ENC, multiplayer) reads the same traits off the same cards.
export function hasSpecialty(card, key) {
  return getCardSpecialties(card).some(s => s.key === key);
}

// Duel-side specialty swing, in power points, for side A against side B.
// Flick pays when the opponent out-positions you; Aura drags the other side's
// mentality down; Mastermind is a random mid-round read from a leading IGL.
// Returns a power delta to add to side A.
export function specialtyDuelBonus(rng, rosterA, rosterB, iglAId = null) {
  if (!rosterA?.length || !rosterB?.length) return 0;
  const avg = (roster, key) => roster.reduce((s, p) => s + (p.stats?.[key] ?? 0), 0) / roster.length;
  let delta = 0;

  // Flick: bonus aim against a better-positioned opponent.
  const outPositioned = avg(rosterB, 'positioning') > avg(rosterA, 'positioning');
  if (outPositioned) {
    delta += rosterA.filter(p => hasSpecialty(p, 'flick')).length * 1.2;
  }

  // Aura: presence drags the opposing squad's mentality down.
  delta += rosterA.filter(p => hasSpecialty(p, 'aura')).length * 1.0;

  // Mastermind: a leading IGL spikes positioning + mentality by 2..10, which
  // is 2 stats on 1 of 5 players => (roll * 2) / 5 players / 5 stats of rating.
  const igl = iglAId ? rosterA.find(p => p.id === iglAId) : null;
  if (igl && hasSpecialty(igl, 'mastermind')) {
    const roll = 2 + Math.floor(rng() * 9); // 2..10
    delta += (roll * 2) / 25;
  }
  return delta;
}

export function teamChemistry(roster, iglId) {
  const lines = [];
  let chem = 0;

  // Role coverage: reward all 4 classes, punish stacking. Flex players each
  // plug one otherwise-missing class, and their own role stops counting
  // toward a stack penalty.
  const roleCount = {};
  for (const p of roster) roleCount[p.role] = (roleCount[p.role] ?? 0) + 1;

  const flexPlayers = roster.filter(p => hasSpecialty(p, 'flex'));
  const missingRaw = ROLE_CLASSES.filter(r => !roleCount[r]);
  const flexFilled = missingRaw.slice(0, flexPlayers.length);
  const missing = missingRaw.slice(flexFilled.length);

  if (missing.length === 0) {
    chem += 6;
    lines.push({ label: 'Full role coverage', value: +6 });
  } else {
    chem -= missing.length * 4;
    lines.push({ label: `Missing: ${missing.join(', ')}`, value: -missing.length * 4 });
  }
  if (flexFilled.length) {
    lines.push({ label: `Flex covers ${flexFilled.join(', ')}`, value: '+0' });
  }
  for (const [role, n] of Object.entries(roleCount)) {
    // A flexed player slides off their stacked class.
    const stackRelief = flexPlayers.filter(p => p.role === role).length
      ? Math.min(flexFilled.length, flexPlayers.filter(p => p.role === role).length)
      : 0;
    const effective = n - stackRelief;
    if (effective > 2) {
      chem -= (effective - 2) * 3;
      lines.push({ label: `${effective}x ${role} stack`, value: -(effective - 2) * 3 });
    }
  }

  // One Trick: mastered a single agent — pays off only when nobody else on
  // the squad plays that agent.
  for (const p of roster) {
    if (!hasSpecialty(p, 'one_trick')) continue;
    const mine = new Set(p.agents ?? []);
    if (!mine.size) continue;
    const shared = roster.some(o => o.id !== p.id && (o.agents ?? []).some(a => mine.has(a)));
    if (!shared) {
      chem += 5;
      lines.push({ label: `${p.player} one-tricks solo`, value: +5 });
    }
  }

  // Countryman pairs
  let natPairs = 0;
  for (let i = 0; i < roster.length; i++) {
    for (let j = i + 1; j < roster.length; j++) {
      if (roster[i].nationality === roster[j].nationality) natPairs++;
    }
  }
  if (natPairs) {
    const bonus = Math.min(natPairs * 2, 8);
    chem += bonus;
    lines.push({ label: `${natPairs} countryman pair${natPairs > 1 ? 's' : ''}`, value: +bonus });
  }

  // Real-life teammate pairs (same org; icons are org-less and never count)
  let orgPairs = 0;
  for (let i = 0; i < roster.length; i++) {
    for (let j = i + 1; j < roster.length; j++) {
      if (roster[i].org && roster[i].org === roster[j].org) orgPairs++;
    }
  }
  if (orgPairs) {
    const bonus = Math.min(orgPairs * 3, 9);
    chem += bonus;
    lines.push({ label: `${orgPairs} real teammate pair${orgPairs > 1 ? 's' : ''}`, value: +bonus });
  }

  // Ran it back: pairs who played on the same team in the past (overlapping
  // stints, hidden card data), excluding current teammates already counted.
  let pastPairs = 0;
  for (let i = 0; i < roster.length; i++) {
    for (let j = i + 1; j < roster.length; j++) {
      if (roster[i].org && roster[i].org === roster[j].org) continue;
      if (stintsOverlap(roster[i].stints, roster[j].stints)) pastPairs++;
    }
  }
  if (pastPairs) {
    const bonus = Math.min(pastPairs * 2, 6);
    chem += bonus;
    lines.push({ label: `${pastPairs} pair${pastPairs > 1 ? 's' : ''} played together before`, value: +bonus });
  }

  // IGL: strategic roles make better callers, and a real IGL pays extra
  const igl = roster.find(p => p.id === iglId);
  if (igl) {
    const bonus = { Controller: 4, Sentinel: 4, Initiator: 2 }[igl.role] ?? 0;
    chem += bonus;
    lines.push({ label: `IGL ${igl.player} (${igl.role})`, value: bonus > 0 ? `+${bonus}` : '+0' });
    if (igl.igl) {
      chem += 6;
      lines.push({ label: `${igl.player} is a real IGL`, value: +6 });
    }
  }

  return { total: chem, lines };
}

// Did two players share a team at the same time? Stints are {org, from, to}
// (year-month integers; null to = still there, null from = unknown start).
function stintsOverlap(a = [], b = []) {
  for (const sa of a) {
    for (const sb of b) {
      if (sa.org.toLowerCase() !== sb.org.toLowerCase()) continue;
      const aFrom = sa.from ?? -Infinity, aTo = sa.to ?? Infinity;
      const bFrom = sb.from ?? -Infinity, bTo = sb.to ?? Infinity;
      if (aFrom <= bTo && bFrom <= aTo) return true;
    }
  }
  return false;
}

export function teamPower(roster, iglId) {
  const base = roster.reduce((s, p) => s + p.rating, 0) / roster.length;
  const chem = teamChemistry(roster, iglId);
  return { base, chem: chem.total, power: base + chem.total * 0.6, lines: chem.lines };
}

function strongestIgl(roster) {
  return roster
    .map(card => ({ card, result: teamPower(roster, card.id) }))
    .sort((a, b) => b.result.power - a.result.power || b.card.rating - a.card.rating)[0];
}

function nationalTeam(nationality, roster) {
  if (roster.length < ROSTER_SIZE) return null;
  const igl = strongestIgl(roster);
  return {
    id: `nation:${nationality}`,
    tag: nationality,
    name: nationality,
    nationality,
    logo: null,
    roster,
    iglId: igl.card.id,
    power: igl.result.power,
    isPlayer: false,
  };
}

// Build a readable, balanced CPU roster: take the best card in every role the
// country can field, then fill open slots by rating. The best IGL assignment is
// selected using the same power calculation available to the player.
export function buildCpuNationalTeam(nationality, cards) {
  const sorted = [...cards].sort((a, b) => b.rating - a.rating || a.player.localeCompare(b.player));
  const roster = [];
  for (const role of ROLE_CLASSES) {
    const card = sorted.find(item => item.role === role);
    if (card && !roster.includes(card)) roster.push(card);
  }
  for (const card of sorted) {
    if (roster.length >= ROSTER_SIZE) break;
    if (!roster.includes(card)) roster.push(card);
  }
  return nationalTeam(nationality, roster);
}

const ROLE_PICK_WEIGHTS = [55, 30, 15];
const FLEX_PICK_WEIGHTS = [40, 25, 17, 11, 7];

// The roster a CPU nation actually brings to this ENC run. It stays strong and
// role-aware, but a seeded weighted draw stops every tournament using the same
// five names.
export function buildVariedCpuNationalTeam(rng, nationality, cards) {
  const sorted = [...cards].sort((a, b) => b.rating - a.rating || a.player.localeCompare(b.player));
  const roster = [];
  for (const role of ROLE_CLASSES) {
    const candidates = sorted.filter(card => card.role === role && !roster.includes(card)).slice(0, 3);
    if (candidates.length) roster.push(weightedPick(rng, candidates, ROLE_PICK_WEIGHTS));
  }
  while (roster.length < ROSTER_SIZE) {
    const candidates = sorted.filter(card => !roster.includes(card)).slice(0, 5);
    if (!candidates.length) break;
    roster.push(weightedPick(rng, candidates, FLEX_PICK_WEIGHTS));
  }
  return nationalTeam(nationality, roster);
}

export function nationalChallengeTier(seed) {
  if (seed <= 8) return 'Contender';
  if (seed <= 24) return 'Challenger';
  return 'Underdog';
}

export function encFormLabel(form) {
  if (form >= 3) return 'Hot';
  if (form <= -3) return 'Cold';
  return 'Steady';
}

export function teamSimulationPower(team) {
  return team.simulationPower ?? team.power;
}

// ── Maps & match sim ─────────────────────────────────────────────────────────

export const MAP_POOL = ['Ascent', 'Bind', 'Haven', 'Lotus', 'Split', 'Sunset', 'Icebox'];

export function pickMaps(rng, n) {
  return pickN(rng, MAP_POOL, n);
}

// Simulate one map round-by-round. Returns the full round sequence so the UI
// can animate it, plus the final score and a map MVP from the winning side.
export function simMap(rng, powerA, powerB, rosterA, rosterB, bias = 0, iglA = null, iglB = null) {
  // Specialty swings are rolled once per map, before the round loop.
  const specA = specialtyDuelBonus(rng, rosterA, rosterB, iglA);
  const specB = specialtyDuelBonus(rng, rosterB, rosterA, iglB);
  const p = 1 / (1 + Math.pow(10, ((powerB + specB) - (powerA + specA) - bias) / 25));
  const rounds = []; // 'A' | 'B'
  let a = 0, b = 0;
  while (true) {
    // First to 13; overtime win-by-2, hard cap 19-17
    const done = (a >= 13 || b >= 13) && Math.abs(a - b) >= 2;
    if (done || a >= 19 || b >= 19) break;
    // small per-round momentum wobble
    const wobble = (rng() - 0.5) * 0.06;
    if (rng() < Math.min(0.92, Math.max(0.08, p + wobble))) { a++; rounds.push('A'); }
    else { b++; rounds.push('B'); }
  }
  const winA = a > b;
  const winners = winA ? rosterA : rosterB;
  const weights = winners.map(pl => pl.stats.aim + pl.rating);
  const total = weights.reduce((s, w) => s + w, 0);
  let roll = rng() * total;
  let mvp = winners[0];
  for (let i = 0; i < winners.length; i++) {
    roll -= weights[i];
    if (roll <= 0) { mvp = winners[i]; break; }
  }
  return { a, b, winA, rounds, mvp };
}

// Simulate a whole NPC series in one call (no animation data needed).
export function simNpcMatch(rng, teamA, teamB, bestOf, bias = 0) {
  const needed = Math.ceil(bestOf / 2);
  const maps = pickMaps(rng, bestOf);
  const played = [];
  let scoreA = 0, scoreB = 0;
  for (const map of maps) {
    if (scoreA >= needed || scoreB >= needed) break;
    const r = simMap(rng, teamSimulationPower(teamA), teamSimulationPower(teamB), teamA.roster, teamB.roster, bias, teamA.iglId ?? null, teamB.iglId ?? null);
    played.push({ map, a: r.a, b: r.b });
    if (r.winA) scoreA++; else scoreB++;
  }
  return { maps: played, scoreA, scoreB, winner: scoreA > scoreB ? teamA.id : teamB.id };
}

// ── Season & tournaments ─────────────────────────────────────────────────────
//
// A season is three single-elimination tournaments: two Masters, then
// Champions. Each is a 16-team bracket (Round of 16 -> QF -> SF -> Grand Final)
// named after a random world city. The player's squad persists all season.

export const CITIES = [
  'London', 'Melbourne', 'Tokyo', 'Berlin', 'Paris', 'Madrid', 'Seoul',
  'Shanghai', 'Toronto', 'Chicago', 'Los Angeles', 'Sydney', 'Copenhagen',
  'Reykjavik', 'Istanbul', 'Bangkok', 'Singapore', 'Sao Paulo', 'Mexico City',
  'Rio de Janeiro', 'Amsterdam', 'Stockholm', 'Barcelona', 'Milan', 'Vienna',
  'Dubai', 'Mumbai', 'Osaka', 'Vancouver', 'Montreal',
];

// Draw three distinct cities: Masters, Masters, Champions.
export function makeSeason(rng) {
  const cities = pickN(rng, CITIES, 3);
  return [
    { kind: 'masters',   city: cities[0], label: `Masters ${cities[0]}` },
    { kind: 'masters',   city: cities[1], label: `Masters ${cities[1]}` },
    { kind: 'champions', city: cities[2], label: `Champions ${cities[2]}` },
  ];
}

// Endless mode: one more event, forever. The first cycle mirrors a season
// (Masters, Masters, then Champions); from the third event on every field is
// Champions-caliber (buildBracket's 'champions' kind = exactly the top 15
// orgs), which is the difficulty ramp. `usedCities` is a sliding window of
// recent hosts so cities do not repeat back-to-back.
export function nextEndlessEvent(rng, index, usedCities = []) {
  const pool = CITIES.filter(c => !usedCities.includes(c));
  const city = pickN(rng, pool.length ? pool : CITIES, 1)[0];
  const kind = index % 3 < 2 ? 'masters' : 'champions';
  const cycle = endlessCycle(index);
  const modifier = drawEventModifier(rng, kind, cycle);
  return { kind, city, label: `${kind === 'champions' ? 'Champions' : 'Masters'} ${city}`, modifier, cycle };
}

// ── Endless roguelike ───────────────────────────────────────────────────────

export const ENDLESS_LIVES = 3;
export const FATIGUE_PENALTY_CAP = 5;
export const BOOST_RATING_CAP = 3;
export const ENDLESS_REGIONS = ['Americas', 'EMEA', 'Pacific', 'China'];

export function endlessCycle(eventIndex) {
  return Math.floor(eventIndex / 3);
}

export function endlessDifficulty(cycle) {
  const safeCycle = Math.max(0, cycle);
  const formBoost = safeCycle <= 3 ? safeCycle * 3 : 9 + (safeCycle - 3) * 1.5;
  return {
    formBoost,
    superTeamCount: Math.min(4, Math.max(0, safeCycle - 1)),
    superTeamBoost: formBoost / 2,
    mastersModifierChance: safeCycle === 0 ? 0 : Math.min(0.6, 0.25 + 0.1 * safeCycle),
  };
}

export const MODIFIERS = {
  hostile_crowd: { key: 'hostile_crowd', label: 'Hostile Crowd', desc: 'Your squad loses 4 power.', pool: 'boss' },
  giant_killers: { key: 'giant_killers', label: 'Giant Killers', desc: 'Every opponent gains 3 power.', pool: 'both' },
  duelist_slump: { key: 'duelist_slump', label: 'Duelist Slump', desc: 'Your Duelists lose 3 rating.', pool: 'both' },
  igl_silenced: { key: 'igl_silenced', label: 'IGL Silenced', desc: 'Your IGL chemistry bonus is disabled.', pool: 'boss' },
  cold_streak: { key: 'cold_streak', label: 'Cold Streak', desc: 'Chemistry contributes at half strength.', pool: 'boss' },
  bo1_r16: { key: 'bo1_r16', label: 'Sudden Death', desc: 'The round of 16 is best-of-one.', pool: 'both', roundOverrides: { r16: { bestOf: 1 } } },
  grueling_schedule: { key: 'grueling_schedule', label: 'Grueling Schedule', desc: 'This event adds double fatigue.', pool: 'both' },
  away_maps: { key: 'away_maps', label: 'Away Maps', desc: 'The map odds lean 2 power toward your opponent.', pool: 'boss', bias: -2 },
};

export function drawEventModifier(rng, kind, cycle) {
  const difficulty = endlessDifficulty(cycle);
  if (kind === 'masters' && rng() >= difficulty.mastersModifierChance) return null;
  const allowed = Object.values(MODIFIERS).filter(modifier =>
    modifier.pool === 'both' || (kind === 'champions' ? modifier.pool === 'boss' : modifier.pool === 'masters'));
  return allowed[Math.floor(rng() * allowed.length)] ?? null;
}

export function nextEndlessCycle(rng, cycleIndex, usedCities = []) {
  const available = CITIES.filter(city => !usedCities.includes(city));
  const cities = pickN(rng, available.length >= 3 ? available : CITIES, 3);
  return ['masters', 'masters', 'champions'].map((kind, index) => ({
    kind,
    city: cities[index],
    label: `${kind === 'champions' ? 'Champions' : 'Masters'} ${cities[index]}`,
    cycle: cycleIndex,
    modifier: drawEventModifier(rng, kind, cycleIndex),
  }));
}

export function npcTeamPower(roster) {
  if (!roster.length) return { power: 0, iglId: null };
  return roster.map(card => ({ iglId: card.id, result: teamPower(roster, card.id) }))
    .sort((a, b) => b.result.power - a.result.power || String(a.iglId).localeCompare(String(b.iglId)))[0];
}

export function buildSuperTeam(region, cards, pickedIds = new Set()) {
  const pool = cards.filter(card => card.region === region && !pickedIds.has(card.id));
  const roster = [];
  for (const role of ROLE_CLASSES) {
    const best = pool.filter(card => card.role === role).sort((a, b) => b.rating - a.rating || String(a.id).localeCompare(String(b.id)))[0];
    if (best) roster.push(best);
  }
  for (const card of [...pool].sort((a, b) => b.rating - a.rating || String(a.id).localeCompare(String(b.id)))) {
    if (roster.length >= ROSTER_SIZE) break;
    if (!roster.includes(card)) roster.push(card);
  }
  if (roster.length < ROSTER_SIZE) return null;
  const best = npcTeamPower(roster);
  return { id: `allstar:${region}`, tag: region.slice(0, 3).toUpperCase(), name: `${region} All-Stars`, region, logo: null,
    roster, iglId: best.iglId, power: best.result.power, isPlayer: false };
}

export function buildEndlessBracket(rng, cards, pickedIds, playerTeam, kind, cycle, modifier = null) {
  const difficulty = endlessDifficulty(cycle);
  const pool = eligibleOrgs(cards, pickedIds).map(team => {
    const best = npcTeamPower(team.roster);
    return { ...team, iglId: best.iglId, power: best.result.power + difficulty.formBoost };
  });
  const neededAllStars = kind === 'champions' ? difficulty.superTeamCount : cycle >= 4 ? 1 : 0;
  const allStars = ENDLESS_REGIONS.slice(0, neededAllStars)
    .map(region => buildSuperTeam(region, cards, pickedIds)).filter(Boolean)
    .map(team => ({ ...team, power: team.power + difficulty.superTeamBoost }));
  const npcCount = 15 - allStars.length;
  const orgs = kind === 'champions' ? pool.slice(0, npcCount) : pickN(rng, pool.slice(0, 30), npcCount);
  const opponentBoost = modifier?.key === 'giant_killers' ? 3 : 0;
  const all = [playerTeam, ...orgs, ...allStars]
    .map(team => team.isPlayer ? team : { ...team, power: team.power + opponentBoost })
    .sort((a, b) => b.power - a.power || String(a.id).localeCompare(String(b.id)));
  const teams = Object.fromEntries(all.map(team => [team.id, team]));
  const bestOf = modifier?.roundOverrides?.r16?.bestOf ?? ROUND_META.r16.bestOf;
  return { kind, teams, seeds: all.map(team => team.id), roundOverrides: modifier?.roundOverrides ?? {}, modifier,
    rounds: [{ key: 'r16', label: ROUND_META.r16.label, bestOf, matches: SEED_ORDER.map(([i, j]) => makeMatch(all[i].id, all[j].id, bestOf)) }], roundIdx: 0 };
}

export function fatiguePenalty(value) {
  return Math.min(FATIGUE_PENALTY_CAP, Math.max(0, Number(value) || 0));
}

export function addEventFatigue(runState, roster, multiplier = 1) {
  const next = { ...runState, fatigue: { ...(runState.fatigue ?? {}) } };
  for (const card of roster) next.fatigue[card.id] = (next.fatigue[card.id] ?? 0) + multiplier;
  return next;
}

export function applyRunEffects(roster, runState = {}) {
  const fatigue = runState.fatigue ?? {};
  const boosts = runState.boosts ?? {};
  if (!Object.keys(fatigue).length && !Object.keys(boosts).length) return roster;
  return roster.map(card => {
    const penalty = fatiguePenalty(fatigue[card.id]);
    const cardBoosts = boosts[card.id] ?? [];
    if (!penalty && !cardBoosts.length) return card;
    const ratingBoost = Math.min(BOOST_RATING_CAP, cardBoosts.reduce((sum, boost) => sum + (boost.rating ?? 0), 0));
    const stats = { ...card.stats };
    for (const boost of cardBoosts) if (boost.stat) stats[boost.stat] = Math.min(99, (stats[boost.stat] ?? 0) + (boost.value ?? 0));
    const runFx = cardBoosts.map(boost => ({ key: boost.key, glyph: boost.glyph, label: boost.label, desc: boost.desc, tone: 'boost' }));
    if (penalty) runFx.push({ key: 'fatigue', glyph: `${penalty}`, label: `Fatigue ${penalty}`, desc: `-${penalty} rating`, tone: 'fatigue' });
    return { ...card, rating: card.rating + ratingBoost - penalty, stats, runFx };
  });
}

export function effectiveTeamPower(roster, iglId, runState = {}, modifierKey = null) {
  let adjusted = applyRunEffects(roster, runState);
  if (modifierKey === 'duelist_slump') adjusted = adjusted.map(card => card.role === 'Duelist' ? { ...card, rating: card.rating - 3 } : card);
  const result = teamPower(adjusted, modifierKey === 'igl_silenced' ? null : iglId);
  const chemFactor = modifierKey === 'cold_streak' ? 0.3 : 0.6;
  const teamChemBonus = Math.min(6, Math.max(0, runState.teamChemBonus ?? 0));
  return { ...result, roster: adjusted,
    power: result.base + result.chem * chemFactor + teamChemBonus * 0.6 - (modifierKey === 'hostile_crowd' ? 4 : 0) };
}

export function eventCredits({ mapsWon = 0, seriesWon = 0, champion = false, cycle = 0 }) {
  return mapsWon * 20 + seriesWon * 40 + (champion ? 150 : 30) + cycle * 10;
}

export const SHOP_ITEMS = [
  { key: 'scout_pack', label: 'Scout Pack', cost: 100, desc: 'Open a five-card swap pack.', glyph: 'P' },
  { key: 'aim_coach', label: 'Aim Coach', cost: 60, desc: '+1 rating and +2 aim for one player.', glyph: 'A', targeted: true },
  { key: 'mental_coach', label: 'Mental Coach', cost: 60, desc: '+1 rating and +2 mentality for one player.', glyph: 'M', targeted: true },
  { key: 'energy_drink', label: 'Energy Drink', cost: 40, desc: 'Clear one player’s fatigue.', glyph: 'E', targeted: true },
  { key: 'team_retreat', label: 'Team Retreat', cost: 90, desc: 'Reduce team fatigue by 2.', glyph: 'R' },
  { key: 'synergy_camp', label: 'Synergy Camp', cost: 120, desc: '+2 team chemistry (three stacks max).', glyph: 'S' },
];

export function applyPurchase(runState, itemKey, targetCardId = null) {
  const item = SHOP_ITEMS.find(entry => entry.key === itemKey);
  if (!item) throw new Error('Unknown shop item.');
  if (item.targeted && !targetCardId) throw new Error('Choose a player for this item.');
  const next = { fatigue: { ...(runState.fatigue ?? {}) }, boosts: Object.fromEntries(Object.entries(runState.boosts ?? {}).map(([id, list]) => [id, [...list]])), teamChemBonus: runState.teamChemBonus ?? 0 };
  if (itemKey === 'aim_coach' || itemKey === 'mental_coach') {
    const stat = itemKey === 'aim_coach' ? 'aim' : 'mentality';
    next.boosts[targetCardId] ??= [];
    next.boosts[targetCardId].push({ key: itemKey, glyph: item.glyph, label: item.label, desc: item.desc, rating: 1, stat, value: 2 });
  } else if (itemKey === 'energy_drink') {
    delete next.fatigue[targetCardId];
  } else if (itemKey === 'team_retreat') {
    for (const id of Object.keys(next.fatigue)) next.fatigue[id] = Math.max(0, next.fatigue[id] - 2);
  } else if (itemKey === 'synergy_camp') {
    next.teamChemBonus = Math.min(6, next.teamChemBonus + 2);
  }
  return next;
}

export const ROUND_KEYS = ['r16', 'quarter', 'semi', 'final'];

export const ROUND_META = {
  preliminary: { label: 'Preliminary Round', bestOf: 3 },
  r64:     { label: 'Round of 64',   bestOf: 3 },
  r32:     { label: 'Round of 32',   bestOf: 3 },
  r16:     { label: 'Round of 16',   bestOf: 3 },
  quarter: { label: 'Quarterfinals', bestOf: 3 },
  semi:    { label: 'Semifinals',    bestOf: 3 },
  final:   { label: 'Grand Final',   bestOf: 5 },
};

// Standard 16-seed bracket order (0-based seed indices) so higher seeds cannot
// meet early and each winner feeds the adjacent match in the next round.
const SEED_ORDER = [
  [0, 15], [7, 8], [3, 12], [4, 11], [1, 14], [6, 9], [2, 13], [5, 10],
];

// Every org with a full five-man roster and nobody already drafted; its best
// five by rating, strongest orgs first.
function eligibleOrgs(cards, pickedIds) {
  const byOrg = {};
  for (const c of cards) {
    if (!c.org) continue; // icons are org-less and never form an opponent team
    (byOrg[c.org] ??= []).push(c);
  }
  return Object.entries(byOrg)
    .filter(([, list]) => list.length >= 5 && list.every(p => !pickedIds.has(p.id)))
    .map(([org, list]) => {
      const roster = [...list].sort((a, b) => b.rating - a.rating).slice(0, 5);
      return {
        id: org, tag: org, name: roster[0].org_name ?? org,
        logo: roster[0].org_logo, roster,
        power: roster.reduce((s, p) => s + p.rating, 0) / 5,
        isPlayer: false,
      };
    })
    .sort((a, b) => b.power - a.power);
}

function makeMatch(aId, bId, bestOf) {
  return {
    a: aId, b: bId, bestOf,
    maps: null, scoreA: 0, scoreB: 0, winner: null,
    isPlayerMatch: aId === 'player' || bId === 'player',
  };
}

function powerOfTwoAtMost(n) {
  let value = 1;
  while (value * 2 <= n) value *= 2;
  return value;
}

function roundKeyForSize(size) {
  if (size === 2) return 'final';
  if (size === 4) return 'semi';
  if (size === 8) return 'quarter';
  if (size === 16) return 'r16';
  if (size === 32) return 'r32';
  if (size === 64) return 'r64';
  return `r${size}`;
}

function mainRoundKeys(size) {
  const keys = [];
  for (let current = size; current >= 2; current /= 2) keys.push(roundKeyForSize(current));
  return keys;
}

// Standard seed layout generated for any power-of-two bracket size.
function seedOrder(size) {
  let order = [1, 2];
  for (let current = 4; current <= size; current *= 2) {
    order = order.flatMap(seed => [seed, current + 1 - seed]);
  }
  return order;
}

function shuffleSeedPots(rng, slots, potSize = 8) {
  const out = [];
  for (let start = 0; start < slots.length; start += potSize) {
    out.push(...shuffle(rng, slots.slice(start, start + potSize)));
  }
  return out;
}

function tournamentForm(rng) {
  const u1 = Math.max(rng(), Number.EPSILON);
  const u2 = rng();
  const normal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(-8, Math.min(8, normal * 5));
}

function addNationalMainRound(t) {
  const ids = t.mainSeedSlots.map(slot => {
    if (!slot.startsWith('prelim:')) return slot;
    const match = t.rounds[0].matches[Number(slot.split(':')[1])];
    return match.winner;
  });
  const key = t.roundKeys[0];
  const meta = ROUND_META[key] ?? { label: `Round of ${t.mainSize}`, bestOf: 3 };
  const order = seedOrder(t.mainSize);
  const matches = [];
  for (let i = 0; i < order.length; i += 2) {
    matches.push(makeMatch(ids[order[i] - 1], ids[order[i + 1] - 1], meta.bestOf));
  }
  t.rounds.push({ key, label: meta.label, bestOf: meta.bestOf, matches });
  t.roundIdx = t.rounds.length - 1;
  return t.rounds[t.roundIdx];
}

// Build the ENC field. Any entrants above the next-lower power of two play a
// seeded preliminary round; its winners occupy the final main-bracket seeds.
export function buildNationalBracket(rng, cards, playerNationality, playerRoster, playerIglId) {
  if (Array.isArray(rng)) {
    playerIglId = playerRoster;
    playerRoster = playerNationality;
    playerNationality = cards;
    cards = rng;
    rng = mulberry32(0x454e43);
  }
  const entrants = eligibleNationalPools(cards).map(({ nationality, cards: pool }) => {
    if (nationality !== playerNationality) {
      const projected = buildCpuNationalTeam(nationality, pool);
      const actual = buildVariedCpuNationalTeam(rng, nationality, pool);
      return { ...actual, projectedPower: projected.power };
    }
    const playerPower = teamPower(playerRoster, playerIglId).power;
    return {
      id: 'player', tag: nationality, name: nationality, nationality, logo: null,
      roster: playerRoster, iglId: playerIglId,
      power: playerPower, projectedPower: playerPower,
      isPlayer: true,
    };
  }).filter(Boolean).sort((a, b) => b.projectedPower - a.projectedPower || a.nationality.localeCompare(b.nationality));

  const fieldAverage = entrants.reduce((sum, team) => sum + team.power, 0) / entrants.length;
  for (const team of entrants) {
    team.form = tournamentForm(rng);
    team.formLabel = encFormLabel(team.form);
    team.simulationPower = fieldAverage + (team.power - fieldAverage) * 0.25 + team.form;
  }

  const mainSize = powerOfTwoAtMost(entrants.length);
  const preliminaryCount = entrants.length - mainSize;
  const byeCount = mainSize - preliminaryCount;
  const teams = Object.fromEntries(entrants.map(team => [team.id, team]));
  const rounds = [];
  const seededMainSlots = entrants.slice(0, byeCount).map(team => team.id);

  if (preliminaryCount) {
    const matches = [];
    for (let i = 0; i < preliminaryCount; i++) {
      const high = entrants[byeCount + i];
      const low = entrants[entrants.length - 1 - i];
      matches.push(makeMatch(high.id, low.id, ROUND_META.preliminary.bestOf));
      seededMainSlots.push(`prelim:${i}`);
    }
    rounds.push({ ...ROUND_META.preliminary, key: 'preliminary', matches });
  } else {
    seededMainSlots.push(...entrants.slice(byeCount).map(team => team.id));
  }

  const mainSeedSlots = shuffleSeedPots(rng, seededMainSlots);

  const tournament = {
    kind: 'enc', teams, seeds: entrants.map(team => team.id), rounds,
    roundIdx: 0, mainSize, mainSeedSlots, roundKeys: mainRoundKeys(mainSize), fieldAverage,
  };
  if (!preliminaryCount) addNationalMainRound(tournament);
  return tournament;
}

// Build a fresh 16-team bracket. Masters draws 15 opponents from the top 30 by
// power (so a tier-2 giant-killer can sneak in); Champions takes exactly the
// top 15, the strongest possible field. The player is seeded by power with the
// rest, so a strong squad earns a kinder opening seed.
export function buildBracket(rng, cards, pickedIds, playerTeam, kind) {
  const pool = eligibleOrgs(cards, pickedIds);
  const npcs = kind === 'champions'
    ? pool.slice(0, 15)
    : pickN(rng, pool.slice(0, 30), 15);

  const all = [playerTeam, ...npcs].sort((a, b) => b.power - a.power);
  const teams = {};
  for (const team of all) teams[team.id] = team;

  const matches = SEED_ORDER.map(([i, j]) =>
    makeMatch(all[i].id, all[j].id, ROUND_META.r16.bestOf));

  return {
    kind, teams,
    seeds: all.map(team => team.id), // index = seed - 1
    rounds: [{ key: 'r16', label: ROUND_META.r16.label, bestOf: ROUND_META.r16.bestOf, matches }],
    roundIdx: 0,
  };
}

// Pair the winners of the current round into the next. Bracket order means the
// winners of matches 2i and 2i+1 meet.
export function nextBracketRound(t) {
  if (currentRound(t)?.key === 'preliminary') return addNationalMainRound(t);
  const idx = t.roundIdx + 1;
  const activeKeys = t.roundKeys ?? ROUND_KEYS;
  const currentKeyIndex = activeKeys.indexOf(currentRound(t)?.key);
  const key = activeKeys[currentKeyIndex + 1] ?? activeKeys[idx];
  if (!key) return null;
  const meta = ROUND_META[key];
  const prev = t.rounds[t.roundIdx].matches;
  const matches = [];
  for (let i = 0; i < prev.length; i += 2) {
    matches.push(makeMatch(prev[i].winner, prev[i + 1].winner, meta.bestOf));
  }
  t.rounds.push({ key, label: meta.label, bestOf: meta.bestOf, matches });
  t.roundIdx = idx;
  return t.rounds[t.roundIdx];
}

export function currentRound(t) {
  return t.rounds[t.rounds.length - 1] ?? null;
}

export function playerMatch(t) {
  return currentRound(t)?.matches.find(m => m.isPlayerMatch) ?? null;
}

// Seed number (1-based) of a team, for display.
export function seedOf(t, teamId) {
  const i = t.seeds.indexOf(teamId);
  return i < 0 ? null : i + 1;
}

// Write the player's finished series into their pending match. The sim always
// treats the player as side A, so maps/scores are remapped onto whichever
// bracket side the player actually occupies.
export function setPlayerResult(t, playedMaps, playerWon) {
  const m = playerMatch(t);
  if (!m) return;
  const playerMapsWon = playedMaps.filter(r => r.winA).length;
  const oppMapsWon = playedMaps.length - playerMapsWon;
  const playerIsA = m.a === 'player';
  m.maps = playedMaps.map(r => ({
    map: r.map,
    a: playerIsA ? r.a : r.b,
    b: playerIsA ? r.b : r.a,
  }));
  m.scoreA = playerIsA ? playerMapsWon : oppMapsWon;
  m.scoreB = playerIsA ? oppMapsWon : playerMapsWon;
  m.winner = playerWon ? 'player' : (playerIsA ? m.b : m.a);
}

// Sim every unresolved NPC match in the current round.
export function resolveNpcMatches(t, rng) {
  const round = currentRound(t);
  for (const m of round.matches) {
    if (m.winner) continue;
    const result = simNpcMatch(rng, t.teams[m.a], t.teams[m.b], m.bestOf);
    m.maps = result.maps;
    m.scoreA = result.scoreA;
    m.scoreB = result.scoreB;
    m.winner = result.winner;
  }
}

// Complete all remaining NPC-only rounds, used by ENC after the player's
// elimination so the Nations Cup always crowns and displays a champion.
export function resolveTournamentToChampion(t, rng) {
  while (true) {
    resolveNpcMatches(t, rng);
    const round = currentRound(t);
    if (round.key === 'final') return round.matches[0].winner;
    nextBracketRound(t);
  }
}

// ── Badges & scoring ─────────────────────────────────────────────────────────

// Per-tournament badges. `series` are the player's series summaries for this
// event ({ mapsWon, mapsLost, roundDiff, won }).
export function evaluateTournament(series, champion) {
  const badges = [];
  const mapsLost = series.reduce((s, r) => s + r.mapsLost, 0);
  if (champion) badges.push({ key: 'champion', label: 'CHAMPION', desc: 'Won the tournament' });
  if (champion && mapsLost === 0) {
    badges.push({ key: 'flawless', label: 'FLAWLESS', desc: 'No maps dropped' });
  }
  return { badges, mapsLost };
}

export function updateEncRecords(records = {}, { series, champion, mapsLost, finishRound }) {
  const wins = series.filter(result => result.won).length;
  const previousBest = records.bestWins ?? 0;
  return {
    ...records,
    bestWins: Math.max(previousBest, wins),
    bestFinish: wins >= previousBest ? (champion ? 'Champion' : finishRound) : records.bestFinish,
    titles: (records.titles ?? 0) + (champion ? 1 : 0),
    flawless: (records.flawless ?? 0) + (champion && mapsLost === 0 ? 1 : 0),
  };
}

// Season summary across all tournaments. `results` are per-tournament
// objects ({ champion, series }). Endless runs can be any length, so the
// three-title slam/perfect badges only apply to fixed seasons.
export function evaluateSeason(results, { endless = false } = {}) {
  const badges = [];
  const titles = results.filter(r => r.champion).length;
  const allSeries = results.flatMap(r => r.series);
  const seriesWon = allSeries.filter(s => s.won).length;
  const mapsWon = allSeries.reduce((s, r) => s + r.mapsWon, 0);
  const mapsLost = allSeries.reduce((s, r) => s + r.mapsLost, 0);
  const roundDiff = allSeries.reduce((s, r) => s + r.roundDiff, 0);

  const grandSlam = !endless && titles === 3;
  const perfectSeason = !endless && titles === 3 && mapsLost === 0;
  if (grandSlam) {
    badges.push({ key: 'grand_slam', label: 'GRAND SLAM', desc: 'Won all three tournaments' });
  }
  if (perfectSeason) {
    badges.push({ key: 'perfect_season', label: 'PERFECT SEASON', desc: 'Three titles, zero maps dropped' });
  }

  const fixedScore = seriesWon * 100 + mapsWon * 20 + roundDiff + titles * 150 +
    (grandSlam ? 300 : 0) + (perfectSeason ? 500 : 0);
  const endlessScore = results.reduce((total, result, index) => {
    const cycle = result.cycle ?? endlessCycle(index);
    const eventSeries = result.series ?? [];
    const base = eventSeries.filter(series => series.won).length * 100 +
      eventSeries.reduce((sum, series) => sum + (series.mapsWon ?? 0) * 20 + (series.roundDiff ?? 0), 0) +
      (result.champion ? 150 : 0);
    return total + base * (1 + 0.25 * cycle);
  }, 0);
  const clearedCycles = endless ? results.filter((result, index) => (result.champion && index % 3 === 2)).length : 0;
  const score = Math.max(0, Math.round(endless ? endlessScore + clearedCycles * 200 : fixedScore));
  const bestCycle = endless ? results.reduce((best, result, index) => Math.max(best, result.cycle ?? endlessCycle(index)), 0) : undefined;

  return {
    badges, score, titles, seriesWon, mapsWon, mapsLost, roundDiff,
    grandSlam, perfectSeason, events: results.length, bestCycle,
  };
}
