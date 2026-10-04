import test from 'node:test';
import assert from 'node:assert/strict';
import { d1 } from './helpers/d1Shim.js';
import { handleAccounts } from '../apps/call/worker/accounts.js';

const env = () => ({ DB: d1() });
const call = (e, method, path, body, cookie, ip) => {
  const url = new URL(`https://x.test${path}`);
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  if (ip) headers['CF-Connecting-IP'] = ip;
  return handleAccounts(new Request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), e, url);
};
const cookieOf = res => res.headers.get('Set-Cookie').split(';')[0];
const save = { collection: [{ pid: 1 }], credits: 5 };

test('signup, me, save round trip, logout', async () => {
  const e = env();
  const res = await call(e, 'POST', '/api/auth/signup', { username: 'Dimas_1', password: 'correct horse' });
  assert.equal(res.status, 201);
  assert.match(res.headers.get('Set-Cookie'), /HttpOnly; Secure; SameSite=Lax/);
  const cookie = cookieOf(res);

  assert.deepEqual(await (await call(e, 'GET', '/api/auth/me', undefined, cookie)).json(), { user: { username: 'dimas_1' } });
  assert.deepEqual(await (await call(e, 'GET', '/api/save', undefined, cookie)).json(), { state: null, version: 0 });
  assert.equal((await call(e, 'PUT', '/api/save', { state: save, version: 0 }, cookie)).status, 200);
  assert.deepEqual(await (await call(e, 'GET', '/api/save', undefined, cookie)).json(), { state: save, version: 1 });

  await call(e, 'POST', '/api/auth/logout', {}, cookie);
  assert.deepEqual(await (await call(e, 'GET', '/api/auth/me', undefined, cookie)).json(), { user: null });
  assert.equal((await call(e, 'GET', '/api/save', undefined, cookie)).status, 401);
});

test('password is never stored in the clear', async () => {
  const e = env();
  await call(e, 'POST', '/api/auth/signup', { username: 'abc', password: 'hunter2hunter2' });
  const row = e.DB.sqlite.prepare('SELECT pw_hash FROM users').get();
  assert.ok(!row.pw_hash.includes('hunter2'));
  assert.match(row.pw_hash, /^[0-9a-f]{32}:[0-9a-f]{64}$/);
});

test('login: right password works, wrong or unknown user is the same 401', async () => {
  const e = env();
  await call(e, 'POST', '/api/auth/signup', { username: 'abc', password: 'hunter2hunter2' });
  assert.equal((await call(e, 'POST', '/api/auth/login', { username: 'ABC', password: 'hunter2hunter2' })).status, 200);
  const wrong = await call(e, 'POST', '/api/auth/login', { username: 'abc', password: 'nope-nope-nope' });
  const ghost = await call(e, 'POST', '/api/auth/login', { username: 'ghost', password: 'nope-nope-nope' });
  assert.equal(wrong.status, 401);
  assert.deepEqual(await wrong.json(), await ghost.json());
});

test('signup validates input and rejects duplicate usernames', async () => {
  const e = env();
  assert.equal((await call(e, 'POST', '/api/auth/signup', { username: 'a', password: 'longenough' })).status, 400);
  assert.equal((await call(e, 'POST', '/api/auth/signup', { username: 'good_name', password: 'short' })).status, 400);
  assert.equal((await call(e, 'POST', '/api/auth/signup', { username: 'bad name!', password: 'longenough' })).status, 400);
  assert.equal((await call(e, 'POST', '/api/auth/signup', { username: 'taken', password: 'longenough' })).status, 201);
  assert.equal((await call(e, 'POST', '/api/auth/signup', { username: 'TAKEN', password: 'longenough' })).status, 409);
});

test('expired sessions and non-JSON bodies are refused; saves are per user', async () => {
  const e = env();
  const a = cookieOf(await call(e, 'POST', '/api/auth/signup', { username: 'alice', password: 'longenough' }));
  const b = cookieOf(await call(e, 'POST', '/api/auth/signup', { username: 'bobby', password: 'longenough' }));
  await call(e, 'PUT', '/api/save', { state: save, version: 0 }, a);
  assert.deepEqual(await (await call(e, 'GET', '/api/save', undefined, b)).json(), { state: null, version: 0 });
  assert.equal((await call(e, 'PUT', '/api/save', { state: { nope: 1 }, version: 0 }, b)).status, 400);

  const url = new URL('https://x.test/api/auth/login');
  const form = await handleAccounts(new Request(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{"username":"alice","password":"longenough"}' }), e, url);
  assert.equal(form.status, 401);

  e.DB.sqlite.prepare('UPDATE sessions SET expires_at = 1').run();
  assert.equal((await call(e, 'GET', '/api/save', undefined, a)).status, 401);
});

test('unknown paths fall through', async () => {
  assert.equal(await call(env(), 'GET', '/api/nothing'), null);
});

test('two devices: a stale write is refused and gets the server copy back', async () => {
  const e = env();
  const cookie = cookieOf(await call(e, 'POST', '/api/auth/signup', { username: 'alice', password: 'longenough' }));
  const put = (state, version) => call(e, 'PUT', '/api/save', { state, version }, cookie);
  const a1 = { collection: [1] };
  const b1 = { collection: [1, 2] };

  assert.deepEqual(await (await put(a1, 0)).json(), { ok: true, version: 1 });
  assert.deepEqual(await (await put(b1, 1)).json(), { ok: true, version: 2 }); // device B
  const stale = await put({ collection: [9] }, 1);                              // device A, still on v1
  assert.equal(stale.status, 409);
  assert.deepEqual(await stale.json(), { state: b1, version: 2 });
  // a second device that never saw a save cannot overwrite the first one's either
  assert.equal((await put({ collection: [7] }, 0)).status, 409);
  assert.deepEqual(await (await call(e, 'GET', '/api/save', undefined, cookie)).json(), { state: b1, version: 2 });
});

test('login and signup are rate limited', async () => {
  const e = env();
  await call(e, 'POST', '/api/auth/signup', { username: 'victim', password: 'longenough' }, undefined, '1.1.1.1');
  const statuses = [];
  for (let i = 0; i < 10; i += 1) {
    statuses.push((await call(e, 'POST', '/api/auth/login', { username: 'victim', password: 'guess-guess' }, undefined, `9.9.9.${i}`)).status);
  }
  assert.deepEqual(statuses, [401, 401, 401, 401, 401, 401, 401, 401, 429, 429]); // 8 per username
  // even the right password is held off while the window is full
  assert.equal((await call(e, 'POST', '/api/auth/login', { username: 'victim', password: 'longenough' }, undefined, '8.8.8.8')).status, 429);

  const codes = [];
  for (let i = 0; i < 7; i += 1) codes.push((await call(e, 'POST', '/api/auth/signup', { username: `user_${i}`, password: 'longenough' }, undefined, '2.2.2.2')).status);
  assert.deepEqual(codes.slice(5), [429, 429]);
});

const signUp = async (e, username = 'alice', password = 'old-password') => {
  const res = await call(e, 'POST', '/api/auth/signup', { username, password });
  return { cookie: cookieOf(res), code: (await res.json()).recoveryCode };
};

test('signup hands out a recovery code once, stored only as a hash', async () => {
  const e = env();
  const { code } = await signUp(e);
  assert.match(code, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
  const stored = e.DB.sqlite.prepare('SELECT recovery_hash FROM users').get().recovery_hash;
  assert.match(stored, /^[0-9a-f]{64}$/);
  assert.ok(!stored.includes(code.replace(/-/g, '').toLowerCase()));
});

test('reset: recovery code sets a new password, signs out old sessions, rotates the code', async () => {
  const e = env();
  const { cookie: old, code } = await signUp(e);

  assert.equal((await call(e, 'POST', '/api/auth/reset', { username: 'alice', code: 'AAAA-AAAA-AAAA-AAAA', password: 'new-password' })).status, 401);
  assert.equal((await call(e, 'POST', '/api/auth/reset', { username: 'ghost', code, password: 'new-password' })).status, 401);
  assert.equal((await call(e, 'POST', '/api/auth/reset', { username: 'alice', code, password: 'short' })).status, 400);

  // lowercase and missing dashes are fine
  const done = await call(e, 'POST', '/api/auth/reset', { username: 'Alice', code: code.toLowerCase().replace(/-/g, ' '), password: 'new-password' });
  assert.equal(done.status, 200);
  const next = (await done.json()).recoveryCode;
  assert.notEqual(next, code);

  assert.deepEqual(await (await call(e, 'GET', '/api/auth/me', undefined, old)).json(), { user: null });
  assert.deepEqual(await (await call(e, 'GET', '/api/auth/me', undefined, cookieOf(done))).json(), { user: { username: 'alice' } });
  assert.equal((await call(e, 'POST', '/api/auth/login', { username: 'alice', password: 'old-password' })).status, 401);
  assert.equal((await call(e, 'POST', '/api/auth/login', { username: 'alice', password: 'new-password' })).status, 200);
  assert.equal((await call(e, 'POST', '/api/auth/reset', { username: 'alice', code, password: 'another-one-1' })).status, 401); // spent
  assert.equal((await call(e, 'POST', '/api/auth/reset', { username: 'alice', code: next, password: 'another-one-1' })).status, 200);
});

test('reset guessing is rate limited per username', async () => {
  const e = env();
  const { code } = await signUp(e);
  const out = [];
  for (let i = 0; i < 7; i += 1) out.push((await call(e, 'POST', '/api/auth/reset', { username: 'alice', code: 'AAAA-AAAA-AAAA-AAAA', password: 'new-password' }, undefined, `7.7.7.${i}`)).status);
  assert.deepEqual(out, [401, 401, 401, 401, 401, 429, 429]);
  assert.equal((await call(e, 'POST', '/api/auth/reset', { username: 'alice', code, password: 'new-password' }, undefined, '6.6.6.6')).status, 429);
});

test('a signed-in user can replace the recovery code with their password', async () => {
  const e = env();
  const { cookie, code } = await signUp(e);
  assert.equal((await call(e, 'POST', '/api/auth/recovery', { password: 'old-password' })).status, 401);
  assert.equal((await call(e, 'POST', '/api/auth/recovery', { password: 'wrong-password' }, cookie)).status, 401);
  const fresh = (await (await call(e, 'POST', '/api/auth/recovery', { password: 'old-password' }, cookie)).json()).recoveryCode;
  assert.notEqual(fresh, code);
  assert.equal((await call(e, 'POST', '/api/auth/reset', { username: 'alice', code, password: 'new-password' })).status, 401);
  assert.equal((await call(e, 'POST', '/api/auth/reset', { username: 'alice', code: fresh, password: 'new-password' })).status, 200);
});
