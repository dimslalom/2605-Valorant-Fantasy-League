const now = () => Math.floor(Date.now() / 1000);

export async function ensureWallet(db, userId, at = now()) {
  const save = await db.prepare('SELECT state FROM saves WHERE user_id = ?').bind(userId).first();
  const opening = Math.max(0, Math.floor(Number(JSON.parse(save?.state ?? '{}').credits) || 0));
  await db.batch([
    db.prepare('INSERT INTO wallets(user_id,balance,opened_at) VALUES(?,?,?) ON CONFLICT DO NOTHING').bind(userId, opening, at),
    db.prepare(`INSERT INTO wallet_entries(user_id,entry_key,amount,balance_after,created_at)
      SELECT user_id,'opening',balance,balance,? FROM wallets WHERE user_id=? ON CONFLICT DO NOTHING`).bind(at,userId),
  ]);
  return db.prepare('SELECT balance FROM wallets WHERE user_id=?').bind(userId).first();
}

// The unique entry is inserted first. The guarded balance update is idempotent, including
// when an earlier request is retried after other entries have been posted.
export async function postWallet(db, userId, key, amount, at = now()) {
  if (!Number.isSafeInteger(amount) || !key || key.length > 160) throw new Error('bad wallet entry');
  await ensureWallet(db, userId, at);
  await db.batch([
    db.prepare(`INSERT INTO wallet_entries(user_id,entry_key,amount,balance_after,created_at)
      SELECT user_id, ?, ?, balance+?, ? FROM wallets
      WHERE user_id=? AND balance+? >= 0 ON CONFLICT DO NOTHING`).bind(key,amount,amount,at,userId,amount),
    db.prepare(`UPDATE wallets SET balance=(SELECT balance_after FROM wallet_entries WHERE user_id=? AND entry_key=?)
      WHERE user_id=? AND changes()=1 AND balance=(SELECT balance_after-amount FROM wallet_entries WHERE user_id=? AND entry_key=?)`)
      .bind(userId,key,userId,userId,key),
  ]);
  const entry = await db.prepare('SELECT amount,balance_after FROM wallet_entries WHERE user_id=? AND entry_key=?').bind(userId,key).first();
  if (!entry) return null;
  if (entry.amount !== amount) throw new Error('wallet key reused');
  return entry;
}
