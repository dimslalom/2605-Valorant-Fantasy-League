import { AGENT_ROLE, MAX_PER_ROLE, SLOTS, SLOT_ROLE } from './constants.js';

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

// draft: { slots: { D, I, C, F1, F2 }, bench: [pid, pid], captain }
// roleOf: pid -> role. Returns { ok, problems[] }.
export function validLineup(draft, squad, roleOf) {
  const problems = [];
  const owned = new Set(squad);
  const used = [];
  for (const slot of SLOTS) {
    const pid = draft.slots?.[slot];
    if (pid == null) { problems.push(`${slot} empty`); continue; }
    if (!owned.has(pid)) problems.push(`${slot} not owned`);
    if (used.includes(pid)) problems.push(`${slot} duplicate`);
    used.push(pid);
    const need = SLOT_ROLE[slot];
    if (need && roleOf(pid) !== need) problems.push(`${slot} needs a ${need}`);
  }
  const perRole = {};
  for (const pid of used) perRole[roleOf(pid)] = (perRole[roleOf(pid)] ?? 0) + 1;
  for (const [role, n] of Object.entries(perRole)) {
    if (n > MAX_PER_ROLE) problems.push(`more than ${MAX_PER_ROLE} ${role}s`);
  }
  if (draft.captain != null && !used.includes(draft.captain)) problems.push('captain not a starter');
  return { ok: problems.length === 0, problems };
}

// Best legal lineup by expected points weighted by series scheduled.
// epOf: pid -> EP per map. seriesOf: pid -> series this matchday (default 1).
export function autoLineup(squad, { epOf, roleOf, seriesOf = () => 1 }) {
  const score = pid => epOf(pid) * Math.max(0.2, seriesOf(pid));
  const ranked = [...squad].sort((a, b) => score(b) - score(a));
  const slots = {};
  const taken = new Set();
  for (const slot of ['D', 'I', 'C']) {
    const pick = ranked.find(pid => !taken.has(pid) && roleOf(pid) === SLOT_ROLE[slot]);
    if (pick != null) { slots[slot] = pick; taken.add(pick); }
  }
  const count = role => [...taken].filter(pid => roleOf(pid) === role).length;
  for (const slot of ['F1', 'F2']) {
    const pick = ranked.find(pid => !taken.has(pid) && count(roleOf(pid)) < MAX_PER_ROLE);
    if (pick != null) { slots[slot] = pick; taken.add(pick); }
  }
  const starters = SLOTS.map(s => slots[s]).filter(pid => pid != null);
  const bench = ranked.filter(pid => !taken.has(pid));
  const captain = [...starters].sort((a, b) => score(b) - score(a))[0] ?? null;
  return { slots, bench, captain };
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
