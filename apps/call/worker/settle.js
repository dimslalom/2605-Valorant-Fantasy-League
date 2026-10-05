import { rescoreCalls, resolveSeries, trackedAt } from '../../../src/engine/collect/game.js';
import { CALL_RULES } from '../../../src/engine/collect/rules.js';
import { loadMatch } from '../../../worker/feed/routes.js';
import { ensureWallet } from './wallet.js';

// Score every finished match that has either a call or a tracked player. The server
// records unrevealed reports so credits and rankings no longer depend on opening a tab.
export async function settleAll(env,at=Math.floor(Date.now()/1000)) {
  const users=(await env.DB.prepare('SELECT user_id,state,version FROM saves').all()).results;
  if (!users.length) return 0;
  const finals=(await env.DB.prepare(`SELECT match_id,starts_at FROM feed_matches WHERE status='final' AND stats_rank>=3
    ORDER BY starts_at,match_id`).all()).results;
  if (!finals.length) return 0;
  const participants=new Map();
  let teams;
  const inMatch=async(matchId,pids)=>{
    if(!pids.length) return false;
    if(!participants.has(matchId)) {
      const rows=(await env.DB.prepare('SELECT DISTINCT vlr_id FROM feed_player_maps WHERE match_id=?').bind(matchId).all()).results;
      participants.set(matchId,new Set(rows.map(r=>r.vlr_id)));
    }
    return pids.some(pid=>participants.get(matchId).has(pid));
  };
  const cache=new Map();
  let settled=0;
  for(const row of users) {
    let state=JSON.parse(row.state);
    if(!Array.isArray(state.trackedLog)) continue;
    const due=[];
    for(const m of finals) {
      if(m.starts_at<(state.createdAt??0)||state.revealed?.[m.match_id]) continue;
      if(state.calls?.[m.match_id]?.winner!=null||await inMatch(m.match_id,trackedAt(state,m.starts_at))) due.push(m);
    }
    // A save scored under older call values is due even with nothing new: rescoring it pays the difference.
    if(!due.length&&(state.callRules??1)>=CALL_RULES) continue;
    const wallet=await ensureWallet(env.DB,row.user_id,at);
    state={...state,credits:wallet.balance};
    const before=state.credits;
    state=rescoreCalls(state);
    teams??=new Map((await env.DB.prepare('SELECT vlr_id,team_tag FROM feed_players').all()).results.map(p=>[p.vlr_id,p.team_tag]));
    for(const m of due) {
      if(!cache.has(m.match_id)) cache.set(m.match_id,await loadMatch(env,m.match_id));
      const series=cache.get(m.match_id);
      if(!series) continue;
      const outcome=resolveSeries(state,series,{teamOf:pid=>teams.get(Number(pid))??null});
      state={...outcome.state,revealed:{...outcome.state.revealed,[m.match_id]:{...outcome.report,unseen:true}}};
    }
    const delta=state.credits-before;
    const key=`call-settle:${row.version}`;
    try {
      const steps=[env.DB.prepare('UPDATE saves SET state=?,version=version+1,updated_at=? WHERE user_id=? AND version=?')
        .bind(JSON.stringify(state),at,row.user_id,row.version)];
      if(delta) steps.push(
        env.DB.prepare(`INSERT INTO wallet_entries(user_id,entry_key,amount,balance_after,created_at)
          SELECT user_id,?,?,balance+?,? FROM wallets WHERE user_id=? AND changes()=1`).bind(key,delta,delta,at,row.user_id),
        env.DB.prepare(`UPDATE wallets SET balance=(SELECT balance_after FROM wallet_entries WHERE user_id=? AND entry_key=?)
          WHERE user_id=? AND balance=(SELECT balance_after-amount FROM wallet_entries WHERE user_id=? AND entry_key=?)`)
          .bind(row.user_id,key,row.user_id,row.user_id,key),
      );
      const result=await env.DB.batch(steps);
      settled+=result?.[0]?.meta?.changes??0;
    } catch { /* concurrent action changed the save; cron retries */ }
  }
  return settled;
}
