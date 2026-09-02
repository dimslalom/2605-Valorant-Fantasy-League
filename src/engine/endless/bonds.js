// Per-pair chemistry: the longer two players start together, the better they
// read each other.
//
// This sits alongside the static chemistry already in teamChemistry (shared
// nationality, real-life org pairs, overlapping stints) rather than replacing
// it: those say "these two already knew each other", this says "these two
// have learned each other HERE". It is the mechanical reason to keep a core
// together rather than chase the highest-rated card every pack.
//
// Bonds decay when a pair stops playing together, so a stable five is a
// choice with a cost - every rotation and every signing spends something.
//
// NPC orgs deliberately do NOT carry per-pair bonds. 48 tracked orgs would be
// ~480 entries and ~26KB of save for a breakdown no player will ever read.
// They carry a single `cohesion` scalar instead, which lands in the same
// place numerically; see world cohesion. Only your own squad, whose
// breakdown you actually read, keeps true pairs.

export const BOND_MAX_STRENGTH = 6;   // events together, saturating
export const EVENTS_PER_STEP = 3;     // events needed per chemistry point
export const MAX_PAIR_CHEM = 2;
export const TOTAL_BOND_CHEM_CAP = 12; // ~+7 power, alongside chemistry's ~+26

/** Stable key for an unordered pair. */
export function bondKey(a, b) {
  return a < b ? `${a}~${b}` : `${b}~${a}`;
}

/** Chemistry points a raw strength is worth. */
export function pairChem(strength) {
  return Math.min(MAX_PAIR_CHEM, Math.floor((strength ?? 0) / EVENTS_PER_STEP));
}

/**
 * Everyone who started this event grows a bond with everyone else who did.
 * Returns the pairs that crossed a chemistry threshold, so the manage screen
 * can announce "X and Y are clicking" rather than silently changing a number.
 */
export function tickBondsAfterEvent(bonds, starterIds) {
  const next = { ...bonds };
  const formed = [];
  const ids = [...new Set(starterIds)];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const key = bondKey(ids[i], ids[j]);
      const before = next[key] ?? 0;
      if (before >= BOND_MAX_STRENGTH) continue;
      const after = Math.min(BOND_MAX_STRENGTH, before + 1);
      next[key] = after;
      if (pairChem(after) > pairChem(before)) {
        formed.push({ key, ids: [ids[i], ids[j]], chem: pairChem(after) });
      }
    }
  }
  return { bonds: next, formed };
}

/**
 * Pairs that did not both start fade. A pair that drops to zero is removed
 * outright so the save does not accumulate dead keys for departed players.
 */
export function decayIdleBonds(bonds, starterIds) {
  const active = new Set(starterIds);
  const next = {};
  const faded = [];
  for (const [key, strength] of Object.entries(bonds ?? {})) {
    const [a, b] = key.split('~');
    if (active.has(a) && active.has(b)) { next[key] = strength; continue; }
    const after = strength - 1;
    if (after > 0) next[key] = after;
    if (pairChem(after) < pairChem(strength)) faded.push({ key, ids: [a, b], chem: pairChem(after) });
  }
  return { bonds: next, faded };
}

/** Drop bonds for anyone no longer on the squad. */
export function pruneBonds(bonds, keepIds) {
  const keep = new Set(keepIds);
  const next = {};
  for (const [key, strength] of Object.entries(bonds ?? {})) {
    const [a, b] = key.split('~');
    if (keep.has(a) && keep.has(b)) next[key] = strength;
  }
  return next;
}

/**
 * Chemistry contribution for a fielded roster, as {total, lines} matching the
 * shape teamChemistry already uses for its own breakdown.
 */
export function bondChemistry(bonds, roster) {
  const lines = [];
  let total = 0;
  const pairs = [];
  for (let i = 0; i < roster.length; i++) {
    for (let j = i + 1; j < roster.length; j++) {
      const strength = bonds?.[bondKey(roster[i].id, roster[j].id)] ?? 0;
      const chem = pairChem(strength);
      if (chem > 0) pairs.push({ a: roster[i], b: roster[j], chem, strength });
    }
  }
  pairs.sort((x, y) => y.chem - x.chem || y.strength - x.strength);

  for (const pair of pairs) {
    if (total >= TOTAL_BOND_CHEM_CAP) break;
    const value = Math.min(pair.chem, TOTAL_BOND_CHEM_CAP - total);
    total += value;
    lines.push({ label: `${pair.a.player} & ${pair.b.player} click`, value });
  }
  return { total, lines };
}
