import MATCH_SQUARES, { byId as matchById } from './bingoSquares.js';
import { lines } from './bingoCard.js';

export const WEEK = 7 * 86400;
export const weekStart = unix => Math.floor((unix - 4 * 86400) / WEEK) * WEEK + 4 * 86400;
export const weekKey = unix => new Date(weekStart(unix) * 1000).toISOString().slice(0,10);
export const weekBounds = key => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key ?? '')) return null;
  const start = Date.parse(`${key}T00:00:00Z`) / 1000;
  return Number.isFinite(start) && weekKey(start) === key ? [start,start+WEEK] : null;
};
export const nextEditableWeek = unix => weekKey(unix);
export const MATCH_LEAD_TIME = 3600;
export const ROSTER_SQUARES = [
  { id:'roster_add', label:'Riot GCD adds a player to a team', cluster:'roster', points:5 },
  { id:'roster_depart', label:'Riot GCD removes a player from a team', cluster:'roster', points:5 },
  { id:'contract_change', label:'Riot GCD changes a contract end date', cluster:'contract', points:7 },
  { id:'contract_extend', label:'Riot GCD extends a player contract', cluster:'contract', points:8 },
  { id:'contract_shorten', label:'Riot GCD shortens a player contract', cluster:'contract', points:9 },
  { id:'multi_team_change', label:'Riot GCD updates players on two teams', cluster:'roster', points:7 },
];
export const WEEKLY_SQUARES = [...MATCH_SQUARES.map(s=>({id:s.id,label:s.label,cluster:s.cluster,scope:'match',bestOf:s.bestOf,seriesRate:s.seriesRate})),...ROSTER_SQUARES.map(s=>({...s,scope:'roster'}))];
export const weeklyById = Object.fromEntries(WEEKLY_SQUARES.map(s=>[s.id,s]));
const oddsPoints = p => Math.max(1,Math.round(-2*Math.log2(Math.max(0.01,Math.min(0.99,p)))));
export function weeklyCatalog(matches, observations = []) {
  const list=Array.isArray(matches)?matches:Array.from({length:matches},()=>({bestOf:3}));
  const summary=new Map();
  for (const o of observations) summary.set(`${o.square}:${o.exposure}`,o);
  return Object.fromEntries(WEEKLY_SQUARES.map(s => {
    if (s.scope==='roster') {
      const prior=ROSTER_SQUARES.find(r=>r.id===s.id).points;
      const base=2**(-prior/2);
      const seen=summary.get(`${s.id}:-1`);
      const p=(4*base+(seen?.hits??0))/(4+(seen?.trials??0));
      return [s.id,{general:oddsPoints(p),named:null}];
    }
    const named=summary.get(`${s.id}:0`);
    const seriesP=(20*s.seriesRate+(named?.hits??0))/(20+(named?.trials??0));
    // A week with no published slate still needs usable, stable opening odds.
    const exposure=Math.max(1,list.filter(m=>!s.bestOf||m.bestOf===s.bestOf).length);
    const base=1-(1-seriesP)**exposure;
    const weekly=summary.get(`${s.id}:${exposure}`);
    const p=(4*base+(weekly?.hits??0))/(4+(weekly?.trials??0));
    return [s.id,{general:oddsPoints(p),named:oddsPoints(seriesP)}];
  }));
}
export function validateWeeklyCard(cells, others, matches, catalog) {
  if (!Array.isArray(cells) || cells.length !== 4) return 'A card needs four squares.';
  const used = new Set(others.flatMap(card=>card.cells.map(c=>c.square)));
  const ids = new Set(matches.map(m=>m.matchId));
  for (const cell of cells) {
    const sq = weeklyById[cell?.square];
    if (!sq || !catalog[cell.square]) return 'Unknown square.';
    if (used.has(cell.square)) return `Duplicate event: ${cell.square}`;
    used.add(cell.square);
    if (sq.scope === 'roster' && cell.matchId != null) return 'Roster squares cannot name a match.';
    if (sq.scope === 'match') {
      if (cell.matchId != null && !ids.has(cell.matchId)) return 'Named match is not on this week’s schedule.';
      if (cell.matchId != null && sq.bestOf && matches.find(m=>m.matchId===cell.matchId)?.bestOf !== sq.bestOf) return 'Square does not fit that match.';
    }
  }
  return null;
}
export function matchHit(square, result) {
  const sq = matchById[square];
  return sq.scope === 'match' ? sq.test({maps:result.maps}) : result.maps.some(sq.test);
}
export function rosterEvidence(square,events) {
  if(square==='multi_team_change') {
    const byTeam=new Map();
    for(const event of events) if(event.team) byTeam.set(event.team,event);
    return byTeam.size>=2?[...byTeam.values()].slice(0,2):null;
  }
  const matches=events.filter(e=>{
    if(square==='contract_extend'||square==='contract_shorten') {
      if(e.changeType!=='contract_change'||!e.oldEnd||!e.newEnd) return false;
      const order=s=>{
        const parsed=Date.parse(s);
        if(Number.isFinite(parsed)) return parsed;
        const season=String(s).match(/\b(20\d{2}) Season End\b/i);
        return season?Date.UTC(Number(season[1]),11,31):NaN;
      };
      const oldEnd=order(e.oldEnd),newEnd=order(e.newEnd);
      if(!Number.isFinite(oldEnd)||!Number.isFinite(newEnd)) return false;
      return square==='contract_extend' ? newEnd>oldEnd : newEnd<oldEnd;
    }
    return e.changeType===square;
  });
  return matches.length?[matches[0]]:null;
}
export function scoreWeeklyCard(cells, schedule, results, rosterEvents, catalog, rosterComplete, lockedAt=0, weekEnded=false) {
  const details = cells.map(c => {
    const sq = weeklyById[c.square];
    if (sq.scope === 'roster') {
      const matched = rosterEvidence(c.square,rosterEvents.filter(e=>e.firstSeenAt>=lockedAt));
      const event=matched?.at(-1);
      return event ? {state:'hit',at:event.firstSeenAt,evidence:{sourceUrl:event.sourceUrl,player:event.player,team:event.team,observedAt:event.firstSeenAt}}
        : {state:rosterComplete?'miss':'pending'};
    }
    const matches = schedule.filter(m=>m.startsAt==null||m.startsAt>=lockedAt+MATCH_LEAD_TIME)
      .filter(m=>c.matchId == null ? !sq.bestOf||m.bestOf===sq.bestOf : m.matchId===c.matchId);
    if (!matches.length) return {state:c.matchId!=null||weekEnded?'free':'pending'};
    const eligible = matches.map(m=>({match:m,result:results[m.matchId]}));
    const hit = eligible.find(({result})=>result?.state==='final' && matchHit(c.square,result));
    if (hit) return {state:'hit',at:hit.result.finalAt,evidence:{matchId:hit.match.matchId,finalAt:hit.result.finalAt}};
    if (eligible.some(({result})=>!result || result.state==='pending')) return {state:'pending'};
    return eligible.every(({result})=>result.state==='void') ? {state:'free'} : {state:'miss'};
  });
  const pts = details.map((d,i)=>d.state==='hit' ? (cells[i].matchId == null ? catalog[cells[i].square].general : catalog[cells[i].square].named) : 0);
  const complete = i => ['hit','free'].includes(details[i].state);
  let firstLineAt = null;
  const lineScores = lines(2).map(idx=>{
    if (!idx.every(complete)) return {idx,complete:false,bonus:0};
    const best={};
    for (const i of idx) {
      const key=weeklyById[cells[i].square].cluster;
      best[key]=Math.max(best[key]??0,pts[i]);
    }
    const bonus=Object.values(best).reduce((a,b)=>a+b,0);
    if (bonus) {
      const at=Math.max(...idx.filter(i=>details[i].state==='hit').map(i=>details[i].at));
      firstLineAt=firstLineAt==null?at:Math.min(firstLineAt,at);
    }
    return {idx,complete:true,bonus};
  });
  const cellTotal=pts.reduce((a,b)=>a+b,0);
  const blackout=details.every((_,i)=>complete(i))?cellTotal:0;
  return {total:cellTotal+lineScores.reduce((a,l)=>a+l.bonus,0)+blackout,cells:details,lines:lineScores,blackout,firstLineAt,complete:details.every(d=>d.state!=='pending')};
}
