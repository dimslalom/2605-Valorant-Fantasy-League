import { VALUE } from './constants.js';
import { fantasyRole } from './lineup.js';
import { scoreSeries } from './scoring.js';
import { buildValueTable } from './values.js';

// Builds a replayable campaign from finished feed matches (feed read format).
// Everything a step needs is derived only from matchdays BEFORE it, so playing
// step n can never see step n's results in prices or listings.

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
  const order = [...rounds.keys()].sort((a, b) => dayOf(a).localeCompare(dayOf(b)) || a.localeCompare(b));

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
            pid: row.vlrId, handle: row.handle ?? `#${row.vlrId}`, team: row.teamTag, agents: [], card: null,
          });
          p.agents.push(row.agent);
        }
      }
    }
    return { id: `md${i + 1}`, roundId, label: `DAY ${i + 1}`, date: dayOf(roundId), matches: list, points, mapsPlayed, teams };
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

  return { title, players, matchdays, valuesAt, seriesNext };
}
