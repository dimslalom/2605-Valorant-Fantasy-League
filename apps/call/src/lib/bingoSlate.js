import { validateCard } from './bingoCard.js';
import { byId } from './bingoSquares.js';

// The slate is the matches a card can use, and the lock rule says when a cell stops being editable.
// Pure: callers pass `now` (unix seconds) and the matches from the feed schedule.

// A match with no accepted stats this long after its start is void (forfeit, never ingested).
export const VOID_AFTER_S = 24 * 3600;

// Slate days are UTC so every player sees the same slate; time.js groups by the viewer's timezone.
// ponytail: a UTC day splits some late NA evenings across two slates; move the boundary if that bites.
export const slateDay = unix => new Date(unix * 1000).toISOString().slice(0, 10);

export const slateOf = (matches, day) => matches.filter(m => m.startsAt && slateDay(m.startsAt) === day);

// Same rule MatchCard uses for call locking.
export const isLocked = (match, now) => match.status !== 'upcoming' || (match.startsAt != null && match.startsAt <= now);

// Feed map (GET /api/feed/matches/:id) -> the record the square tests read.
export const fromFeedMap = map => ({
  score1: map.score[0], score2: map.score[1],
  t1_atk: map.halves?.t1.atk, t1_def: map.halves?.t1.def, t2_atk: map.halves?.t2.atk, t2_def: map.halves?.t2.def,
  players: map.players.map(p => ({ ...p, mk5: p.mk[3], cl3: p.cl[2], cl4: p.cl[3], cl5: p.cl[4] })),
});

// Full feed match (with maps) -> a result for scoreCard. Only fully ingested finals (stats rank 3, or
// 4 once settled) resolve; partial or pending stats wait, and wait forever becomes void. A forfeit is void at once.
export function resultOf(match, now) {
  if (match.forfeit) return { state: 'void' };
  if (match.status === 'final' && match.statsRank >= 3) {
    return { state: 'final', maps: match.maps.map(fromFeedMap), finalAt: match.firstFinalAt ?? match.startsAt };
  }
  return now - (match.startsAt ?? now) > VOID_AFTER_S ? { state: 'void' } : { state: 'pending' };
}

// Can this square be used on this match? Series-length rules only (see `bestOf` in bingoSquares.js).
export const available = (square, match) => !byId[square]?.bestOf || byId[square].bestOf === match?.bestOf;

// Swap cell i for `next` ({ square, matchId }). Both the cell being replaced and its replacement must
// sit on unlocked matches, so a card can't be rebuilt after seeing a result. Returns { card } or { error }.
export function editCell(card, i, next, matchesById, now) {
  const locked = id => !matchesById[id] || isLocked(matchesById[id], now);
  if (locked(card.cells[i].matchId)) return { error: 'cell is locked' };
  if (locked(next.matchId)) return { error: 'match already started' };
  if (!available(next.square, matchesById[next.matchId])) return { error: `${next.square} does not fit that match` };
  const cells = card.cells.map((c, j) => (j === i ? next : c));
  const errors = validateCard({ cells }, Object.keys(matchesById).map(Number));
  return errors.length ? { error: errors[0] } : { card: { ...card, cells } };
}

// Final server-side check when a card is saved: it must be valid against the slate, and any cell
// that differs from the stored card must be on an unlocked match.
export function checkSave(card, stored, matchesById, now) {
  const errors = validateCard(card, Object.keys(matchesById).map(Number));
  if (errors.length) return errors;
  const misfit = card.cells.findIndex(c => !available(c.square, matchesById[c.matchId]));
  if (misfit >= 0) return [`cell ${misfit}: ${card.cells[misfit].square} does not fit that match`];
  return card.cells.flatMap((c, i) => {
    const old = stored?.cells[i];
    const changed = !old || old.square !== c.square || old.matchId !== c.matchId;
    if (!changed) return [];
    const bad = [c, old].filter(Boolean).some(x => !matchesById[x.matchId] || isLocked(matchesById[x.matchId], now));
    return bad ? [`cell ${i}: locked`] : [];
  });
}
