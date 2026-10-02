// Fantasy save. The replay itself is rebuilt from the feed on load, so only the
// league state and the player's draft lineup are stored.
const KEY = 'vfl-fantasy-save';
const VERSION = 3; // 3: any-role lineup (slots S1..S5); 2: limited copies

export function loadFantasySave() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return raw && raw.v === VERSION ? raw : null;
  } catch {
    return null;
  }
}

export function saveFantasy(payload) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: VERSION, ...payload }));
  } catch { /* storage full or blocked: the run just won't resume */ }
}

export function clearFantasySave() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
