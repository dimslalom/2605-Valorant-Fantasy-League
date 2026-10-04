import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dispatchFeed } from '../apps/call/worker/index.js';

test('cron starts the feed workflow on main, and does nothing without a token', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => { calls.push({ url, init }); return new Response(null, { status: 204 }); };
  assert.equal(await dispatchFeed({}, fakeFetch), 'skipped: no token');
  assert.equal(calls.length, 0);
  assert.equal(await dispatchFeed({ GITHUB_DISPATCH_TOKEN: 't' }, fakeFetch), 204);
  assert.match(calls[0].url, /\/actions\/workflows\/feed\.yml\/dispatches$/);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer t');
  assert.deepEqual(JSON.parse(calls[0].init.body), { ref: 'main' });
});
