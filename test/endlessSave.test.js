import test from 'node:test';
import assert from 'node:assert/strict';
import cards from '../src/data/cards.json' with { type: 'json' };
import {
  ENDLESS_META_KEY,
  ENDLESS_RUN_KEY,
  cardsRevision,
  clearEndlessRun,
  hydrateEndlessRun,
  loadEndlessRun,
  readEndlessRunMeta,
  saveEndlessRun,
  serializeEndlessRun,
} from '../src/lib/endlessRunSave.js';
import { migratePerfectRunSaves } from '../src/lib/perfectRunSaves.js';

function fakeStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key),
    get size() { return map.size; },
  };
}

function sampleRun() {
  const roster = cards.filter(card => card.org).slice(0, 6);
  return {
    runId: 'run-1',
    createdAt: 1000,
    seed: 4242,
    rngState: 0xdeadbeef,
    cardsRev: cardsRevision(cards),
    squadName: 'GAUNTLET',
    tourIndex: 4,
    season: [{ kind: 'masters', city: 'Berlin', label: 'Masters Berlin' }],
    squad: { slots: 6, roster, starters: roster.slice(0, 5), iglId: roster[0].id },
    packs: 2,
    reputation: 140,
    standing: { tier: 1, tierPoints: 30, seasonPlacements: [4, 2] },
    prestige: { level: 0, multiplier: 1, bankedScore: 0 },
    world: { ladder: [[], [], []], orgs: { FNC: { coh: 3 } }, signedIds: {} },
    dev: { [roster[0].id]: { d: 2, a: 1, m: 3, s: 0, p: 48, f: 20, cy: 2, yr: 1 } },
    bonds: { [`${roster[0].id}~${roster[1].id}`]: 4 },
    market: { offers: [], interest: [], prospectId: null },
    yearSummaries: [{ score: 900, titles: 1 }],
    tourResults: [{
      kind: 'masters', label: 'Masters Berlin', champion: true, series: [],
      mvpBoard: [{ card: roster[0], count: 3 }, { card: roster[1], count: 1 }],
      igl: roster[0],
    }],
    feed: [{ y: 1, t: 2, k: 'bond', ids: [roster[0].id, roster[1].id], n: 3 }],
    active: null,
  };
}

test('a run round-trips through storage without losing state', () => {
  const storage = fakeStorage();
  const run = sampleRun();

  assert.equal(saveEndlessRun(run, storage), true);
  const loaded = loadEndlessRun(cards, storage);

  assert.equal(loaded.squadName, 'GAUNTLET');
  assert.equal(loaded.tourIndex, 4);
  assert.equal(loaded.packs, 2);
  assert.equal(loaded.reputation, 140);
  assert.equal(loaded.rngState, 0xdeadbeef);
  assert.equal(loaded.squad.slots, 6);
  assert.equal(loaded.squad.iglId, run.squad.iglId);
  assert.deepEqual(loaded.squad.roster.map(c => c.id), run.squad.roster.map(c => c.id));
  assert.deepEqual(loaded.squad.starters.map(c => c.id), run.squad.starters.map(c => c.id));
  assert.deepEqual(loaded.standing, run.standing);
  assert.deepEqual(loaded.dev, run.dev);
  assert.deepEqual(loaded.bonds, run.bonds);
  assert.equal(loaded.reconciled, false);
});

test('serializing is idempotent, so repeated autosaves cannot drift', () => {
  const run = sampleRun();
  const once = serializeEndlessRun(run);
  const twice = serializeEndlessRun(hydrateEndlessRun(once, cards));
  // savedAt is a clock reading by design; everything else must be stable.
  delete once.savedAt; delete twice.savedAt;
  assert.deepEqual(twice, once);
});

test('no card object survives serialization', () => {
  const json = JSON.stringify(serializeEndlessRun(sampleRun()));
  // A serialized card would drag its art and stat payload along with it.
  assert.equal(json.includes('"photo"'), false);
  assert.equal(json.includes('"org_logo"'), false);
  assert.equal(json.includes('"headGeom"'), false);
  assert.equal(json.includes('"stats"'), false);
});

test('tournament results keep their MVP board and IGL across a reload', () => {
  const storage = fakeStorage();
  const run = sampleRun();
  saveEndlessRun(run, storage);
  const [result] = loadEndlessRun(cards, storage).tourResults;

  assert.equal(result.mvpBoard.length, 2);
  assert.equal(result.mvpBoard[0].card.id, run.squad.roster[0].id);
  assert.equal(result.mvpBoard[0].count, 3);
  assert.equal(result.igl.id, run.squad.iglId);
});

test('a retired card is reconciled rather than left as a hole', () => {
  const storage = fakeStorage();
  saveEndlessRun(sampleRun(), storage);

  // Simulate `npm run sync-cards` retiring the squad's second player.
  const resynced = cards.filter(card => card.id !== sampleRun().squad.roster[1].id);
  const loaded = loadEndlessRun(resynced, storage);

  assert.equal(loaded.squad.roster.length, 5);
  assert.equal(loaded.reconciled, true);
  assert.deepEqual(loaded.retiredIds, [sampleRun().squad.roster[1].id]);
  assert.equal(loaded.squad.roster.some(c => c.id === sampleRun().squad.roster[1].id), false);
});

test('the IGL falls back to a real squad member if the saved one is gone', () => {
  const storage = fakeStorage();
  const run = sampleRun();
  saveEndlessRun(run, storage);
  const resynced = cards.filter(card => card.id !== run.squad.iglId);

  const loaded = loadEndlessRun(resynced, storage);
  assert.ok(loaded.squad.roster.some(c => c.id === loaded.squad.iglId));
});

test('a corrupt or foreign run is discarded, never thrown', () => {
  assert.equal(loadEndlessRun(cards, fakeStorage({ [ENDLESS_RUN_KEY]: 'not json{' })), null);
  assert.equal(loadEndlessRun(cards, fakeStorage({ [ENDLESS_RUN_KEY]: 'null' })), null);
  assert.equal(loadEndlessRun(cards, fakeStorage({ [ENDLESS_RUN_KEY]: '{"v":999}' })), null);
  assert.equal(loadEndlessRun(cards, fakeStorage({ [ENDLESS_RUN_KEY]: '{"v":1}' })), null);
  assert.equal(loadEndlessRun(cards, fakeStorage()), null);
  assert.equal(hydrateEndlessRun(undefined, cards), null);
});

test('a storage failure is survivable and does not abort the run', () => {
  const hostile = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => {} };
  assert.equal(saveEndlessRun(sampleRun(), hostile), false);
});

test('the menu can read a run summary without parsing the run', () => {
  const storage = fakeStorage();
  saveEndlessRun(sampleRun(), storage);
  const meta = readEndlessRunMeta(storage);

  assert.equal(meta.squadName, 'GAUNTLET');
  assert.equal(meta.year, 2);          // tourIndex 4 -> second year
  assert.equal(meta.tier, 1);
  // Small enough to be worth reading on the menu's render path.
  assert.ok(storage.getItem(ENDLESS_META_KEY).length < 300);
});

test('clearing removes both keys', () => {
  const storage = fakeStorage();
  saveEndlessRun(sampleRun(), storage);
  clearEndlessRun(storage);
  assert.equal(storage.getItem(ENDLESS_RUN_KEY), null);
  assert.equal(readEndlessRunMeta(storage), null);
});

// ── records blob ────────────────────────────────────────────────────────────

test('v2 records migrate to v3 with the old endless score kept as an archive', () => {
  const migrated = migratePerfectRunSaves({
    saveVersion: 2, bestScore: 500, endlessV2: { bestScore: 4200, bestYears: 6 },
  });
  assert.equal(migrated.saveVersion, 3);
  assert.equal(migrated.bestScore, 500);
  assert.deepEqual(migrated.endlessV2, { bestScore: 4200, bestYears: 6 }, 'V2 record is preserved, not deleted');
  assert.deepEqual(migrated.endlessV3, {
    bestScore: 0, bestYears: 0, bestTier: 0, bestPrestige: 0, titlesByTier: [0, 0, 0],
  });
});

test('the v1 archive still survives the second migration', () => {
  const migrated = migratePerfectRunSaves({ bestEndless: 1234, bestCycle: 5, grandSlams: 2 });
  assert.deepEqual(migrated.legacyEndlessV1, { bestScore: 1234, bestCycle: 5 });
  assert.deepEqual(migrated.endlessV2, { bestScore: 0, bestYears: 0 });
  assert.equal(migrated.endlessV3.bestScore, 0);
  assert.equal(migrated.grandSlams, 2);
});

test('the records blob stays small enough to parse on the render path', () => {
  const full = migratePerfectRunSaves({
    saveVersion: 3, bestScore: 9999,
    badges: { masters: 12, champions: 4, grand_slam: 2, perfect_season: 1 },
    dailyScores: Object.fromEntries(Array.from({ length: 90 }, (_, i) => [`2026-9-${i}`, 1000 + i])),
    enc: { bestWins: 5, bestFinish: 'Champion', titles: 2, flawless: 1 },
  });
  assert.ok(JSON.stringify(full).length < 4000);
});
