import { handleFeed } from '../../../worker/feed/routes.js';
import { handleAccounts } from './accounts.js';

// OpVAL's Worker: a read-only window onto the shared feed database, plus accounts
// and cloud saves (accounts.js). Ingest stays on the old site's Worker, so
// no secrets live here. Static files bypass this Worker entirely (see wrangler.jsonc).

const CSP = [
  "default-src 'self'",
  // 'wasm-unsafe-eval' lets the Rive runtime compile its self-hosted wasm.
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

function secure(response) {
  const out = new Response(response.body, response);
  out.headers.set('Content-Security-Policy', CSP);
  out.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  out.headers.set('X-Content-Type-Options', 'nosniff');
  out.headers.set('X-Frame-Options', 'DENY');
  out.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  return out;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Read-only feed. handleFeed also knows the ingest path, so only the public prefix is routed here.
    if (url.pathname.startsWith('/api/feed/')) return secure(await handleFeed(request, env, url));
    if (url.pathname.startsWith('/api/')) {
      const res = await handleAccounts(request, env, url);
      return secure(res ?? Response.json({ error: 'not found' }, { status: 404 }));
    }

    // HTML routes: the app shell for any client-side route.
    const wantsHtml = request.method === 'GET' && (request.headers.get('Accept') ?? '').includes('text/html');
    const asset = await env.ASSETS.fetch(wantsHtml ? new Request(new URL('/', url.origin), request) : request);
    return secure(asset);
  },
};
