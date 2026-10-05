import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

// A tiny shim over node:sqlite that mimics the D1 surface the store uses.
export function d1() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of ['0002_feed.sql', '0003_accounts.sql', '0004_account_hardening.sql', '0005_recovery_codes.sql', '0006_bingo_cards.sql', '0007_bingo_slots.sql', '0008_call_settlements.sql', '0009_player_last_played.sql']) {
    sqlite.exec(readFileSync(new URL(`../../migrations/${file}`, import.meta.url), 'utf8'));
  }
  const stmt = sql => {
    let args = [];
    const api = {
      bind: (...a) => { args = a; return api; },
      first: async () => sqlite.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
      run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } }),
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

