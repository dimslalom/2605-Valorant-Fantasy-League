import { useCallback, useEffect, useMemo, useState } from 'react';
import Split from '../../../../src/components/Split';
import Sheet from '../components/Sheet';
import { useGame } from '../lib/gameContext';
import { logoFor } from '../lib/orgs';
import { timeOf } from '../lib/time';
import { nextEditableWeek, weeklyById } from '../lib/weeklyBingo';

const blank = () => [null, null, null, null];
const sign = n => (n > 0 ? `+${n}` : String(n));
const RARE = 5;
const CALIBRATION_WEEKS = 4;
const CLUSTERS = [
  { id: 'close', label: 'Close map' },
  { id: 'stomp', label: 'Stomp' },
  { id: 'star', label: 'Star player' },
  { id: 'chaos', label: 'Chaos' },
  { id: 'agent', label: 'Agent' },
  { id: 'side', label: 'Side' },
  { id: 'roster', label: 'Roster moves' },
  { id: 'contract', label: 'Contracts' },
];
// What the card says: a short name per square. The exact rule (the square's label) shows in the picker.
const SHORT = {
  ot: 'Overtime', long24: 'Long map', k25: '25 kills', map3: 'Map 3',
  stomp8: '13-5 stomp', short20: 'Quick map', plus15: '+15 K/D',
  acs350: '350 ACS', k30: '30 kills', two20k: 'Two 20-bombs', mvpLoser: 'MVP loses',
  ace: 'Ace', c3: '1v3 clutch', c4: '1v4 clutch', minus12: '-12 K/D', fk6: '6 first kills', fk8: '8 first kills',
  duelistTop: 'Duelist MVP', controllerTop: 'Controller MVP', initiatorTop: 'Initiator MVP', sentinelTop: 'Sentinel MVP', yoruTop: 'Yoru MVP',
  def9: '9-round defense', atk9: '9-round attack',
  roster_add: 'Player joins', roster_depart: 'Player leaves', multi_team_change: 'Two teams move',
  contract_change: 'Contract changes', contract_extend: 'Contract extended', contract_shorten: 'Contract cut',
};
const nameOf = sq => SHORT[sq.id] ?? sq.label;
const dayOf = s => new Date(s * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
const weekdayOf = s => new Date(s * 1000).toLocaleDateString(undefined, { weekday: 'short' });

// Time left as the two largest units: "2d 4h", "4h 12m", "38m".
function left(seconds) {
  const s = Math.max(0, seconds);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

// A matchup as logo + tag per team, split by a hairline (never a typed separator).
const Tags = ({ match }) => <Split className="bteams" parts={[match.team1Tag, match.team2Tag].map(tag => {
  const logo = logoFor(tag);
  return <>{logo && <img src={logo} alt="" />}{tag || 'TBD'}</>;
})} />;
// "Any match this week": the week's teams as a row of logos, so the reach shows instead of being said.
function Crowd({ matches }) {
  const tags = [...new Set(matches.flatMap(m => [m.team1Tag, m.team2Tag]).filter(Boolean))];
  const shown = tags.slice(0, 5);
  return <span className="bcrowd" aria-label={`Any of ${matches.length} matches this week`}>
    {shown.map(tag => (logoFor(tag) ? <img key={tag} src={logoFor(tag)} alt="" /> : <i key={tag}>{tag}</i>))}
    {tags.length > shown.length && <small>+{tags.length - shown.length}</small>}
  </span>;
}
const Plus = () => <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>;
const Lock = () => <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>;
const Back = () => <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>;

export default function Bingo() {
  const { account } = useGame();
  const [week, setWeek] = useState(() => nextEditableWeek(Math.floor(Date.now() / 1000)));
  const [data, setData] = useState(null);
  const [score, setScore] = useState(null);
  const [calibration, setCalibration] = useState(null);
  const [cells, setCells] = useState(blank);
  const [slot, setSlot] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [picking, setPicking] = useState(null);       // { i, square? }: which cell, and the square awaiting a match
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    const responses = await Promise.all(['', '/score'].map(p => fetch(`/api/weekly-bingo${p}?week=${week}`, { cache: 'no-store' })));
    fetch('/api/weekly-bingo/calibration', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).then(setCalibration).catch(() => {});
    if (responses.some(r => !r.ok)) throw new Error('Bingo is unavailable right now. Try again in a minute.');
    const [next, scored] = await Promise.all(responses.map(r => r.json()));
    setData(next);
    setScore(scored);
    setCells(next.cards.find(c => c.slot === slot)?.cells ?? blank());
  }, [week, slot]);
  useEffect(() => {
    let live = true;
    Promise.resolve().then(() => load()).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [load]);

  const saved = data?.cards.find(c => c.slot === slot);
  const dirty = JSON.stringify(cells) !== JSON.stringify(saved?.cells ?? blank());
  const full = cells.every(c => c?.square);
  const usedElsewhere = useMemo(() => new Set(data?.cards.filter(c => c.slot !== slot).flatMap(c => c.cells.map(x => x.square)) ?? []), [data, slot]);
  const result = score?.cards.find(c => c.slot === slot);

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/weekly-bingo', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ week, slot, cells, version: saved?.version ?? 0 }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'The card was not saved.');
      await load();
      window.dispatchEvent(new Event('opval-wallet-changed'));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!account.user) return <section className="bingo-page"><h1>Bingo</h1><p className="note">Sign in to play weekly bingo.</p></section>;
  const shift = by => setWeek(w => new Date(Date.parse(`${w}T00:00:00Z`) + by * 7 * 86400000).toISOString().slice(0, 10));
  const latest = nextEditableWeek(now);

  // The headline is whatever the week is waiting on: the lock, the end of play, or the results.
  const phase = !data ? null
    : data.settled ? { big: 'Final', small: 'Results are in' }
    : data.ended ? { big: 'Settling', small: 'Waiting on final results' }
    : data.locked || now >= data.startsAt ? { big: left(data.endsAt - now), small: 'Left to play' }
    : { big: left(data.startsAt - now), small: 'To lock' };
  // Seven pips for the week: played days fill, today is ruby; before lock they wait empty.
  const played = data ? Math.max(0, Math.min(7, Math.ceil((now - data.startsAt) / 86400))) : 0;
  const open = data && !data.locked && now < data.startsAt;
  const settledWeeks = Math.min(calibration?.settledWeeks ?? 0, CALIBRATION_WEEKS);

  const choose = (i, cell) => { setCells(prev => prev.map((c, n) => (n === i ? cell : c))); setPicking(null); };
  const eligible = sq => (data?.matches ?? []).filter(m => !sq.bestOf || m.bestOf === sq.bestOf);
  const pointsOf = cell => cell?.square && data?.catalog[cell.square]?.[cell.matchId == null ? 'general' : 'named'];
  const slots = data?.rules.paidEnabled
    ? Array.from({ length: Math.min(data.rules.maxCards, Math.max(1, data.cards.length + (open ? 1 : 0))) }, (_, n) => n + 1)
    : [1];

  return <section className="bingo-page">
    <header className="bingo-head">
      <button type="button" className="icon" onClick={() => shift(-1)} aria-label="Previous week"><Back /></button>
      <div className="bingo-phase" aria-live="polite">
        {phase && <strong aria-label={`${phase.big} ${phase.small}`}>{phase.big}</strong>}
        {data && <div className="bingo-week" aria-hidden="true">
          <span className="bingo-days">{Array.from({ length: 7 }, (_, n) => <i key={n} data-state={n < played - 1 || data.ended ? 'done' : n === played - 1 ? 'today' : undefined} />)}</span>
          <span className="bingo-dates"><small>{dayOf(data.startsAt)}</small><small>{dayOf(data.endsAt - 1)}</small></span>
        </div>}
      </div>
      <button type="button" className="icon bingo-next" onClick={() => shift(1)} aria-label="Next week" disabled={week >= latest}><Back /></button>
    </header>

    {error && <p className="error" role="alert">{error}</p>}
    {!data && !error && <p className="note">Loading the week</p>}

    {data && <>
      <div className="tier-switch bingo-slots" role="group" aria-label="Cards" style={{ '--n': data.rules.paidEnabled ? slots.length : 2 }}>
        {slots.map(n => <button key={n} type="button" className={slot === n ? 'primary' : undefined} aria-pressed={slot === n}
          onClick={() => { setSlot(n); setCells(data.cards.find(c => c.slot === n)?.cells ?? blank()); }}>
          Card {n}{n > 1 && !data.cards.some(c => c.slot === n) && <small>{data.rules.cardCost} CR</small>}
        </button>)}
        {!data.rules.paidEnabled && <button type="button" disabled aria-label={`Card 2 opens after ${CALIBRATION_WEEKS} settled weeks, ${settledWeeks} so far`}>
          <Lock /><span className="bingo-pips" aria-hidden="true">{Array.from({ length: CALIBRATION_WEEKS }, (_, n) => <i key={n} data-on={n < settledWeeks} />)}</span>
        </button>}
      </div>

      <div className="bcard-grid bingo-card">
        {cells.map((cell, i) => {
          const sq = weeklyById[cell?.square];
          const out = result?.cells[i];
          const state = !open && out ? out.state : undefined;
          const match = cell?.matchId != null && data.matches.find(m => m.matchId === cell.matchId);
          const Cell = open ? 'button' : 'div';
          const pts = pointsOf(cell);
          return <Cell key={i} {...(open ? { type: 'button', onClick: () => setPicking({ i }) } : {})}
            className="bcell" data-filled={!!sq} data-state={state}
            aria-label={open ? (sq ? `${nameOf(sq)}: ${sq.label}, ${pts} points. Change` : `Cell ${i + 1} empty. Pick a square`) : undefined}>
            {sq ? <>
              <span className="bcell-top">
                <span className="bcell-pts" data-rare={pts >= RARE}><b>{pts}</b><small>pts</small></span>
                {(state === 'pending' || state === 'free') && <span className="bcell-lock">{state}</span>}
              </span>
              <span className="bcell-label">{nameOf(sq)}</span>
              <span className="bcell-match">
                {sq.scope === 'roster' ? 'Riot GCD' : match ? <Tags match={match} /> : <Crowd matches={eligible(sq)} />}
                {state === 'hit' && out.evidence && <a href={out.evidence.sourceUrl ?? `https://www.vlr.gg/${out.evidence.matchId}`} target="_blank" rel="noreferrer">Source</a>}
              </span>
              {state && <span className="sr">{state}</span>}
            </> : open ? <span className="bcell-empty"><Plus /></span> : <span className="bcell-empty">Empty</span>}
          </Cell>;
        })}
      </div>

      {open && (dirty || !saved) && <button type="button" className="primary big bingo-submit" onClick={save} disabled={busy || !full}>
        {busy ? 'Saving' : saved ? 'Update card' : slot > 1 ? `Buy card ${data.rules.cardCost} CR` : 'Submit card'}
      </button>}
      {open && saved && !dirty && <p className="bingo-saved">Saved</p>}
      {result && !open && <p className="sum sum-total"><b>{sign(result.total)}</b><span>{result.complete ? 'this week' : 'so far'}</span></p>}
    </>}

    <Sheet open={picking != null} onClose={() => setPicking(null)}
      title={picking?.square ? weeklyById[picking.square].label : 'Pick a square'}
      head={picking?.square && <button type="button" className="icon bingo-back" aria-label="Back to squares" onClick={() => setPicking({ i: picking.i })}><Back /></button>}>
      {picking && !picking.square && CLUSTERS.map(cl => {
        const list = (data?.squares ?? []).filter(s => s.cluster === cl.id);
        return list.length > 0 && <div key={cl.id} className="bingo-cluster">
          <h2 className="section">{cl.label}</h2>
          <ul>
            {list.map(s => {
              const inUse = usedElsewhere.has(s.id) || cells.some((c, n) => n !== picking.i && c?.square === s.id);
              const fits = s.scope === 'roster' || eligible(s).length > 0;
              const pts = data.catalog[s.id]?.general;
              return <li key={s.id}><button type="button" className="bsq" disabled={inUse || !fits}
                onClick={() => (s.scope === 'roster' ? choose(picking.i, { square: s.id, matchId: null }) : setPicking({ i: picking.i, square: s.id }))}>
                <span className="bsq-pts">
                  <span className="bcell-pts" data-rare={pts >= RARE}><b>{pts}</b><small>pts</small></span>
                  {!inUse && fits && data.catalog[s.id]?.named > pts && <span className="bsq-more" data-rare={data.catalog[s.id].named >= RARE} aria-label={`${data.catalog[s.id].named} points for one named match`}>{data.catalog[s.id].named}</span>}
                </span>
                <span className="bsq-label">{nameOf(s)}</span>
                <small className="bsq-rule">{s.label}</small>
                {(inUse || !fits) && <small className="bsq-note">{inUse ? 'In use' : 'No match fits'}</small>}
              </button></li>;
            })}
          </ul>
        </div>;
      })}
      {picking?.square && (() => {
        const sq = weeklyById[picking.square];
        const current = cells[picking.i];
        const options = [{ matchId: null, n: eligible(sq).length }, ...eligible(sq)];
        return <ul className="bingo-targets">
          {options.map(m => {
            const named = m.matchId != null && m.team1Tag !== undefined;
            const pts = data.catalog[sq.id][named ? 'named' : 'general'];
            const on = current?.square === sq.id && current.matchId === (named ? m.matchId : null);
            return <li key={m.matchId ?? 'any'}><button type="button" aria-pressed={on} onClick={() => choose(picking.i, { square: sq.id, matchId: named ? m.matchId : null })}>
              <span className="bingo-target-what">
                {named ? <Tags match={m} /> : <b>Any match</b>}
                {named ? <small><Split parts={[weekdayOf(m.startsAt), timeOf(m.startsAt)]} /></small> : <Crowd matches={eligible(sq)} />}
              </span>
              <span className="bcell-pts" data-rare={pts >= RARE}><b>{pts}</b><small>pts</small></span>
            </button></li>;
          })}
        </ul>;
      })()}
    </Sheet>
  </section>;
}
