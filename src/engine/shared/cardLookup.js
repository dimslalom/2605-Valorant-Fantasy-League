// Join feed players to the designed cards by handle + team tag, falling back to a unique handle.
const cardKey = (handle, tag) => `${String(handle).toLowerCase()}|${String(tag).toLowerCase()}`;

// Join a feed player to a card by handle + team tag; fall back to a unique handle.
export function makeCardLookup(cards) {
  const exact = new Map(cards.map(c => [cardKey(c.player, c.org), c]));
  const byHandle = new Map();
  for (const c of cards) {
    const k = String(c.player).toLowerCase();
    byHandle.set(k, byHandle.has(k) ? null : c);
  }
  return (handle, tag) => exact.get(cardKey(handle, tag)) ?? byHandle.get(String(handle).toLowerCase()) ?? null;
}
