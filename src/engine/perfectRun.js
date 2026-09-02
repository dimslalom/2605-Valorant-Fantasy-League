// Gauntlet game engine.
// Draft-by-nationality rolls, team chemistry, and a seeded SEASON of three
// single-elimination tournaments (two Masters, then Champions), each a 16-team
// bracket named after a random world city. Every match is simulated, not just
// the player's. Ratings come from cards.json (approximations for game balance,
// not official stats).
//
// Tournament objects are plain data (teams, rounds, matches) so a future
// multiplayer mode can assign any match to a human instead of the sim.

import { getCardSpecialties } from '../data/specialties.js';

// ── Seeded RNG ───────────────────────────────────────────────────────────────

// The generator's entire state is the single uint32 `a`, and the first thing
// next() does is advance it - so mulberry32(rngState(r)) resumes r's stream
// exactly. That is what makes an endless run resumable across a reload
// without replaying it. The arithmetic is untouched, so every seeded stream
// (the daily seed included) is bit-identical to before `state` existed.
export function mulberry32(seed) {
  let a = seed >>> 0;
  function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  // A property rather than a {next, state} object: every call site passes the
  // rng as a bare function (simMap, pickN, weightedPick, shuffle...), and this
  // stays invisible to all of them.
  next.state = () => a >>> 0;
  return next;
}

export function rngState(rng) {
  return typeof rng?.state === 'function' ? rng.state() : null;
}

export function restoreRng(state) {
  return mulberry32(state >>> 0);
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

export function pickN(rng, arr, n) {
  const pool = [...arr];
  const out = [];
  while (out.length < n && pool.length) {
    out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  }
  return out;
}

function weightedPick(rng, items, weights) {
  const usable = items.slice(0, weights.length);
  const total = weights.slice(0, usable.length).reduce((sum, weight) => sum + weight, 0);
  let roll = rng() * total;
  for (let i = 0; i < usable.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return usable[i];
  }
  return usable[usable.length - 1];
}

function shuffle(rng, items) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ── Draft ────────────────────────────────────────────────────────────────────

export const ROSTER_SIZE = 5;
export const MIN_NATIONAL_POOL = 7;

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

// Countries available in the Esports Nations Cup. UN is a data fallback, not
// a playable nation. Sorting here keeps the country picker deterministic.
export function eligibleNationalPools(cards, minimum = MIN_NATIONAL_POOL) {
  const pools = {};
  for (const card of cards) {
    if (!card.nationality || card.nationality === 'UN') continue;
    (pools[card.nationality] ??= []).push(card);
  }
  return Object.entries(pools)
    .filter(([, pool]) => pool.length >= minimum)
    .map(([nationality, pool]) => ({
      nationality,
      cards: [...pool].sort((a, b) => b.rating - a.rating || a.player.localeCompare(b.player)),
    }))
    .sort((a, b) => a.nationality.localeCompare(b.nationality));
}

// ── Chemistry & team power ───────────────────────────────────────────────────

const ROLE_CLASSES = ['Duelist', 'Initiator', 'Controller', 'Sentinel'];

// Specialties are looked up from the shared catalog so every mode (solo,
// daily, ENC, multiplayer) reads the same traits off the same cards.
export function hasSpecialty(card, key) {
  return getCardSpecialties(card).some(s => s.key === key);
}

// Duel-side specialty swing, in power points, for side A against side B.
// Flick pays when the opponent out-positions you; Aura drags the other side's
// mentality down; Mastermind is a random mid-round read from a leading IGL.
// Returns a power delta to add to side A.
export function specialtyDuelBonus(rng, rosterA, rosterB, iglAId = null) {
  if (!rosterA?.length || !rosterB?.length) return 0;
  const avg = (roster, key) => roster.reduce((s, p) => s + (p.stats?.[key] ?? 0), 0) / roster.length;
  let delta = 0;

  // Flick: bonus aim against a better-positioned opponent.
  const outPositioned = avg(rosterB, 'positioning') > avg(rosterA, 'positioning');
  if (outPositioned) {
    delta += rosterA.filter(p => hasSpecialty(p, 'flick')).length * 1.2;
  }

  // Aura: presence drags the opposing squad's mentality down.
  delta += rosterA.filter(p => hasSpecialty(p, 'aura')).length * 1.0;

  // Mastermind: a leading IGL spikes positioning + mentality by 2..10, which
  // is 2 stats on 1 of 5 players => (roll * 2) / 5 players / 5 stats of rating.
  const igl = iglAId ? rosterA.find(p => p.id === iglAId) : null;
  if (igl && hasSpecialty(igl, 'mastermind')) {
    const roll = 2 + Math.floor(rng() * 9); // 2..10
    delta += (roll * 2) / 25;
  }
  return delta;
}

// `opts.extra` ({ total, lines }) lets a caller fold in chemistry the engine
// itself knows nothing about - endless passes its per-pair bonds through it.
// Defaulting to {} keeps every existing call byte-identical, which is pinned
// by a regression test, so Daily / ENC / Multiplayer are untouched.
export function teamChemistry(roster, iglId, opts = {}) {
  const lines = [];
  let chem = 0;

  // Role coverage: reward all 4 classes, punish stacking. Flex players each
  // plug one otherwise-missing class, and their own role stops counting
  // toward a stack penalty.
  const roleCount = {};
  for (const p of roster) roleCount[p.role] = (roleCount[p.role] ?? 0) + 1;

  const flexPlayers = roster.filter(p => hasSpecialty(p, 'flex'));
  const missingRaw = ROLE_CLASSES.filter(r => !roleCount[r]);
  const flexFilled = missingRaw.slice(0, flexPlayers.length);
  const missing = missingRaw.slice(flexFilled.length);

  if (missing.length === 0) {
    chem += 6;
    lines.push({ label: 'Full role coverage', value: +6 });
  } else {
    chem -= missing.length * 4;
    lines.push({ label: `Missing: ${missing.join(', ')}`, value: -missing.length * 4 });
  }
  if (flexFilled.length) {
    lines.push({ label: `Flex covers ${flexFilled.join(', ')}`, value: '+0' });
  }
  for (const [role, n] of Object.entries(roleCount)) {
    // A flexed player slides off their stacked class.
    const stackRelief = flexPlayers.filter(p => p.role === role).length
      ? Math.min(flexFilled.length, flexPlayers.filter(p => p.role === role).length)
      : 0;
    const effective = n - stackRelief;
    if (effective > 2) {
      chem -= (effective - 2) * 3;
      lines.push({ label: `${effective}x ${role} stack`, value: -(effective - 2) * 3 });
    }
  }

  // One Trick: mastered a single agent - pays off only when nobody else on
  // the squad plays that agent.
  for (const p of roster) {
    if (!hasSpecialty(p, 'one_trick')) continue;
    const mine = new Set(p.agents ?? []);
    if (!mine.size) continue;
    const shared = roster.some(o => o.id !== p.id && (o.agents ?? []).some(a => mine.has(a)));
    if (!shared) {
      chem += 5;
      lines.push({ label: `${p.player} one-tricks solo`, value: +5 });
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

  if (opts.extra?.total) {
    chem += opts.extra.total;
    lines.push(...(opts.extra.lines ?? []));
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

// `opts.soft` is a flat power addend, used by endless for the soft-stat
// residual. It is computed by the caller rather than here so the engine never
// has to import the endless modules (and cannot form an import cycle with
// them). Absent, this is exactly the old two-argument function.
export function teamPower(roster, iglId, opts = {}) {
  const base = roster.reduce((s, p) => s + p.rating, 0) / roster.length;
  const chem = teamChemistry(roster, iglId, opts);
  const soft = opts.soft ?? 0;
  return { base, chem: chem.total, soft, power: base + chem.total * 0.6 + soft, lines: chem.lines };
}

function strongestIgl(roster) {
  return roster
    .map(card => ({ card, result: teamPower(roster, card.id) }))
    .sort((a, b) => b.result.power - a.result.power || b.card.rating - a.card.rating)[0];
}

function nationalTeam(nationality, roster) {
  if (roster.length < ROSTER_SIZE) return null;
  const igl = strongestIgl(roster);
  return {
    id: `nation:${nationality}`,
    tag: nationality,
    name: nationality,
    nationality,
    logo: null,
    roster,
    iglId: igl.card.id,
    power: igl.result.power,
    isPlayer: false,
  };
}

// Build a readable, balanced CPU roster: take the best card in every role the
// country can field, then fill open slots by rating. The best IGL assignment is
// selected using the same power calculation available to the player.
export function buildCpuNationalTeam(nationality, cards) {
  const sorted = [...cards].sort((a, b) => b.rating - a.rating || a.player.localeCompare(b.player));
  const roster = [];
  for (const role of ROLE_CLASSES) {
    const card = sorted.find(item => item.role === role);
    if (card && !roster.includes(card)) roster.push(card);
  }
  for (const card of sorted) {
    if (roster.length >= ROSTER_SIZE) break;
    if (!roster.includes(card)) roster.push(card);
  }
  return nationalTeam(nationality, roster);
}

const ROLE_PICK_WEIGHTS = [55, 30, 15];
const FLEX_PICK_WEIGHTS = [40, 25, 17, 11, 7];

// The roster a CPU nation actually brings to this ENC run. It stays strong and
// role-aware, but a seeded weighted draw stops every tournament using the same
// five names.
export function buildVariedCpuNationalTeam(rng, nationality, cards) {
  const sorted = [...cards].sort((a, b) => b.rating - a.rating || a.player.localeCompare(b.player));
  const roster = [];
  for (const role of ROLE_CLASSES) {
    const candidates = sorted.filter(card => card.role === role && !roster.includes(card)).slice(0, 3);
    if (candidates.length) roster.push(weightedPick(rng, candidates, ROLE_PICK_WEIGHTS));
  }
  while (roster.length < ROSTER_SIZE) {
    const candidates = sorted.filter(card => !roster.includes(card)).slice(0, 5);
    if (!candidates.length) break;
    roster.push(weightedPick(rng, candidates, FLEX_PICK_WEIGHTS));
  }
  return nationalTeam(nationality, roster);
}

export function nationalChallengeTier(seed) {
  if (seed <= 8) return 'Contender';
  if (seed <= 24) return 'Challenger';
  return 'Underdog';
}

export function encFormLabel(form) {
  if (form >= 3) return 'Hot';
  if (form <= -3) return 'Cold';
  return 'Steady';
}

export function teamSimulationPower(team) {
  return team.simulationPower ?? team.power;
}

// ── Maps & match sim ─────────────────────────────────────────────────────────

export const MAP_POOL = ['Ascent', 'Bind', 'Haven', 'Lotus', 'Split', 'Sunset', 'Icebox'];

export function pickMaps(rng, n) {
  return pickN(rng, MAP_POOL, n);
}

// Simulate one map round-by-round. Returns the full round sequence so the UI
// can animate it, plus the final score and a map MVP from the winning side.
export function simMap(rng, powerA, powerB, rosterA, rosterB, bias = 0, iglA = null, iglB = null) {
  // Specialty swings are rolled once per map, before the round loop.
  const specA = specialtyDuelBonus(rng, rosterA, rosterB, iglA);
  const specB = specialtyDuelBonus(rng, rosterB, rosterA, iglB);
  const p = 1 / (1 + Math.pow(10, ((powerB + specB) - (powerA + specA) - bias) / 25));
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
export function simNpcMatch(rng, teamA, teamB, bestOf, bias = 0) {
  const needed = Math.ceil(bestOf / 2);
  const maps = pickMaps(rng, bestOf);
  const played = [];
  let scoreA = 0, scoreB = 0;
  for (const map of maps) {
    if (scoreA >= needed || scoreB >= needed) break;
    const r = simMap(rng, teamSimulationPower(teamA), teamSimulationPower(teamB), teamA.roster, teamB.roster, bias, teamA.iglId ?? null, teamB.iglId ?? null);
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

export function npcTeamPower(roster) {
  if (!roster.length) return { power: 0, iglId: null };
  return roster.map(card => ({ iglId: card.id, result: teamPower(roster, card.id) }))
    .sort((a, b) => b.result.power - a.result.power || String(a.iglId).localeCompare(String(b.iglId)))[0];
}

export const ROUND_KEYS = ['r16', 'quarter', 'semi', 'final'];

export const ROUND_META = {
  preliminary: { label: 'Preliminary Round', bestOf: 3 },
  r64:     { label: 'Round of 64',   bestOf: 3 },
  r32:     { label: 'Round of 32',   bestOf: 3 },
  r16:     { label: 'Round of 16',   bestOf: 3 },
  quarter: { label: 'Quarterfinals', bestOf: 3 },
  semi:    { label: 'Semifinals',    bestOf: 3 },
  final:   { label: 'Grand Final',   bestOf: 5 },
};

// Standard 16-seed bracket order (0-based seed indices) so higher seeds cannot
// meet early and each winner feeds the adjacent match in the next round.
// Every org that can still field five undrafted players; its best five by
// rating, strongest orgs first.
//
// Signing a player takes that PLAYER off the market, not their whole team:
// the old rule dropped the entire org if any one of its players had been
// drafted, so a five-org draft silently deleted five teams from the opponent
// pool. Orgs with no depth (only 41 of 159 carry a sixth player) still fall
// out on their own once they can't field five - which is the rule players
// actually expect.
export function eligibleOrgs(cards, pickedIds) {
  const byOrg = {};
  for (const c of cards) {
    if (!c.org) continue; // icons are org-less and never form an opponent team
    if (pickedIds.has(c.id)) continue;
    (byOrg[c.org] ??= []).push(c);
  }
  return Object.entries(byOrg)
    .filter(([, list]) => list.length >= 5)
    .map(([org, list]) => {
      const roster = [...list].sort((a, b) => b.rating - a.rating).slice(0, 5);
      const best = npcTeamPower(roster);
      return {
        id: org, tag: org, name: roster[0].org_name ?? org,
        logo: roster[0].org_logo, roster, iglId: best.iglId,
        power: best.result.power,
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

function powerOfTwoAtMost(n) {
  let value = 1;
  while (value * 2 <= n) value *= 2;
  return value;
}

function roundKeyForSize(size) {
  if (size === 2) return 'final';
  if (size === 4) return 'semi';
  if (size === 8) return 'quarter';
  if (size === 16) return 'r16';
  if (size === 32) return 'r32';
  if (size === 64) return 'r64';
  return `r${size}`;
}

function mainRoundKeys(size) {
  const keys = [];
  for (let current = size; current >= 2; current /= 2) keys.push(roundKeyForSize(current));
  return keys;
}

// Standard seed layout generated for any power-of-two bracket size.
function seedOrder(size) {
  let order = [1, 2];
  for (let current = 4; current <= size; current *= 2) {
    order = order.flatMap(seed => [seed, current + 1 - seed]);
  }
  return order;
}

function shuffleSeedPots(rng, slots, potSize = 8) {
  const out = [];
  for (let start = 0; start < slots.length; start += potSize) {
    out.push(...shuffle(rng, slots.slice(start, start + potSize)));
  }
  return out;
}

// A clamped Gaussian tournament-form roll, sigma 5, bounded +/-8. Shared by
// ENC and by endless: it is the single mechanism that stops a bracket from
// being decided entirely by roster quality before a map is played.
export function tournamentForm(rng) {
  const u1 = Math.max(rng(), Number.EPSILON);
  const u2 = rng();
  const normal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(-8, Math.min(8, normal * 5));
}

function addNationalMainRound(t) {
  const ids = t.mainSeedSlots.map(slot => {
    if (!slot.startsWith('prelim:')) return slot;
    const match = t.rounds[0].matches[Number(slot.split(':')[1])];
    return match.winner;
  });
  const key = t.roundKeys[0];
  const meta = ROUND_META[key] ?? { label: `Round of ${t.mainSize}`, bestOf: 3 };
  const order = seedOrder(t.mainSize);
  const matches = [];
  for (let i = 0; i < order.length; i += 2) {
    matches.push(makeMatch(ids[order[i] - 1], ids[order[i + 1] - 1], meta.bestOf));
  }
  t.rounds.push({ key, label: meta.label, bestOf: meta.bestOf, matches });
  t.roundIdx = t.rounds.length - 1;
  return t.rounds[t.roundIdx];
}

// Build the ENC field. Any entrants above the next-lower power of two play a
// seeded preliminary round; its winners occupy the final main-bracket seeds.
export function buildNationalBracket(rng, cards, playerNationality, playerRoster, playerIglId) {
  if (Array.isArray(rng)) {
    playerIglId = playerRoster;
    playerRoster = playerNationality;
    playerNationality = cards;
    cards = rng;
    rng = mulberry32(0x454e43);
  }
  const entrants = eligibleNationalPools(cards).map(({ nationality, cards: pool }) => {
    if (nationality !== playerNationality) {
      const projected = buildCpuNationalTeam(nationality, pool);
      const actual = buildVariedCpuNationalTeam(rng, nationality, pool);
      return { ...actual, projectedPower: projected.power };
    }
    const playerPower = teamPower(playerRoster, playerIglId).power;
    return {
      id: 'player', tag: nationality, name: nationality, nationality, logo: null,
      roster: playerRoster, iglId: playerIglId,
      power: playerPower, projectedPower: playerPower,
      isPlayer: true,
    };
  }).filter(Boolean).sort((a, b) => b.projectedPower - a.projectedPower || a.nationality.localeCompare(b.nationality));

  const fieldAverage = entrants.reduce((sum, team) => sum + team.power, 0) / entrants.length;
  for (const team of entrants) {
    team.form = tournamentForm(rng);
    team.formLabel = encFormLabel(team.form);
    team.simulationPower = fieldAverage + (team.power - fieldAverage) * 0.25 + team.form;
  }

  const mainSize = powerOfTwoAtMost(entrants.length);
  const preliminaryCount = entrants.length - mainSize;
  const byeCount = mainSize - preliminaryCount;
  const teams = Object.fromEntries(entrants.map(team => [team.id, team]));
  const rounds = [];
  const seededMainSlots = entrants.slice(0, byeCount).map(team => team.id);

  if (preliminaryCount) {
    const matches = [];
    for (let i = 0; i < preliminaryCount; i++) {
      const high = entrants[byeCount + i];
      const low = entrants[entrants.length - 1 - i];
      matches.push(makeMatch(high.id, low.id, ROUND_META.preliminary.bestOf));
      seededMainSlots.push(`prelim:${i}`);
    }
    rounds.push({ ...ROUND_META.preliminary, key: 'preliminary', matches });
  } else {
    seededMainSlots.push(...entrants.slice(byeCount).map(team => team.id));
  }

  const mainSeedSlots = shuffleSeedPots(rng, seededMainSlots);

  const tournament = {
    kind: 'enc', teams, seeds: entrants.map(team => team.id), rounds,
    roundIdx: 0, mainSize, mainSeedSlots, roundKeys: mainRoundKeys(mainSize), fieldAverage,
  };
  if (!preliminaryCount) addNationalMainRound(tournament);
  return tournament;
}

// Build a fresh 16-team bracket. Masters draws 15 opponents from the top 30 by
// power (so a tier-2 giant-killer can sneak in); Champions takes exactly the
// top 15, the strongest possible field. The player is seeded by power with the
// rest, so a strong squad earns a kinder opening seed.
// Seed already-chosen teams into a single-elimination bracket. Split out of
// buildBracket so endless can choose its own field (by circuit tier, with
// form applied) without duplicating the seeding rules.
//
// The field size is read from the entrant list and must be a power of two.
// seedOrder(16) reproduces the old hardcoded SEED_ORDER exactly, so the
// sixteen-team path is unchanged; smaller fields let the lower circuits run
// shorter events, where a title is three series away rather than four.
export function buildBracketFromTeams(entrants, kind) {
  const all = [...entrants].sort((a, b) => b.power - a.power);
  const size = all.length;
  const roundKeys = mainRoundKeys(size);
  const key = roundKeys[0];
  const meta = ROUND_META[key];

  const teams = {};
  for (const team of all) teams[team.id] = team;

  const order = seedOrder(size); // 1-indexed seeds in bracket order
  const matches = [];
  for (let i = 0; i < size; i += 2) {
    matches.push(makeMatch(all[order[i] - 1].id, all[order[i + 1] - 1].id, meta.bestOf));
  }

  return {
    kind, teams,
    seeds: all.map(team => team.id), // index = seed - 1
    rounds: [{ key, label: meta.label, bestOf: meta.bestOf, matches }],
    roundIdx: 0,
    roundKeys,
    // The bracket renderer lays out rows from mainSize; without it an
    // eight-team field would still reserve sixteen teams' worth of slots and
    // draw empty TBD cells under the real matches.
    mainSize: size,
  };
}

export function buildBracket(rng, cards, pickedIds, playerTeam, kind) {
  const pool = eligibleOrgs(cards, pickedIds);
  const npcs = kind === 'champions'
    ? pool.slice(0, 15)
    : pickN(rng, pool.slice(0, 30), 15);

  return buildBracketFromTeams([playerTeam, ...npcs], kind);
}

// Pair the winners of the current round into the next. Bracket order means the
// winners of matches 2i and 2i+1 meet.
export function nextBracketRound(t) {
  if (currentRound(t)?.key === 'preliminary') return addNationalMainRound(t);
  const idx = t.roundIdx + 1;
  const activeKeys = t.roundKeys ?? ROUND_KEYS;
  const currentKeyIndex = activeKeys.indexOf(currentRound(t)?.key);
  const key = activeKeys[currentKeyIndex + 1] ?? activeKeys[idx];
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

// Complete all remaining NPC-only rounds, used by ENC after the player's
// elimination so the Nations Cup always crowns and displays a champion.
export function resolveTournamentToChampion(t, rng) {
  while (true) {
    resolveNpcMatches(t, rng);
    const round = currentRound(t);
    if (round.key === 'final') return round.matches[0].winner;
    nextBracketRound(t);
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

export function updateEncRecords(records = {}, { series, champion, mapsLost, finishRound }) {
  const wins = series.filter(result => result.won).length;
  const previousBest = records.bestWins ?? 0;
  return {
    ...records,
    bestWins: Math.max(previousBest, wins),
    bestFinish: wins >= previousBest ? (champion ? 'Champion' : finishRound) : records.bestFinish,
    titles: (records.titles ?? 0) + (champion ? 1 : 0),
    flawless: (records.flawless ?? 0) + (champion && mapsLost === 0 ? 1 : 0),
  };
}

// Season summary across all tournaments. `results` are per-tournament
// objects ({ champion, series }). Endless runs can be any length, so the
// Evaluate one ordinary three-tournament year. Passing a partial year is
// useful for the live score shown between tournaments; year-only awards are
// naturally withheld until all three titles have actually been won.
export function evaluateSeason(results) {
  const badges = [];
  const titles = results.filter(r => r.champion).length;
  const allSeries = results.flatMap(r => r.series);
  const seriesWon = allSeries.filter(s => s.won).length;
  const mapsWon = allSeries.reduce((s, r) => s + r.mapsWon, 0);
  const mapsLost = allSeries.reduce((s, r) => s + r.mapsLost, 0);
  const roundDiff = allSeries.reduce((s, r) => s + r.roundDiff, 0);

  const grandSlam = results.length === 3 && titles === 3;
  const perfectSeason = grandSlam && mapsLost === 0;
  if (grandSlam) {
    badges.push({ key: 'grand_slam', label: 'GRAND SLAM', desc: 'Won all three tournaments' });
  }
  if (perfectSeason) {
    badges.push({ key: 'perfect_season', label: 'PERFECT SEASON', desc: 'Three titles, zero maps dropped' });
  }

  const score = Math.max(0, Math.round(
    seriesWon * 100 + mapsWon * 20 + roundDiff + titles * 150 +
    (grandSlam ? 300 : 0) + (perfectSeason ? 500 : 0),
  ));

  return {
    badges, score, titles, seriesWon, mapsWon, mapsLost, roundDiff,
    grandSlam, perfectSeason, events: results.length,
  };
}

// Endless is deliberately not a second ruleset. It is an aggregate of
// consecutive ordinary years, including the current partial year. Keeping
// the grouping here guarantees that scoring and annual awards cannot drift
// away from evaluateSeason as the normal game evolves.
export function evaluateEndless(results) {
  const years = [];
  for (let index = 0; index < results.length; index += 3) {
    years.push(evaluateSeason(results.slice(index, index + 3)));
  }

  const completedYears = Math.floor(results.length / 3);
  const badges = years.flatMap((year, yearIndex) => (
    yearIndex < completedYears
      ? year.badges.map(badge => ({
        ...badge,
        key: `year_${yearIndex + 1}_${badge.key}`,
        label: `YEAR ${yearIndex + 1} · ${badge.label}`,
      }))
      : []
  ));

  return {
    badges,
    score: years.reduce((sum, year) => sum + year.score, 0),
    titles: years.reduce((sum, year) => sum + year.titles, 0),
    seriesWon: years.reduce((sum, year) => sum + year.seriesWon, 0),
    mapsWon: years.reduce((sum, year) => sum + year.mapsWon, 0),
    mapsLost: years.reduce((sum, year) => sum + year.mapsLost, 0),
    roundDiff: years.reduce((sum, year) => sum + year.roundDiff, 0),
    grandSlam: years.slice(0, completedYears).some(year => year.grandSlam),
    perfectSeason: years.slice(0, completedYears).some(year => year.perfectSeason),
    events: results.length,
    completedYears,
    currentYear: Math.floor(results.length / 3) + 1,
    years,
  };
}
