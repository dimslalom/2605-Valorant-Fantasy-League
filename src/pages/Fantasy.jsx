import { useCallback, useEffect, useMemo, useState } from 'react';
import AppFrame from '../components/AppFrame';
import Split from '../components/Split';
import cards from '../data/cards.json';
import { ctxFor, playMatchday, startReplay } from '../engine/fantasy/game';
import { autoLineup, validLineup } from '../engine/fantasy/lineup';
import { squadOf, standings } from '../engine/fantasy/league';
import { MarketError, acceptOffer, cancelBid, queueBid, queueSale } from '../engine/fantasy/market';
import { buildReplay } from '../engine/fantasy/replay';
import { SLOTS } from '../engine/fantasy/constants';
import { fetchEventMatches } from '../lib/feedClient';
import { clearFantasySave, loadFantasySave, saveFantasy } from '../lib/fantasySave';
import styles from './Fantasy.module.css';

const EVENT_ID = 2766; // Valorant Champions 2026
const SLOT_LABEL = { D: 'DUELIST', I: 'INITIATOR', C: 'CONTROLLER', F1: 'FLEX', F2: 'FLEX' };
const fmt = k => `${(k / 1000).toFixed(2)}M`;
const trend = form => (form >= 3 ? 'up' : form <= -3 ? 'down' : 'flat');

function Face({ player }) {
  const photo = player.card?.photo;
  return photo && !photo.includes('placeholder')
    ? <img className={styles.face} src={photo} alt="" loading="lazy" />
    : <span className={styles.face} data-empty="true">{player.role[0].toUpperCase()}</span>;
}

function PlayerLine({ player, value, extra, children }) {
  return (
    <div className={styles.row}>
      <Face player={player} />
      <div className={styles.who}>
        <strong>{player.handle}</strong>
        <span className={styles.micro}><Split parts={[player.team, player.role.toUpperCase()]} /></span>
      </div>
      <div className={styles.num}>
        {value != null && <span>{fmt(value.v)}</span>}
        {value != null && <span className={styles.micro} data-trend={trend(value.form)}>EP {value.ep.toFixed(0)}</span>}
        {extra}
      </div>
      {children}
    </div>
  );
}

export default function Fantasy() {
  const [replay, setReplay] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | empty | error | intro | play
  const [state, setState] = useState(null);
  const [override, setOverride] = useState(null);
  const [bidText, setBidText] = useState({});
  const [message, setMessage] = useState('');
  const [reveal, setReveal] = useState(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const matches = await fetchEventMatches(EVENT_ID);
      if (!live) return;
      if (matches == null) { setStatus('error'); return; }
      const built = buildReplay({ matches, cards, title: 'Champions 2026' });
      if (built.matchdays.length < 2) { setStatus('empty'); setReplay(built); return; }
      setReplay(built);
      const save = loadFantasySave();
      if (save?.state && save.totalSteps === built.matchdays.length) {
        setState(save.state);
        setOverride(save.override ?? null);
        setStatus('play');
      } else {
        setStatus('intro');
      }
    })();
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (state) saveFantasy({ state, override, totalSteps: state.totalSteps });
  }, [state, override]);

  const ctx = useMemo(() => (replay && state ? ctxFor(replay, state.step) : null), [replay, state]);
  const roleOf = useCallback(pid => replay.players[pid].role, [replay]);
  const squad = useMemo(() => (state ? squadOf(state, 'you') : []), [state]);

  const draft = useMemo(() => {
    if (!state || !ctx) return null;
    const auto = autoLineup(squad, { epOf: pid => ctx.values[pid].ep, roleOf, seriesOf: pid => ctx.seriesNext[pid] ?? 1 });
    if (override && validLineup(override, squad, roleOf).ok) return override;
    return auto;
  }, [state, ctx, squad, override, roleOf]);

  const start = () => {
    clearFantasySave();
    setState(startReplay(replay, { seed: Math.floor(Math.random() * 1e6) }));
    setOverride(null);
    setReveal(null);
    setStatus('play');
  };

  const attempt = fn => {
    try { setState(fn()); setMessage(''); } catch (e) {
      if (e instanceof MarketError) setMessage(e.message); else throw e;
    }
  };

  const lineupSlots = draft?.slots ?? {};
  const setSlot = (slot, pid) => {
    const slots = { ...lineupSlots, [slot]: pid };
    for (const s of SLOTS) if (s !== slot && slots[s] === pid) slots[s] = lineupSlots[slot];
    const captain = Object.values(slots).includes(draft.captain) ? draft.captain : slots.D;
    setOverride({ slots, bench: [], captain });
  };

  const play = () => {
    const out = playMatchday(state, replay, draft);
    setReveal({ ...out, step: state.step });
    setState(out.state);
    setOverride(null);
    setBidText({});
  };

  const rows = state ? standings(state) : [];
  const myRank = rows.findIndex(r => r.id === 'you') + 1;
  const nameOf = id => {
    const m = state.managers.find(x => x.id === id);
    return m.kind === 'human' ? 'You' : m.personality[0].toUpperCase() + m.personality.slice(1);
  };

  let body;
  if (status === 'loading') body = <p className={styles.note}>Loading the feed</p>;
  else if (status === 'error') body = <p className={styles.note}>The data feed is unreachable. Try again in a minute.</p>;
  else if (status === 'empty') {
    body = <p className={styles.note}>Only {replay.matchdays.length} matchday of Champions 2026 is stored so far. The feed fills in about 30 minutes per run. Check back soon.</p>;
  } else if (status === 'intro') {
    body = (
      <section className={styles.intro}>
        <span className={styles.micro}>REPLAY</span>
        <h2>Champions 2026</h2>
        <p>{replay.matchdays.length} matchdays of real results. You and seven rival managers each own five pros. Buy and sell on the market, set a lineup and a captain, and score from their real stats. Results stay hidden until you play each day.</p>
        <button className={styles.primary} onClick={start}>START REPLAY</button>
      </section>
    );
  } else if (state) {
    const md = replay.matchdays[Math.min(state.step, replay.matchdays.length - 1)];
    const done = state.status === 'done';
    body = (
      <>
        <header className={styles.top}>
          <div>
            <span className={styles.micro}>{done ? 'FINAL' : `${md.label} OF ${state.totalSteps}`}</span>
            <h2>{replay.title}</h2>
          </div>
          <div className={styles.stats}>
            <div><span className={styles.micro}>CREDITS</span><strong>{fmt(state.cash.you)}</strong></div>
            <div><span className={styles.micro}>RANK</span><strong>{myRank}/8</strong></div>
            <div><span className={styles.micro}>POINTS</span><strong>{state.points.you.total}</strong></div>
          </div>
        </header>

        {reveal && (
          <section className={styles.panel} aria-live="polite">
            <h3>{replay.matchdays[reveal.step].label} RESULT</h3>
            <p className={styles.note}>
              <Split parts={[`You scored ${reveal.results.you.total}`, `payout ${fmt(reveal.results.you.total * 1.5 + 300)}`]} />
            </p>
            {SLOTS.map(slot => {
              const pid = reveal.locked.you.slots[slot];
              const sub = reveal.results.you.subs.find(s => s.slot === slot);
              const shown = sub ? sub.in : pid;
              if (shown == null) return null;
              const pts = reveal.md.points.get(shown);
              const cap = reveal.results.you.captain === shown;
              return (
                <PlayerLine key={slot} player={replay.players[shown]}
                  extra={<span className={styles.micro}>{pts ? `${pts.total} pts${cap ? ' x2' : ''}` : 'did not play'}</span>}>
                  {sub && <span className={styles.stamp}>SUB</span>}
                  {cap && <span className={styles.stamp} data-hot="true">CAPTAIN</span>}
                </PlayerLine>
              );
            })}
            <h4>MARKET</h4>
            {reveal.report.auctions.length === 0 && <p className={styles.note}>No bids were placed.</p>}
            {reveal.report.auctions.map(a => (
              <p key={a.pid} className={styles.note}>
                <strong>{replay.players[a.pid].handle}</strong>
                <Split parts={[a.winner ? `${nameOf(a.winner)} won at ${fmt(a.bids[0].amt)}` : 'unsold', a.bids.length > 1 ? `${a.bids.length} bids` : '']} />
              </p>
            ))}
            <button className={styles.secondary} onClick={() => setReveal(null)}>CLOSE</button>
          </section>
        )}

        {!done && (
          <>
            <section className={styles.panel}>
              <h3>MARKET</h3>
              {state.market.offers.map(o => (
                <PlayerLine key={o.id} player={replay.players[o.pid]} extra={<span className={styles.micro}>{nameOf(o.from)} offers {fmt(o.amt)}</span>}>
                  <button className={styles.secondary} disabled={o.accepted} onClick={() => attempt(() => acceptOffer(state, o.id))}>{o.accepted ? 'ACCEPTED' : 'ACCEPT'}</button>
                </PlayerLine>
              ))}
              {state.market.listings.map(l => {
                const p = replay.players[l.pid];
                const placed = state.market.bids.you[l.pid];
                return (
                  <PlayerLine key={l.pid} player={p} value={ctx.values[l.pid]}>
                    {placed
                      ? <button className={styles.secondary} onClick={() => attempt(() => cancelBid(state, 'you', l.pid))}>BID {fmt(placed)} X</button>
                      : (
                        <form className={styles.bid} onSubmit={e => {
                          e.preventDefault();
                          const amt = Math.round(Number(bidText[l.pid] ?? l.min / 1000) * 1000 / 10) * 10;
                          attempt(() => queueBid(state, 'you', l.pid, amt, ctx));
                        }}>
                          <input aria-label={`Bid for ${p.handle} in millions`} inputMode="decimal" value={bidText[l.pid] ?? (l.min / 1000).toFixed(2)}
                            onChange={e => setBidText(t => ({ ...t, [l.pid]: e.target.value }))} />
                          <button className={styles.secondary}>BID</button>
                        </form>
                      )}
                  </PlayerLine>
                );
              })}
              {message && <p className={styles.error} role="alert">{message}</p>}
            </section>

            <section className={styles.panel}>
              <h3>LINEUP</h3>
              {SLOTS.map(slot => (
                <div key={slot} className={styles.slot}>
                  <span className={styles.micro}>{SLOT_LABEL[slot]}</span>
                  <select value={lineupSlots[slot] ?? ''} onChange={e => setSlot(slot, Number(e.target.value))}>
                    {squad.filter(pid => !(slot in { D: 1, I: 1, C: 1 }) || roleOf(pid) === { D: 'duelist', I: 'initiator', C: 'controller' }[slot])
                      .map(pid => <option key={pid} value={pid}>{replay.players[pid].handle} ({fmt(ctx.values[pid].v)}, EP {ctx.values[pid].ep.toFixed(0)})</option>)}
                  </select>
                  <label className={styles.cap}>
                    <input type="radio" name="captain" checked={draft?.captain === lineupSlots[slot]}
                      onChange={() => setOverride({ ...draft, captain: lineupSlots[slot] })} /> C
                  </label>
                </div>
              ))}
              <h4>SQUAD</h4>
              {squad.map(pid => {
                const queued = state.market.sales.you?.includes(pid);
                return (
                  <PlayerLine key={pid} player={replay.players[pid]} value={ctx.values[pid]}>
                    <button className={styles.secondary} disabled={queued} onClick={() => attempt(() => queueSale(state, 'you', pid))}>{queued ? 'SELLING' : 'SELL'}</button>
                  </PlayerLine>
                );
              })}
            </section>

            <div className={styles.actions}>
              <button className={styles.primary} onClick={play}>CLOSE MARKET AND PLAY {md.label}</button>
            </div>
          </>
        )}

        <section className={styles.panel}>
          <h3>STANDINGS</h3>
          <table className={styles.table}>
            <thead><tr><th>#</th><th>MANAGER</th><th>PTS</th><th>DAY WINS</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} data-you={r.id === 'you'}><td>{i + 1}</td><td>{nameOf(r.id)}</td><td>{r.total}</td><td>{r.wins}</td></tr>
              ))}
            </tbody>
          </table>
          {done && <button className={styles.primary} onClick={start}>PLAY AGAIN</button>}
        </section>
      </>
    );
  }

  return (
    <AppFrame>
      <main className={styles.page}>
        {body}
        <footer className={styles.legal}>
          <Split parts={['Data: vlr.gg', <a key="l" href="/legal.html">Legal</a>]} />
        </footer>
      </main>
    </AppFrame>
  );
}
