// Bearer check for /internal/* routes. Compares SHA-256 digests so the
// comparison time does not depend on how much of the token matched.
export async function timingSafeHashEqual(left, right) {
  const encoder = new TextEncoder();
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(String(left))),
    crypto.subtle.digest('SHA-256', encoder.encode(String(right))),
  ]);
  // crypto.subtle.timingSafeEqual exists only in Workers; both digests are 32
  // bytes, so a plain constant-time XOR loop works everywhere (Node tests too).
  const a = new Uint8Array(leftDigest);
  const b = new Uint8Array(rightDigest);
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function isAuthorized(request, env) {
  const expected = env.FEED_INGEST_TOKEN;
  if (!expected) return false;
  const header = request.headers.get('Authorization') ?? '';
  const match = header.match(/^Bearer (.+)$/);
  if (!match) return false;
  return timingSafeHashEqual(match[1], expected);
}
