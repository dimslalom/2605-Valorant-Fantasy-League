import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AppFrame from '../components/AppFrame';
import Split from '../components/Split';
import cards from '../data/cards.json';
import { SLOTS } from '../engine/fantasy/constants';
import { ctxFor, playMatchday, startReplay } from '../engine/fantasy/game';
import { autoLineup, validLineup } from '../engine/fantasy/lineup';
import { squadOf, standings } from '../engine/fantasy/league';
import { MarketError, acceptOffer, cancelBid, queueBid, queueSale } from '../engine/fantasy/market';
import { buildReplay, playbackSteps, teamStrengths } from '../engine/fantasy/replay';
import { fetchEventMatches } from '../lib/feedClient';
import { clearFantasySave, loadFantasySave, saveFantasy } from '../lib/fantasySave';
import styles from './Fantasy.module.css';

const EVENT_ID = 2766; // Valorant Champions 2026
const SLOT_LABEL = { D: 'DUELIST', I: 'INITIATOR', C: 'CONTROLLER', F1: 'FLEX', F2: 'FLEX' };
const ROLE_FOR = { D: 'duelist', I: 'initiator', C: 'controller' };
const fmt = k => `${(k / 1000).toFixed(2)}M`;
const trend = form => (form >= 3 ? 'up' : form <= -3 ? 'down' : 'flat');

function Face({ player }) {
  const photo = player.card?.photo;
  return photo && !photo.includes('placeholder')
    ? <img className={styles.face} src={photo} alt="" loading="lazy" />
    : <span className={styles.face} data-empty="true">{player.role[0].toUpperCase()}</span>;
}

function PlayerLine({ player, value, sub, children }) {
  return (
    <div className={styles.row}>
      <Face player={player} />
      <div className={styles.who}>
        <strong>{player.handle}</strong>
        <span className={styles.micro}><Split parts={[player.team, player.role.toUpperCase()]} /></span>
        {sub}
      </div>
      <div className={styles.num}>
        {value != null && <span>{fmt(value.v)}</span>}
        {value != null && <span className={styles.micro} data-trend={trend(value.form)}>AVG {value.ep.toFixed(0)} PTS</span>}
      </div>
      {children}
    </div>
  );
}

// Broadcast playback: the day's real maps replay one by one with your points ticking up.
function Broadcast({ steps, replay, onDone }) {
  const [shown, setShown] = useState(0);
  const timer = useRef(null);
  useEffect(() => {
    if (shown >= steps.length) return undefined;
    timer.current = setTimeout(() => setShown(n => n + 1), 1500);
    return () => clearTimeout(timer.current);
  }, [shown, steps.length]);

  const visible = steps.slice(0, shown);
  const total = visible.reduce((sum, st) => sum + st.lines.reduce((a, l) => a + l.counted, 0), 0);
  const finished = shown >= steps.length;

  return (
    <section className={styles.panel} aria-live="polite">
      <div className={styles.liveTop}>
        <span className={styles.micro}>{finished ? 'FINAL' : 'LIVE REPLAY'}</span>
        <strong className={styles.liveTotal}>{total}</strong>
        <span className={styles.micro}>YOUR POINTS TODAY</span>
      </div>
      {steps.length === 0 && <p className={styles.note}>None of your starters played today. Check your fixtures before locking in next time.</p>}
      {[...visible].reverse().map((st, i) => (
        <article key={st.key} className={styles.mapCard} data-new={i === 0 && !finished}>
          <header>
            <strong>{st.teams[0]} vs {st.teams[1]}</strong>
            <span className={styles.micro}><Split parts={[st.map.toUpperCase(), `MAP ${st.mapNo}`, `${st.score[0]}-${st.score[1]}`]} /></span>
          </header>
          {st.lines.map(l => (
            <div key={l.pid} className={styles.mapLine}>
              <strong>{replay.players[l.pid].handle}</strong>
              <span className={styles.tags}>{l.tags.map(t => <span key={t} className={styles.stamp} data-hot="true">{t}</span>)}</span>
              <span className={styles.pts} data-neg={l.counted < 0}>{l.counted > 0 ? '+' : ''}{l.counted}</span>
            </div>
          ))}
        </article>
      ))}
      <div className={styles.liveActions}>
        {!finished && <button className={styles.secondary} onClick={() => setShown(steps.length)}>SKIP TO RESULT</button>}
        {finished && <button className={styles.primary} onClick={onDone}>SEE THE TABLE</button>}
      </div>
    </section>
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
  const [view, setView] = useState('board'); // board | transfers | broadcast | result
  const [picker, setPicker] = useState(null);
  const [transferNote, setTransferNote] = useState(null); // outcome of the last lock-in's transfers

  useEffect(() => {
    let live = true;
    (async () => {
      const matches = await fetchEventMatches(EVENT_ID);
      if (!live) return;
      if (matches == null) { setStatus('error'); return; }
      const built = buildReplay({ matches, cards, title: 'Champions 2026' });
      setReplay(built);
      if (built.matchdays.length < 2) { setStatus('empty'); return; }
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

  // A new screen should start at the top, not where the last one was scrolled to.
  useEffect(() => { window.scrollTo(0, 0); }, [view]);

  useEffect(() => {
    if (state) saveFantasy({ state, override, totalSteps: state.totalSteps });
  }, [state, override]);

  const ctx = useMemo(() => (replay && state ? ctxFor(replay, state.step) : null), [replay, state]);
  const roleOf = useCallback(pid => replay.players[pid].role, [replay]);
  const squad = useMemo(() => (state ? squadOf(state, 'you') : []), [state]);
  const md = replay && state ? replay.matchdays[Math.min(state.step, replay.matchdays.length - 1)] : null;
  const strengths = useMemo(() => (replay && ctx ? teamStrengths(replay.players, ctx.values) : {}), [replay, ctx]);

  const draft = useMemo(() => {
    if (!state || !ctx) return null;
    const auto = autoLineup(squad, { epOf: pid => ctx.values[pid].ep, roleOf, seriesOf: pid => ctx.seriesNext[pid] ?? 1 });
    return override && validLineup(override, squad, roleOf).ok ? override : auto;
  }, [state, ctx, squad, override, roleOf]);

  // Today's fixtures with the manager's players and the matchup read.
  const fixtures = useMemo(() => {
    if (!md || !replay) return [];
    return md.matches.map(m => {
      const [a, b] = m.teams.map(t => t.tag);
      const sa = strengths[a] ?? 0;
      const sb = strengths[b] ?? 0;
      const mine = squad.filter(pid => [a, b].includes(replay.players[pid].team));
      return { id: m.matchId, a, b, sa, sb, fav: sa === sb ? null : sa > sb ? a : b, bestOf: m.bestOf, mine };
    });
  }, [md, replay, strengths, squad]);

  const fixtureOf = pid => {
    const team = replay.players[pid].team;
    const f = fixtures.find(x => x.a === team || x.b === team);
    if (!f) return null;
    const opp = f.a === team ? f.b : f.a;
    const gap = Math.abs(f.sa - f.sb);
    const verdict = f.fav == null || gap < 1 ? 'EVEN' : f.fav === team ? 'FAVOURITE' : 'UNDERDOG';
    return { opp, verdict, bestOf: f.bestOf };
  };
  const matchupLine = pid => {
    const f = fixtureOf(pid);
    return f
      ? <span className={styles.matchup} data-v={f.verdict}>vs {f.opp}<Split parts={[f.verdict, `BO${f.bestOf}`]} /></span>
      : <span className={styles.matchup} data-v="idle">NO MATCH TODAY</span>;
  };

  // Rivals who plan to bid on a listing, shown only as a coarse read.
  const eyeing = pid => {
    if (!state) return 0;
    return Object.values(state.market.aiPlans).filter(plan => plan.some(c => c.type === 'bid' && c.pid === pid)).length;
  };

  const start = () => {
    clearFantasySave();
    setState(startReplay(replay, { seed: Math.floor(Math.random() * 1e6) }));
    setOverride(null);
    setReveal(null);
    setTransferNote(null);
    setView('board');
    setStatus('play');
  };

  const attempt = fn => {
    try { setState(fn()); setMessage(''); } catch (e) {
      if (e instanceof MarketError) setMessage(e.message); else throw e;
    }
  };

  const slots = draft?.slots ?? {};
  const assign = (slot, pid) => {
    const next = { ...slots, [slot]: pid };
    for (const s of SLOTS) if (s !== slot && next[s] === pid) next[s] = slots[slot];
    const captain = Object.values(next).includes(draft.captain) ? draft.captain : next.D;
    setOverride({ slots: next, bench: [], captain });
    setPicker(null);
  };

  const lockIn = () => {
    const before = { cash: state.cash.you, rank: myRank, points: state.points.you.total };
    const out = playMatchday(state, replay, draft);
    const effective = SLOTS.map(sl => out.results.you.subs.find(x => x.slot === sl)?.in ?? out.locked.you.slots[sl]).filter(p => p != null);
    // Only maps with your players are worth watching.
    const steps = playbackSteps(out.md, effective, out.results.you.captain).filter(st => st.lines.length > 0);
    setReveal({ ...out, before, step: state.step, steps });
    const items = [];
    for (const a of out.report.auctions) {
      const mine = a.bids.find(b => b.mgr === 'you');
      if (!mine) continue;
      items.push(a.winner === 'you'
        ? { kind: 'won', pid: a.pid, text: `You signed ${replay.players[a.pid].handle} for ${fmt(mine.amt)}.` }
        : { kind: 'lost', pid: a.pid, text: `You lost ${replay.players[a.pid].handle}. ${a.winner ? `${nameOf(a.winner)} won him with ${fmt(a.bids[0].amt)}; you bid ${fmt(mine.amt)}.` : 'Nobody could pay for him.'} You were not charged.` });
    }
    for (const sale of out.report.sold.filter(x => x.mgr === 'you')) items.push({ kind: 'sold', pid: sale.pid, text: `You sold ${replay.players[sale.pid].handle} for ${fmt(sale.price)}.` });
    for (const o of out.report.offers) {
      if (state.owner[o.pid] === 'you') items.push({ kind: 'sold', pid: o.pid, text: `You sold ${replay.players[o.pid].handle} to ${nameOf(o.from)} for ${fmt(o.amt)}.` });
    }
    setTransferNote(items);
    setState(out.state);
    setOverride(null);
    setBidText({});
    setPicker(null);
    setView('broadcast');
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
  else if (status === 'empty') body = <p className={styles.note}>Only {replay.matchdays.length} matchday of Champions 2026 is stored so far. Check back soon.</p>;
  else if (status === 'intro') {
    body = (
      <section className={styles.intro}>
        <span className={styles.micro}>REPLAY</span>
        <h2>Champions 2026</h2>
        <p>Relive the tournament as a manager. Every match day you can see the real fixtures, field the players you think will dominate, then watch the matches replay with your points ticking up.</p>
        <ol className={styles.how}>
          <li><strong>Read the board.</strong> Today's real matches, who is favourite, and where your players sit.</li>
          <li><strong>Pick your five and a captain</strong> who scores double.</li>
          <li><strong>Outbid the other managers</strong> for the players you want. Bids are secret.</li>
          <li><strong>Lock in and watch</strong> the real maps play out.</li>
        </ol>
        <button className={styles.primary} onClick={start}>START REPLAY</button>
      </section>
    );
  } else if (state) {
    const done = state.status === 'done';
    // While the broadcast plays, the header keeps the pre-day numbers so it does not spoil the result.
    const hold = view === 'broadcast' && reveal ? reveal.before : null;
    const shownStep = hold ? reveal.step : Math.min(state.step, state.totalSteps - 1);
    const header = (
      <header className={styles.top}>
        <div>
          <span className={styles.micro}>{done && !hold ? 'FINISHED' : `${replay.matchdays[shownStep].label} OF ${state.totalSteps}`}</span>
          <h2>{replay.title}</h2>
        </div>
        <div className={styles.stats}>
          <div><span className={styles.micro}>CREDITS</span><strong>{fmt(hold ? hold.cash : state.cash.you)}</strong></div>
          <div><span className={styles.micro}>RANK</span><strong>{hold ? hold.rank : myRank}/8</strong></div>
          <div><span className={styles.micro}>POINTS</span><strong>{hold ? hold.points : state.points.you.total}</strong></div>
        </div>
      </header>
    );

    const table = (
      <table className={styles.table}>
        <thead><tr><th>#</th><th>MANAGER</th><th>TOTAL</th><th>{reveal ? 'THIS DAY' : 'DAY WINS'}</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} data-you={r.id === 'you'}>
              <td>{i + 1}</td><td>{nameOf(r.id)}</td><td>{r.total}</td><td>{reveal ? (reveal.results[r.id]?.total ?? 0) : r.wins}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );

    const bidsPlaced = Object.keys(state.market.bids.you).length + (state.market.sales.you?.length ?? 0);

    // What happened to your last bids and sales, shown until you dismiss it.
    const noteBox = transferNote && transferNote.length > 0 && (
      <section className={styles.note2} role="status">
        <div className={styles.noteHead}>
          <h3>LAST DAY'S TRANSFERS</h3>
          <button className={styles.secondary} onClick={() => setTransferNote(null)}>DISMISS</button>
        </div>
        {transferNote.map(item => (
          <p key={`${item.kind}-${item.pid}`} className={styles.noteLine} data-kind={item.kind}>{item.text}</p>
        ))}
      </section>
    );

    // Pending bids with the risk spelled out.
    const pendingBids = Object.entries(state.market.bids.you);
    const pendingBox = (
      <section className={styles.pending}>
        <h4>YOUR PENDING BIDS</h4>
        <p className={styles.help}>Nothing is decided yet. <strong>Bids resolve when you lock in</strong>, after your team is set. If another manager bids more, you lose him and are not charged. You will see the result right after the matches.</p>
        {pendingBids.length === 0 && <p className={styles.note}>No bids placed yet.</p>}
        {pendingBids.map(([pid, amt]) => {
          const heat = eyeing(Number(pid));
          return (
            <p key={pid} className={styles.noteLine} data-kind={heat > 0 ? 'risk' : 'ok'}>
              {replay.players[pid].handle}: your bid {fmt(amt)}.{' '}
              {heat > 0 ? `${heat} rival${heat > 1 ? 's are' : ' is'} also going for him. Bid higher to be safe.` : 'No rival is going for him right now.'}
            </p>
          );
        })}
      </section>
    );

    const board = (
      <>
        {noteBox}
        <section className={styles.panel}>
          <h3>TODAY'S MATCHES</h3>
          <div className={styles.fixtures}>
            {fixtures.map(f => (
              <div key={f.id} className={styles.fixture} data-mine={f.mine.length > 0}>
                <div className={styles.teams}>
                  <span data-fav={f.fav === f.a}>{f.a}</span>
                  <span className={styles.micro}>VS</span>
                  <span data-fav={f.fav === f.b}>{f.b}</span>
                </div>
                <span className={styles.micro}>{`STRENGTH ${f.sa.toFixed(0)}  ${f.sb.toFixed(0)}`}</span>
                <span className={styles.micro}>BO{f.bestOf}</span>
                {f.mine.length > 0 && <span className={styles.stamp} data-hot="true">{f.mine.length} OF YOURS</span>}
              </div>
            ))}
          </div>
          <p className={styles.help}>Strength is the average points per map of each team's best five. The bolder team is the favourite.</p>
        </section>

        <section className={styles.panel}>
          <h3>YOUR FIVE</h3>
          {SLOTS.map(slot => {
            const pid = slots[slot];
            if (pid == null) return <p key={slot} className={styles.note}>{SLOT_LABEL[slot]}: no player available</p>;
            const isCap = draft?.captain === pid;
            const options = squad.filter(x => !ROLE_FOR[slot] || roleOf(x) === ROLE_FOR[slot]);
            return (
              <div key={slot} className={styles.slotCard}>
                <span className={styles.micro}>{SLOT_LABEL[slot]}</span>
                <PlayerLine player={replay.players[pid]} value={ctx.values[pid]} sub={matchupLine(pid)}>
                  <div className={styles.slotTools}>
                    <button className={styles.secondary} onClick={() => setPicker(picker === slot ? null : slot)}>{picker === slot ? 'CLOSE' : 'SWAP'}</button>
                    <button className={styles.secondary} data-on={isCap} onClick={() => setOverride({ ...draft, captain: pid })}>{isCap ? 'CAPTAIN x2' : 'CAPTAIN'}</button>
                  </div>
                </PlayerLine>
                {picker === slot && (
                  <div className={styles.picker}>
                    {options.filter(x => x !== pid).length === 0 && <p className={styles.note}>No other eligible player. Buy one in Transfers.</p>}
                    {options.filter(x => x !== pid).map(x => (
                      <button key={x} className={styles.pick} onClick={() => assign(slot, x)}>
                        <strong>{replay.players[x].handle}</strong>
                        {matchupLine(x)}
                        <span className={styles.micro}>AVG {ctx.values[x].ep.toFixed(0)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {(draft?.bench ?? []).length > 0 && <h4>BENCH</h4>}
          {(draft?.bench ?? []).map(pid => (
            <PlayerLine key={pid} player={replay.players[pid]} value={ctx.values[pid]} sub={matchupLine(pid)} />
          ))}
        </section>

        <section className={styles.panel}>
          <h3>STANDINGS</h3>
          {table}
        </section>

        <div className={styles.actions}>
          <button className={styles.secondary} onClick={() => setView('transfers')}>TRANSFERS{bidsPlacedBadge(bidsPlaced)}</button>
          <button className={styles.primary} onClick={lockIn}>LOCK IN AND WATCH {md.label}</button>
        </div>
      </>
    );

    const transfers = (
      <>
        {noteBox}
        <section className={styles.panel}>
          <p className={styles.help}>Place secret bids on players. A <strong>RIVALS EYEING</strong> tag means another manager plans to bid on him too, so you will need to bid more than the market value to win. The highest bid wins and you only pay if you win.</p>
          {pendingBox}
          {state.market.offers.length > 0 && <h4>A RIVAL WANTS ONE OF YOUR PLAYERS</h4>}
          {state.market.offers.map(o => (
            <PlayerLine key={o.id} player={replay.players[o.pid]} sub={<span className={styles.micro}>{nameOf(o.from)} offers {fmt(o.amt)}</span>}>
              <button className={styles.secondary} disabled={o.accepted} onClick={() => attempt(() => acceptOffer(state, o.id))}>{o.accepted ? 'SELLING' : 'SELL TO THEM'}</button>
            </PlayerLine>
          ))}
          <h4>ON THE MARKET</h4>
          {state.market.listings.map(l => {
            const p = replay.players[l.pid];
            const placed = state.market.bids.you[l.pid];
            const heat = eyeing(l.pid);
            const flags = (
              <span className={styles.flags}>
                {matchupLine(l.pid)}
                {ctx.values[l.pid].form >= 3 && <span className={styles.stamp} data-hot="false">IN FORM</span>}
                {heat > 0 && <span className={styles.stamp} data-hot="true">RIVALS EYEING</span>}
              </span>
            );
            return (
              <PlayerLine key={l.pid} player={p} value={ctx.values[l.pid]} sub={flags}>
                {placed
                  ? <button className={styles.secondary} onClick={() => attempt(() => cancelBid(state, 'you', l.pid))}>BID {fmt(placed)}  CANCEL</button>
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
          <h4>YOUR SQUAD</h4>
          <p className={styles.help}>Selling pays their value when you lock in. Squads hold at most {state.squadMax} players.</p>
          {squad.map(pid => {
            const queued = state.market.sales.you?.includes(pid);
            return (
              <PlayerLine key={pid} player={replay.players[pid]} value={ctx.values[pid]} sub={matchupLine(pid)}>
                <button className={styles.secondary} disabled={queued} onClick={() => attempt(() => queueSale(state, 'you', pid))}>{queued ? 'WILL SELL' : 'SELL'}</button>
              </PlayerLine>
            );
          })}
        </section>
        <div className={styles.actions}>
          <button className={styles.primary} onClick={() => setView('board')}>BACK TO THE BOARD</button>
        </div>
      </>
    );

    const result = reveal && (
      <section className={styles.panel}>
        <h3>{replay.matchdays[reveal.step].label} RESULT</h3>
        <p className={styles.big}>You scored <strong>{reveal.results.you.total}</strong> points</p>
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
        {table}
        <button className={styles.primary} onClick={() => { setReveal(null); setView('board'); }}>
          {done ? 'SEE FINAL RESULT' : `CONTINUE TO MATCHDAY ${state.step + 1}`}
        </button>
      </section>
    );

    const final = (
      <section className={styles.panel}>
        <h3>FINAL STANDINGS</h3>
        <p className={styles.big}>You finished <strong>{myRank}</strong> of 8</p>
        {table}
        <button className={styles.primary} onClick={start}>PLAY AGAIN</button>
      </section>
    );

    let main = board;
    if (view === 'broadcast' && reveal) main = <Broadcast steps={reveal.steps} replay={replay} onDone={() => setView('result')} />;
    else if (view === 'result' && reveal) main = result;
    else if (done) main = final;
    else if (view === 'transfers') main = transfers;

    body = <>{header}{main}</>;
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

function bidsPlacedBadge(n) {
  return n > 0 ? `  (${n})` : '';
}
