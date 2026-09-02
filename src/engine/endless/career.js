// Player careers: how a squad ages, grows, and fades over a long run.
//
// The design constraint that shapes everything here is the user's: a
// well-managed team must not be forced to replace a favourite card. So every
// anti-decline mechanic is a MULTIPLIER ON THE DECLINE TERM ONLY. None of
// them can flip decline into growth - a veteran always trends downward - but
// together they turn a 12-point collapse into a 5-point graceful arc, which
// is a character, not a forced transfer.
//
// Two facts from the card data drive the model:
//
//   1. `stints.from` is a months-since-year-0 integer (24241 = Feb 2020, the
//      Valorant beta; 24319 = Aug 2026). 775 of 922 cards carry one, so a
//      real career clock comes straight out of the data. Only the debut AGE
//      is synthesized, and it is a pure function of (run seed, card id) so it
//      survives a save/resume without being stored.
//
//   2. The soft stats correlate with `rating` at 0.995 - they are rating in
//      disguise. Feeding them into the sim raw would silently widen the
//      rating spread rather than add an axis, so only their RESIDUAL against
//      the rating-predicted value carries information. See softResidual.

import { hashSeed } from '../perfectRun.js';

export const NOW_MONTH = 24319;
// Bounds the value DERIVED from card data only - the data horizon is Feb
// 2020, so a pre-2020 veteran reads as ~6 years pro and no more. The clock
// keeps running normally once a run is under way.
export const MAX_DERIVED_PRO_MONTHS = 84;

// Decline steepens with age but plateaus: without this the age term grows
// without bound and a long endless run eventually deletes every veteran
// regardless of how well they are managed.
export const DECLINE_AGE_CAP = 6;

// Rating is clamped well inside the card range so drift can never manufacture
// a player better than the best card in the game.
export const RATING_FLOOR = 40;
export const RATING_CEILING = 96;
export const DRIFT_MIN = -12;
export const DRIFT_MAX = 10;
export const SOFT_MIN = -14;
export const SOFT_MAX = 14;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// ── career clock ────────────────────────────────────────────────────────────

/** Months as a professional, derived from the earliest dated stint. */
export function derivedProMonths(card) {
  const froms = (card?.stints ?? []).map(s => s.from).filter(v => typeof v === 'number');
  if (froms.length) return clamp(NOW_MONTH - Math.min(...froms), 0, MAX_DERIVED_PRO_MONTHS);
  // 147 cards carry no dated stint; tier is the best available proxy for how
  // long they have been around.
  return { icon: 84, gold: 54, silver: 40, bronze: 22 }[card?.tier] ?? 36;
}

/**
 * Age at debut. Not stored: a pure function of the run seed and card id, so
 * it is identical before and after a reload. Icons and gold-tier late joiners
 * skew older, which matches the real pattern of crossover veterans.
 */
export function debutAge(seed, card) {
  const bias = card?.league === 'icon' ? 5 : card?.tier === 'gold' ? 2 : 0;
  return 17 + bias + (hashSeed(`${seed}:${card?.id}`) % 5);
}

export function careerAge(seed, card, dev) {
  const months = dev?.p ?? derivedProMonths(card);
  return debutAge(seed, card) + Math.round(months / 12);
}

export function careerStage(seed, card, dev) {
  if (dev?.lg) return 'legend';
  const age = careerAge(seed, card, dev);
  if (age < 21) return 'prospect';
  if (age <= 25) return 'prime';
  return 'veteran';
}

export function emptyDev(card) {
  return { d: 0, a: 0, m: 0, s: 0, p: derivedProMonths(card), f: 0, cy: 0, yr: -1 };
}

// ── fatigue and the load band ───────────────────────────────────────────────

// Both extremes cost you. Playing every event burns a player out; benching
// them for too long lets them go stale. The sweet spot is roughly three
// events in four, which is what makes an unlocked bench slot a decision
// rather than a straight upgrade.
export const FATIGUE_PER_EVENT = 18;
export const FATIGUE_RECOVERY = 30;
export const FATIGUE_PENALTY_FROM = 60;
export const STALE_AFTER_EVENTS = 3;

export function tickFatigue(dev, { started }) {
  const next = { ...dev };
  if (started) {
    next.f = clamp((dev.f ?? 0) + FATIGUE_PER_EVENT, 0, 100);
    next.idle = 0;
  } else {
    next.f = clamp((dev.f ?? 0) - FATIGUE_RECOVERY, 0, 100);
    next.idle = (dev.idle ?? 0) + 1;
  }
  return next;
}

/** Rating lost to fatigue right now. Recovers fully with rest. */
export function fatiguePenalty(dev) {
  const fatigue = dev?.f ?? 0;
  return fatigue > FATIGUE_PENALTY_FROM ? (fatigue - FATIGUE_PENALTY_FROM) * 0.04 : 0;
}

// ── the effective card ──────────────────────────────────────────────────────

/**
 * The card as it is TODAY, with drift, role change and fatigue applied.
 *
 * This is the whole gating strategy for endless: hand pre-developed cards to
 * teamPower/teamChemistry/simMap and every existing formula - role coverage,
 * countrymen, ex-teammates, IGL bonuses, specialties, MVP weighting - applies
 * to developed players for free, with no branch anywhere in the engine.
 */
export function effectiveCard(card, dev) {
  if (!dev) return card;
  const penalty = fatiguePenalty(dev);
  return {
    ...card,
    role: dev.r ?? card.role,
    rating: clamp(Math.round(card.rating + (dev.d ?? 0) - penalty), RATING_FLOOR, RATING_CEILING),
    stats: {
      ...card.stats,
      ability: clamp((card.stats?.ability ?? 0) + (dev.a ?? 0), 30, 99),
      mentality: clamp((card.stats?.mentality ?? 0) + (dev.m ?? 0), 30, 99),
      synergy: clamp((card.stats?.synergy ?? 0) + (dev.s ?? 0), 30, 99),
    },
  };
}

export function effectiveRoster(cards, dev = {}) {
  return cards.map(card => effectiveCard(card, dev[card.id]));
}

// ── the soft-stat residual ──────────────────────────────────────────────────

// Fitted across all 922 cards: soft = 0.9993 * rating + 0.296, residual sd
// 0.85. At run start the mean-of-five residual is worth about +/-1 power -
// correctly almost nothing, so existing balance cannot break. It only becomes
// load-bearing once development de-correlates the axes on purpose (veterans
// lose ability but gain mentality and, with continuity, synergy), which is
// the mechanical statement of "your veterans are still worth keeping".
export const SOFT_SLOPE = 0.9993;
export const SOFT_INTERCEPT = 0.296;
export const SOFT_WEIGHT = 0.8;

export function softResidual(roster) {
  if (!roster?.length) return 0;
  let sum = 0;
  for (const player of roster) {
    const soft = ((player.stats?.ability ?? 0) + (player.stats?.mentality ?? 0)
      + (player.stats?.synergy ?? 0)) / 3;
    sum += soft - (SOFT_SLOPE * player.rating + SOFT_INTERCEPT);
  }
  return sum / roster.length;
}

// ── the year tick ───────────────────────────────────────────────────────────

// Ticked once a YEAR rather than per event: cheaper, and far more legible as
// a "here is what changed over the season" report than a trickle of noise.

export const ROLE_CHANGE_COST = 2;
const ROLE_CONVERSIONS = { Duelist: 'Controller', Initiator: 'Sentinel' };

/**
 * A fading mechanical player can convert to a strategic role. Everything it
 * pays back already exists in teamChemistry: a Controller/Sentinel IGL is
 * worth +4 chem, and re-covering a missing role class can swing +10.
 */
export function roleChangeOffer(seed, card, dev) {
  if (careerStage(seed, card, dev) !== 'veteran') return null;
  if (dev?.r) return null; // once per career
  const to = ROLE_CONVERSIONS[card.role];
  return to ? { from: card.role, to, ratingCost: ROLE_CHANGE_COST } : null;
}

export function applyRoleChange(dev, role) {
  return { ...dev, r: role, d: clamp((dev.d ?? 0) - ROLE_CHANGE_COST, DRIFT_MIN, DRIFT_MAX) };
}

export const LEGEND_TITLES = 3;

export function isLegendEligible(dev, titlesWithYou) {
  return !dev?.lg && titlesWithYou >= LEGEND_TITLES;
}

/**
 * Advance one player by a year.
 *
 * ctx: { yearsAtOrg, rested, cohesion, roleChangedThisYear, titlesWithYou }
 */
export function tickCareerYear(rng, seed, card, dev, ctx = {}) {
  const stage = careerStage(seed, card, dev);
  const age = careerAge(seed, card, dev);
  const effective = card.rating + (dev.d ?? 0);
  const room = RATING_CEILING - effective;
  const events = [];

  let base;
  if (stage === 'prospect') base = 2.2 * (room / 40);
  else if (stage === 'prime') base = 0.4;
  else if (stage === 'legend') base = 0;
  else base = -(1.4 + 0.35 * Math.min(age - 25, DECLINE_AGE_CAP));

  // The four anti-decline mechanics, all multiplicative on decline only.
  const continuity = 1 - Math.min(0.45, 0.09 * (ctx.yearsAtOrg ?? 0));
  // A converted player keeps the benefit for the rest of their career - the
  // conversion costs rating up front, so a single year of relief would make
  // taking it strictly worse than refusing it.
  const roleChange = dev.r ? 0.6 : 1;
  const rest = 1 - Math.min(0.35, 0.12 * (ctx.rested ?? 0));

  const noise = (rng() - 0.5) * 1.2;
  let drift;
  if (dev.lg) {
    // A legend is locked outright: noise included, or "stops declining" would
    // still bleed a point every few years.
    drift = 0;
  } else if (base > 0) {
    drift = base * (1 + 0.04 * (ctx.cohesion ?? 0)) + noise;
  } else {
    drift = base * continuity * roleChange * rest + noise;
  }

  const next = { ...dev };
  const before = next.d ?? 0;
  next.d = clamp(before + Math.round(drift), DRIFT_MIN, DRIFT_MAX);
  next.p = (next.p ?? derivedProMonths(card)) + 12;
  next.cy = (ctx.yearsAtOrg ?? 0);
  next.yr = ctx.year ?? next.yr;

  // Soft stats drift on a DIFFERENT schedule from rating - that separation is
  // what gives the residual term something real to measure by year three.
  const nudge = (key, amount) => {
    next[key] = clamp((next[key] ?? 0) + amount, SOFT_MIN, SOFT_MAX);
  };
  if (stage === 'prospect') { nudge('a', 2); nudge('s', 1); }
  else if (stage === 'prime') { nudge('m', 1); nudge('s', 1); }
  else if (stage === 'veteran') {
    nudge('a', -1);                                   // the body goes first
    nudge('m', 2);                                    // the head keeps growing
    nudge('s', Math.min(2, ctx.yearsAtOrg ?? 0));     // continuity pays here
  }
  if (dev.r) nudge('s', 2);

  if (next.d !== before) {
    events.push({ kind: next.d > before ? 'growth' : 'decline', id: card.id, n: next.d - before });
  }
  return { dev: next, events, stage };
}

// ── assembling a developed squad's power ────────────────────────────────────

/**
 * Team power for an endless squad: developed cards, per-pair bonds, and the
 * soft-stat residual, folded into the ordinary engine call. Keeping this in
 * one place means the manage screen, the bracket and the sim can never
 * disagree about what a squad is worth.
 */
export function endlessTeamPower(teamPower, bondChemistry, roster, iglId, bonds) {
  return teamPower(roster, iglId, {
    extra: bondChemistry(bonds ?? {}, roster),
    soft: softResidual(roster) * SOFT_WEIGHT,
  });
}

// ── what to SHOW about a player ─────────────────────────────────────────────

/**
 * Everything a surface needs to render a player's development without
 * narrating it. Returns data, not sentences: an age, a stage, a direction and
 * a ceiling, so the UI can draw them rather than describe them.
 *
 *   age      the number itself - 19 beside an 84 already says "potential"
 *   stage    prospect | prime | veteran | legend, a chip like a role or flag
 *   trend    -1 | 0 | +1, from what has ACTUALLY happened, not a projection
 *   rating   where they are now
 *   ceiling  where this stage can still take them, for a headroom bar
 */
export function cardSignals(seed, card, dev = null) {
  const stage = careerStage(seed, card, dev);
  const rating = effectiveCard(card, dev).rating;
  const drift = dev?.d ?? 0;

  // Headroom is what the stage can still add, bounded by the same clamps the
  // tick itself respects - so the bar can never promise more than the model
  // can deliver.
  const remaining = stage === 'prospect' ? Math.min(DRIFT_MAX - drift, 10)
    : stage === 'prime' ? Math.min(DRIFT_MAX - drift, 3)
      : 0;

  return {
    age: careerAge(seed, card, dev),
    stage,
    trend: drift === 0 ? 0 : Math.sign(drift),
    drift,
    rating,
    ceiling: Math.min(RATING_CEILING, rating + Math.max(0, remaining)),
    legend: Boolean(dev?.lg),
  };
}

export const STAGE_LABEL = {
  prospect: 'Prospect', prime: 'Prime', veteran: 'Veteran', legend: 'Legend',
};
