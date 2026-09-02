// Club stature: one scale, one rule, for you and for every rival org.
//
// The bug this fixes: with no notion of who can attract whom, every org
// reached for the best card on the board and 23 of 24 signings were icons
// going to academy sides. FlyQuest does not sign TenZ, and the reason is not
// that the game rolled badly - it is that nothing modelled pull at all.
//
// Stature is the SAME 0-1000 number as the player's reputation, read through
// the SAME ceiling ladder. That symmetry is the point: you can see where you
// rank against real clubs, and "we outbid FNATIC" means something.
//
// A club's baseline is derived by inverting the ceiling ladder at its best
// player's rating - a club can attract roughly the calibre it already has.
// That is self-calibrating (no hand-maintained prestige table to drift
// against the card data) and it matches the real pool: the median
// Challengers side's best player is 73, the median International side's 87.
// In-run results then move it, so a small club that wins genuinely becomes
// attractive and a fallen giant genuinely stops being.

import { MAX_REPUTATION, reputationRank } from './ladder.js';

// Rating a club of each standing can realistically attract. Read forwards for
// "what can I sign", backwards for "what is this club worth".
// The floor is deliberately low. SELF_REACH already guarantees every club can
// sign a little above its own best player, so the ladder does not need to
// carry the bottom of the pool - it only matters once standing outgrows the
// squad you already field. A generous floor here is what let a club whose
// best was 59 reach a 70.
export const STATURE_CEILING = {
  unknown: 62, local: 72, respected: 80, contender: 86, elite: 92, dynasty: 99,
};

// ...and a club can always reach a little above its own best player, whatever
// its standing. Without this the bottom of the ladder flattens: every club
// with a sub-70 best would share one ceiling, and a side whose best is 59
// could sign a 70. With it, pull is the HIGHER of what you have done and what
// you already field, which is the honest reading of both.
export const SELF_REACH = 2;

const LADDER = [
  { key: 'unknown', stature: 0 },
  { key: 'local', stature: 60 },
  { key: 'respected', stature: 180 },
  { key: 'contender', stature: 380 },
  { key: 'elite', stature: 620 },
  { key: 'dynasty', stature: 850 },
];

/** Ceiling from standing alone. */
export function ladderCeiling(stature) {
  return STATURE_CEILING[reputationRank(stature).key] ?? STATURE_CEILING.unknown;
}

/**
 * What a club can sign: the higher of what its standing earns and what its
 * own squad already justifies. THE one shared rule - the player and every
 * rival org are measured by this same function.
 */
export function maxSignableRating(stature, roster = null) {
  const self = roster?.length ? Math.max(...roster.map(card => card.rating)) + SELF_REACH : 0;
  return Math.max(ladderCeiling(stature), self);
}

/** The inverse: what standing does a club that fields this calibre have? */
export function statureForRating(rating) {
  let out = 0;
  for (const step of LADDER) {
    if (rating >= STATURE_CEILING[step.key]) out = step.stature;
  }
  // Interpolate inside the band so two clubs of different quality do not
  // collapse onto the same number.
  const next = LADDER.find(step => step.stature > out);
  if (!next) return MAX_REPUTATION;
  const floorKey = LADDER.find(step => step.stature === out).key;
  const span = STATURE_CEILING[next.key] - STATURE_CEILING[floorKey];
  const into = Math.max(0, Math.min(1, (rating - STATURE_CEILING[floorKey]) / (span || 1)));
  return Math.round(out + into * (next.stature - out));
}

/** A club's standing before anything it has done in this run. */
export function baselineStature(roster) {
  if (!roster?.length) return 0;
  const best = Math.max(...roster.map(card => card.rating));
  return statureForRating(best);
}

/**
 * Live standing: baseline plus what the club has earned or lost in this run.
 * Stored as a delta so the baseline stays derived from current roster quality
 * - a club that loses its stars fades even if it once won something.
 */
export function orgStature(world, orgId, roster) {
  const earned = world?.orgs?.[orgId]?.rep ?? 0;
  return Math.max(0, Math.min(MAX_REPUTATION, baselineStature(roster) + earned));
}

/** Record a result against a club's earned standing. */
export function recordOrgResult(world, orgId, delta) {
  world.orgs ??= {};
  const row = (world.orgs[orgId] ??= {});
  row.rep = Math.max(-400, Math.min(MAX_REPUTATION, (row.rep ?? 0) + delta));
  return world;
}

// ── what a club actually shops for ──────────────────────────────────────────

// Nobody signs the best player available; they sign the best player who would
// plausibly come, and mostly to fix something. The band is deliberately
// narrow at the bottom (a small club's options really are limited) and wider
// at the top (an elite club can take a punt on a project).
export const BAND_DEPTH = 14;

export function shoppingBand(stature, roster = null) {
  const ceiling = maxSignableRating(stature, roster);
  return { min: ceiling - BAND_DEPTH, max: ceiling };
}

// A small club with momentum occasionally lands someone above its level.
export const OVERREACH_CHANCE = 0.12;
export const OVERREACH_BONUS = 5;

export function overreachCeiling(stature, rng, roster = null) {
  const ceiling = maxSignableRating(stature, roster);
  return rng() < OVERREACH_CHANCE ? ceiling + OVERREACH_BONUS : ceiling;
}

const ROLE_CLASSES = ['Duelist', 'Initiator', 'Controller', 'Sentinel'];

/** Role classes this roster does not cover. */
export function roleGaps(roster) {
  const covered = new Set(roster.map(card => card.role));
  return ROLE_CLASSES.filter(role => !covered.has(role));
}

/**
 * How much this club wants this player. Rating is a floor, not the whole
 * story - filling a hole and signing someone your squad already knows both
 * count, which is why NPC rosters end up looking like plausible teams rather
 * than rating lists.
 */
export function targetScore(card, { roster, gaps }) {
  let score = card.rating;
  if (gaps.includes(card.role)) score += 6;          // fills a hole
  const countrymen = roster.filter(p => p.nationality === card.nationality).length;
  score += Math.min(4, countrymen * 2);              // a squad that speaks together
  const exTeammates = roster.filter(p => p.org && p.org === card.org).length;
  score += Math.min(3, exTeammates * 3);             // played there before
  return score;
}
