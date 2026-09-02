// The world outside your squad.
//
// NPC orgs are subject to the same career model you are: their players grow,
// peak and fade year over year. That is what makes "the world levels up" a
// real mechanic rather than a difficulty number - the field you face in year
// six is genuinely a different field, developed by the same rules, and you
// can watch a rival's rating drift on the broadcast plate.
//
// Scope is bounded on purpose. Ticking all 159 orgs would put ~800 players in
// the save for an effect the player mostly cannot see; ticking the orgs of
// the tier they actually compete in keeps the state proportional to what is
// on screen.

import { effectiveCard, emptyDev, tickCareerYear } from './career.js';

export const MAX_TRACKED_ORGS = 48;

/**
 * Apply developed state to a card list. Only cards that have actually
 * deviated allocate a new object, so this stays cheap on the bracket path.
 */
export function developCards(cards, dev) {
  if (!dev) return cards;
  let touched = false;
  const out = cards.map(card => {
    const entry = dev[card.id];
    if (!entry) return card;
    touched = true;
    return effectiveCard(card, entry);
  });
  return touched ? out : cards;
}

/**
 * Advance one year for the orgs in `pool` (an eligibleOrgs-shaped list).
 * NPC continuity is implicit - an org's five stay together unless the card
 * data changes - so they get the same continuity relief a player earns by
 * keeping a core, which is why a long-standing org keeps its edge.
 */
export function tickWorldYear(rng, seed, pool, dev, { year, maxOrgs = MAX_TRACKED_ORGS } = {}) {
  const next = { ...dev };
  for (const org of pool.slice(0, maxOrgs)) {
    for (const player of org.roster) {
      const current = next[player.id] ?? emptyDev(player);
      const { dev: updated } = tickCareerYear(rng, seed, player, current, {
        year,
        // An NPC roster is stable by construction, so continuity accrues.
        yearsAtOrg: (current.cy ?? 0) + 1,
        rested: 0,
        cohesion: Math.min(12, (current.cy ?? 0) * 2),
      });
      next[player.id] = updated;
    }
  }
  return next;
}
