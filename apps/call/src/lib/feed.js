// Read-only client for the shared feed (same-origin Worker). Every call returns null
// on failure so a bad connection degrades to an empty state, never a crash.

async function get(path) {
  try {
    const res = await fetch(`/api/feed${path}`);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export const fetchMeta = () => get('/meta');
export const fetchPlayers = async () => (await get('/players'))?.players ?? null;
export const fetchSchedule = async eventId => (await get(`/schedule?event=${eventId}`))?.matches ?? null;
export const fetchMatch = id => get(`/matches/${id}`);
