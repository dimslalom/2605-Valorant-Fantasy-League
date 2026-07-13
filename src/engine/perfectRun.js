// Perfect Run game engine.
// Draft-by-nationality rolls, team chemistry, and a seeded tournament
// simulator: a 24-team VCT Champions field where every match is simulated,
// not just the player's. Ratings come from cards.json (approximations for
// game balance, not official stats).
//
// The tournament object is plain data (teams, rounds, matches, records) so a
// future multiplayer mode can assign any match to a human instead of the sim.

// ── Seeded RNG ───────────────────────────────────────────────────────────────

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function todaySeed() {
  const d = new Date();
  return hashSeed(`vfl-daily-${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`);
}

function pickN(rng, arr, n) {
  const pool = [...arr];
  const out = [];
  while (out.length < n && pool.length) {
    out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  }
  return out;
}

// ── Draft ────────────────────────────────────────────────────────────────────

export const ROSTER_SIZE = 5;

// Roll a nationality, weighted by sqrt of its remaining player pool so big
// regions are more common without drowning out everyone else.
export function rollNationality(rng, cards, pickedIds) {
  const pools = {};
  for (const c of cards) {
    if (pickedIds.has(c.id)) continue;
    (pools[c.nationality] ??= []).push(c);
  }
  const entries = Object.entries(pools).filter(([, list]) => list.length >= 1);
  const weights = entries.map(([, list]) => Math.sqrt(list.length));
  const total = weights.reduce((s, w) => s + w, 0);
  let roll = rng() * total;
  for (let i = 0; i < entries.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return entries[i][0];
  }
  return entries[entries.length - 1][0];
}

// Up to 5 random players of that nationality, best rating first.
export function draftChoices(rng, cards, nationality, pickedIds, n = 5) {
  const pool = cards.filter(c => c.nationality === nationality && !pickedIds.has(c.id));
  return pickN(rng, pool, n).sort((a, b) => b.rating - a.rating);
}

// ── Chemistry & team power ───────────────────────────────────────────────────

const ROLE_CLASSES = ['Duelist', 'Initiator', 'Controller', 'Sentinel'];

export function teamChemistry(roster, iglId) {
  const lines = [];
  let chem = 0;

  // Role coverage: reward all 4 classes, punish stacking
  const roleCount = {};
  for (const p of roster) roleCount[p.role] = (roleCount[p.role] ?? 0) + 1;
  const covered = ROLE_CLASSES.filter(r => roleCount[r]);
  if (covered.length === 4) {
    chem += 6;
    lines.push({ label: 'Full role coverage', value: +6 });
  } else {
    const missing = ROLE_CLASSES.filter(r => !roleCount[r]);
    chem -= missing.length * 4;
    lines.push({ label: `Missing: ${missing.join(', ')}`, value: -missing.length * 4 });
  }
  for (const [role, n] of Object.entries(roleCount)) {
    if (n > 2) {
      chem -= (n - 2) * 3;
      lines.push({ label: `${n}x ${role} stack`, value: -(n - 2) * 3 });
    }
  }

  // Countryman pairs
  let natPairs = 0;
  for (let i = 0; i < roster.length; i++) {
    for (let j = i + 1; j < roster.length; j++) {
      if (roster[i].nationality === roster[j].nationality) natPairs++;
    }
  }
  if (natPairs) {
    const bonus = Math.min(natPairs * 2, 8);
    chem += bonus;
    lines.push({ label: `${natPairs} countryman pair${natPairs > 1 ? 's' : ''}`, value: +bonus });
  }

  // Real-life teammate pairs (same org)
  let orgPairs = 0;
  for (let i = 0; i < roster.length; i++) {
    for (let j = i + 1; j < roster.length; j++) {
      if (roster[i].org === roster[j].org) orgPairs++;
    }
  }
  if (orgPairs) {
    const bonus = Math.min(orgPairs * 3, 9);
    chem += bonus;
    lines.push({ label: `${orgPairs} real teammate pair${orgPairs > 1 ? 's' : ''}`, value: +bonus });
  }

  // Ran it back: pairs who played on the same team in the past (overlapping
  // stints, hidden card data), excluding current teammates already counted.
  let pastPairs = 0;
  for (let i = 0; i < roster.length; i++) {
    for (let j = i + 1; j < roster.length; j++) {
      if (roster[i].org === roster[j].org) continue;
      if (stintsOverlap(roster[i].stints, roster[j].stints)) pastPairs++;
    }
  }
  if (pastPairs) {
    const bonus = Math.min(pastPairs * 2, 6);
    chem += bonus;
    lines.push({ label: `${pastPairs} pair${pastPairs > 1 ? 's' : ''} played together before`, value: +bonus });
  }

  // IGL: strategic roles make better callers, and a real IGL pays extra
  const igl = roster.find(p => p.id === iglId);
  if (igl) {
    const bonus = { Controller: 4, Sentinel: 4, Initiator: 2 }[igl.role] ?? 0;
    chem += bonus;
    lines.push({ label: `IGL ${igl.player} (${igl.role})`, value: bonus > 0 ? `+${bonus}` : '+0' });
    if (igl.igl) {
      chem += 6;
      lines.push({ label: `${igl.player} is a real IGL`, value: +6 });
    }
  }

  return { total: chem, lines };
}

// Did two players share a team at the same time? Stints are {org, from, to}
// (year-month integers; null to = still there, null from = unknown start).
function stintsOverlap(a = [], b = []) {
  for (const sa of a) {
    for (const sb of b) {
      if (sa.org.toLowerCase() !== sb.org.toLowerCase()) continue;
      const aFrom = sa.from ?? -Infinity, aTo = sa.to ?? Infinity;
      const bFrom = sb.from ?? -Infinity, bTo = sb.to ?? Infinity;
      if (aFrom <= bTo && bFrom <= aTo) return true;
    }
  }
  return false;
}

export function teamPower(roster, iglId) {
  const base = roster.reduce((s, p) => s + p.rating, 0) / roster.length;
  const chem = teamChemistry(roster, iglId);
  return { base, chem: chem.total, power: base + chem.total * 0.6, lines: chem.lines };
}

// ── Maps & match sim ─────────────────────────────────────────────────────────

export const MAP_POOL = ['Ascent', 'Bind', 'Haven', 'Lotus', 'Split', 'Sunset', 'Icebox'];

export function pickMaps(rng, n) {
  return pickN(rng, MAP_POOL, n);
}

// Simulate one map round-by-round. Returns the full round sequence so the UI
// can animate it, plus the final score and a map MVP from the winning side.
export function simMap(rng, powerA, powerB, rosterA, rosterB) {
  const p = 1 / (1 + Math.pow(10, (powerB - powerA) / 25));
  const rounds = []; // 'A' | 'B'
  let a = 0, b = 0;
  while (true) {
    // First to 13; overtime win-by-2, hard cap 19-17
    const done = (a >= 13 || b >= 13) && Math.abs(a - b) >= 2;
    if (done || a >= 19 || b >= 19) break;
    // small per-round momentum wobble
    const wobble = (rng() - 0.5) * 0.06;
    if (rng() < Math.min(0.92, Math.max(0.08, p + wobble))) { a++; rounds.push('A'); }
    else { b++; rounds.push('B'); }
  }
  const winA = a > b;
  const winners = winA ? rosterA : rosterB;
  const weights = winners.map(pl => pl.stats.aim + pl.rating);
  const total = weights.reduce((s, w) => s + w, 0);
  let roll = rng() * total;
  let mvp = winners[0];
  for (let i = 0; i < winners.length; i++) {
    roll -= weights[i];
    if (roll <= 0) { mvp = winners[i]; break; }
  }
  return { a, b, winA, rounds, mvp };
}

// Simulate a whole NPC series in one call (no animation data needed).
export function simNpcMatch(rng, teamA, teamB, bestOf) {
  const needed = Math.ceil(bestOf / 2);
  const maps = pickMaps(rng, bestOf);
  const played = [];
  let scoreA = 0, scoreB = 0;
  for (const map of maps) {
    if (scoreA >= needed || scoreB >= needed) break;
    const r = simMap(rng, teamA.power, teamB.power, teamA.roster, teamB.roster);
    played.push({ map, a: r.a, b: r.b });
    if (r.winA) scoreA++; else scoreB++;
  }
  return { maps: played, scoreA, scoreB, winner: scoreA > scoreB ? teamA.id : teamB.id };
}

// ── Tournament ───────────────────────────────────────────────────────────────
//
// 24 teams. Bottom 16 seeds (player included) enter the Play-In; 8 winners
// join the top 8 seeds in a 3-round Swiss group stage (record pairing, two
// losses eliminates, teams already on two wins play round 3 for seeding).
// The 8 qualified teams play a single-elimination bracket: QF, SF, GF Bo5.

export const STAGE_KEYS = ['playin', 'swiss1', 'swiss2', 'swiss3', 'quarter', 'semi', 'final'];

export const STAGE_META = {
  playin:  { label: 'Play-In',       bestOf: 3, swiss: false },
  swiss1:  { label: 'Group Round 1', bestOf: 3, swiss: true },
  swiss2:  { label: 'Group Round 2', bestOf: 3, swiss: true },
  swiss3:  { label: 'Group Round 3', bestOf: 3, swiss: true },
  quarter: { label: 'Quarterfinals', bestOf: 3, swiss: false },
  semi:    { label: 'Semifinals',    bestOf: 3, swiss: false },
  final:   { label: 'Grand Final',   bestOf: 5, swiss: false },
};

export function buildField(rng, cards, pickedIds, playerTeam) {
  const byOrg = {};
  for (const c of cards) (byOrg[c.org] ??= []).push(c);

  const eligible = Object.entries(byOrg)
    .filter(([, list]) => list.length >= 5 && list.every(p => !pickedIds.has(p.id)))
    .map(([org, list]) => {
      const roster = [...list].sort((a, b) => b.rating - a.rating).slice(0, 5);
      return {
        id: org,
        tag: org,
        name: roster[0].org_name ?? org,
        logo: roster[0].org_logo,
        roster,
        power: roster.reduce((s, p) => s + p.rating, 0) / 5,
        isPlayer: false,
      };
    });

  // With tier-2 orgs in the pool, a fully random field would be too easy.
  // Draw the 23 opponents from the strongest 32 orgs so the field stays
  // Champions-caliber with the occasional tier-2 giant-killer.
  const contenders = eligible.sort((a, b) => b.power - a.power).slice(0, 32);
  const npcs = pickN(rng, contenders, 23).sort((a, b) => b.power - a.power);
  const teams = { [playerTeam.id]: playerTeam };
  for (const t of npcs) teams[t.id] = t;

  return {
    teams,
    seedIds: npcs.slice(0, 8).map(t => t.id),                 // straight to groups
    playInIds: [...npcs.slice(8).map(t => t.id), playerTeam.id], // 16 incl. player
    rounds: [],
    records: {},   // swiss only: { teamId: { w, l } }
    stageIdx: -1,
  };
}

function makeMatch(aId, bId, bestOf, pool) {
  // Player always sits on side A of their own match, simpler for the UI.
  const [a, b] = bId === 'player' ? [bId, aId] : [aId, bId];
  return {
    a, b, bestOf, pool,
    maps: null, scoreA: 0, scoreB: 0, winner: null,
    isPlayerMatch: a === 'player' || b === 'player',
  };
}

function priorOpponents(t, teamId) {
  const opps = new Set();
  for (const round of t.rounds) {
    if (!STAGE_META[round.key].swiss) continue;
    for (const m of round.matches) {
      if (m.a === teamId) opps.add(m.b);
      if (m.b === teamId) opps.add(m.a);
    }
  }
  return opps;
}

// Pair a pool of team ids, reshuffling a few times to avoid Swiss rematches.
function pairPool(t, rng, ids, bestOf, poolLabel) {
  for (let attempt = 0; attempt < 24; attempt++) {
    const order = pickN(rng, ids, ids.length);
    let ok = true;
    for (let i = 0; i < order.length; i += 2) {
      if (priorOpponents(t, order[i]).has(order[i + 1])) { ok = false; break; }
    }
    if (ok || attempt === 23) {
      const matches = [];
      for (let i = 0; i < order.length; i += 2) {
        matches.push(makeMatch(order[i], order[i + 1], bestOf, poolLabel));
      }
      return matches;
    }
  }
  return [];
}

function roundByKey(t, key) {
  return t.rounds.find(r => r.key === key);
}

// Total round differential across all played maps, used for playoff seeding.
function roundDiffOf(t, teamId) {
  let diff = 0;
  for (const round of t.rounds) {
    for (const m of round.matches) {
      if (!m.maps) continue;
      for (const mp of m.maps) {
        if (m.a === teamId) diff += mp.a - mp.b;
        if (m.b === teamId) diff += mp.b - mp.a;
      }
    }
  }
  return diff;
}

// Generate pairings for the next stage and append the round (matches pending).
export function generateNextRound(t, rng) {
  const idx = t.stageIdx + 1;
  const key = STAGE_KEYS[idx];
  if (!key) return null;
  const meta = STAGE_META[key];
  let matches = [];

  if (key === 'playin') {
    matches = pairPool(t, rng, t.playInIds, meta.bestOf, 'Play-In');
  } else if (key === 'swiss1') {
    const winners = roundByKey(t, 'playin').matches.map(m => m.winner);
    for (const id of [...t.seedIds, ...winners]) t.records[id] = { w: 0, l: 0 };
    // Seeded round 1: group seeds face play-in winners
    const shuffled = pickN(rng, winners, winners.length);
    matches = t.seedIds.map((s, i) => makeMatch(s, shuffled[i], meta.bestOf, '0-0'));
  } else if (key === 'swiss2' || key === 'swiss3') {
    // Everyone below two losses plays; teams on two wins play round 3 for seeding.
    const pools = {};
    for (const [id, r] of Object.entries(t.records)) {
      if (r.l >= 2) continue;
      (pools[`${r.w}-${r.l}`] ??= []).push(id);
    }
    const poolOrder = Object.keys(pools).sort((x, y) => Number(y[0]) - Number(x[0]));
    for (const label of poolOrder) {
      matches.push(...pairPool(t, rng, pools[label], meta.bestOf, label));
    }
  } else if (key === 'quarter') {
    const qualified = Object.entries(t.records)
      .filter(([, r]) => r.w >= 2)
      .map(([id]) => id)
      .sort((x, y) => {
        const rx = t.records[x], ry = t.records[y];
        if (ry.w !== rx.w) return ry.w - rx.w;
        return roundDiffOf(t, y) - roundDiffOf(t, x);
      });
    // Bracket order: SF1 comes from QF1/QF2, SF2 from QF3/QF4
    const s = qualified;
    matches = [
      makeMatch(s[0], s[7], meta.bestOf, 'Playoffs'),
      makeMatch(s[3], s[4], meta.bestOf, 'Playoffs'),
      makeMatch(s[1], s[6], meta.bestOf, 'Playoffs'),
      makeMatch(s[2], s[5], meta.bestOf, 'Playoffs'),
    ];
  } else if (key === 'semi') {
    const qf = roundByKey(t, 'quarter').matches;
    matches = [
      makeMatch(qf[0].winner, qf[1].winner, meta.bestOf, 'Playoffs'),
      makeMatch(qf[2].winner, qf[3].winner, meta.bestOf, 'Playoffs'),
    ];
  } else if (key === 'final') {
    const sf = roundByKey(t, 'semi').matches;
    matches = [makeMatch(sf[0].winner, sf[1].winner, meta.bestOf, 'Playoffs')];
  }

  // Player match first so the board leads with it
  matches.sort((a, b) => Number(b.isPlayerMatch) - Number(a.isPlayerMatch));
  t.rounds.push({ key, label: meta.label, bestOf: meta.bestOf, matches });
  t.stageIdx = idx;
  return t.rounds[t.rounds.length - 1];
}

export function currentRound(t) {
  return t.rounds[t.rounds.length - 1] ?? null;
}

export function playerMatch(t) {
  return currentRound(t)?.matches.find(m => m.isPlayerMatch) ?? null;
}

// Write the player's finished series into their pending match.
export function setPlayerResult(t, playedMaps, playerWon) {
  const m = playerMatch(t);
  if (!m) return;
  m.maps = playedMaps.map(r => ({ map: r.map, a: r.a, b: r.b }));
  m.scoreA = playedMaps.filter(r => r.winA).length;
  m.scoreB = playedMaps.length - m.scoreA;
  m.winner = playerWon ? m.a : m.b;
}

// Sim every unresolved NPC match in the current round.
export function resolveNpcMatches(t, rng) {
  const round = currentRound(t);
  for (const m of round.matches) {
    if (m.winner) continue;
    const result = simNpcMatch(rng, t.teams[m.a], t.teams[m.b], m.bestOf);
    m.maps = result.maps;
    m.scoreA = result.scoreA;
    m.scoreB = result.scoreB;
    m.winner = result.winner;
  }
}

// After a full swiss round, update win/loss records.
export function applySwissRecords(t) {
  const round = currentRound(t);
  if (!STAGE_META[round.key].swiss) return;
  for (const m of round.matches) {
    const loser = m.winner === m.a ? m.b : m.a;
    t.records[m.winner].w += 1;
    t.records[loser].l += 1;
  }
}

// ── Badges & scoring ─────────────────────────────────────────────────────────

export function evaluateRun(seriesResults, champion) {
  const badges = [];
  const seriesWon = seriesResults.filter(s => s.won).length;
  const mapsLost = seriesResults.reduce((s, r) => s + r.mapsLost, 0);
  const mapsWon = seriesResults.reduce((s, r) => s + r.mapsWon, 0);
  const roundDiff = seriesResults.reduce((s, r) => s + r.roundDiff, 0);

  if (champion) badges.push({ key: 'champion', label: 'CHAMPION', desc: 'Won VCT Champions' });
  if (champion && seriesWon === 7) badges.push({ key: 'sweep', label: '7-0', desc: 'Won every series' });
  if (champion && seriesWon === 7 && mapsLost === 0) {
    badges.push({ key: 'perfect', label: 'PERFECT RUN', desc: 'Never dropped a single map' });
  }

  const score =
    seriesWon * 100 +
    mapsWon * 20 +
    roundDiff +
    (champion ? 150 : 0) +
    (badges.some(b => b.key === 'perfect') ? 500 : 0);

  return { badges, score, seriesWon, mapsWon, mapsLost, roundDiff };
}
