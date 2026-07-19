// Perfect Run game engine.
// Draft-by-nationality rolls, team chemistry, and a seeded SEASON of three
// single-elimination tournaments (two Masters, then Champions), each a 16-team
// bracket named after a random world city. Every match is simulated, not just
// the player's. Ratings come from cards.json (approximations for game balance,
// not official stats).
//
// Tournament objects are plain data (teams, rounds, matches) so a future
// multiplayer mode can assign any match to a human instead of the sim.

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

// Every available player of that nationality, best rating first.
export function draftChoices(cards, nationality, pickedIds) {
  return cards
    .filter(c => c.nationality === nationality && !pickedIds.has(c.id))
    .sort((a, b) => b.rating - a.rating);
}

// "Normal" unboxing: a pack of PACK_SIZE uniformly-random cards, pick one.
// Sampling consumes exactly n rng calls (pickN) so the stream stays stable
// for the shared daily seed; the display sort never touches the rng.
export const PACK_SIZE = 5;

export function samplePack(rng, cards, pickedIds, n = PACK_SIZE) {
  const available = cards.filter(c => !pickedIds.has(c.id));
  return pickN(rng, available, Math.min(n, available.length))
    .sort((a, b) => b.rating - a.rating);
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

  // Real-life teammate pairs (same org; icons are org-less and never count)
  let orgPairs = 0;
  for (let i = 0; i < roster.length; i++) {
    for (let j = i + 1; j < roster.length; j++) {
      if (roster[i].org && roster[i].org === roster[j].org) orgPairs++;
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
      if (roster[i].org && roster[i].org === roster[j].org) continue;
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

// ── Season & tournaments ─────────────────────────────────────────────────────
//
// A season is three single-elimination tournaments: two Masters, then
// Champions. Each is a 16-team bracket (Round of 16 -> QF -> SF -> Grand Final)
// named after a random world city. The player's squad persists all season.

export const CITIES = [
  'London', 'Melbourne', 'Tokyo', 'Berlin', 'Paris', 'Madrid', 'Seoul',
  'Shanghai', 'Toronto', 'Chicago', 'Los Angeles', 'Sydney', 'Copenhagen',
  'Reykjavik', 'Istanbul', 'Bangkok', 'Singapore', 'Sao Paulo', 'Mexico City',
  'Rio de Janeiro', 'Amsterdam', 'Stockholm', 'Barcelona', 'Milan', 'Vienna',
  'Dubai', 'Mumbai', 'Osaka', 'Vancouver', 'Montreal',
];

// Draw three distinct cities: Masters, Masters, Champions.
export function makeSeason(rng) {
  const cities = pickN(rng, CITIES, 3);
  return [
    { kind: 'masters',   city: cities[0], label: `Masters ${cities[0]}` },
    { kind: 'masters',   city: cities[1], label: `Masters ${cities[1]}` },
    { kind: 'champions', city: cities[2], label: `Champions ${cities[2]}` },
  ];
}

// Endless mode: one more event, forever. The first cycle mirrors a season
// (Masters, Masters, then Champions); from the third event on every field is
// Champions-caliber (buildBracket's 'champions' kind = exactly the top 15
// orgs), which is the difficulty ramp. `usedCities` is a sliding window of
// recent hosts so cities do not repeat back-to-back.
export function nextEndlessEvent(rng, index, usedCities = []) {
  const pool = CITIES.filter(c => !usedCities.includes(c));
  const city = pickN(rng, pool.length ? pool : CITIES, 1)[0];
  const kind = index < 2 ? 'masters' : 'champions';
  return { kind, city, label: `${kind === 'champions' ? 'Champions' : 'Masters'} ${city}` };
}

export const ROUND_KEYS = ['r16', 'quarter', 'semi', 'final'];

export const ROUND_META = {
  r16:     { label: 'Round of 16',   bestOf: 3 },
  quarter: { label: 'Quarterfinals', bestOf: 3 },
  semi:    { label: 'Semifinals',    bestOf: 3 },
  final:   { label: 'Grand Final',   bestOf: 5 },
};

// Standard 16-seed bracket order (0-based seed indices) so higher seeds cannot
// meet early and each winner feeds the adjacent match in the next round.
const SEED_ORDER = [
  [0, 15], [7, 8], [3, 12], [4, 11], [1, 14], [6, 9], [2, 13], [5, 10],
];

// Every org with a full five-man roster and nobody already drafted; its best
// five by rating, strongest orgs first.
function eligibleOrgs(cards, pickedIds) {
  const byOrg = {};
  for (const c of cards) {
    if (!c.org) continue; // icons are org-less and never form an opponent team
    (byOrg[c.org] ??= []).push(c);
  }
  return Object.entries(byOrg)
    .filter(([, list]) => list.length >= 5 && list.every(p => !pickedIds.has(p.id)))
    .map(([org, list]) => {
      const roster = [...list].sort((a, b) => b.rating - a.rating).slice(0, 5);
      return {
        id: org, tag: org, name: roster[0].org_name ?? org,
        logo: roster[0].org_logo, roster,
        power: roster.reduce((s, p) => s + p.rating, 0) / 5,
        isPlayer: false,
      };
    })
    .sort((a, b) => b.power - a.power);
}

function makeMatch(aId, bId, bestOf) {
  return {
    a: aId, b: bId, bestOf,
    maps: null, scoreA: 0, scoreB: 0, winner: null,
    isPlayerMatch: aId === 'player' || bId === 'player',
  };
}

// Build a fresh 16-team bracket. Masters draws 15 opponents from the top 30 by
// power (so a tier-2 giant-killer can sneak in); Champions takes exactly the
// top 15, the strongest possible field. The player is seeded by power with the
// rest, so a strong squad earns a kinder opening seed.
export function buildBracket(rng, cards, pickedIds, playerTeam, kind) {
  const pool = eligibleOrgs(cards, pickedIds);
  const npcs = kind === 'champions'
    ? pool.slice(0, 15)
    : pickN(rng, pool.slice(0, 30), 15);

  const all = [playerTeam, ...npcs].sort((a, b) => b.power - a.power);
  const teams = {};
  for (const team of all) teams[team.id] = team;

  const matches = SEED_ORDER.map(([i, j]) =>
    makeMatch(all[i].id, all[j].id, ROUND_META.r16.bestOf));

  return {
    kind, teams,
    seeds: all.map(team => team.id), // index = seed - 1
    rounds: [{ key: 'r16', label: ROUND_META.r16.label, bestOf: ROUND_META.r16.bestOf, matches }],
    roundIdx: 0,
  };
}

// Pair the winners of the current round into the next. Bracket order means the
// winners of matches 2i and 2i+1 meet.
export function nextBracketRound(t) {
  const idx = t.roundIdx + 1;
  const key = ROUND_KEYS[idx];
  if (!key) return null;
  const meta = ROUND_META[key];
  const prev = t.rounds[t.roundIdx].matches;
  const matches = [];
  for (let i = 0; i < prev.length; i += 2) {
    matches.push(makeMatch(prev[i].winner, prev[i + 1].winner, meta.bestOf));
  }
  t.rounds.push({ key, label: meta.label, bestOf: meta.bestOf, matches });
  t.roundIdx = idx;
  return t.rounds[t.roundIdx];
}

export function currentRound(t) {
  return t.rounds[t.rounds.length - 1] ?? null;
}

export function playerMatch(t) {
  return currentRound(t)?.matches.find(m => m.isPlayerMatch) ?? null;
}

// Seed number (1-based) of a team, for display.
export function seedOf(t, teamId) {
  const i = t.seeds.indexOf(teamId);
  return i < 0 ? null : i + 1;
}

// Write the player's finished series into their pending match. The sim always
// treats the player as side A, so maps/scores are remapped onto whichever
// bracket side the player actually occupies.
export function setPlayerResult(t, playedMaps, playerWon) {
  const m = playerMatch(t);
  if (!m) return;
  const playerMapsWon = playedMaps.filter(r => r.winA).length;
  const oppMapsWon = playedMaps.length - playerMapsWon;
  const playerIsA = m.a === 'player';
  m.maps = playedMaps.map(r => ({
    map: r.map,
    a: playerIsA ? r.a : r.b,
    b: playerIsA ? r.b : r.a,
  }));
  m.scoreA = playerIsA ? playerMapsWon : oppMapsWon;
  m.scoreB = playerIsA ? oppMapsWon : playerMapsWon;
  m.winner = playerWon ? 'player' : (playerIsA ? m.b : m.a);
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

// ── Badges & scoring ─────────────────────────────────────────────────────────

// Per-tournament badges. `series` are the player's series summaries for this
// event ({ mapsWon, mapsLost, roundDiff, won }).
export function evaluateTournament(series, champion) {
  const badges = [];
  const mapsLost = series.reduce((s, r) => s + r.mapsLost, 0);
  if (champion) badges.push({ key: 'champion', label: 'CHAMPION', desc: 'Won the tournament' });
  if (champion && mapsLost === 0) {
    badges.push({ key: 'flawless', label: 'FLAWLESS', desc: 'No maps dropped' });
  }
  return { badges, mapsLost };
}

// Season summary across all tournaments. `results` are per-tournament
// objects ({ champion, series }). Endless runs can be any length, so the
// three-title slam/perfect badges only apply to fixed seasons.
export function evaluateSeason(results, { endless = false } = {}) {
  const badges = [];
  const titles = results.filter(r => r.champion).length;
  const allSeries = results.flatMap(r => r.series);
  const seriesWon = allSeries.filter(s => s.won).length;
  const mapsWon = allSeries.reduce((s, r) => s + r.mapsWon, 0);
  const mapsLost = allSeries.reduce((s, r) => s + r.mapsLost, 0);
  const roundDiff = allSeries.reduce((s, r) => s + r.roundDiff, 0);

  const grandSlam = !endless && titles === 3;
  const perfectSeason = !endless && titles === 3 && mapsLost === 0;
  if (grandSlam) {
    badges.push({ key: 'grand_slam', label: 'GRAND SLAM', desc: 'Won all three tournaments' });
  }
  if (perfectSeason) {
    badges.push({ key: 'perfect_season', label: 'PERFECT SEASON', desc: 'Three titles, zero maps dropped' });
  }

  const score = Math.max(0,
    seriesWon * 100 +
    mapsWon * 20 +
    roundDiff +
    titles * 150 +
    (grandSlam ? 300 : 0) +
    (perfectSeason ? 500 : 0),
  );

  return {
    badges, score, titles, seriesWon, mapsWon, mapsLost, roundDiff,
    grandSlam, perfectSeason, events: results.length,
  };
}
