// Persistence for an endless run.
//
// This deliberately lives under its own storage keys rather than inside
// `vfl-perfectrun`: that blob is parsed on every render, and a run is three
// orders of magnitude larger than the records it would otherwise share a key
// with. A run is written only at quiescent phase boundaries.
//
// Two rules govern the format:
//   1. Never serialize a card object — store ids and rehydrate from cards.json.
//      A run is a set of deltas against the card data, not a copy of it.
//   2. Never throw on load. A corrupt or unreadable run is discarded and the
//      player is offered a fresh start; their records blob is untouched.

import { hashSeed } from '../engine/perfectRun.js';

export const ENDLESS_RUN_KEY = 'vfl-endless-run';
export const ENDLESS_META_KEY = 'vfl-endless-run-meta';
export const ENDLESS_SAVE_VERSION = 1;

/**
 * Fingerprint of the card set a run was built against. `npm run sync-cards`
 * can add, remove or re-rate players between sessions; comparing this on load
 * tells us whether a reconciliation pass is needed.
 */
export function cardsRevision(cards) {
  return hashSeed(cards.map(card => card.id).sort().join(',')) >>> 0;
}

const idsOf = list => (list ?? []).map(card => (typeof card === 'string' ? card : card?.id)).filter(Boolean);

// ── serialize ───────────────────────────────────────────────────────────────

function dehydrateTourResult(result) {
  return {
    ...result,
    // Whole card objects here would be ~20x the size of the ids and would go
    // stale against the card data the moment it resyncs.
    mvpBoard: (result.mvpBoard ?? []).map(entry => ({
      id: entry.id ?? entry.card?.id,
      count: entry.count,
    })).filter(entry => entry.id),
    igl: undefined,
    iglId: result.iglId ?? result.igl?.id ?? null,
  };
}

export function serializeEndlessRun(run) {
  return {
    v: ENDLESS_SAVE_VERSION,
    runId: run.runId,
    createdAt: run.createdAt,
    savedAt: Date.now(),

    seed: run.seed,
    rngState: run.rngState,
    cardsRev: run.cardsRev,

    squadName: run.squadName,
    tourIndex: run.tourIndex,
    season: run.season,

    squad: {
      slots: run.squad.slots,
      roster: idsOf(run.squad.roster),
      starters: idsOf(run.squad.starters),
      iglId: run.squad.iglId,
    },

    packs: run.packs,
    reputation: run.reputation,
    standing: run.standing,
    prestige: run.prestige,

    world: run.world,
    dev: run.dev,
    bonds: run.bonds,
    market: run.market,

    yearSummaries: run.yearSummaries,
    tourResults: (run.tourResults ?? []).map(dehydrateTourResult),
    feed: run.feed,
    active: run.active,
  };
}

// ── migrate ─────────────────────────────────────────────────────────────────

/**
 * Bring an on-disk blob up to the current version. Returns null for anything
 * unrecognisable — callers treat that as "no saved run".
 */
export function migrateEndlessRun(json) {
  if (!json || typeof json !== 'object') return null;
  const version = json.v ?? 0;
  if (version > ENDLESS_SAVE_VERSION) return null; // written by a newer build
  // No prior versions exist yet; future migrations chain from here.
  return version === ENDLESS_SAVE_VERSION ? json : null;
}

// ── hydrate ─────────────────────────────────────────────────────────────────

function hydrateTourResult(result, byId) {
  const igl = result.iglId ? byId.get(result.iglId) ?? null : null;
  return {
    ...result,
    mvpBoard: (result.mvpBoard ?? [])
      .map(entry => ({ id: entry.id, card: byId.get(entry.id), count: entry.count }))
      .filter(entry => entry.card),
    igl,
  };
}

/**
 * Rebuild a live run from a stored blob. Card ids that no longer exist (a card
 * resync can retire a player) are dropped rather than left as holes, and the
 * caller is told via `reconciled` so it can surface a "<name> retired" note
 * instead of silently changing the squad.
 */
export function hydrateEndlessRun(json, cards) {
  const migrated = migrateEndlessRun(json);
  if (!migrated) return null;

  try {
    const byId = new Map(cards.map(card => [card.id, card]));
    const resolve = ids => (ids ?? []).map(id => byId.get(id)).filter(Boolean);

    const roster = resolve(migrated.squad?.roster);
    if (!roster.length) return null; // a run with no squad is not resumable

    const starters = resolve(migrated.squad?.starters);
    const missing = (migrated.squad?.roster ?? []).filter(id => !byId.has(id));

    return {
      runId: migrated.runId,
      createdAt: migrated.createdAt,
      savedAt: migrated.savedAt,

      seed: migrated.seed,
      rngState: migrated.rngState,
      cardsRev: migrated.cardsRev,
      // Told apart from a clean load so the UI can explain any squad change.
      reconciled: missing.length > 0 || migrated.cardsRev !== cardsRevision(cards),
      retiredIds: missing,

      squadName: migrated.squadName,
      tourIndex: migrated.tourIndex ?? 0,
      season: migrated.season ?? [],

      squad: {
        slots: migrated.squad?.slots ?? 5,
        roster,
        starters: starters.length ? starters : roster.slice(0, 5),
        iglId: byId.has(migrated.squad?.iglId) ? migrated.squad.iglId : roster[0]?.id ?? null,
      },

      packs: migrated.packs ?? 0,
      reputation: migrated.reputation ?? 0,
      standing: migrated.standing ?? { tier: 0, tierPoints: 0, seasonPlacements: [] },
      prestige: migrated.prestige ?? { level: 0, multiplier: 1, bankedScore: 0 },

      world: migrated.world ?? { ladder: [[], [], []], orgs: {}, signedIds: {} },
      dev: migrated.dev ?? {},
      bonds: migrated.bonds ?? {},
      market: migrated.market ?? { offers: [], interest: [], prospectId: null },

      yearSummaries: migrated.yearSummaries ?? [],
      tourResults: (migrated.tourResults ?? []).map(result => hydrateTourResult(result, byId)),
      feed: migrated.feed ?? [],
      active: migrated.active ?? null,
    };
  } catch {
    return null;
  }
}

// ── storage ─────────────────────────────────────────────────────────────────

/**
 * A tiny companion record so the menu can offer "Resume — Year 4 · Ascension"
 * without parsing the full run.
 */
export function endlessRunMeta(run) {
  return {
    v: ENDLESS_SAVE_VERSION,
    runId: run.runId,
    savedAt: Date.now(),
    squadName: run.squadName,
    year: Math.floor((run.tourIndex ?? 0) / 3) + 1,
    tier: run.standing?.tier ?? 0,
    prestige: run.prestige?.level ?? 0,
    score: run.score ?? 0,
  };
}

export function saveEndlessRun(run, storage = localStorage) {
  try {
    storage.setItem(ENDLESS_RUN_KEY, JSON.stringify(serializeEndlessRun(run)));
    storage.setItem(ENDLESS_META_KEY, JSON.stringify(endlessRunMeta(run)));
    return true;
  } catch {
    // A full or unavailable quota must never take down a run in progress.
    return false;
  }
}

export function loadEndlessRun(cards, storage = localStorage) {
  try {
    const raw = storage.getItem(ENDLESS_RUN_KEY);
    if (!raw) return null;
    return hydrateEndlessRun(JSON.parse(raw), cards);
  } catch {
    return null;
  }
}

export function readEndlessRunMeta(storage = localStorage) {
  try {
    const raw = storage.getItem(ENDLESS_META_KEY);
    if (!raw) return null;
    const meta = JSON.parse(raw);
    return meta?.v === ENDLESS_SAVE_VERSION ? meta : null;
  } catch {
    return null;
  }
}

export function clearEndlessRun(storage = localStorage) {
  try {
    storage.removeItem(ENDLESS_RUN_KEY);
    storage.removeItem(ENDLESS_META_KEY);
  } catch { /* nothing to clean up */ }
}
