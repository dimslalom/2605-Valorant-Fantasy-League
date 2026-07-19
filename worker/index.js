import cards from '../src/data/cards.json';
import {
  GameError,
  LOBBY_TTL_MS,
  addCompetitor,
  addSpectator,
  advanceDeadlines,
  applyCommand,
  createLobbyState,
  nextAlarmAt,
  publicSnapshot,
  setConnection,
} from '../src/engine/multiplayer.js';

const APP_PREFIX = '';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === `${APP_PREFIX}/api/lobbies` && request.method === 'POST') {
      const body = await readJson(request);
      for (let attempt = 0; attempt < 8; attempt++) {
        const code = randomCode();
        const stub = env.LOBBIES.get(env.LOBBIES.idFromName(code));
        const response = await stub.fetch('https://lobby.internal/create', {
          method: 'POST',
          body: JSON.stringify({ ...body, code }),
        });
        if (response.status !== 409) return response;
      }
      return json({ error: 'code_generation_failed', message: 'Could not allocate a lobby code.' }, 503);
    }

    const joinMatch = url.pathname.match(/^\/api\/lobbies\/([A-Z2-9]{6})\/join$/);
    if (joinMatch && request.method === 'POST') {
      const stub = env.LOBBIES.get(env.LOBBIES.idFromName(joinMatch[1]));
      return stub.fetch('https://lobby.internal/join', { method: 'POST', body: JSON.stringify(await readJson(request)) });
    }

    const wsMatch = url.pathname.match(/^\/ws\/([A-Z2-9]{6})$/);
    if (wsMatch) {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'upgrade_required' }, 426);
      const stub = env.LOBBIES.get(env.LOBBIES.idFromName(wsMatch[1]));
      const internal = new URL('https://lobby.internal/connect');
      internal.searchParams.set('token', url.searchParams.get('token') ?? '');
      return stub.fetch(new Request(internal, request));
    }

    // ── Daily-challenge leaderboard (D1) ────────────────────────────────────

    if (url.pathname === `${APP_PREFIX}/api/daily-scores` && request.method === 'POST') {
      const body = await readJson(request).catch(() => null);
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return json({ error: 'invalid_submission' }, 400);
      }
      const date = String(body.date ?? '');
      const clientId = String(body.clientId ?? '');
      const squadName = String(body.squadName ?? '').trim().replace(/\s+/g, ' ');
      const score = body.score;
      if (!isValidDateKey(date)
          || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)
          || !squadName || squadName.length > 28
          || !Number.isInteger(score) || score < 0 || score > 5000) {
        return json({ error: 'invalid_submission' }, 400);
      }
      // UNIQUE(date, client_id) + OR IGNORE = atomic once-per-day gate.
      const result = await env.DB.prepare(
        `INSERT OR IGNORE INTO daily_scores (date, client_id, squad_name, score, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(date, clientId, squadName, score, Date.now()).run();
      return json({ accepted: result.meta.changes > 0 });
    }

    if (url.pathname === `${APP_PREFIX}/api/leaderboard/daily` && request.method === 'GET') {
      const date = url.searchParams.get('date') ?? '';
      if (!isValidDateKey(date)) return json({ error: 'invalid_date' }, 400);
      const { results } = await env.DB.prepare(
        `SELECT client_id, squad_name, score FROM daily_scores
         WHERE date = ? ORDER BY score DESC, created_at ASC LIMIT 50`,
      ).bind(date).all();
      return json({
        rows: results.map(r => ({ clientId: r.client_id, squadName: r.squad_name, score: r.score })),
      });
    }

    if (url.pathname === `${APP_PREFIX}/api/leaderboard/overall` && request.method === 'GET') {
      // Best single day per client; SQLite's bare-column rule pulls
      // squad_name from the same row as MAX(score).
      const { results } = await env.DB.prepare(
        `SELECT client_id, squad_name, MAX(score) AS best, COUNT(*) AS days
         FROM daily_scores GROUP BY client_id ORDER BY best DESC LIMIT 50`,
      ).all();
      return json({
        rows: results.map(r => ({ clientId: r.client_id, squadName: r.squad_name, best: r.best, days: r.days })),
      });
    }

    if (!url.pathname.startsWith(`${APP_PREFIX}/`) && url.pathname !== APP_PREFIX) return new Response('Not found', { status: 404 });
    if (request.method === 'GET' && request.headers.get('Accept')?.includes('text/html') && url.pathname !== `${APP_PREFIX}/index.html`) {
      const fallback = new URL(`${APP_PREFIX}/`, url.origin);
      return env.ASSETS.fetch(new Request(fallback, request));
    }
    const assetResponse = await env.ASSETS.fetch(request);
    if (assetResponse.status !== 404) return assetResponse;
    if (request.method !== 'GET' || !request.headers.get('Accept')?.includes('text/html')) return assetResponse;
    const fallback = new URL(`${APP_PREFIX}/`, url.origin);
    return env.ASSETS.fetch(new Request(fallback, request));
  },
};

export class Lobby {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.game = null;
    this.auth = null;
    this.ready = ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get(['game', 'auth']);
      this.game = stored.get('game') ?? null;
      this.auth = stored.get('auth') ?? { competitors: {}, spectators: {} };
    });
  }

  async fetch(request) {
    await this.ready;
    const url = new URL(request.url);
    try {
      if (url.pathname === '/create' && request.method === 'POST') return this.create(await readJson(request));
      if (url.pathname === '/join' && request.method === 'POST') return this.join(await readJson(request));
      if (url.pathname === '/connect') return this.connect(request, url.searchParams.get('token') ?? '');
      return json({ error: 'not_found' }, 404);
    } catch (error) {
      return errorResponse(error);
    }
  }

  async create(body) {
    if (this.game) return json({ error: 'lobby_exists' }, 409);
    const now = Date.now();
    const competitorId = crypto.randomUUID();
    const sessionToken = randomToken();
    this.game = createLobbyState({
      code: body.code,
      hostId: competitorId,
      squadName: body.squadName,
      settings: body.settings,
      seed: crypto.getRandomValues(new Uint32Array(1))[0],
      now,
    });
    this.auth.competitors[competitorId] = await hashToken(sessionToken);
    await this.persistAndSchedule();
    return json({ lobbyCode: body.code, competitorId, sessionToken });
  }

  async join(body) {
    if (!this.game) return json({ error: 'lobby_not_found', message: 'Lobby not found.' }, 404);
    if (body.sessionToken) {
      const identity = await this.authenticate(body.sessionToken);
      if (identity) return json({ lobbyCode: this.game.code, ...identity, sessionToken: body.sessionToken, reconnected: true });
    }
    const now = Date.now();
    const sessionToken = randomToken();
    if (this.game.phase === 'lobby') {
      const competitorId = crypto.randomUUID();
      addCompetitor(this.game, { id: competitorId, squadName: body.squadName, now });
      this.auth.competitors[competitorId] = await hashToken(sessionToken);
      await this.persistAndSchedule();
      return json({ lobbyCode: this.game.code, competitorId, sessionToken, role: 'competitor' });
    }
    const spectatorId = crypto.randomUUID();
    addSpectator(this.game, { id: spectatorId, now });
    this.auth.spectators[spectatorId] = await hashToken(sessionToken);
    await this.persistAndSchedule();
    return json({ lobbyCode: this.game.code, spectatorId, sessionToken, role: 'spectator' });
  }

  async connect(request, token) {
    if (!this.game) return json({ error: 'lobby_not_found' }, 404);
    const identity = await this.authenticate(token);
    if (!identity) return json({ error: 'invalid_session' }, 401);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(identity);
    setConnection(this.game, identity.participantId, true, Date.now());
    await this.persistAndSchedule();
    server.send(JSON.stringify({ type: 'snapshot', snapshot: publicSnapshot(this.game) }));
    this.broadcast({ type: 'presence', snapshot: publicSnapshot(this.game) }, server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    await this.ready;
    const identity = ws.deserializeAttachment();
    try {
      const command = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message));
      const result = applyCommand(this.game, identity.participantId, command, cards, Date.now());
      if (!result.duplicate && command.type === 'kick_player') {
        delete this.auth.competitors[command.payload?.competitorId];
        for (const socket of this.ctx.getWebSockets()) {
          if (socket.deserializeAttachment()?.participantId === command.payload?.competitorId) socket.close(4001, 'Removed by host');
        }
      }
      if (!result.duplicate) await this.persistAndSchedule();
      this.broadcast({
        type: 'state_patch',
        version: this.game.version,
        snapshot: publicSnapshot(this.game),
        events: result.events,
      });
    } catch (error) {
      ws.send(JSON.stringify({
        type: 'command_rejected',
        code: error.code ?? 'invalid_command',
        message: error.message,
        snapshot: publicSnapshot(this.game),
      }));
    }
  }

  async webSocketClose(ws) {
    await this.ready;
    const identity = ws.deserializeAttachment();
    if (identity && !this.hasOtherSocket(identity.participantId, ws)) {
      setConnection(this.game, identity.participantId, false, Date.now());
      await this.persistAndSchedule();
      this.broadcast({ type: 'presence', snapshot: publicSnapshot(this.game) });
    }
  }

  async webSocketError(ws) {
    await this.webSocketClose(ws);
  }

  async alarm() {
    await this.ready;
    if (!this.game) return;
    const now = Date.now();
    const noSockets = this.ctx.getWebSockets().length === 0;
    const noGameDeadline = !this.game.draft?.deadlineAt && !this.game.pendingTransition?.deadlineAt && !this.game.consolation?.deadlineAt;
    if (noSockets && noGameDeadline && now - this.game.lastActiveAt >= LOBBY_TTL_MS) {
      await this.ctx.storage.deleteAll();
      this.game = null;
      this.auth = { competitors: {}, spectators: {} };
      return;
    }
    const result = advanceDeadlines(this.game, cards, now);
    if (result.changed) {
      await this.persistAndSchedule();
      this.broadcast({ type: 'state_patch', version: this.game.version, snapshot: publicSnapshot(this.game), events: result.events });
    } else {
      await this.scheduleAlarm();
    }
  }

  async authenticate(token) {
    if (!token) return null;
    const hash = await hashToken(token);
    for (const [participantId, stored] of Object.entries(this.auth.competitors)) {
      if (stored === hash) return { participantId, role: 'competitor' };
    }
    for (const [participantId, stored] of Object.entries(this.auth.spectators)) {
      if (stored === hash) return { participantId, role: 'spectator' };
    }
    return null;
  }

  hasOtherSocket(participantId, closingSocket) {
    return this.ctx.getWebSockets().some(socket => socket !== closingSocket && socket.deserializeAttachment()?.participantId === participantId);
  }

  broadcast(payload, except = null) {
    const message = JSON.stringify(payload);
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except) continue;
      try { socket.send(message); } catch { /* stale sockets are cleaned up by the runtime */ }
    }
  }

  async persistAndSchedule() {
    await this.ctx.storage.put({ game: this.game, auth: this.auth });
    await this.scheduleAlarm();
  }

  async scheduleAlarm() {
    const at = this.game && nextAlarmAt(this.game);
    if (at) await this.ctx.storage.setAlarm(at);
    else await this.ctx.storage.deleteAlarm();
  }
}

function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, byte => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('');
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hashToken(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function readJson(request) {
  try { return await request.json(); } catch { throw new GameError('invalid_json', 'Expected a JSON request body.'); }
}

function errorResponse(error) {
  const status = error.code === 'unauthorized' ? 403 : error.code?.includes('not_found') ? 404 : 400;
  return json({ error: error.code ?? 'internal_error', message: error.message }, status);
}

function isValidDateKey(value) {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 2020 || year > 2100 || month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
