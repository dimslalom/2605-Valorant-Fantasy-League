import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

// A tiny shim over node:sqlite that mimics the D1 surface the store uses.
export function d1() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../../migrations/0002_feed.sql', import.meta.url), 'utf8'));
  const stmt = sql => {
    let args = [];
    const api = {
      bind: (...a) => { args = a; return api; },
      first: async () => sqlite.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
      run: async () => { sqlite.prepare(sql).run(...args); return {}; },
      _exec: () => sqlite.prepare(sql).run(...args),
    };
    return api;
  };
  return {
    sqlite,
    prepare: stmt,
    batch: async list => { sqlite.exec('BEGIN'); try { list.forEach(s => s._exec()); sqlite.exec('COMMIT'); } catch (e) { sqlite.exec('ROLLBACK'); throw e; } },
  };
}

