// Pure helpers shared by the DOM-facing card hook and Node regression tests.
export function seededRestAngle(seed) {
  let hash = 2166136261;
  for (const char of String(seed ?? 'card')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const magnitude = 1.2 + ((hash >>> 1) % 81) / 100;
  return (hash & 1 ? magnitude : -magnitude).toFixed(2);
}
