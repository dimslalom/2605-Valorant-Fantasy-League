// The youth academy: one free prospect a year.
//
// This is the half of the anti-spiral fix that does not depend on winning.
// Relegation finds you a field you can beat; the academy guarantees that even
// a run with no titles and no packs still has a development path.
//
// The prospect is a REAL card from the free pool with its career clock reset
// to zero, not a generated player. Generated names would have no photo, head
// cutout, org or kit, so they would render as a hole in every surface that
// draws a portrait. Resetting a real bronze T2 card instead costs nothing,
// reuses every asset, and tells a better story: an unknown from the lower
// divisions who becomes an 80 in four years.

import { careerStage, debutAge } from './career.js';
import { pickN } from '../perfectRun.js';

export const PROSPECT_MAX_RATING = 70;
export const PROSPECT_MIN_RATING = 52;

export const PROSPECT_MAX_AGE = 20;

/**
 * Cards that can plausibly be an unknown teenager with room to grow.
 *
 * Zeroing the career clock is not on its own enough to make someone a
 * prospect: careerAge is debutAge + years served, and a gold-tier debut age
 * can already be 21. So the academy draws only from players whose debut age
 * is genuinely young - it signs teenagers, which is what an academy is.
 */
export function prospectPool(cards, excludedIds, seed = 0) {
  return cards.filter(card => (
    card.org
    && card.league !== 'icon'
    && card.rating >= PROSPECT_MIN_RATING
    && card.rating <= PROSPECT_MAX_RATING
    && !excludedIds.has(card.id)
    && debutAge(seed, card) < PROSPECT_MAX_AGE
  ));
}

/**
 * Draw this year's prospect. Returns the card plus the dev state that makes
 * them a prospect: a zeroed career clock, which puts them in the fast-growth
 * stage regardless of what their stint history says.
 */
export function rollYouthProspect(rng, cards, excludedIds, seed = 0) {
  const pool = prospectPool(cards, excludedIds, seed);
  if (!pool.length) return null;
  const [card] = pickN(rng, pool, 1);
  if (!card) return null;
  return {
    cardId: card.id,
    // p: 0 is the whole mechanism - careerAge falls back to the debut age, so
    // careerStage reads 'prospect' and tickCareerYear uses the headroom-scaled
    // growth curve instead of a decline curve.
    dev: { d: 0, a: 0, m: 0, s: 0, p: 0, f: 0, cy: 0, yr: -1 },
  };
}

/** Sanity helper for tests and UI copy. */
export function isProspect(seed, card, dev) {
  return careerStage(seed, card, dev) === 'prospect';
}
