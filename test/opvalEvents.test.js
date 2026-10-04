import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentEvents } from '../apps/call/src/lib/events.js';

const DAY = 86400;
const now = 1000 * DAY;
const events = [{ id: 1, name: 'Champions' }, { id: 2, name: 'Americas' }, { id: 3, name: 'EMEA' }];
const at = (eventId, offsetDays) => ({ eventId, startsAt: now + offsetDays * DAY });

test('currentEvents keeps only events playing near now', () => {
  const ids = list => list.map(e => e.id);
  assert.deepEqual(ids(currentEvents(events, [at(1, -200), at(2, -2), at(3, 5)], now)), [2, 3]);   // a Kickoff week
  assert.deepEqual(ids(currentEvents(events, [at(1, -1), at(2, -200), at(3, -190)], now)), [1]);   // Champions only
  assert.deepEqual(ids(currentEvents(events, [at(1, -40), at(2, -200)], now)), [1]);              // off-season: latest
  assert.deepEqual(currentEvents(events, [], now), []);
});
