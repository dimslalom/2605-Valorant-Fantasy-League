// Daily-challenge leaderboard client. Same-origin Worker API, no accounts:
// identity is a locally-minted uuid, and every call swallows network errors
// and returns null so a dev server without the Worker degrades to an
// offline leaderboard instead of breaking the run flow.

const API_ROOT = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api`;
const CLIENT_ID_KEY = 'vfl-client-id';
let fallbackClientId;

export function getClientId() {
  try {
    let id = localStorage.getItem(CLIENT_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  } catch {
    fallbackClientId ??= crypto.randomUUID();
    return fallbackClientId;
  }
}

// Returns { accepted } or null when the API is unreachable.
export async function submitDailyScore({ date, squadName, score }) {
  return request(`${API_ROOT}/daily-scores`, {
    method: 'POST',
    body: JSON.stringify({ date, clientId: getClientId(), squadName, score }),
  });
}

// Returns [{ clientId, squadName, score }] or null.
export async function fetchDailyLeaderboard(date) {
  const result = await request(`${API_ROOT}/leaderboard/daily?date=${encodeURIComponent(date)}`);
  return result?.rows ?? null;
}

// Returns [{ clientId, squadName, best, days }] or null.
export async function fetchOverallLeaderboard() {
  const result = await request(`${API_ROOT}/leaderboard/overall`);
  return result?.rows ?? null;
}

async function request(url, options = {}) {
  try {
    const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json' } });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}
