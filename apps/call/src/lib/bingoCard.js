import { byId } from './bingoSquares.js';

// A card is SIZE x SIZE cells, row-major. A cell binds one square to one match on today's slate:
// { square: 'ace', matchId: 753462 }. It hits if the square's test passes on ANY map of that match.
// The same square may appear on several matches, never twice on the same match.
//
// Correlation lives inside a match (squares of one cluster hit and miss together), not across
// matches, so scoring dedupes by (match, cluster) inside a line instead of capping clusters when
// the card is built.

export const SIZE = 2; // ponytail: 2x2 = 4 picks, and every pair of cells is a line. Every function takes n, so 3 is a constant flip.

// Row, column and both diagonal lines as lists of cell indices.
export function lines(n = SIZE) {
  const rows = [...Array(n)].map((_, r) => [...Array(n)].map((_, c) => r * n + c));
  const cols = [...Array(n)].map((_, c) => [...Array(n)].map((_, r) => r * n + c));
  const d1 = [...Array(n)].map((_, i) => i * n + i);
  const d2 = [...Array(n)].map((_, i) => i * n + (n - 1 - i));
  return [...rows, ...cols, d1, d2];
}

// slate = matchIds on offer. Returns a list of problems; empty means the card is valid.
export function validateCard(card, slate, n = SIZE) {
  const errors = [];
  if (!Array.isArray(card?.cells) || card.cells.length !== n * n) return [`need ${n * n} cells`];
  const seen = new Set();
  card.cells.forEach((c, i) => {
    if (!byId[c?.square]) errors.push(`cell ${i}: unknown square`);
    if (!slate.includes(c?.matchId)) errors.push(`cell ${i}: match not on the slate`);
    const key = `${c?.square}@${c?.matchId}`;
    if (seen.has(key)) errors.push(`cell ${i}: duplicate ${key}`);
    seen.add(key);
  });
  return errors;
}

// result = { state: 'pending' | 'void' | 'final', maps, finalAt }. Pending until stats are accepted;
// void (forfeit, never ingested) makes the cell a free square: it completes lines but pays nothing.
export function resolveCell(cell, result) {
  if (!result || result.state === 'pending') return 'pending';
  if (result.state === 'void') return 'free';
  const sq = byId[cell.square];
  const hit = sq.scope === 'match' ? sq.test({ maps: result.maps }) : result.maps.some(sq.test);
  return hit ? 'hit' : 'miss';
}

// results = { [matchId]: result }. Total = hit cells + line bonuses + a blackout bonus.
// Line bonus = the line's hit points with each (match, cluster) group counted once at its best cell.
// Blackout (every cell hit or free) doubles the card's cell points.
// firstLineAt = when the earliest line completed, the tiebreak (earlier wins; null if no line).
export function scoreCard(card, results, n = SIZE) {
  const state = card.cells.map(c => resolveCell(c, results[c.matchId]));
  const pts = card.cells.map((c, i) => (state[i] === 'hit' ? byId[c.square].points : 0));
  const done = i => state[i] === 'hit' || state[i] === 'free';

  let firstLineAt = null;
  const lineScores = lines(n).map(idx => {
    if (!idx.every(done)) return { idx, complete: false, bonus: 0 };
    const best = {};
    for (const i of idx) {
      const c = card.cells[i];
      const key = `${c.matchId}:${byId[c.square].cluster}`;
      best[key] = Math.max(best[key] ?? 0, pts[i]);
    }
    const bonus = Object.values(best).reduce((a, b) => a + b, 0);
    // The tiebreak clock only counts lines that paid, and only the hit cells' times: a free square has none.
    const hitTimes = idx.filter(i => state[i] === 'hit').map(i => results[card.cells[i].matchId].finalAt ?? 0);
    if (bonus > 0) {
      const at = Math.max(...hitTimes);
      if (firstLineAt === null || at < firstLineAt) firstLineAt = at;
    }
    return { idx, complete: true, bonus };
  });

  const cellTotal = pts.reduce((a, b) => a + b, 0);
  const blackout = state.every((_, i) => done(i)) ? cellTotal : 0;
  const total = cellTotal + lineScores.reduce((a, l) => a + l.bonus, 0) + blackout;
  return { total, cells: state, lines: lineScores, blackout, firstLineAt };
}
