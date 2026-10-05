import { useEffect, useMemo, useRef, useState } from 'react';
import Split from '../../../../src/components/Split';
import Sheet from '../components/Sheet';
import { SIZE } from '../lib/bingoCard';
import { available, isLocked, slateDay } from '../lib/bingoSlate';
import SQUARES from '../lib/bingoSquares';
import { useGame } from '../lib/gameContext';
import { logoFor } from '../lib/orgs';
import { longDay, timeOf } from '../lib/time';

const CLUSTERS = [
  { id: 'close', label: 'Close map' },
  { id: 'stomp', label: 'Stomp' },
  { id: 'star', label: 'Star player' },
  { id: 'chaos', label: 'Chaos' },
  { id: 'agent', label: 'Agent' },
  { id: 'side', label: 'Side' },
];
const EMPTY = Array(SIZE * SIZE).fill(null);
const sameCell = (a, b) => a?.square === b?.square && a?.matchId === b?.matchId;
const shiftDay = (key, by) => slateDay(Date.parse(`${key}T00:00:00Z`) / 1000 + by * 86400);
const sqOf = id => SQUARES.find(s => s.id === id);
const pct = rate => `${Math.round(rate * 100)}%`;

function friendly(message) {
  if (/locked|already started/.test(message)) return 'A match in this card has started. Its cell went back to what you saved.';
  return `The card was not saved: ${message}`;
}

// A matchup as logo + tag per team, split by a hairline (never a typed separator).
const Tags = ({ match }) => <Split className="bteams" parts={match.teams.map(t => {
  const logo = logoFor(t.tag);
  return <>{logo && <img src={logo} alt="" />}{t.tag || '?'}</>;
})} />;
// Rare squares (5+ points) show their points in gold, so risk reads at a glance.
const RARE = 5;
const Plus = () => <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>;

export default function Bingo() {
  const { state, buyBingoCard } = useGame();
  const [day, setDay] = useState(() => slateDay(Math.floor(Date.now() / 1000)));
  const [data, setData] = useState(null);       // { matches, cards, rules } for `day`
  const [drafts, setDrafts] = useState({});     // slot -> unsaved cells
  const [slot, setSlot] = useState(1);          // the card in front
  const [failed, setFailed] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [picking, setPicking] = useState(null); // { slot, i }: the cell being edited
  const [matchId, setMatchId] = useState(null); // match chosen inside the sheet
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [reload, setReload] = useState(0);
  const scanned = useRef(false); // the skip-ahead scan runs once, on the first load
  const rail = useRef(null);
  const flying = useRef(0); // until this time, scroll events come from our own scrollIntoView, not the player

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30000);
    return () => clearInterval(t);
  }, []);

  // The first load lands on the next day that has matches, so an empty today is not a dead end. It scans
  // once: the flag is set when a scan finishes (or the player moves a day), so landing on a day never
  // starts another scan, and a slate with no matches anywhere stays on the day you asked for.
  useEffect(() => {
    let live = true;
    (async () => {
      setData(null); setFailed(''); setMessage(''); setDrafts({}); setSlot(1);
      try {
        const scan = !scanned.current;
        let landed = null;
        let key = day;
        for (let i = 0; i < (scan ? 8 : 1); i += 1, key = shiftDay(key, 1)) {
          const res = await fetch(`/api/bingo?day=${key}`, { cache: 'no-store' }).catch(() => null);
          if (!res) throw new Error("Can't reach the OpVAL server. Check your connection and try again.");
          if (!res.ok) throw new Error(res.status === 401 ? 'You are signed out. Sign in again.' : `The slate could not be loaded (error ${res.status}).`);
          const body = await res.json().catch(() => { throw new Error('The slate came back in a form this page cannot read.'); });
          if (!live) return;
          landed ??= { key, body };
          if (body.matches.length) { landed = { key, body }; break; }
        }
        scanned.current = true;
        if (landed.key !== day) setDay(landed.key);
        setData(landed.body);
      } catch (e) { if (live) setFailed(e.message); }
    })();
    return () => { live = false; };
  }, [day, reload]);
  const go = by => { scanned.current = true; setDay(d => shiftDay(d, by)); };

  const cards = data?.cards ?? [];
  const rules = data?.rules;
  const savedOf = s => cards.find(c => c.slot === s);
  const cellsOf = s => drafts[s] ?? savedOf(s)?.cells ?? EMPTY;
  const setCellsOf = (s, fn) => setDrafts(d => ({ ...d, [s]: fn(d[s] ?? savedOf(s)?.cells ?? EMPTY) }));

  const matches = useMemo(() => Object.fromEntries((data?.matches ?? []).map(m => [m.matchId, m])), [data]);
  const open = (data?.matches ?? []).filter(m => !isLocked(m, now));
  const lockedAt = (s, i) => { const c = cellsOf(s)[i]; return c && (!matches[c.matchId] || isLocked(matches[c.matchId], now)); };

  const cells = cellsOf(slot);
  const saved = savedOf(slot);
  const full = cells.every(Boolean);
  const dirty = JSON.stringify(cells) !== JSON.stringify(saved?.cells ?? EMPTY);
  const used = picking ? cellsOf(picking.slot).filter((c, i) => c && i !== picking.i) : [];

  // Cards fill in order: the card in front may be the next, unsaved one. The first card is free;
  // each extra costs credits, taken once the server has accepted the card.
  const pendingNew = slot > cards.length;
  const cost = slot <= (rules?.freeCards ?? 1) ? 0 : (rules?.cardCost ?? 0);
  const credits = state?.credits ?? 0;
  const affordable = !pendingNew || cost === 0 || credits >= cost;
  const canAdd = rules && !pendingNew && cards.length < rules.maxCards;
  const nextCost = cards.length + 1 <= rules?.freeCards ? 0 : rules?.cardCost ?? 0;
  const slots = Array.from({ length: Math.max(cards.length, slot) }, (_, i) => i + 1);

  const openPicker = (s, i) => {
    setSlot(s);
    setPicking({ slot: s, i });
    setMatchId(cellsOf(s)[i]?.matchId ?? open[0]?.matchId ?? null);
  };
  const choose = square => {
    setCellsOf(picking.slot, cs => cs.map((c, i) => (i === picking.i ? { square, matchId } : c)));
    setPicking(null);
    setMessage('');
  };

  // The rail is a row of cards you swipe through; the one nearest the middle is "in front".
  const onRail = e => {
    if (Date.now() < flying.current) return;
    const el = e.currentTarget;
    const first = el.children[0];
    if (!first) return;
    const step = first.offsetWidth + parseFloat(getComputedStyle(el).columnGap || 0);
    const idx = Math.round(el.scrollLeft / step);
    if (idx < slots.length && idx + 1 !== slot) { setSlot(idx + 1); setMessage(''); }
  };
  const addCard = () => {
    const next = cards.length + 1;
    setSlot(next);
    setMessage('');
    flying.current = Date.now() + 800;
    requestAnimationFrame(() => rail.current?.children[next - 1]?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' }));
  };

  const autoFill = () => {
    const taken = [...cells];
    const pairs = open.flatMap(m => SQUARES.filter(s => available(s.id, m)).map(s => ({ square: s.id, matchId: m.matchId })));
    for (let i = 0; i < taken.length; i += 1) {
      if (taken[i]) continue;
      const free = pairs.filter(p => !taken.some(c => sameCell(c, p)));
      taken[i] = free[Math.floor(Math.random() * free.length)] ?? null;
    }
    setCellsOf(slot, () => taken);
    setMessage('');
  };

  const save = async () => {
    setSaving(true); setMessage('');
    const mine = slot;
    try {
      const res = await fetch('/api/bingo', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ day, slot: mine, cells, version: saved?.version ?? 0 }),
      });
      const body = await res.json();
      const put = card => setData(d => ({ ...d, cards: [...d.cards.filter(c => c.slot !== card.slot), card].sort((a, b) => a.slot - b.slot) }));
      const settle = () => setDrafts(d => Object.fromEntries(Object.entries(d).filter(([k]) => Number(k) !== mine)));
      if (res.ok) {
        put({ slot: mine, cells, version: body.version });
        settle();
        if (pendingNew && cost > 0) buyBingoCard();
        setMessage(pendingNew && cost > 0 ? `Saved. ${cost} credits spent.` : 'Saved');
      } else if (res.status === 409) {
        if (body.card.cells) put(body.card); else setData(d => ({ ...d, cards: d.cards.filter(c => c.slot !== mine) }));
        settle();
        setMessage('This card changed on another device. Showing the saved one.');
      } else {
        setMessage(friendly(body.error ?? 'try again'));
        // A match may have started since the slate loaded: pick up the new locks, and put any locked cell
        // back to what was saved (the server will never take a change there), keeping the other edits.
        const fresh = await fetch(`/api/bingo?day=${day}`, { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).catch(() => null);
        if (fresh) {
          const byId = Object.fromEntries(fresh.matches.map(m => [m.matchId, m]));
          const closed = c => c && (!byId[c.matchId] || isLocked(byId[c.matchId], now));
          setData(d => ({ ...d, matches: fresh.matches }));
          setCellsOf(mine, cs => cs.map((c, i) => (closed(c) ? saved?.cells[i] ?? null : c)));
        }
      }
    } catch {
      setMessage('The card was not saved. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  const pickMatch = matches[matchId];

  return <section className="bingo-page">
    <h1 className="sr">Bingo</h1>
    <div className="day-switch">
      <button aria-label="Previous day" onClick={() => go(-1)}>&larr;</button>
      <div><h2>{longDay(day)}</h2></div>
      <button aria-label="Next day" onClick={() => go(1)}>&rarr;</button>
    </div>
    <p className="bingo-utc">Slate days run on UTC</p>

    {failed && <p className="note" role="alert">{failed} <button className="link" onClick={() => setReload(n => n + 1)}>Try again</button></p>}
    {!failed && !data && <p className="note">Loading the slate</p>}
    {data && data.matches.length === 0 && <p className="note">No matches on this day.</p>}

    {data && data.matches.length > 0 && <>
      <div className="bcards" ref={rail} onScroll={onRail} role="group" aria-label="Your cards">
        {slots.map(s => <article key={s} className="bcard" data-front={s === slot} aria-label={`Card ${s}`}>
          <header className="bcard-meta">
            <b>Card {s}</b>
            <span>{drafts[s] ? 'Unsaved' : savedOf(s) ? 'Saved' : 'New'}</span>
          </header>
          <div className="bcard-grid">
            {cellsOf(s).map((c, i) => {
              const sq = c && sqOf(c.square);
              const locked = lockedAt(s, i);
              return <button key={i} type="button" className="bcell" data-filled={!!c} data-locked={!!locked}
                disabled={!!locked || open.length === 0} onClick={() => openPicker(s, i)}
                aria-label={c ? `${sq.label}, ${sq.points} points${locked ? ', locked' : ''}. Change` : `Cell ${i + 1} empty. Pick a square`}>
                {c ? <>
                  <span className="bcell-top">
                    <span className="bcell-pts" data-rare={sq.points >= RARE}><b>{sq.points}</b><small>pts</small></span>
                    {locked && <span className="bcell-lock">Started</span>}
                  </span>
                  <span className="bcell-label">{sq.label}</span>
                  <span className="bcell-match">{matches[c.matchId] ? <Tags match={matches[c.matchId]} /> : null}</span>
                </> : <span className="bcell-empty"><Plus />Pick a square</span>}
              </button>;
            })}
          </div>
        </article>)}
        {canAdd && <button type="button" className="bcard bcard-add" disabled={nextCost > 0 && credits < nextCost} onClick={addCard}>
          <Plus />
          <span>Add a card</span>
          <b>{nextCost > 0 ? `${nextCost} CR` : 'Free'}</b>
        </button>}
      </div>

      <div className="bingo-bar">
        <button type="button" className="secondary" onClick={autoFill} disabled={full || open.length === 0}>Auto-fill</button>
        <button type="button" className="primary" onClick={save} disabled={!full || !dirty || saving || !affordable}>
          {saving ? 'Saving' : 'Save card'}{pendingNew && cost > 0 && !saving && <small>{cost} cr</small>}
        </button>
      </div>
      {!affordable && <p className="bingo-message" role="status">A new card costs {cost} credits. You have {credits}.</p>}
      {message && <p className="bingo-message" role="status">{message}</p>}
    </>}

    <Sheet open={picking !== null} onClose={() => setPicking(null)} title="Pick a square">
      <div className="bingo-pick">
        <h2 className="section">Match</h2>
        <div className="bingo-matches" role="group" aria-label="Match">
          {(data?.matches ?? []).map(m => <button key={m.matchId} type="button" aria-pressed={m.matchId === matchId}
            disabled={isLocked(m, now)} onClick={() => setMatchId(m.matchId)}>
            <small>{isLocked(m, now) ? 'Started' : timeOf(m.startsAt)}</small>
            <Tags match={m} />
          </button>)}
        </div>
        {/* Each square looks like the cell it becomes on your card: its points, its line, and a bar
            filled to how often it hits a series, so risk reads without reading. */}
        {CLUSTERS.map(cl => <div key={cl.id} className="bingo-cluster">
          <h2 className="section">{cl.label}</h2>
          <ul>
            {SQUARES.filter(s => s.cluster === cl.id).map(s => {
              const taken = used.some(c => sameCell(c, { square: s.id, matchId }));
              const fits = !pickMatch || available(s.id, pickMatch);
              return <li key={s.id}><button type="button" className="bsq" disabled={!pickMatch || taken || !fits} onClick={() => choose(s.id)}>
                <span className="bcell-pts" data-rare={s.points >= RARE}><b>{s.points}</b><small>pts</small></span>
                <span className="bsq-label">{s.label}</span>
                {taken || !fits
                  ? <small className="bsq-note">{taken ? 'In use' : 'Bo3 only'}</small>
                  : <span className="bsq-odds" style={{ '--rate': s.seriesRate }}><i /><small>Hits {pct(s.seriesRate)}</small></span>}
              </button></li>;
            })}
          </ul>
        </div>)}
      </div>
    </Sheet>
  </section>;
}
