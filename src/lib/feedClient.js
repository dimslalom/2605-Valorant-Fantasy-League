// Real-data feed client. Same-origin Worker API; every call returns null on
// failure so a dev server without the Worker degrades instead of crashing.

const API_ROOT = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api/feed`;

async function get(path) {
  try {
    const res = await fetch(`${API_ROOT}${path}`);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export const fetchMeta = () => get('/meta');

// Every finished match of an event with full stats, grouped by the feed's
// round ids. Round ids contain a colon, which is legal in a path segment, so
// they are sent as-is. Returns null when the feed is unreachable.
export async function fetchEventMatches(eventId) {
  const schedule = await get(`/schedule?event=${eventId}`);
  if (!schedule) return null;
  const roundIds = [...new Set(schedule.matches.filter(m => m.statsRank >= 3 && m.roundId).map(m => m.roundId))];
  const rounds = await Promise.all(roundIds.map(id => get(`/rounds/${id}`)));
  return rounds.filter(Boolean).flatMap(r => r.matches);
}
