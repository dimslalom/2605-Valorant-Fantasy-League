// The endless circuit ladder.
//
// Three tiers, and which one you are in IS the difficulty setting. That is
// the whole anti-spiral and anti-runaway mechanism: a squad that keeps losing
// falls to a field it can actually beat, and a squad that keeps winning is
// promoted into one that can beat it. Nothing here inspects how well the
// player is doing and quietly adjusts a number - the field changes, visibly,
// and the player is told why.

export const TIERS = ['challengers', 'ascension', 'international'];

export const TIER_META = [
  { key: 'challengers', label: 'Challengers', short: 'CHL' },
  { key: 'ascension', label: 'Ascension', short: 'ASC' },
  { key: 'international', label: 'International', short: 'INT' },
];

// A fresh squad drafts in around 82-85 power; measured field strength is
// ~76 / ~84 / ~92. Starting at Ascension therefore starts you at par, with a
// tier of headroom above and a catch-net below.
export const STARTING_TIER = 1;

// Field size per tier. The lower circuits run smaller events, which is both
// true to life and the single most effective way to make the bottom of the
// ladder winnable: a title at Challengers is three series away, not four.
// Raw power alone could never do this - the T2 org pool is too flat (rank 32
// is 82.0 power, rank 90 is 75.8), so no slice of it is weak enough to let a
// poor squad actually lift a trophy in a sixteen-team bracket.
export const TIER_FIELD_SIZE = [8, 16, 16];

// Orgs per tier band. VCT-partnered orgs are the top flight by definition, so
// the league field in the card data does the classification for us rather
// than a hand-maintained table that would drift on every card resync.
const ASCENSION_BAND = 32;

/** Which orgs carry a VCT-partnered roster. */
export function vctOrgIds(cards) {
  const ids = new Set();
  for (const card of cards) {
    if (card.org && card.league === 'vct') ids.add(card.org);
  }
  return ids;
}

/**
 * Split an eligibleOrgs() pool into the three circuit tiers, strongest first
 * within each. `pool` is already sorted by power, so the T2 split is a slice.
 */
export function tierPools(pool, cards) {
  const vct = vctOrgIds(cards);
  const international = pool.filter(org => vct.has(org.id));
  const t2 = pool.filter(org => !vct.has(org.id));
  return [t2.slice(ASCENSION_BAND), t2.slice(0, ASCENSION_BAND), international];
}

// ── Squad slots ─────────────────────────────────────────────────────────────

// Bench depth is a reward, not a starting condition: it paces the UI's
// complexity and gives a long run something to unlock besides better cards.
// A deeper squad is not a straight upgrade - a benched player goes stale and
// grows restless, so the extra slot is a rotation decision with a cost.
export const SLOT_UNLOCKS = [
  { year: 1, slots: 6 },
  { year: 3, slots: 7 },
  { year: 6, slots: 8 },
];
export const BASE_SLOTS = 5;
export const MAX_SLOTS = 8;

/** Squad size available having COMPLETED `yearsDone` years. */
export function slotsFor(yearsDone) {
  let slots = BASE_SLOTS;
  for (const unlock of SLOT_UNLOCKS) {
    if (yearsDone >= unlock.year) slots = unlock.slots;
  }
  return slots;
}

/** The unlock crossed by finishing `yearsDone` years, if any. */
export function slotUnlockAt(yearsDone) {
  return SLOT_UNLOCKS.find(unlock => unlock.year === yearsDone) ?? null;
}

// ── Placement ───────────────────────────────────────────────────────────────

// Bracket exits map to a placement bucket: champion 1, runner-up 2, losing
// semifinalist 3, and so on down to a Round-of-16 exit at 9.
const EXIT_PLACEMENT = {
  'Grand Final': 2,
  Semifinals: 3,
  Quarterfinals: 5,
  'Round of 16': 9,
};

export function placementFor(finishRound, champion) {
  if (champion) return 1;
  return EXIT_PLACEMENT[finishRound] ?? 9;
}

// ── Promotion and relegation ────────────────────────────────────────────────

// Points banked per event, settled at the end of each three-event year.
// Calibrated so promotion needs a genuinely strong year (a title plus two
// deep runs) and relegation needs a genuinely poor one (two first-round
// exits), rather than either happening on a single result.
const EVENT_POINTS = { 1: 3, 2: 2, 3: 1, 5: 0, 9: -2 };

export function eventPoints(placement) {
  return EVENT_POINTS[placement] ?? -2;
}

export const PROMOTE_AT = 5;
export const RELEGATE_AT = -4;

/**
 * Settle a completed year. Returns the movement and the tier it lands in;
 * the top and bottom tiers absorb movement that would fall off the ladder.
 */
export function yearEndMovement(tier, tierPoints) {
  if (tierPoints >= PROMOTE_AT && tier < TIERS.length - 1) {
    return { movement: 'promote', tier: tier + 1 };
  }
  if (tierPoints <= RELEGATE_AT && tier > 0) {
    return { movement: 'relegate', tier: tier - 1 };
  }
  return { movement: 'hold', tier };
}

// ── Reputation ──────────────────────────────────────────────────────────────

// Standing, not currency: it is never spent. It gates who will sign for you,
// whether you can hold off a poach, and (later) prestige eligibility. Winning
// a lower tier is worth genuinely less than a deep run at the top, so farming
// Challengers titles is not a shortcut to a reputable org.
const REPUTATION_BY_PLACEMENT = { 1: 60, 2: 40, 3: 25, 5: 12, 9: 4 };
const TIER_WEIGHT = [1, 1.5, 2.2];

export const MAX_REPUTATION = 1000;

export function reputationDelta(tier, placement) {
  const base = REPUTATION_BY_PLACEMENT[placement] ?? 4;
  return Math.round(base * (TIER_WEIGHT[tier] ?? 1));
}

const REPUTATION_RANKS = [
  { min: 0, key: 'unknown', label: 'Unknown' },
  { min: 60, key: 'local', label: 'Local Name' },
  { min: 180, key: 'respected', label: 'Respected' },
  { min: 380, key: 'contender', label: 'Contender' },
  { min: 620, key: 'elite', label: 'Elite' },
  { min: 850, key: 'dynasty', label: 'Dynasty' },
];

export function reputationRank(reputation) {
  let rank = REPUTATION_RANKS[0];
  for (const candidate of REPUTATION_RANKS) {
    if (reputation >= candidate.min) rank = candidate;
  }
  return rank;
}

/**
 * Rank plus how far through it you are, so the UI can draw a meter instead
 * of just a label and a number. `pct` is 0-100 toward `next` (null, with
 * pct 100, once there is nowhere higher to climb).
 */
export function reputationRankProgress(reputation) {
  const idx = REPUTATION_RANKS.findIndex(r => r.key === reputationRank(reputation).key);
  const rank = REPUTATION_RANKS[idx];
  const next = REPUTATION_RANKS[idx + 1] ?? null;
  const pct = next
    ? Math.max(0, Math.min(100, ((reputation - rank.min) / (next.min - rank.min)) * 100))
    : 100;
  return { rank, next, pct };
}
