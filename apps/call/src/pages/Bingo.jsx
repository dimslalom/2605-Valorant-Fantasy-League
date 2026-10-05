import { useCallback, useEffect, useMemo, useState } from 'react';
import { useGame } from '../lib/gameContext';
import { nextEditableWeek, weeklyById } from '../lib/weeklyBingo';

const blank=()=>[null,null,null,null];
const date=s=>new Date(s*1000).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
export default function Bingo() {
  const {account}=useGame();
  const [week,setWeek]=useState(()=>nextEditableWeek(Math.floor(Date.now()/1000)));
  const [data,setData]=useState(null);
  const [score,setScore]=useState(null);
  const [board,setBoard]=useState(null);
  const [calibration,setCalibration]=useState(null);
  const [cells,setCells]=useState(blank);
  const [slot,setSlot]=useState(1);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const load=useCallback(async()=>{
    const paths=['','/score','/leaderboard'];
    const responses=await Promise.all(paths.map(p=>fetch(`/api/weekly-bingo${p}?week=${week}`,{cache:'no-store'})));
    fetch('/api/weekly-bingo/calibration',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(setCalibration).catch(()=>{});
    if (responses.some(r=>!r.ok)) throw new Error('Weekly bingo is unavailable. Sign in and try again.');
    const [next,scored,leaders]=await Promise.all(responses.map(r=>r.json()));
    setData(next);setScore(scored);setBoard(leaders);
    const card=next.cards.find(c=>c.slot===slot);
    setCells(card?.cells??blank());
  },[week,slot]);
  useEffect(()=>{let live=true;Promise.resolve().then(()=>load()).catch(e=>{if(live)setMessage(e.message)});return()=>{live=false};},[load]);
  const selected=data?.cards.find(c=>c.slot===slot);
  const used=useMemo(()=>new Set(data?.cards.filter(c=>c.slot!==slot).flatMap(c=>c.cells.map(x=>x.square))??[]),[data,slot]);
  const remaining=(data?.squares??[]).filter(s=>!used.has(s.id));
  const setCell=(i,patch)=>setCells(prev=>prev.map((c,n)=>n===i?{...c,...patch}:c));
  const save=async()=>{
    setBusy(true);setMessage('');
    try {
      const res=await fetch('/api/weekly-bingo',{method:'PUT',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({week,slot,cells,version:selected?.version??0})});
      const body=await res.json();
      if (!res.ok) throw new Error(body.error??'Could not save card');
      await load();window.dispatchEvent(new Event('opval-wallet-changed'));setMessage(slot>1?'Card saved and 100 credits spent.':'Card saved.');
    } catch(e){setMessage(e.message)} finally {setBusy(false)}
  };
  if (!account.user) return <section className="bingo-page"><h1>Weekly Bingo</h1><p className="note">Sign in to submit a weekly card.</p></section>;
  const shift=by=>setWeek(w=>new Date(Date.parse(`${w}T00:00:00Z`)+by*7*86400000).toISOString().slice(0,10));
  return <section className="bingo-page weekly-bingo">
    <header className="day-switch"><button onClick={()=>shift(-1)} aria-label="Previous week">←</button><h1>Week of {week}</h1><button onClick={()=>shift(1)} aria-label="Next week">→</button></header>
    <p className="bingo-utc">All cards lock Monday 00:00 UTC. A card covers that Monday through the next Monday.</p>
    {message&&<p className="note" role="status">{message}</p>}
    {!data&&<p className="note">Loading weekly bingo…</p>}
    {data&&<>
      <p className="note">{data.locked?'Active or finished — picks locked':`Submit by ${date(data.startsAt)}`} · {data.settled?'Final':'Pending'} · {data.balance} credits</p>
      <div className="bingo-bar" role="group" aria-label="Cards">
        {Array.from({length:Math.min(data.rules.maxCards,Math.max(1,data.cards.length+(!data.locked?1:0)))},(_,i)=>i+1).map(n=><button key={n} className={slot===n?'primary':'secondary'} onClick={()=>{setSlot(n);setCells(data.cards.find(c=>c.slot===n)?.cells??blank())}}>Card {n}{n>1?' · 100 CR':''}</button>)}
      </div>
      {!data.rules.paidEnabled&&<p className="note">One free card is available while weekly rewards are being calibrated. Paid cards open after the published results meet the payout target. {calibration?`${calibration.settledWeeks} settled weeks recorded; at least four are needed.`:''}</p>}
      {data.ended&&!data.settled&&!score?.rosterComplete&&<p className="note" role="status">Official roster coverage is incomplete. Roster squares and payouts remain pending until the source window is verified.</p>}
      <div className="bcard-grid">
        {cells.map((cell,i)=>{
          const square=weeklyById[cell?.square];
          const points=cell?.square?data.catalog[cell.square]?.[cell.matchId==null?'general':'named']:null;
          const outcome=score?.cards.find(c=>c.slot===slot)?.cells[i];
          return <div key={i} className="bcell weekly-cell" data-filled={!!square}>
            <span className="bcell-top"><b>{points??'+'} {points?'pts':''}</b>{outcome&&<small>{outcome.state}</small>}</span>
            <label><span className="sr">Square {i+1}</span><select disabled={data.locked} value={cell?.square??''} onChange={e=>setCell(i,{square:e.target.value||null,matchId:null})}>
              <option value="">Choose an event</option>{remaining.filter(s=>s.id===cell?.square||!cells.some((c,n)=>n!==i&&c?.square===s.id)).map(s=><option key={s.id} value={s.id}>{s.label}</option>)}
            </select></label>
            {square?.scope==='match'&&<label className="weekly-target">Match<select disabled={data.locked} value={cell?.matchId??''} onChange={e=>setCell(i,{matchId:e.target.value?Number(e.target.value):null})}>
              <option value="">Any eligible match this week</option>
              {data.matches.filter(m=>!square.bestOf||m.bestOf===square.bestOf).map(m=><option key={m.matchId} value={m.matchId}>{m.team1Tag||'TBD'} vs {m.team2Tag||'TBD'} · {date(m.startsAt)}</option>)}
            </select></label>}
            {outcome?.evidence&&<a href={outcome.evidence.sourceUrl??`https://www.vlr.gg/${outcome.evidence.matchId}`} target="_blank" rel="noreferrer">Evidence ↗</a>}
          </div>;
        })}
      </div>
      {!data.locked&&<div className="bingo-bar"><button className="primary" disabled={busy||cells.some(c=>!c?.square)||JSON.stringify(cells)===JSON.stringify(selected?.cells??blank())} onClick={save}>{busy?'Saving…':selected?'Update card':slot===1?'Submit free card':'Buy and submit card'}</button></div>}
      <h2 className="section">Scores</h2>
      <p className="note">{score?.cards.map(c=>`Card ${c.slot}: ${c.total} points${c.complete?'':' (pending)'}`).join(' · ')||'No cards submitted yet.'}</p>
      <h2 className="section">Weekly leaderboard</h2>
      <ol className="leaderboard-list">{board?.entries.map(e=><li key={e.username} className="leaderboard-entry"><b>{e.rank}</b><span>{e.username}</span><strong>{e.points} pts</strong></li>)}</ol>
      {board&&<p className="note">Your score: {board.me.points} points{board.me.rank?` · rank ${board.me.rank}`:''}</p>}
    </>}
  </section>;
}
