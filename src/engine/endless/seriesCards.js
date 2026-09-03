// Card-table preparation for Endless series.
//
// The public surface is deliberately data-first: React renders these objects
// as physical cards, while the match engine consumes the same activations as
// power deltas. There is no separate explanatory model that can drift away
// from what a card actually does.

import { getCardSpecialties } from '../../data/specialties.js';
import { hashSeed, mulberry32, pickN } from '../perfectRun.js';

export const TACTIC_HAND_MAX = 5;
export const TACTIC_HAND_FLOOR = 2;
export const ENDLESS_POWER_DIVISOR = 85;

const ROLE_ORDER = ['Duelist', 'Initiator', 'Controller', 'Sentinel'];

const MAP_ART = {
  Ascent:   { mark: 'A', hue: '#80a7bc', image: '/assets/maps/ascent.webp', agents: ['Sova', 'KAY/O', 'Omen'] },
  Bind:     { mark: 'B', hue: '#d89b62', image: '/assets/maps/bind.webp', agents: ['Raze', 'Brimstone', 'Viper'] },
  Haven:    { mark: 'H', hue: '#8da58b', image: '/assets/maps/haven.webp', agents: ['Breach', 'Sova', 'Omen'] },
  Lotus:    { mark: 'L', hue: '#b38b74', image: '/assets/maps/lotus.webp', agents: ['Raze', 'Fade', 'Viper'] },
  Split:    { mark: 'S', hue: '#bd8295', image: '/assets/maps/split.webp', agents: ['Raze', 'Cypher', 'Viper'] },
  Sunset:   { mark: 'U', hue: '#ce8068', image: '/assets/maps/sunset.webp', agents: ['Cypher', 'Breach', 'Omen'] },
  Icebox:   { mark: 'I', hue: '#75a8ca', image: '/assets/maps/icebox.webp', agents: ['Jett', 'Sage', 'Viper'] },
};

// Three learnable identities per place. A year changes exactly three active
// stickers; the other four cards stay put, so the meta moves without turning
// every year into a new ruleset.
const MAP_RULES = {
  Ascent: [
    { key: 'four-corners', label: 'FOUR CORNERS', roles: ROLE_ORDER, mode: 'coverage' },
    { key: 'mid-control', label: 'MID CONTROL', roles: ['Controller', 'Initiator'], mode: 'pair' },
    { key: 'anchor-points', label: 'ANCHOR POINTS', roles: ['Sentinel', 'Controller'], mode: 'pair' },
  ],
  Bind: [
    { key: 'fast-lanes', label: 'FAST LANES', roles: ['Duelist', 'Initiator'], mode: 'pair' },
    { key: 'hold-then-hit', label: 'HOLD / HIT', roles: ['Controller', 'Duelist'], mode: 'pair' },
    { key: 'closed-circuit', label: 'CLOSED CIRCUIT', roles: ['Sentinel', 'Initiator'], mode: 'pair' },
  ],
  Haven: [
    { key: 'three-sites', label: 'THREE SITES', roles: ROLE_ORDER, mode: 'coverage' },
    { key: 'long-reads', label: 'LONG READS', roles: ['Initiator', 'Sentinel'], mode: 'pair' },
    { key: 'late-rotation', label: 'LATE ROTATION', roles: ['Controller', 'Sentinel'], mode: 'pair' },
  ],
  Lotus: [
    { key: 'break-the-door', label: 'BREAK THE DOOR', roles: ['Duelist', 'Controller'], mode: 'pair' },
    { key: 'wide-net', label: 'WIDE NET', roles: ROLE_ORDER, mode: 'coverage' },
    { key: 'pressure-plates', label: 'PRESSURE PLATES', roles: ['Initiator', 'Duelist'], mode: 'pair' },
  ],
  Split: [
    { key: 'tight-lanes', label: 'TIGHT LANES', roles: ['Controller', 'Sentinel'], mode: 'pair' },
    { key: 'vertical-game', label: 'VERTICAL GAME', roles: ['Duelist', 'Controller'], mode: 'pair' },
    { key: 'information-tax', label: 'INFORMATION TAX', roles: ['Initiator', 'Sentinel'], mode: 'pair' },
  ],
  Sunset: [
    { key: 'open-mid', label: 'OPEN MID', roles: ['Duelist', 'Initiator'], mode: 'pair' },
    { key: 'trap-lines', label: 'TRAP LINES', roles: ['Sentinel', 'Controller'], mode: 'pair' },
    { key: 'split-second', label: 'SPLIT SECOND', roles: ['Initiator', 'Duelist'], mode: 'pair' },
  ],
  Icebox: [
    { key: 'long-sightlines', label: 'LONG SIGHTLINES', roles: ['Duelist', 'Sentinel'], mode: 'pair' },
    { key: 'utility-wall', label: 'UTILITY WALL', roles: ['Controller', 'Sentinel'], mode: 'pair' },
    { key: 'first-contact', label: 'FIRST CONTACT', roles: ['Duelist', 'Initiator'], mode: 'pair' },
  ],
};

export const MAP_NAMES = Object.keys(MAP_RULES);

function yearPatch(seed, year) {
  if (year <= 1) return [];
  const rng = mulberry32(hashSeed(`${seed}:map-patch:${year}`));
  return pickN(rng, MAP_NAMES, 3);
}

export function mapCardsForYear(seed, year) {
  const indexes = Object.fromEntries(MAP_NAMES.map(name => [name, 0]));
  let changed = [];
  for (let current = 2; current <= Math.max(1, year); current++) {
    const patch = yearPatch(seed, current);
    for (const name of patch) indexes[name] = (indexes[name] + 1) % MAP_RULES[name].length;
    if (current === year) changed = patch;
  }
  return MAP_NAMES.map(name => {
    const rule = MAP_RULES[name][indexes[name]];
    return {
      id: name.toLowerCase(), name, ...MAP_ART[name], ...rule,
      changed: changed.includes(name), year,
    };
  });
}

export function changedMapCards(seed, year) {
  return mapCardsForYear(seed, year).filter(card => card.changed);
}

function roleCount(roster, role) {
  return roster.filter(card => card.role === role).length;
}

function isMapSpecialist(card, map) {
  const agents = card.agents ?? [];
  return agents.length === 1 && map.agents.includes(agents[0]);
}

export function mapActivation(roster, map, mastery = 0) {
  if (!roster?.length || !map) return { bonus: 0, activeIds: [], roleHits: [], specialistIds: [] };
  const roleHits = map.roles.filter(role => roleCount(roster, role) > 0);
  const roleBonus = map.mode === 'coverage'
    ? (roleHits.length === ROLE_ORDER.length ? 2.4 : roleHits.length * 0.25)
    : Math.min(2.4, map.roles.reduce((sum, role) => sum + roleCount(roster, role) * 0.75, 0));
  const specialistIds = roster.filter(card => isMapSpecialist(card, map)).map(card => card.id);
  const masteryBonus = Math.min(1.8, Math.max(0, mastery) * 0.3);
  const activeIds = roster
    .filter(card => map.roles.includes(card.role) || specialistIds.includes(card.id))
    .map(card => card.id);
  return {
    bonus: roleBonus + specialistIds.length * 0.9 + masteryBonus,
    activeIds, roleHits, specialistIds, masteryBonus,
  };
}

export function gainMapMastery(mastery, mapName) {
  return { ...mastery, [mapName]: Math.min(6, (mastery?.[mapName] ?? 0) + 1) };
}

// Off-screen organizations still carry stable, run-specific mastery. The
// value is derived rather than stored for all ~160 orgs, keeping a solo save
// small while ensuring the same rival has the same practiced maps on reload.
export function rivalMapMastery(seed, orgId, mapName, year = 1) {
  const base = hashSeed(`${seed}:${orgId}:${mapName}:mastery`) % 4;
  const drift = hashSeed(`${seed}:${orgId}:${mapName}:year:${year}`) % 3;
  return Math.min(6, base + Math.floor(Math.max(0, year - 1) / 3) + (drift === 0 ? 1 : 0));
}

export function recentMapSelections(seed, orgId, year = 1, count = 3) {
  const rng = mulberry32(hashSeed(`${seed}:${orgId}:recent-maps:${year}`));
  return pickN(rng, MAP_NAMES, count);
}

export const TACTICS = {
  pocket: {
    key: 'pocket', name: 'POCKET STRAT', tier: 'common', tag: 'read',
    role: null, rule: 'IGL + MAP', base: 1.25,
  },
  hit: {
    key: 'hit', name: 'HIT THE SITE', tier: 'common', tag: 'tempo',
    role: 'Duelist', rule: '2× DLT', base: 0.7, perRole: 0.75,
  },
  layers: {
    key: 'layers', name: 'UTILITY LAYERS', tier: 'common', tag: 'structure',
    role: 'Controller', rule: 'CTL + INIT', base: 0.8, partner: 'Initiator', pair: 1.8,
  },
  retake: {
    key: 'retake', name: 'RETAKE PROTOCOL', tier: 'common', tag: 'structure',
    role: 'Sentinel', rule: 'SEN + CTL', base: 0.8, partner: 'Controller', pair: 1.8,
  },
  contact: {
    key: 'contact', name: 'CONTACT PLAY', tier: 'uncommon', tag: 'read',
    role: 'Initiator', rule: 'INIT → FLICK', base: 1.2, specialty: 'flick', specialtyBonus: 0.8,
  },
  flood: {
    key: 'flood', name: 'FLOOD THE GAP', tier: 'uncommon', tag: 'tempo',
    role: 'Duelist', rule: 'DLT + FLEX', base: 1.1, specialty: 'flex', specialtyBonus: 1.2,
  },
  defaults: {
    key: 'defaults', name: 'DEEP DEFAULT', tier: 'uncommon', tag: 'read',
    role: 'Sentinel', rule: '4 ROLES', base: 0.6, coverage: 2.4,
  },
  calling: {
    key: 'calling', name: 'SECOND CALL', tier: 'rare', tag: 'read',
    role: null, rule: 'MASTERMIND ×2', base: 1.0, specialty: 'mastermind', specialtyBonus: 2.2,
  },
  noRespect: {
    key: 'no-respect', name: 'NO RESPECT', tier: 'rare', tag: 'tempo',
    role: null, rule: 'FLICK LEADS', base: 0.8, specialty: 'flick', specialtyBonus: 1.5,
  },
  lockout: {
    key: 'lockout', name: 'LOCK THE MAP', tier: 'rare', tag: 'structure',
    role: null, rule: 'MAP RULE ×2', base: 0.5, mapMultiplier: 0.75,
  },
};

export const TACTIC_LIST = Object.values(TACTICS);

function hasSpec(card, key) {
  return getCardSpecialties(card).some(spec => spec.key === key);
}

export function tacticActivation(instance, roster, mapActivationResult = null) {
  const tactic = TACTICS[instance?.key];
  if (!tactic) return { bonus: 0, activeIds: [], tag: null };
  const active = new Set();
  let bonus = tactic.base ?? 0;
  if (tactic.role) {
    const roleCards = roster.filter(card => card.role === tactic.role);
    roleCards.forEach(card => active.add(card.id));
    bonus += roleCards.length * (tactic.perRole ?? 0.35);
  }
  if (tactic.partner && roster.some(card => card.role === tactic.role) && roster.some(card => card.role === tactic.partner)) {
    roster.filter(card => card.role === tactic.role || card.role === tactic.partner).forEach(card => active.add(card.id));
    bonus += tactic.pair ?? 0;
  }
  if (tactic.coverage && new Set(roster.map(card => card.role)).size >= 4) {
    roster.forEach(card => active.add(card.id));
    bonus += tactic.coverage;
  }
  if (tactic.specialty) {
    const specialists = roster.filter(card => hasSpec(card, tactic.specialty));
    specialists.forEach(card => active.add(card.id));
    bonus += specialists.length * (tactic.specialtyBonus ?? 0);
  }
  if (tactic.mapMultiplier && mapActivationResult) bonus += mapActivationResult.bonus * tactic.mapMultiplier;
  return { bonus, activeIds: [...active], tag: tactic.tag, tactic };
}

const COUNTERS = { tempo: 'read', read: 'structure', structure: 'tempo' };

export function tacticClash(playerActivation, opponentActivation) {
  let player = 0;
  let opponent = 0;
  if (COUNTERS[playerActivation?.tag] === opponentActivation?.tag) player = 0.8;
  if (COUNTERS[opponentActivation?.tag] === playerActivation?.tag) opponent = 0.8;
  return { player, opponent };
}

function tacticInstance(rng, tactic, source) {
  return {
    uid: `${tactic.key}-${Math.floor(rng() * 0x7fffffff).toString(36)}`,
    key: tactic.key,
    source,
  };
}

export function createTacticInstance(rng, key, source = 'owned') {
  return tacticInstance(rng, TACTICS[key] ?? TACTICS.pocket, source);
}

function contextualTactics(roster, map) {
  const roles = new Set(roster.map(card => card.role));
  const specs = new Set(roster.flatMap(getCardSpecialties).map(spec => spec.key));
  const scored = TACTIC_LIST.map(tactic => {
    let score = tactic.tier === 'common' ? 3 : tactic.tier === 'uncommon' ? 1 : 0;
    if (!tactic.role || roles.has(tactic.role)) score += 3;
    if (tactic.partner && roles.has(tactic.partner)) score += 2;
    if (tactic.specialty && specs.has(tactic.specialty)) score += 3;
    if (map?.roles?.includes(tactic.role)) score += 2;
    return { tactic, score };
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, 5).map(row => row.tactic);
}

export function refillTacticHand(rng, hand, { roster, map }) {
  const next = [...(hand ?? [])].slice(0, TACTIC_HAND_MAX);
  const pool = contextualTactics(roster, map);
  while (next.length < TACTIC_HAND_FLOOR) {
    const tactic = pool[Math.floor(rng() * pool.length)] ?? TACTICS.pocket;
    next.push(tacticInstance(rng, tactic, 'igl'));
  }
  return next;
}

export function consumeTactic(hand, uid) {
  return (hand ?? []).filter(card => card.uid !== uid);
}

export function tacticBooster(rng, count = 3) {
  const weighted = [
    ...TACTIC_LIST.filter(card => card.tier === 'common'),
    ...TACTIC_LIST.filter(card => card.tier === 'common'),
    ...TACTIC_LIST.filter(card => card.tier === 'uncommon'),
    ...TACTIC_LIST.filter(card => card.tier === 'rare'),
  ];
  return Array.from({ length: count }, () => tacticInstance(rng, weighted[Math.floor(rng() * weighted.length)], 'owned'));
}

export function npcTacticChoices(rng, roster, map) {
  const pool = contextualTactics(roster, map);
  // NPC IGLs obey the same two-card floor as the player. They draw two
  // contextual calls and keep the one their five can activate most strongly;
  // no invisible bespoke AI bonus is needed.
  const choices = Array.from({ length: TACTIC_HAND_FLOOR }, () => (
    tacticInstance(rng, pool[Math.floor(rng() * Math.min(3, pool.length))] ?? TACTICS.pocket, 'igl')
  ));
  const mapResult = mapActivation(roster, map, 0);
  return choices.sort((a, b) => (
    tacticActivation(b, roster, mapResult).bonus - tacticActivation(a, roster, mapResult).bonus
  ) || a.key.localeCompare(b.key));
}

export function npcTactic(rng, roster, map) {
  return npcTacticChoices(rng, roster, map)[0];
}

export function chooseNpcMap(maps, roster, masteryByName = {}) {
  return [...maps].sort((a, b) => (
    mapActivation(roster, b, masteryByName[b.name] ?? 0).bonus
    - mapActivation(roster, a, masteryByName[a.name] ?? 0).bonus
  ) || a.name.localeCompare(b.name))[0];
}
