import { AGENT_ROLE, SLOTS } from './constants.js';

// Fantasy role: the role class of the agent played most in the last 10 maps,
// falling back to the card role. Fixed per event, never changed mid-event.
export function fantasyRole(recentAgents, cardRole = null) {
  const counts = {};
  for (const agent of recentAgents.slice(0, 10)) {
    const role = AGENT_ROLE[agent];
    if (role) counts[role] = (counts[role] ?? 0) + 1;
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return top ? top[0] : (cardRole ? String(cardRole).toLowerCase() : 'flex');
}

// draft: { slots: { S1..S5 }, captain }. Any five distinct players you own, any roles.
// Returns { ok, problems[] }. (roleOf is accepted and ignored so older callers still work.)
export function validLineup(draft, squad) {
  const problems = [];
  const owned = new Set(squad);
  const used = [];
  for (const slot of SLOTS) {
    const pid = draft.slots?.[slot];
    if (pid == null) { problems.push(`${slot} empty`); continue; }
    if (!owned.has(pid)) problems.push(`${slot} not owned`);
    if (used.includes(pid)) problems.push(`${slot} duplicate`);
    used.push(pid);
  }
  if (draft.captain != null && !used.includes(draft.captain)) problems.push('captain not a starter');
  return { ok: problems.length === 0, problems };
}

// Best five by expected points weighted by series scheduled. Used for the AI managers
// only: the human always builds their own lineup.
export function autoLineup(squad, { epOf, seriesOf = () => 1 }) {
  const score = pid => epOf(pid) * Math.max(0.2, seriesOf(pid));
  const ranked = [...squad].sort((a, b) => score(b) - score(a) || a - b);
  const slots = {};
  SLOTS.forEach((slot, i) => { if (ranked[i] != null) slots[slot] = ranked[i]; });
  const starters = SLOTS.map(sl => slots[sl]).filter(pid => pid != null);
  const bench = ranked.filter(pid => !starters.includes(pid));
  return { slots, bench, captain: starters[0] ?? null };
}

// At settle: a starter who played no maps is replaced by the first bench player
// (in bench order) who did. Role does not matter for subs, and each bench player
// subs once. The captain, if absent, doubles nobody.
export function applyAutoSubs(locked, mapsPlayedOf) {
  const bench = [...(locked.bench ?? [])];
  const starters = {};
  const subs = [];
  for (const slot of SLOTS) {
    const pid = locked.slots[slot];
    if (pid != null && mapsPlayedOf(pid) === 0) {
      const idx = bench.findIndex(b => mapsPlayedOf(b) > 0);
      if (idx >= 0) {
        const [sub] = bench.splice(idx, 1);
        starters[slot] = sub;
        subs.push({ slot, out: pid, in: sub });
        continue;
      }
    }
    starters[slot] = pid;
  }
  const captain = locked.captain != null && mapsPlayedOf(locked.captain) > 0 ? locked.captain : null;
  return { starters, subs, captain };
}
