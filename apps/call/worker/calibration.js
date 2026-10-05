import { scoreWeeklyCard, WEEKLY_SQUARES, weekKey } from '../src/lib/weeklyBingo.js';
import { ensureWeek, weeklyContext } from './weeklyBingo.js';

const hash=s=>[...s].reduce((n,c)=>(Math.imul(n,33)+c.charCodeAt(0))>>>0,5381);
async function replayWeek(db,key,t) {
  const week=await ensureWeek(db,key,t),ctx=await weeklyContext(db,week,t);
  if (!ctx.rosterComplete||Object.values(ctx.results).some(r=>r.state==='pending')) return [];
  const free=(await db.prepare('SELECT user_id,cells FROM weekly_bingo_cards WHERE week=? AND slot=1').bind(key).all()).results;
  const scores=[];
  for (const row of free) {
    const owned=new Set(JSON.parse(row.cells).map(c=>c.square));
    const choices=WEEKLY_SQUARES.filter(s=>!owned.has(s.id) && (s.scope==='roster'||week.matches.some(m=>!s.bestOf||m.bestOf===s.bestOf)))
      .sort((a,b)=>hash(`${key}:${row.user_id}:${a.id}`)-hash(`${key}:${row.user_id}:${b.id}`));
    if (choices.length<16) continue;
    for (let slot=2;slot<=5;slot++) {
      const cells=choices.slice((slot-2)*4,(slot-1)*4).map(s=>{
        const eligible=week.matches.filter(m=>!s.bestOf||m.bestOf===s.bestOf);
        const pick=s.scope==='match'&&eligible.length&&hash(`${key}:${row.user_id}:${s.id}:target`)%2===0
          ? eligible[hash(`${key}:${row.user_id}:${s.id}:match`)%eligible.length].matchId:null;
        return {square:s.id,matchId:pick};
      });
      scores.push(scoreWeeklyCard(cells,week.matches,ctx.results,ctx.rosterEvents,week.points,true).total);
    }
  }
  return scores;
}
export async function calibratePaid(env,t=Math.floor(Date.now()/1000)) {
  const db=env.DB;
  const settled=(await db.prepare('SELECT week FROM weekly_bingo_weeks WHERE settled_at IS NOT NULL ORDER BY week').all()).results.map(r=>r.week);
  if (settled.length<4) return {ready:false,reason:'four settled weeks required'};
  const recent=settled.slice(-4),holdout=recent.at(-1);
  const latest=await db.prepare('SELECT holdout_week,passed FROM bingo_calibration ORDER BY id DESC LIMIT 1').first();
  if (latest?.passed) return {ready:true};
  if (latest?.holdout_week===holdout) return {ready:false,reason:'waiting for another holdout week'};
  const training=(await Promise.all(recent.slice(0,3).map(w=>replayWeek(db,w,t)))).flat();
  const validation=await replayWeek(db,holdout,t);
  const mean=arr=>arr.length?arr.reduce((a,b)=>a+b,0)/arr.length:0;
  const trainMean=mean(training),rate=trainMean>0?Math.round((100/trainMean)*100)/100:0;
  const holdoutMean=mean(validation)*rate;
  const passed=training.length>=12&&validation.length>=4&&rate>0&&holdoutMean>=90&&holdoutMean<=110;
  await db.prepare(`INSERT INTO bingo_calibration(checked_at,training_weeks,holdout_week,training_mean,holdout_mean,payout_rate,passed,notes)
    VALUES(?,?,?,?,?,?,?,?)`).bind(t,3,holdout,trainMean,holdoutMean,rate,passed,
      `Synthetic legal card replay: ${training.length} training / ${validation.length} holdout paid cards`).run();
  if (passed) {
    const next=weekKey(t+7*86400);
    await ensureWeek(db,next,t);
    await db.prepare('UPDATE weekly_bingo_weeks SET paid_enabled=1,payout_rate=? WHERE starts_at>? AND locked_at IS NULL').bind(rate,t).run();
  }
  return {ready:passed,trainingMean:trainMean,holdoutMean,payoutRate:rate};
}
export async function calibrationStatus(db) {
  const recent=await db.prepare('SELECT * FROM bingo_calibration ORDER BY id DESC LIMIT 1').first();
  const weeks=(await db.prepare('SELECT COUNT(*) AS n FROM weekly_bingo_weeks WHERE settled_at IS NOT NULL').first()).n;
  return {settledWeeks:weeks,paidReady:!!recent?.passed,lastReplay:recent};
}
