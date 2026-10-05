import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Sheet from '../components/Sheet';
import { logoForName } from '../lib/orgs';
import { weekBounds, weekKey } from '../lib/weeklyBingo';

const LEAGUES = [
  { id: 'AMERICAS', label: 'Americas' },
  { id: 'EMEA', label: 'EMEA' },
  { id: 'PACIFIC', label: 'Pacific' },
  { id: 'CN', label: 'China' },
];
const MOVES_SHOWN = 24;
const nowS = () => Math.floor(Date.now() / 1000);
const dayOf = s => new Date(s * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const dayKeyOf = key => new Date(`${key}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
function ago(s) {
  const d = Math.max(0, nowS() - s);
  return d < 3600 ? `${Math.max(1, Math.round(d / 60))}m` : d < 86400 ? `${Math.round(d / 3600)}h` : `${Math.round(d / 86400)}d`;
}
const yearOf = end => Number(String(end ?? '').match(/20\d\d/)?.[0]) || null;

// A team's logo, or its initials on a tile when we have no art for it.
function Crest({ name }) {
  const logo = logoForName(name);
  return logo
    ? <img className="crest" src={logo} alt="" />
    : <span className="crest crest-mono" aria-hidden="true">{String(name ?? '?').replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).map(w => w[0]).join('').slice(0, 3)}</span>;
}
const Arrow = () => <span className="move-arrow" aria-hidden="true" />;

// A confirmed Riot change in words a fan uses, with the contract years when they moved.
function changeLabel(e) {
  if (e.changeType === 'roster_add') return 'joins';
  if (e.changeType === 'roster_depart') return 'leaves';
  const from = yearOf(e.oldEnd), to = yearOf(e.newEnd);
  return from && to ? (to > from ? 'extends' : to < from ? 'shortens' : 'contract') : 'contract';
}

export default function Roster() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [league, setLeague] = useState('AMERICAS');
  const [allMoves, setAllMoves] = useState(false);
  const [unmatchedOpen, setUnmatchedOpen] = useState(false);

  useEffect(() => {
    Promise.all(['transfers', 'contracts', 'events', 'status', 'unresolved'].map(x => fetch(`/api/roster/${x}`).then(r => {
      if (!r.ok) throw new Error('Roster data is unavailable right now. Try again in a minute.');
      return r.json();
    }))).then(parts => setData(Object.assign({}, ...parts))).catch(e => setError(e.message));
  }, []);

  const q = query.trim().toLowerCase();
  const hit = (...fields) => !q || fields.some(f => String(f ?? '').toLowerCase().includes(q));
  const [from, to] = weekBounds(weekKey(nowS()));

  const week = useMemo(() => (data?.events ?? []).filter(e => e.firstSeenAt >= from && e.firstSeenAt < to), [data, from, to]);
  const moves = useMemo(() => (data?.transfers ?? []).filter(t => hit(t.handle, ...t.moves.flatMap(m => [m.team, m.from]))), [data, q]);
  const shownMoves = allMoves || q ? moves : moves.slice(0, MOVES_SHOWN);
  const movesByDay = shownMoves.reduce((out, t) => ((out[t.day] ??= []).push(t), out), {});
  const teams = useMemo(() => {
    const list = (data?.contracts ?? []).filter(c => (q ? true : c.league === league) && hit(c.player, c.team));
    const grouped = list.reduce((out, c) => ((out[c.team] ??= []).push(c), out), {});
    return Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b));
  }, [data, league, q]);
  const contractCount = teams.reduce((n, [, players]) => n + players.length, 0);
  const thisYear = new Date().getUTCFullYear();
  const years = [thisYear, thisYear + 1, thisYear + 2, thisYear + 3];

  return <section className="roster-page">
    <header className="roster-head">
      <h1>Rosters</h1>
      {data && <div className="roster-sources">
        <a href={data.riot.sourceUrl} target="_blank" rel="noreferrer" data-ok={!data.riot.stale && !data.riot.lastError}>
          <i aria-hidden="true" />Riot GCD<small>{data.riot.lastReadAt ? ago(data.riot.lastReadAt) : 'never'}</small>
        </a>
        <a href={data.vlr.sourceUrl} target="_blank" rel="noreferrer" data-ok={!data.vlr.lastError}>
          <i aria-hidden="true" />VLR<small>{data.vlr.lastReadAt ? ago(data.vlr.lastReadAt) : 'never'}</small>
        </a>
        {data.unresolved?.length > 0 && <button type="button" className="roster-unmatched" onClick={() => setUnmatchedOpen(true)}>
          <b>{data.unresolved.length}</b> unmatched
        </button>}
      </div>}
    </header>

    {error && <p className="error" role="alert">{error}</p>}
    {!data && !error && <p className="note">Loading rosters</p>}

    {data && <>
      <input className="roster-search" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="aspas, Sentinels, EMEA" aria-label="Search players and teams" />

      {/* What settles Bingo's roster squares: Riot's confirmed changes since Monday. */}
      {!q && <section className="roster-block">
        <h2 className="sum"><b>{week.length}</b><span>{week.length === 1 ? 'change' : 'changes'} confirmed this week</span></h2>
        {week.length > 0 ? <ul className="roster-events">
          {week.map((e, i) => <li key={i}>
            <Crest name={e.team} />
            <span className="roster-who"><b>{e.player}</b><small>{e.team}</small></span>
            <span className="roster-verb" data-kind={e.changeType}>{changeLabel(e)}</span>
            {e.changeType === 'contract_change' && <span className="roster-years">{yearOf(e.oldEnd) ?? '?'}<Arrow />{yearOf(e.newEnd) ?? '?'}</span>}
            <a className="roster-src" href={e.sourceUrl} target="_blank" rel="noreferrer" aria-label={`Riot source, first seen ${dayOf(e.firstSeenAt)}`}>{dayOf(e.firstSeenAt)}</a>
          </li>)}
        </ul> : <Link className="roster-bingo" to="/bingo">Roster squares on Bingo</Link>}
      </section>}

      <section className="roster-block">
        <h2 className="sum"><b>{moves.length}</b><span>{moves.length === 1 ? 'move' : 'moves'} on VLR</span></h2>
        {Object.entries(movesByDay).map(([day, list]) => <div key={day} className="roster-day">
          <h3>{dayKeyOf(day)}</h3>
          <ul className="roster-moves">
            {list.map(t => <li key={`${t.vlrId}-${t.day}`}>
              <a href={t.sourceUrl} target="_blank" rel="noreferrer" className="roster-who"><b>{t.handle}</b></a>
              {t.moves.map((m, n) => <span key={n} className="roster-move" data-type={m.type}>
                {m.type === 'joined'
                  ? <>{m.from ? <Crest name={m.from} /> : <span className="crest crest-none" aria-hidden="true" />}<Arrow /><Crest name={m.team} /><small>{m.team}</small></>
                  : <><Crest name={m.team} /><Arrow /><span className="crest crest-none" aria-hidden="true" /><small>{m.team}</small></>}
                <span className="sr">{m.type === 'joined' ? `joined ${m.team}${m.from ? ` from ${m.from}` : ''}` : `left ${m.team}`}</span>
              </span>)}
            </li>)}
          </ul>
        </div>)}
        {!q && !allMoves && moves.length > MOVES_SHOWN && <button type="button" className="secondary roster-more" onClick={() => setAllMoves(true)}>All {moves.length} moves</button>}
      </section>

      <section className="roster-block">
        <h2 className="sum"><b>{contractCount}</b><span>{contractCount === 1 ? 'contract' : 'contracts'} on Riot GCD</span></h2>
        {!q && <div className="tier-switch" role="group" aria-label="League" style={{ '--n': LEAGUES.length }}>
          {LEAGUES.map(l => <button key={l.id} type="button" className={league === l.id ? 'primary' : undefined} aria-pressed={league === l.id} onClick={() => setLeague(l.id)}>{l.label}</button>)}
        </div>}
        {/* Each team: its players, each with a bar running to the year their contract ends. */}
        <div className="roster-teams">
          {teams.map(([team, players]) => <article key={team} className="roster-team">
            <header><Crest name={team} /><b>{team}</b></header>
            <div className="roster-years-axis" aria-hidden="true"><span /><span className="roster-axis">{years.map(y => <small key={y}>{y}</small>)}</span></div>
            <ul>
              {players.sort((a, b) => (yearOf(b.contractEnd) ?? 0) - (yearOf(a.contractEnd) ?? 0)).map(p => {
                const y = yearOf(p.contractEnd);
                const span = y ? Math.max(1, Math.min(years.length, y - thisYear + 1)) : 0;
                return <li key={p.player} aria-label={`${p.player}, contract ends ${p.contractEnd ?? 'not listed'}`}>
                  <span>{p.player}</span>
                  <span className="roster-bar" style={{ '--span': span, '--n': years.length }} data-ending={y === thisYear}><i /></span>
                </li>;
              })}
            </ul>
          </article>)}
        </div>
        {teams.length === 0 && <p className="note">No contracts match.</p>}
      </section>
    </>}

    <Sheet open={unmatchedOpen} onClose={() => setUnmatchedOpen(false)} title="Unmatched identities">
      <ul className="roster-unmatched-list">
        {(data?.unresolved ?? []).map((u, i) => <li key={i}><b>{u.identityKey}</b><small>{u.reason}</small><small>{dayOf(u.observedAt)}</small></li>)}
      </ul>
    </Sheet>
  </section>;
}
