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
const STEPS = [['market', '1  BUY AND SELL'], ['lineup', '2  PICK YOUR TEAM'], ['play', '3  PLAY THE DAY']];

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
        {value != null && <span className={styles.micro} data-trend={trend(value.form)}>AVG {value.ep.toFixed(0)} PTS</span>}
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
  const [view, setView] = useState('market'); // market | lineup | play | result | table

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
    setView('market');
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
    setView('result');
  };

  const rows = state ? standings(state) : [];
  const myRank = rows.findIndex(r => r.id === 'you') + 1;
  const nameOf = id => {
    const m = state.managers.find(x => x.id === id);
    return m.kind === 'human' ? 'You' : m.personality[0].toUpperCase() + m.personality.slice(1);
  };
  const plays = pid => (ctx?.seriesNext[pid] ?? 0) > 0;
  const Tag = ({ pid }) => <span className={styles.stamp} data-hot={plays(pid) ? 'false' : 'dim'}>{plays(pid) ? 'PLAYS TODAY' : 'NOT PLAYING'}</span>;

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
        <p>Relive the tournament as a manager. Each real match day, your team scores points from what your players actually did in those matches.</p>
        <ol className={styles.how}>
          <li><strong>Own 5 real pros.</strong> You get a starting squad. Seven rival managers get theirs. Nobody shares a player.</li>
          <li><strong>Each day, pick your team.</strong> Choose which 5 of your players start, and one captain who scores double.</li>
          <li><strong>Play the day.</strong> Your starters earn points for kills, assists, clutches and wins. The most points after all days wins.</li>
          <li><strong>Buy and sell between days.</strong> Bid secretly on other players. The best bid wins when the day closes.</li>
        </ol>
        <button className={styles.primary} onClick={start}>START REPLAY</button>
      </section>
    );
  } else if (state) {
    const md = replay.matchdays[Math.min(state.step, replay.matchdays.length - 1)];
    const done = state.status === 'done';
    const starters = SLOTS.map(slot => lineupSlots[slot]).filter(pid => pid != null);
    const playing = starters.filter(plays).length;

    const stepper = (
      <nav className={styles.stepper} aria-label="Steps">
        {STEPS.map(([key, label]) => (
          <button key={key} className={styles.step} data-on={view === key} onClick={() => setView(key)}>{label}</button>
        ))}
      </nav>
    );

    const marketView = (
      <section className={styles.panel}>
        <p className={styles.help}>Buy players to make your team stronger. <strong>Bids are secret.</strong> When you play the day, the highest bid for each player wins. You only pay if you win. Skip this step if you are happy with your squad.</p>
        {state.market.offers.length > 0 && <h4>A RIVAL WANTS ONE OF YOUR PLAYERS</h4>}
        {state.market.offers.map(o => (
          <PlayerLine key={o.id} player={replay.players[o.pid]} extra={<span className={styles.micro}>{nameOf(o.from)} offers {fmt(o.amt)}</span>}>
            <button className={styles.secondary} disabled={o.accepted} onClick={() => attempt(() => acceptOffer(state, o.id))}>{o.accepted ? 'SELLING TO THEM' : 'SELL TO THEM'}</button>
          </PlayerLine>
        ))}
        <h4>PLAYERS YOU CAN BID ON</h4>
        {state.market.listings.map(l => {
          const p = replay.players[l.pid];
          const placed = state.market.bids.you[l.pid];
          return (
            <PlayerLine key={l.pid} player={p} value={ctx.values[l.pid]}>
              {placed
                ? <button className={styles.secondary} onClick={() => attempt(() => cancelBid(state, 'you', l.pid))}>YOUR BID {fmt(placed)}  CANCEL</button>
                : (
                  <form className={styles.bid} onSubmit={e => {
                    e.preventDefault();
                    const amt = Math.round(Number(bidText[l.pid] ?? l.min / 1000) * 1000 / 10) * 10;
                    attempt(() => queueBid(state, 'you', l.pid, amt, ctx));
                  }}>
                    <input aria-label={`Your bid for ${p.handle}, in millions`} inputMode="decimal" value={bidText[l.pid] ?? (l.min / 1000).toFixed(2)}
                      onChange={e => setBidText(t => ({ ...t, [l.pid]: e.target.value }))} />
                    <button className={styles.secondary}>BID</button>
                  </form>
                )}
            </PlayerLine>
          );
        })}
        {message && <p className={styles.error} role="alert">{message}</p>}
        <h4>YOUR PLAYERS</h4>
        <p className={styles.help}>Selling pays you their value when the day closes. Your squad holds at most {state.squadMax} players.</p>
        {squad.map(pid => {
          const queued = state.market.sales.you?.includes(pid);
          return (
            <PlayerLine key={pid} player={replay.players[pid]} value={ctx.values[pid]}>
              <button className={styles.secondary} disabled={queued} onClick={() => attempt(() => queueSale(state, 'you', pid))}>{queued ? 'WILL SELL' : 'SELL'}</button>
            </PlayerLine>
          );
        })}
        <button className={styles.primary} onClick={() => setView('lineup')}>NEXT: PICK YOUR TEAM</button>
      </section>
    );

    const lineupView = (
      <section className={styles.panel}>
        <p className={styles.help}>Choose the <strong>5 players who start</strong>. Only players whose team plays today can score. Tap <strong>CAPTAIN</strong> on one starter: their points count double.</p>
        {SLOTS.map(slot => {
          const pid = lineupSlots[slot];
          if (pid == null) return <p key={slot} className={styles.note}>{SLOT_LABEL[slot]}: no player available</p>;
          const isCap = draft?.captain === pid;
          const options = squad.filter(x => !(slot in { D: 1, I: 1, C: 1 }) || roleOf(x) === { D: 'duelist', I: 'initiator', C: 'controller' }[slot]);
          return (
            <div key={slot} className={styles.slotCard}>
              <span className={styles.micro}>{SLOT_LABEL[slot]}</span>
              <PlayerLine player={replay.players[pid]} value={ctx.values[pid]} extra={<Tag pid={pid} />}>
                <div className={styles.slotTools}>
                  <select aria-label={`Change ${SLOT_LABEL[slot]}`} value={pid} onChange={e => setSlot(slot, Number(e.target.value))}>
                    {options.map(x => <option key={x} value={x}>{replay.players[x].handle}{plays(x) ? '' : ' (not playing)'}</option>)}
                  </select>
                  <button className={styles.secondary} data-on={isCap} onClick={() => setOverride({ ...draft, captain: pid })}>{isCap ? 'CAPTAIN x2' : 'CAPTAIN'}</button>
                </div>
              </PlayerLine>
            </div>
          );
        })}
        {draft?.bench?.length > 0 && <h4>ON THE BENCH</h4>}
        {(draft?.bench ?? []).map(pid => (
          <PlayerLine key={pid} player={replay.players[pid]} value={ctx.values[pid]} extra={<Tag pid={pid} />} />
        ))}
        <p className={styles.help}>A starter whose team does not play is replaced by a bench player who does.</p>
        <button className={styles.primary} onClick={() => setView('play')}>NEXT: PLAY THE DAY</button>
      </section>
    );

    const playView = (
      <section className={styles.panel}>
        <p className={styles.help}>Ready? Playing the day closes the market, locks your team and reveals what your players really did.</p>
        <h4>YOUR STARTERS</h4>
        {SLOTS.map(slot => {
          const pid = lineupSlots[slot];
          if (pid == null) return null;
          return (
            <PlayerLine key={slot} player={replay.players[pid]} extra={<Tag pid={pid} />}>
              {draft?.captain === pid && <span className={styles.stamp} data-hot="true">CAPTAIN x2</span>}
            </PlayerLine>
          );
        })}
        {playing < 5 && <p className={styles.warn}>{5 - playing} of your starters are not playing today. They score 0 unless a bench player steps in. You can go back and change your team.</p>}
        <h4>YOUR BIDS</h4>
        {Object.keys(state.market.bids.you).length === 0
          ? <p className={styles.note}>No bids placed.</p>
          : Object.entries(state.market.bids.you).map(([pid, amt]) => <p key={pid} className={styles.note}>{replay.players[pid].handle}: {fmt(amt)}</p>)}
        <button className={styles.primary} onClick={play}>PLAY {md.label}</button>
        <button className={styles.secondary} onClick={() => setView('lineup')}>BACK</button>
      </section>
    );

    const resultView = reveal && (
      <section className={styles.panel} aria-live="polite">
        <h3>{replay.matchdays[reveal.step].label} RESULT</h3>
        <p className={styles.big}>You scored <strong>{reveal.results.you.total}</strong> points</p>
        <p className={styles.help}>Points: +2 per kill, +1 per assist, -1 per death, bonuses for first kills, multi-kills, clutches, a strong round-win rate, and winning the map. The captain counts double.</p>
        {SLOTS.map(slot => {
          const pid = reveal.locked.you.slots[slot];
          const sub = reveal.results.you.subs.find(x => x.slot === slot);
          const shown = sub ? sub.in : pid;
          if (shown == null) return null;
          const pts = reveal.md.points.get(shown);
          const cap = reveal.results.you.captain === shown;
          return (
            <PlayerLine key={slot} player={replay.players[shown]}
              extra={<span className={styles.micro}>{pts ? `${pts.total} pts${cap ? ' x2' : ''}` : 'did not play'}</span>}>
              {sub && <span className={styles.stamp}>SUBBED IN</span>}
              {cap && <span className={styles.stamp} data-hot="true">CAPTAIN</span>}
            </PlayerLine>
          );
        })}
        <h4>THE MARKET</h4>
        {reveal.report.auctions.length === 0 && <p className={styles.note}>Nobody bid on anyone.</p>}
        {reveal.report.auctions.map(a => {
          const mine = a.bids.find(b => b.mgr === 'you');
          return (
            <div key={a.pid} className={styles.auction}>
              <strong>{replay.players[a.pid].handle}</strong>
              <Split parts={[
                a.winner ? `${nameOf(a.winner)} won at ${fmt(a.bids[0].amt)}` : 'nobody could pay',
                mine && a.winner !== 'you' ? `you bid ${fmt(mine.amt)}` : '',
                a.bids.length > 1 ? `${a.bids.length} bids` : '',
              ]} />
            </div>
          );
        })}
        <h4>STANDINGS</h4>
        <table className={styles.table}>
          <thead><tr><th>#</th><th>MANAGER</th><th>TOTAL</th><th>THIS DAY</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} data-you={r.id === 'you'}><td>{i + 1}</td><td>{nameOf(r.id)}</td><td>{r.total}</td><td>{reveal.results[r.id]?.total ?? 0}</td></tr>
            ))}
          </tbody>
        </table>
        <button className={styles.primary} onClick={() => { setReveal(null); setView('market'); }}>
          {done ? 'SEE FINAL RESULT' : `CONTINUE TO DAY ${state.step + 1}`}
        </button>
      </section>
    );

    const finalView = (
      <section className={styles.panel}>
        <h3>FINAL STANDINGS</h3>
        <p className={styles.big}>You finished <strong>{myRank}</strong> of 8</p>
        <table className={styles.table}>
          <thead><tr><th>#</th><th>MANAGER</th><th>POINTS</th><th>DAY WINS</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} data-you={r.id === 'you'}><td>{i + 1}</td><td>{nameOf(r.id)}</td><td>{r.total}</td><td>{r.wins}</td></tr>
            ))}
          </tbody>
        </table>
        <button className={styles.primary} onClick={start}>PLAY AGAIN</button>
      </section>
    );

    let main;
    if (reveal && view === 'result') main = resultView;
    else if (done) main = finalView;
    else if (view === 'lineup') main = lineupView;
    else if (view === 'play') main = playView;
    else main = marketView;

    body = (
      <>
        <header className={styles.top}>
          <div>
            <span className={styles.micro}>{done ? 'FINISHED' : `${md.label} OF ${state.totalSteps}`}</span>
            <h2>{replay.title}</h2>
          </div>
          <div className={styles.stats}>
            <div><span className={styles.micro}>CREDITS</span><strong>{fmt(state.cash.you)}</strong></div>
            <div><span className={styles.micro}>RANK</span><strong>{myRank}/8</strong></div>
            <div><span className={styles.micro}>POINTS</span><strong>{state.points.you.total}</strong></div>
          </div>
        </header>
        {!done && !(reveal && view === 'result') && stepper}
        {main}
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
