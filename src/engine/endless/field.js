// Endless field construction: which sixteen teams you face, and how much the
// gap between them is allowed to decide the result.
//
// Two levers, both borrowed from the Nations Cup where they are already
// tuned and tested:
//
//   compression - how much of a team's real power gap from the field average
//     survives into the sim. 1.0 means raw roster quality decides everything
//     and the bracket is a formality; 0 means a coin flip. It is applied to
//     every team including the player, from a field average, so it is a
//     property of the competition rather than a handicap aimed at anyone.
//
//   form - a per-tournament Gaussian roll. This is what makes an upset a
//     normal event in both directions: it is why a good squad can go out in
//     the Round of 16, and why a rebuilding one can steal a title.
//
// Crucially, compression works from the FIELD's average, and each tier has
// its own. So compression makes matches inside a tier less predictable
// without eroding the gap between tiers - the ladder stays the real
// difficulty curve.

import {
  buildBracketFromTeams, eligibleOrgs, encFormLabel, pickN, tournamentForm,
} from '../perfectRun.js';
import { TIER_FIELD_SIZE, tierPools } from './ladder.js';
import { developCards } from './world.js';

export const FIELD_SIZE = 16;

export function fieldSizeFor(tier) {
  return TIER_FIELD_SIZE[tier] ?? FIELD_SIZE;
}

// Tuned in test/endlessBalance.test.js against 10-year simulated runs.
export const FIELD_COMPRESSION = 0.62;

export function endlessFieldPool(cards, pickedIds, tier, dev = null) {
  // Opponent rosters are built from DEVELOPED cards, so an org whose players
  // have grown or faded is genuinely a different team than it was in year one.
  const developed = developCards(cards, dev);
  return tierPools(eligibleOrgs(developed, pickedIds), cards)[tier] ?? [];
}

/**
 * Roll tournament form for every entrant and derive the power the sim will
 * actually use. Mirrors buildNationalBracket's treatment exactly.
 */
export function applyEndlessForm(rng, entrants, compression = FIELD_COMPRESSION) {
  const fieldAverage = entrants.reduce((sum, team) => sum + team.power, 0) / entrants.length;
  for (const team of entrants) {
    team.form = tournamentForm(rng);
    team.formLabel = encFormLabel(team.form);
    team.simulationPower = fieldAverage + (team.power - fieldAverage) * compression + team.form;
  }
  return fieldAverage;
}

/**
 * The player's sim power, recomputed from their LIVE team power rather than
 * the value frozen when the bracket was drawn. That is what keeps promoting a
 * new IGL mid-tournament a real decision: the change lands on the next map,
 * while the tournament's form roll still applies.
 */
export function endlessPlayerPower(tour, livePower) {
  if (!tour || tour.fieldAverage == null) return livePower;
  const { fieldAverage, compression } = tour;
  return fieldAverage + (livePower - fieldAverage) * compression + (tour.teams.player?.form ?? 0);
}

/**
 * Draw a tier-scoped sixteen-team bracket. Seeding still uses raw power (the
 * public form guide), while the sim uses simulationPower - so a hot underdog
 * is still seeded low and still has to beat someone to prove it.
 */
export function buildEndlessBracket(rng, cards, pickedIds, playerTeam, tier, opts = {}) {
  const compression = opts.compression ?? FIELD_COMPRESSION;
  const pool = endlessFieldPool(cards, pickedIds, tier, opts.dev);
  const npcs = pickN(rng, pool, fieldSizeFor(tier) - 1);
  const entrants = [playerTeam, ...npcs];

  const fieldAverage = applyEndlessForm(rng, entrants, compression);
  const tour = buildBracketFromTeams(entrants, opts.kind ?? 'masters');
  tour.tier = tier;
  tour.fieldAverage = fieldAverage;
  tour.compression = compression;
  return tour;
}
