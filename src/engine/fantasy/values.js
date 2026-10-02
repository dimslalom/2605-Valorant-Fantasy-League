import { OUTLOOK, VALUE } from './constants.js';

// Player values come from real form only and are global: identical across
// leagues and replays, computed by the pipeline and by this module alike.
// AI demand never moves value; it shows up as bids and offers instead.

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// Prior expected points per map from the card rating (82 -> 30). Feed-only
// players with no card start slightly below the pool average.
export function priorEP(card) {
  return card ? 30 + 0.6 * (card.rating - 82) : 26;
}

// mapPointsNewestFirst: fantasy points of the player's recent maps, newest first.
export function expectedPoints(mapPointsNewestFirst, prior) {
  let weight = 0;
  let sum = 0;
  mapPointsNewestFirst.forEach((points, i) => {
    const w = VALUE.decay ** i;
    weight += w;
    sum += w * points;
  });
  return (sum + VALUE.shrinkK * prior) / (weight + VALUE.shrinkK);
}

const round10 = n => Math.round(n / 10) * 10;

export function valueFromEP(ep) {
  return clamp(round10(VALUE.base * Math.exp((ep - 30) / VALUE.scale)), VALUE.min, VALUE.max);
}

// One step of the value table. `cap` limits the form move per step; the outlook
// factor is applied after the cap, so news is never capped.
export function stepValue(prevBase, { ep, outlook, cap }) {
  const target = valueFromEP(ep);
  const base = prevBase == null
    ? target
    : clamp(target, prevBase * (1 - cap), prevBase * (1 + cap));
  const rounded = round10(base);
  return { base: rounded, value: clamp(round10(rounded * OUTLOOK[outlook]), VALUE.min, VALUE.max) };
}

// Outlook from a player's status and what the campaign has ahead.
//   status: 'active' | 'contract_year' | 'free_agent' | 'benched' | 'retired'
//   ctx: { teamHasSeriesAhead, eliminatedWithLaterEvents }
export function outlookOf(status, ctx = {}) {
  if (status === 'free_agent' || status === 'benched' || status === 'retired') return 'OUT';
  if (status === 'contract_year') return 'UNCERTAIN';
  if (ctx.teamHasSeriesAhead === false) return ctx.eliminatedWithLaterEvents ? 'WAITING' : 'OUT';
  return 'ACTIVE';
}

// Build the whole table for a day. players: [{ pid, card, mapPoints, status, ctx }].
export function buildValueTable({ players, prevTable = {}, cap = VALUE.capLive }) {
  const table = {};
  for (const p of players) {
    const ep = expectedPoints(p.mapPoints, priorEP(p.card));
    const outlook = outlookOf(p.status ?? 'active', p.ctx);
    const prev = prevTable[p.pid]?.base;
    const { base, value } = stepValue(prev, { ep, outlook, cap });
    const prior = priorEP(p.card);
    table[p.pid] = { ep: Math.round(ep * 10) / 10, form: Math.round((ep - prior) * 10) / 10, o: outlook, base, v: value };
  }
  return table;
}
