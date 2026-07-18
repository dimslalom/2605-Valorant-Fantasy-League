const API_ROOT = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api/lobbies`;
const STORAGE_PREFIX = 'vct-lock-in-lobby:';

export async function createLobby(input) {
  const result = await request(API_ROOT, { method: 'POST', body: JSON.stringify(input) });
  saveSession(result.lobbyCode, result);
  return result;
}

export async function joinLobby(code, input) {
  const normalized = code.trim().toUpperCase();
  const existing = loadSession(normalized);
  const result = await request(`${API_ROOT}/${normalized}/join`, {
    method: 'POST',
    body: JSON.stringify({ ...input, sessionToken: input.sessionToken ?? existing?.sessionToken }),
  });
  saveSession(normalized, result);
  return result;
}

export function loadSession(code) {
  try { return JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}${code.toUpperCase()}`)); }
  catch { return null; }
}

export function connectLobby(code, token, onMessage, onStatus) {
  const base = new URL(import.meta.env.BASE_URL, window.location.origin);
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${window.location.host}${base.pathname}ws/${code}?token=${encodeURIComponent(token)}`);
  socket.addEventListener('open', () => onStatus?.('connected'));
  socket.addEventListener('close', () => onStatus?.('disconnected'));
  socket.addEventListener('error', () => onStatus?.('error'));
  socket.addEventListener('message', event => {
    try { onMessage(JSON.parse(event.data)); } catch { /* ignore malformed server frames */ }
  });
  return socket;
}

export function makeCommand(type, snapshot, payload = {}) {
  return {
    type,
    commandId: crypto.randomUUID(),
    expectedVersion: snapshot.version,
    payload,
  };
}

function saveSession(code, value) {
  localStorage.setItem(`${STORAGE_PREFIX}${code.toUpperCase()}`, JSON.stringify(value));
}

async function request(url, options) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json' } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message ?? body.error ?? 'Request failed.');
  return body;
}
