import { useEffect, useMemo, useState } from 'react';
const fmt=t=>t?new Date(t*1000).toLocaleString():'Not read yet';
export default function Roster() {
  const [data,setData]=useState(null),[query,setQuery]=useState(''),[tab,setTab]=useState('transfers'),[error,setError]=useState('');
  useEffect(()=>{Promise.all(['transfers','contracts','events','status','unresolved'].map(x=>fetch(`/api/roster/${x}`).then(r=>{if(!r.ok)throw new Error('Roster data unavailable');return r.json()})))
    .then(([transfers,contracts,events,status,unresolved])=>setData({...transfers,...contracts,...events,...status,...unresolved})).catch(e=>setError(e.message));},[]);
  const rows=useMemo(()=>data?.[tab]?.filter(r=>JSON.stringify(r).toLowerCase().includes(query.toLowerCase()))??[],[data,tab,query]);
  return <section className="roster-page"><h1>Roster Hub</h1><p className="note">Transfers: VLR discovery. Contracts and bingo confirmations: Riot’s published Global Contract Database.</p>
    {error&&<p role="alert">{error}</p>}
    {data&&<><p className="note">Riot last read: {fmt(data.riot.lastReadAt)}{data.riot.stale?' · source stale':''}{data.riot.lastError?` · ${data.riot.lastError}`:''} · VLR last read: {fmt(data.vlr.lastReadAt)} · {data.riot.unresolved} unresolved identities</p>
      <div className="bingo-bar" role="group" aria-label="Roster data">{[['transfers','Transfers'],['contracts','Contracts'],['events','Confirmed changes'],['unresolved','Unresolved']].map(([id,label])=><button key={id} className={tab===id?'primary':'secondary'} onClick={()=>setTab(id)}>{label}</button>)}</div>
      <label>Search <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Player, team, league" /></label>
      <ul className="roster-list">{rows.map((r,i)=><li key={i}>
        {tab==='transfers'&&<><b>{r.handle}</b> · {r.day} · {r.moves.map(m=>`${m.type} ${m.team}`).join(', ')} <a href={r.sourceUrl} target="_blank" rel="noreferrer">VLR ↗</a></>}
        {tab==='contracts'&&<><b>{r.player}</b> · {r.team} · {r.league} · Contract end: {r.contractEnd??'Not listed'} <a href={r.sourceUrl} target="_blank" rel="noreferrer">Riot ↗</a></>}
        {tab==='events'&&<><b>{r.player}</b> · {r.changeType.replaceAll('_',' ')} · {r.team} · First observed {fmt(r.firstSeenAt)} <a href={r.sourceUrl} target="_blank" rel="noreferrer">Riot ↗</a></>}
        {tab==='unresolved'&&<>{r.identityKey} · {r.reason} · {fmt(r.observedAt)}</>}
      </li>)}</ul>
      {!rows.length&&<p className="note">No entries found.</p>}
    </>}
  </section>;
}
