// Synthetic league context for balance tests until real replay data exists.
// Players are the real cards of the Champions 2026 teams; per-map points are
// drawn around the card prior with the spread seen in the first real matches.
import cards from '../../src/data/cards.json' with { type: 'json' };
import { mulberry32 } from '../../src/engine/perfectRun.js';
import { buildValueTable } from '../../src/engine/fantasy/values.js';

const TEAMS = new Set(['100T', 'LOUD', 'NRG', 'G2', 'TL', 'FUT', 'VIT', 'GE', 'NS', 'PRX', 'T1', 'TYL', 'JDG', 'EDG', 'XLG']);

export function synthPlayers() {
  return cards.filter(c => c.league === 'vct' && TEAMS.has(c.org)).map((c, i) => ({
    pid: i + 1, card: c, team: c.org, role: String(c.role).toLowerCase(),
  }));
}

export function synthCtx(seed = 1) {
  const rng = mulberry32(seed);
  const list = synthPlayers();
  const gauss = () => (rng() + rng() + rng() + rng() - 2) * 1.73;
  const rows = list.map(p => ({
    pid: p.pid, card: p.card,
    mapPoints: [0, 1, 2, 3].map(() => Math.round(30 + 0.6 * (p.card.rating - 82) + gauss() * 14)),
  }));
  const values = buildValueTable({ players: rows });
  return {
    players: Object.fromEntries(list.map(p => [p.pid, p])),
    values,
    seriesNext: {},
  };
}
