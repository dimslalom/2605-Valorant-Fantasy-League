// The transfer market.
//
// This is what turns the card pool from a slot machine into a contested
// resource. Three mechanics, all pulling against dominance:
//
//   Scarcity  - a player an NPC org signs leaves your pack pool until they
//               are released. Packs stop being a pure lottery over 922 cards.
//   Poaching  - the better you do, the harder rivals come for your best
//               player. Success costs something, which is the anti-runaway
//               half of the design.
//   Signing   - packs buy a SPECIFIC player rather than a gamble, gated on
//               reputation. This is the deterministic escape from a bad run
//               that pack luck alone cannot provide.
//
// Reputation is standing, never currency: it is spent only as leverage (to
// refuse a poach), never traded for cards. That keeps "who will play for you"
// a consequence of how you have actually done, not of hoarding.

import { pickN } from '../perfectRun.js';

import {
  baselineStature, maxSignableRating, orgStature, overreachCeiling, roleGaps,
  shoppingBand, targetScore,
} from './stature.js';

// ── scarcity ────────────────────────────────────────────────────────────────

/** Cards nobody has claimed: not on your squad, not signed by an NPC org. */
export function freeAgents(cards, squadIds, signedIds) {
  return cards.filter(card => !squadIds.has(card.id) && !signedIds[card.id]);
}

/**
 * The pool a pack draws from. Same shape as the full card list so samplePack
 * needs no changes - scarcity is expressed by what is missing from it.
 */
export function packPool(cards, squadIds, signedIds) {
  return freeAgents(cards, squadIds, signedIds);
}

// ── NPC signings ────────────────────────────────────────────────────────────

export const SIGNINGS_PER_YEAR = 4;

/**
 * Rival orgs strengthen themselves from the free pool each year.
 *
 * Every buyer shops in ITS OWN band, set by the same stature rule the player
 * is held to. Previously each org called .find() on one rating-sorted list,
 * so all of them reached for the same top card and 23 of 24 signings were
 * icons landing at academy sides. Now an academy side shops in the academy
 * bracket, and what it wants is the best FIT in that bracket - role gaps,
 * countrymen and old teammates all count - not the biggest number.
 *
 * Icons never appear here; a retired legend is an event, not a transfer.
 */
export function rollNpcSignings(rng, { pool, cards, world = null, squadIds, signedIds, count = SIGNINGS_PER_YEAR }) {
  const nextSigned = { ...signedIds };
  const news = [];
  const available = freeAgents(cards, squadIds, nextSigned)
    .filter(card => card.league !== 'icon');
  if (!available.length || !pool.length) return { signedIds: nextSigned, news };

  const buyers = pickN(rng, pool, Math.min(count, pool.length));
  for (const org of buyers) {
    const roster = org.roster ?? [];
    const stature = world ? orgStature(world, org.id, roster) : baselineStature(roster);
    const ceiling = overreachCeiling(stature, rng, roster);
    const band = shoppingBand(stature, roster);
    const weakest = [...roster].sort((a, b) => a.rating - b.rating)[0];
    if (!weakest) continue;

    const gaps = roleGaps(roster);
    const shortlist = available.filter(card => (
      !nextSigned[card.id]
      && card.rating <= ceiling
      && card.rating >= band.min
      && card.rating > weakest.rating + 1
    ));
    if (!shortlist.length) continue;

    // Best fit, not best rating.
    const target = shortlist.reduce((best, card) => (
      targetScore(card, { roster, gaps }) > targetScore(best, { roster, gaps }) ? card : best
    ));

    nextSigned[target.id] = org.id;
    news.push({
      kind: 'signing', orgId: org.id, orgName: org.name,
      cardId: target.id, player: target.player, replacedId: weakest.id,
      reach: target.rating > maxSignableRating(stature, roster),
    });
  }
  return { signedIds: nextSigned, news };
}

// ── icons ───────────────────────────────────────────────────────────────────

// A retired legend coming back is an event, not a transaction. It happens
// rarely, and the legend picks who they join - weighted by standing, so being
// the biggest club in the world is what earns the chance, not having a slot.
export const ICON_EVENT_CHANCE = 0.25;

/**
 * Roll a possible icon return. `suitors` are {id, name, stature, roster}
 * rows - the player is passed in as one of them, on the same terms.
 */
export function rollIconEvent(rng, { cards, squadIds, signedIds, suitors }) {
  if (rng() > ICON_EVENT_CHANCE) return null;
  const icons = freeAgents(cards, squadIds, signedIds).filter(card => card.league === 'icon');
  if (!icons.length || !suitors?.length) return null;

  const [icon] = pickN(rng, icons, 1);
  if (!icon) return null;

  // Only clubs who could plausibly attract them are even in the running.
  const eligible = suitors.filter(s => maxSignableRating(s.stature, s.roster) >= icon.rating);
  if (!eligible.length) return null;

  // Weighted by standing: the biggest club is favoured, not guaranteed.
  const total = eligible.reduce((sum, s) => sum + Math.max(1, s.stature), 0);
  let roll = rng() * total;
  let chosen = eligible[0];
  for (const suitor of eligible) {
    roll -= Math.max(1, suitor.stature);
    if (roll <= 0) { chosen = suitor; break; }
  }
  return { cardId: icon.id, player: icon.player, rating: icon.rating, suitor: chosen };
}

// ── poaching ────────────────────────────────────────────────────────────────

// Interest is driven by three things the player controls or earns: how good
// the player is, how long they have been left on the bench, and how much
// standing the club has. A benched icon will absolutely leave; nobody is
// coming for your benched bronze.
export const POACH_MIN_RATING = 78;

export function poachInterest({ card, dev, reputation }) {
  if (card.rating < POACH_MIN_RATING) return 0;
  const quality = (card.rating - POACH_MIN_RATING) / 18;      // 0..~1
  const restless = Math.min(1, (dev?.idle ?? 0) / 3);          // benched too long
  const shielded = Math.min(0.6, reputation / 1000);           // standing protects
  const loyalty = dev?.fi ? 0.6 : 1;
  return Math.max(0, (quality * 0.6 + restless * 0.6) * (1 - shielded) * loyalty);
}

/**
 * Reputation cost to refuse an offer. Refusing is always possible in
 * principle - it just has to cost enough that a dominant club cannot hold
 * every star forever for free.
 */
export function holdCost(card) {
  return Math.round(40 + Math.max(0, card.rating - POACH_MIN_RATING) * 12);
}

/** Packs offered in compensation when you let someone go. */
export function releaseFee(card) {
  return card.rating >= 88 ? 3 : card.rating >= 82 ? 2 : 1;
}

/**
 * Roll at most one poach offer a year. One, deliberately: a queue of
 * simultaneous offers reads as noise, while a single named rival coming for a
 * single named player is a story the player will remember.
 */
export function rollPoachOffer(rng, { squad, dev, reputation, pool, signedIds }) {
  const candidates = squad
    .map(card => ({ card, interest: poachInterest({ card, dev: dev[card.id], reputation }) }))
    .filter(entry => entry.interest > 0.15)
    .sort((a, b) => b.interest - a.interest);
  if (!candidates.length) return null;

  const [{ card, interest }] = candidates;
  if (rng() > interest) return null;

  const suitors = pool.filter(org => !Object.values(signedIds).includes(org.id)).slice(0, 12);
  const [suitor] = pickN(rng, suitors.length ? suitors : pool, 1);
  if (!suitor) return null;

  return {
    cardId: card.id,
    player: card.player,
    orgId: suitor.id,
    orgName: suitor.name,
    holdCost: holdCost(card),
    releaseFee: releaseFee(card),
  };
}

// ── targeted signings ───────────────────────────────────────────────────────

/** Packs to sign a specific player outright. */
export function signingCost(card) {
  if (card.rating >= 90) return 5;
  if (card.rating >= 85) return 4;
  if (card.rating >= 80) return 3;
  if (card.rating >= 74) return 2;
  return 1;
}

// Who will even take your call. Your reputation IS your club stature, read
// through the same ceiling as every rival org - see stature.js.
export { maxSignableRating } from './stature.js';

export function canSign(card, { packs, reputation, roster = null }) {
  // Icons are never signed over the counter; they return as an event.
  if (card.league === 'icon') return { ok: false, reason: 'icon' };
  if (card.rating > maxSignableRating(reputation, roster)) {
    return { ok: false, reason: 'reputation' };
  }
  if (packs < signingCost(card)) return { ok: false, reason: 'packs' };
  return { ok: true };
}

/**
 * A shortlist of realistic targets, best first - realistic meaning your club
 * could plausibly attract them (reputation ceiling, not signed elsewhere),
 * NOT that you can afford them this instant. The market is a shop window:
 * seeing a name here is a promise you could sign them once you have the
 * packs, not a claim you already do. `canSign`/`signingCost` still gate the
 * actual signing and tell a caller whether a given target is affordable
 * right now - that's a per-card UI state, not a reason to hide the card.
 */
export function signingTargets(cards, { squadIds, signedIds, reputation, roster = null, limit = 6 }) {
  return freeAgents(cards, squadIds, signedIds)
    .filter(card => card.league !== 'icon' && card.rating <= maxSignableRating(reputation, roster))
    .sort((a, b) => b.rating - a.rating)
    .slice(0, limit);
}

// ── prestige ────────────────────────────────────────────────────────────────

export const PRESTIGE_TIER = 2;          // International
export const PRESTIGE_MIN_TITLES = 2;
export const PRESTIGE_STEP = 0.5;

export function canPrestige({ tier, titles, prestige }) {
  if (tier < PRESTIGE_TIER) return { ok: false, reason: 'tier' };
  if (titles < PRESTIGE_MIN_TITLES) return { ok: false, reason: 'titles' };
  return { ok: true, multiplier: (prestige?.multiplier ?? 1) + PRESTIGE_STEP };
}

/**
 * Bank the run and start again harder. The banked score keeps compounding,
 * so a dominant player has a reason to walk away from a solved run instead of
 * farming it - the anti-runaway mechanic that is a CHOICE rather than a nerf.
 */
export function applyPrestige(prestige, score) {
  const level = (prestige?.level ?? 0) + 1;
  const multiplier = (prestige?.multiplier ?? 1);
  return {
    level,
    multiplier: multiplier + PRESTIGE_STEP,
    bankedScore: (prestige?.bankedScore ?? 0) + Math.round(score * multiplier),
  };
}
