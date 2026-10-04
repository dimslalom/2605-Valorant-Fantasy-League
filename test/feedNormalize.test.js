import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeMatch, unixOf } from '../scripts/feed/normalize.js';
import { judgeMatch } from '../worker/feed/validate.js';

// Golden output of the patched vlrggapi on the saved XLG vs NS Champions match.
const golden = JSON.parse(readFileSync(new URL('./fixtures/feed/match-753462.v2.json', import.meta.url), 'utf8'));
const segment = golden.data.segments[0];

test('a real vlrggapi match normalizes to ten players per map and passes validation', () => {
  const match = normalizeMatch(segment, { roundId: '2766:2026-10-01' });
  assert.equal(match.matchId, 753462);
  assert.equal(match.eventId, 2766);
  assert.equal(match.bestOf, 3);
  assert.equal(match.status, 'final');
  assert.equal(match.maps.length, 2);
  for (const map of match.maps) {
    assert.equal(map.players.length, 10);
    assert.equal(map.players.filter(p => p.side === 1).length, 5);
    assert.ok(map.players.every(p => Number.isInteger(p.vlrId) && p.agent));
  }
  const verdict = judgeMatch(match);
  assert.equal(verdict.verdict, 'accept');
  assert.equal(verdict.statsRank, 3);
});

test('stats, tags, sides and clutches carry through exactly', () => {
  const match = normalizeMatch(segment);
  assert.deepEqual(match.teams.map(t => t.tag), ['XLG', 'NS']);
  assert.equal(match.winner, 2);
  const lysoar = match.maps[0].players.find(p => p.vlrId === 37489);
  assert.deepEqual([lysoar.handle, lysoar.agent, lysoar.r2, lysoar.acs, lysoar.k, lysoar.d, lysoar.a, lysoar.kast, lysoar.fk, lysoar.fd],
    ['Lysoar', 'omen', 1.37, 262, 22, 17, 11, 71, 2, 2]);
  assert.equal(lysoar.atk.r2, 1.81);
  assert.equal(lysoar.def.k, 7);
  const francis = match.maps[1].players.find(p => p.handle === 'Francis');
  assert.equal(francis.cl[0], 1);  // 1v1 won on Sunset
  assert.equal(francis.mk[1], 2);  // two 3Ks
  assert.equal(match.maps[0].pickedBy, 1);
  assert.equal(match.maps[1].pickedBy, 2);
  assert.deepEqual(match.maps[0].score, [11, 13]);
});

test('content hash is stable for identical input and changes when stats change', () => {
  const a = normalizeMatch(segment).contentHash;
  assert.equal(normalizeMatch(segment).contentHash, a);
  const edited = JSON.parse(JSON.stringify(segment));
  edited.maps[0].players.team1[0].kills = '23';
  assert.notEqual(normalizeMatch(edited).contentHash, a);
  const rescheduled = { ...segment, start_utc: '2026-10-01 09:00:00' };
  assert.notEqual(normalizeMatch(rescheduled).contentHash, a);
});

test('vlr data-utc-ts is US Eastern wall time, converted with daylight saving', () => {
  const utc = (...p) => Date.UTC(...p) / 1000;
  assert.equal(unixOf('2026-10-04 05:00:00'), utc(2026, 9, 4, 9, 0));     // EDT, UTC-4 (Champions Shanghai)
  assert.equal(unixOf('2026-01-20 15:00:00'), utc(2026, 0, 20, 20, 0));   // EST, UTC-5 (Kickoff)
  assert.equal(unixOf('2026-03-08 03:30:00'), utc(2026, 2, 8, 7, 30));    // just after the spring change
  assert.equal(unixOf('2026-11-01 00:30:00'), utc(2026, 10, 1, 4, 30));   // before the autumn change
  assert.equal(unixOf(''), null);
  assert.equal(unixOf('not a date'), null);
});
