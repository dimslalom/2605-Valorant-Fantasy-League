import { VALUE } from './constants.js';
import { fantasyRole } from './lineup.js';
import { scoreSeries } from './scoring.js';
import { buildValueTable } from './values.js';

// Builds a replayable campaign from finished feed matches (feed read format).
// Everything a step needs is derived only from matchdays BEFORE it, so playing
// step n can never see step n's results in prices or listings.

export const MIN_TEAMS = 12;
export const MAX_DAYS = 3;
const dayOf = roundId => String(roundId ?? '').split(':')[1] ?? '';
const cardKey = (handle, tag) => `${String(handle).toLowerCase()}|${String(tag).toLowerCase()}`;

// Join a feed player to a card by handle + team tag; fall back to a unique handle.
export function makeCardLookup(cards) {
  const exact = new Map(cards.map(c => [cardKey(c.player, c.org), c]));
  const byHandle = new Map();
  for (const c of cards) {
    const k = String(c.player).toLowerCase();
    byHandle.set(k, byHandle.has(k) ? null : c);
  }
  return (handle, tag) => exact.get(cardKey(handle, tag)) ?? byHandle.get(String(handle).toLowerCase()) ?? null;
}

export function buildReplay({ matches, cards = [], title = 'Replay' }) {
  const lookup = makeCardLookup(cards);
  const rounds = new Map();
  for (const m of matches) {
    const key = m.roundId ?? `x:${m.startsAt}`;
    if (!rounds.has(key)) rounds.set(key, []);
    rounds.get(key).push(m);
  }
  const dayKeys = [...rounds.keys()].sort((a, b) => dayOf(a).localeCompare(dayOf(b)) || a.localeCompare(b));

  // A group-stage day may only cover a few teams, which leaves most of a squad
  // idle. Merge consecutive group-stage days until the matchday covers at least
  // MIN_TEAMS teams (at most MAX_DAYS days). Bracket rounds are never merged: who
  // plays in a semifinal depends on the quarterfinal results.
  const isGroup = key => rounds.get(key).every(m => m.stage === 'Group Stage');
  const groups = [];
  for (const key of dayKeys) {
    const last = groups[groups.length - 1];
    const teamsOf = ks => new Set(ks.flatMap(k => rounds.get(k).flatMap(m => m.teams.map(t => t.tag))));
    if (last && isGroup(key) && last.every(isGroup) && last.length < MAX_DAYS && teamsOf(last).size < MIN_TEAMS) last.push(key);
    else groups.push([key]);
  }
  const order = groups.map(g => g.join('+'));
  groups.forEach(g => rounds.set(g.join('+'), g.flatMap(k => rounds.get(k))));

  const players = {};
  const matchdays = order.map((roundId, i) => {
    const list = rounds.get(roundId).sort((a, b) => (a.startsAt ?? 0) - (b.startsAt ?? 0));
    const points = new Map();
    const mapsPlayed = new Map();
    const teams = new Set();
    for (const match of list) {
      match.teams.forEach(t => teams.add(t.tag));
      for (const [pid, entry] of scoreSeries(match)) {
        points.set(pid, entry);
        mapsPlayed.set(pid, entry.maps.length);
      }
      for (const map of match.maps) {
        for (const row of map.players) {
          const p = (players[row.vlrId] ??= {
            pid: row.vlrId, handle: row.handle ?? `#${row.vlrId}`, team: row.teamTag, agents: [], maps: 0, card: null,
          });
          p.agents.push(row.agent);
          p.maps += 1;
        }
      }
    }
    const days = roundId.split('+').map(dayOf);
    return { id: `md${i + 1}`, roundId, label: `MATCHDAY ${i + 1}`, date: days[0], days, matches: list, points, mapsPlayed, teams };
  });

  for (const p of Object.values(players)) {
    p.card = lookup(p.handle, p.team);
    p.role = fantasyRole(p.agents, p.card?.role);
    delete p.agents;
  }

  // Prices and series-ahead flags per step, built sequentially from earlier days only.
  const history = Object.fromEntries(Object.keys(players).map(pid => [pid, []]));
  const valuesAt = [];
  const seriesNext = [];
  let prev = {};
  matchdays.forEach((md, i) => {
    const ahead = new Set(matchdays.slice(i).flatMap(d => [...d.teams]));
    const table = buildValueTable({
      cap: VALUE.capReplay,
      prevTable: prev,
      players: Object.values(players).map(p => ({
        pid: p.pid,
        card: p.card,
        mapPoints: history[p.pid],
        status: 'active',
        ctx: { teamHasSeriesAhead: ahead.has(p.team) },
      })),
    });
    valuesAt.push(table);
    prev = table;
    seriesNext.push(Object.fromEntries(Object.values(players).map(p => [p.pid, md.teams.has(p.team) ? 1 : 0])));
    // After the step is priced, its results become history for the next step (newest first).
    for (const [pid, entry] of md.points) history[pid] = [...entry.maps.map(m => m.total).reverse(), ...history[pid]];
  });

  // Real orgs a manager can take over: each team's five most-used players.
  const names = {};
  for (const m of matches) for (const t of m.teams) if (t.tag && t.name) names[t.tag] = t.name;
  const byTeam = {};
  for (const p of Object.values(players)) (byTeam[p.team] ??= []).push(p);
  const orgs = {};
  for (const [tag, list] of Object.entries(byTeam)) {
    if (list.length < 5) continue;
    const top = [...list].sort((a, b) => b.maps - a.maps || a.pid - b.pid).slice(0, 5);
    const ep = top.reduce((sum, p) => sum + (valuesAt[0]?.[p.pid]?.ep ?? 0), 0) / 5;
    orgs[tag] = { tag, name: names[tag] ?? tag, pids: top.map(p => p.pid), strength: Math.round(ep * 10) / 10 };
  }

  return { title, players, matchdays, valuesAt, seriesNext, orgs };
}

// Mean expected points of a team's best five, from a value table. A rough team
// strength for reading matchups; the same number the player sees for every team.
export function teamStrengths(players, values) {
  const byTeam = {};
  for (const p of Object.values(players)) (byTeam[p.team] ??= []).push(values[p.pid]?.ep ?? 0);
  return Object.fromEntries(Object.entries(byTeam).map(([team, list]) => {
    const top = list.sort((a, b) => b - a).slice(0, 5);
    return [team, Math.round((top.reduce((x, y) => x + y, 0) / top.length) * 10) / 10];
  }));
}

// What a manager's effective starters did on each map of a matchday, in order,
// for the broadcast replay. `starters` are pids after auto-subs, `captain` doubles.
export function playbackSteps(md, starters, captain) {
  const steps = [];
  const mine = new Set(starters);
  for (const match of md.matches) {
    match.maps.forEach((map, mapIdx) => {
      const lines = [];
      for (const row of map.players) {
        if (!mine.has(row.vlrId)) continue;
        const entry = md.points.get(row.vlrId)?.maps.find(m => m.gameId === map.gameId);
        if (!entry) continue;
        const tags = [];
        if (row.mk[3] > 0) tags.push('ACE');
        else if (row.mk[2] > 0) tags.push('4K');
        const clutch = row.cl.map((n, i) => (n > 0 ? i + 1 : 0)).filter(Boolean).pop();
        if (clutch) tags.push(`CLUTCH 1v${clutch}`);
        if (entry.lines.mvp > 0) tags.push('MVP');
        lines.push({ pid: row.vlrId, points: entry.total, counted: row.vlrId === captain ? entry.total * 2 : entry.total, tags });
      }
      steps.push({
        key: `${match.matchId}:${map.gameId}`,
        teams: match.teams.map(t => t.tag),
        map: map.map,
        mapNo: mapIdx + 1,
        score: map.score,
        lines,
      });
    });
  }
  return steps;
}
