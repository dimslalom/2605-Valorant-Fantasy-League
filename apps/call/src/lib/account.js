import { useCallback, useEffect, useRef, useState } from 'react';

// Account + cloud save. Signed out, the game is local-only as before. Signed in, the server
// copy of the save is adopted once (server wins), then every change is uploaded after a pause.
// Each upload carries the save version it was based on; if another device got there first the
// server refuses, we take its copy and say so (no merging).

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => null);
  const data = await res?.json().catch(() => null);
  if (!data) throw Object.assign(new Error("Can't reach the OpVAL server. Check your connection and try again."), { status: 0 });
  if (!res.ok) throw Object.assign(new Error(data.error ?? 'Something went wrong. Try again.'), { status: res.status, data });
  return data;
}

export function useAccount({ state, setSaved }) {
  const [user, setUser] = useState(null);
  const [checked, setChecked] = useState(false); // has the first /me answered (or failed)?
  const [syncedFor, setSyncedFor] = useState(null); // username whose server save has been adopted
  const [notice, setNotice] = useState('');
  const [recoveryCode, setRecoveryCode] = useState(null); // shown once, until the player confirms they saved it
  const synced = Boolean(user) && syncedFor === user.username;
  const sent = useRef('');   // last state JSON the server is known to hold
  const version = useRef(0); // its version

  useEffect(() => {
    api('GET', '/api/auth/me').then(d => setUser(d.user), () => {}).finally(() => setChecked(true));
  }, []);

  const adopt = useCallback(remote => {
    version.current = remote.version;
    if (remote.state) { sent.current = JSON.stringify(remote.state); setSaved(remote.state); }
    else sent.current = '';
  }, [setSaved]);

  // On sign-in: adopt the server save if there is one, otherwise the local save is uploaded below.
  useEffect(() => {
    if (!user) return undefined;
    let live = true;
    api('GET', '/api/save').then(remote => {
      if (!live) return;
      adopt(remote);
      setSyncedFor(user.username);
    }, () => {});
    return () => { live = false; };
  }, [user, adopt]);

  useEffect(() => {
    if (!user || !synced || !state) return undefined;
    const body = JSON.stringify(state);
    if (body === sent.current) return undefined;
    const t = setTimeout(() => {
      api('PUT', '/api/save', { state, version: version.current }).then(
        d => { sent.current = body; version.current = d.version; },
        e => {
          if (e.status !== 409) return;
          adopt(e.data);
          setNotice('This game was changed on another device, so it was reloaded from your account.');
        },
      );
    }, 1500);
    return () => clearTimeout(t);
  }, [user, synced, state, adopt]);

  // ponytail: a second device is only noticed on its next upload; add a refetch on tab focus if that bites.

  const enter = useCallback(path => async fields => {
    const d = await api('POST', path, fields);
    setUser(d.user);
    if (d.recoveryCode) setRecoveryCode(d.recoveryCode);
  }, []);
  const logout = useCallback(async () => {
    await api('POST', '/api/auth/logout', {}).catch(() => {});
    setUser(null);
    setRecoveryCode(null);
  }, []);

  return {
    user, checked, notice, clearNotice: () => setNotice(''),
    recoveryCode, ackRecoveryCode: () => setRecoveryCode(null),
    signup: enter('/api/auth/signup'),
    login: enter('/api/auth/login'),
    reset: enter('/api/auth/reset'),
    newCode: async password => setRecoveryCode((await api('POST', '/api/auth/recovery', { password })).recoveryCode),
    logout,
  };
}
