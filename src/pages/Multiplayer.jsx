import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import NavHeader from '../components/NavHeader';
import PlayerCard from '../components/PlayerCard';
import cards from '../data/cards.json';
import { connectLobby, createLobby, joinLobby, loadSession, makeCommand } from '../lib/multiplayerClient';
import { assetPath } from '../lib/utils';
import styles from './Multiplayer.module.css';

const cardMap = new Map(cards.map(card => [card.id, card]));

export default function Multiplayer() {
  const { code: routeCode } = useParams();
  const navigate = useNavigate();
  const [screen, setScreen] = useState(routeCode ? 'room' : 'menu');
  const [code, setCode] = useState(routeCode ?? '');
  const [name, setName] = useState('');
  const [settings, setSettings] = useState({ gameLength: 'year', unboxing: 'normal' });
  const [session, setSession] = useState(() => routeCode ? loadSession(routeCode) : null);
  const [snapshot, setSnapshot] = useState(null);
  const [status, setStatus] = useState('disconnected');
  const [error, setError] = useState('');
  const [animationEvent, setAnimationEvent] = useState(null);
  const socketRef = useRef(null);

  useEffect(() => {
    if (!routeCode || !session?.sessionToken) return;
    let reconnectTimer;
    let stopped = false;
    const open = () => {
      socketRef.current = connectLobby(routeCode, session.sessionToken, message => {
        if (message.snapshot) setSnapshot(message.snapshot);
        const roundEvent = message.events?.find(event => event.type === 'round_advance');
        if (roundEvent) setAnimationEvent(roundEvent);
        if (message.type === 'command_rejected') setError(message.message);
      }, nextStatus => {
        setStatus(nextStatus);
        if (nextStatus === 'disconnected' && !stopped) reconnectTimer = setTimeout(open, 1500);
      });
    };
    open();
    return () => {
      stopped = true;
      clearTimeout(reconnectTimer);
      socketRef.current?.close();
    };
  }, [routeCode, session?.sessionToken]);

  async function handleCreate(event) {
    event.preventDefault();
    setError('');
    try {
      const result = await createLobby({ squadName: name, settings });
      setSession(result);
      navigate(`/lobby/${result.lobbyCode}`);
      setScreen('room');
    } catch (err) { setError(err.message); }
  }

  async function handleJoin(event) {
    event.preventDefault();
    setError('');
    try {
      const normalized = code.toUpperCase();
      const result = await joinLobby(normalized, { squadName: name });
      setSession(result);
      navigate(`/lobby/${normalized}`);
      setScreen('room');
    } catch (err) { setError(err.message); }
  }

  function send(type, payload) {
    if (!snapshot || socketRef.current?.readyState !== WebSocket.OPEN) return;
    socketRef.current.send(JSON.stringify(makeCommand(type, snapshot, payload)));
  }

  if (routeCode && !session) {
    return (
      <main className={styles.page}>
        <NavHeader right={`Lobby ${routeCode}`} />
        <section className={styles.hero}>
          <span className={styles.kicker}>Join lobby {routeCode}</span>
          <h1>Enter your<br /><em>squad</em></h1>
          <form className={styles.panel} onSubmit={handleJoin}>
            <NameInput value={name} onChange={setName} />
            <button className={styles.primary}>Join lobby</button>
          </form>
          {error && <p className={styles.error}>{error}</p>}
        </section>
      </main>
    );
  }

  if (!routeCode || screen !== 'room') {
    return (
      <main className={styles.page}>
        <NavHeader right="Multiplayer" />
        <section className={styles.hero}>
          <span className={styles.kicker}>2–16 squads · live draft · shared bracket</span>
          <h1>Multiplayer<br /><em>Lock-In</em></h1>
          <div className={styles.paths}>
            <form className={styles.panel} onSubmit={handleCreate}>
              <h2>Create lobby</h2>
              <NameInput value={name} onChange={setName} />
              <Toggle label="Game length" value={settings.gameLength} options={[['year', 'Year'], ['endless', 'Endless']]} onChange={value => setSettings({ ...settings, gameLength: value })} />
              <Toggle label="Unboxing" value={settings.unboxing} options={[['normal', 'Normal'], ['enc', 'ENC']]} onChange={value => setSettings({ ...settings, unboxing: value })} />
              <button className={styles.primary}>Create private lobby</button>
            </form>
            <form className={styles.panel} onSubmit={handleJoin}>
              <h2>Join lobby</h2>
              <label>Lobby code<input value={code} onChange={event => setCode(event.target.value.replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase())} placeholder="ABC234" required /></label>
              <NameInput value={name} onChange={setName} />
              <button className={styles.primary}>Join lobby</button>
            </form>
          </div>
          {error && <p className={styles.error}>{error}</p>}
        </section>
      </main>
    );
  }

  return <LobbyRoom snapshot={snapshot} session={session} status={status} error={error} send={send} animationEvent={animationEvent} clearAnimation={() => setAnimationEvent(null)} />;
}

function LobbyRoom({ snapshot, session, status, error, send, animationEvent, clearAnimation }) {
  if (!snapshot) return <main className={styles.page}><NavHeader right={status} /><div className={styles.loading}>Connecting to lobby…</div></main>;
  const myId = session.competitorId ?? session.spectatorId;
  const me = snapshot.competitors.find(player => player.id === myId);
  const isHost = snapshot.hostId === myId;
  const activeId = snapshot.draft?.activeCompetitorId ?? snapshot.consolation?.activeCompetitorId;
  const offers = snapshot.phase === 'draft' ? snapshot.draft?.offers : snapshot.consolation?.offers;
  const active = snapshot.competitors.find(player => player.id === activeId);

  return (
    <main className={styles.page}>
      <NavHeader right={`${snapshot.code} · ${status}`} />
      <header className={styles.roomHeader}>
        <div><span className={styles.kicker}>Private lobby</span><h1>{snapshot.code}</h1></div>
        <div className={styles.meta}><b>{snapshot.settings.gameLength}</b><span>{snapshot.settings.unboxing} packs</span><span>{snapshot.competitors.length}/16 squads</span></div>
      </header>
      {error && <p className={styles.error}>{error}</p>}

      {snapshot.phase === 'lobby' && (
        <section className={styles.lobbyGrid}>
          <div><h2>Competitors</h2><RosterList snapshot={snapshot} isHost={isHost} myId={myId} send={send} /></div>
          <aside className={styles.rules}><h2>Ready check</h2><p>Five snake-draft rounds. Cards are unique across the lobby. Late arrivals spectate once the host starts.</p>{isHost ? <button className={styles.primary} disabled={snapshot.competitors.length < 2} onClick={() => send('start_game')}>Start game</button> : <span>Waiting for the host</span>}</aside>
        </section>
      )}

      {(snapshot.phase === 'draft' || snapshot.phase === 'consolation') && (
        <section className={styles.draftStage}>
          <span className={styles.kicker}>{snapshot.phase === 'draft' ? `Draft pick ${(snapshot.draft.turnIndex ?? 0) + 1}/${snapshot.draft.turns.length}` : 'Consolation unboxing'}</span>
          <h2>{active?.squadName} is opening</h2>
          {(snapshot.draft?.nation || snapshot.consolation?.nation) && <p className={styles.nation}>{snapshot.draft?.nation ?? snapshot.consolation?.nation}</p>}
          <div className={styles.cards}>{offers?.map(id => <PlayerCard key={id} card={cardMap.get(id)} displayScale={0.38} onClick={activeId === myId ? () => send('choose_card', { cardId: id }) : undefined} selected={snapshot.consolation?.selectedCardId === id} />)}</div>
          {snapshot.phase === 'consolation' && activeId === myId && snapshot.consolation.selectedCardId && <SwapStrip me={me} send={send} />}
          {snapshot.phase === 'consolation' && activeId === myId && <button className={styles.secondary} onClick={() => send('skip_consolation')}>Skip pack</button>}
          <Deadline deadlineAt={snapshot.draft?.deadlineAt ?? snapshot.consolation?.deadlineAt} serverNow={snapshot.serverNow} />
        </section>
      )}

      {snapshot.phase === 'igl_select' && <IglSelect me={me} selected={snapshot.draft.iglSelections[myId]} onChoose={id => send('choose_igl', { cardId: id })} deadlineAt={snapshot.draft.deadlineAt} serverNow={snapshot.serverNow} spectator={!me} />}

      {(snapshot.phase === 'tournament' || snapshot.phase === 'match_transition') && snapshot.tournament && (
        <section>
          <div className={styles.eventTitle}><span>{snapshot.tournament.meta.label}</span><b>{snapshot.tournament.rounds[snapshot.tournament.roundIdx].label}</b></div>
          <MultiplayerBracket tournament={snapshot.tournament} animationEvent={animationEvent} onAnimationDone={clearAnimation} />
          {snapshot.settings.gameLength === 'endless' && isHost && <button className={styles.endless} onClick={() => send('end_endless')}>End Endless after this event</button>}
        </section>
      )}

      {snapshot.phase === 'season_over' && <Standings snapshot={snapshot} isHost={isHost} send={send} />}
      {snapshot.phase === 'match_transition' && <TimerBar pending={snapshot.pendingTransition} serverNow={snapshot.serverNow} isHost={isHost} onAdvance={() => send('advance_early')} />}
    </main>
  );
}

function RosterList({ snapshot, isHost, myId, send }) {
  return <div className={styles.rosterList}>{snapshot.competitors.map((player, index) => <div key={player.id} className={styles.rosterRow}><span>{index + 1}</span><b>{player.squadName}{player.id === myId ? ' · YOU' : ''}</b><i className={player.connected ? styles.online : styles.offline}>{player.connected ? 'online' : 'offline'}</i>{player.id === snapshot.hostId && <em>HOST</em>}{isHost && player.id !== myId && <button onClick={() => send('kick_player', { competitorId: player.id })}>Remove</button>}</div>)}</div>;
}

function IglSelect({ me, selected, onChoose, deadlineAt, serverNow, spectator }) {
  return <section className={styles.draftStage}><span className={styles.kicker}>Concurrent selection</span><h2>Choose your IGL</h2>{spectator ? <p>Competitors are choosing their callers.</p> : <div className={styles.cards}>{me.rosterIds.map(id => <PlayerCard key={id} card={cardMap.get(id)} displayScale={0.34} selected={selected === id} onClick={() => onChoose(id)} />)}</div>}<Deadline deadlineAt={deadlineAt} serverNow={serverNow} /></section>;
}

function SwapStrip({ me, send }) {
  return <div className={styles.swap}><span>Choose who leaves</span>{me.rosterIds.map(id => <button key={id} onClick={() => send('choose_swap', { replaceCardId: id })}>{cardMap.get(id)?.player}</button>)}</div>;
}

function Standings({ snapshot, isHost, send }) {
  const rows = Object.values(snapshot.season.standings).sort((a, b) => b.score - a.score || b.titles - a.titles);
  return <section className={styles.standings}><span className={styles.kicker}>Season complete</span><h1>Final standings</h1>{rows.map((row, index) => <div key={row.competitorId}><span>{index + 1}</span><b>{row.squadName}</b><span>{row.titles} titles</span><span>{row.matchWins} wins</span><strong>{row.score}</strong></div>)}{isHost && <button className={styles.primary} onClick={() => send('return_to_lobby')}>Return everyone to lobby</button>}</section>;
}

function MultiplayerBracket({ tournament, animationEvent, onAnimationDone }) {
  const refs = useRef({});
  const overlayRef = useRef(null);
  const wrapRef = useRef(null);
  useLayoutEffect(() => {
    if (!animationEvent?.moves?.length) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches || matchMedia('(max-width: 680px)').matches;
    if (reduced) { onAnimationDone(); return; }
    const wrap = wrapRef.current;
    const overlay = overlayRef.current;
    const base = wrap?.getBoundingClientRect();
    if (!wrap || !overlay || !base) { onAnimationDone(); return; }
    const cleanups = [];
    const animations = animationEvent.moves.map(move => {
      const source = refs.current[move.sourceSlot]?.querySelector(`[data-team-id="${CSS.escape(move.teamId)}"]`);
      const destination = refs.current[move.destinationSlot]?.querySelector(`[data-team-id="${CSS.escape(move.teamId)}"]`);
      if (!source || !destination) return Promise.resolve();
      const a = source.getBoundingClientRect();
      const b = destination.getBoundingClientRect();
      const clone = source.cloneNode(true);
      clone.classList.add(styles.travelClone);
      clone.style.width = `${a.width}px`;
      clone.style.height = `${a.height}px`;
      overlay.appendChild(clone);
      source.style.visibility = 'hidden';
      destination.style.visibility = 'hidden';
      cleanups.push(() => { clone.remove(); source.style.visibility = ''; destination.style.visibility = ''; });
      const x0 = a.left - base.left, y0 = a.top - base.top, x1 = b.left - base.left, y1 = b.top - base.top;
      const bridge = x0 + (x1 - x0) / 2;
      return clone.animate([
        { transform: `translate(${x0}px, ${y0}px)` },
        { transform: `translate(${bridge}px, ${y0}px)`, offset: .35 },
        { transform: `translate(${bridge}px, ${y1}px)`, offset: .65 },
        { transform: `translate(${x1}px, ${y1}px)` },
      ], { duration: 900, easing: 'cubic-bezier(.5,0,.2,1)', fill: 'forwards' }).finished.catch(() => {});
    });
    Promise.all(animations).then(() => { cleanups.forEach(fn => fn()); onAnimationDone(); });
    return () => cleanups.forEach(fn => fn());
  }, [animationEvent, onAnimationDone]);

  return <div className={styles.bracketWrap} ref={wrapRef}><div className={styles.bracket}>{tournament.rounds.map(round => <div className={styles.round} key={round.key}><h3>{round.label}</h3>{round.matches.map((match, index) => <div className={styles.match} key={match.id} ref={el => { refs.current[`${round.key}:${index}`] = el; }}>{[match.a, match.b].map(teamId => { const team = tournament.teams[teamId]; return <div key={teamId} data-team-id={teamId} className={match.winner === teamId ? styles.winner : ''}><span>{tournament.seeds.indexOf(teamId) + 1}</span>{team.logo && <img src={assetPath(team.logo)} alt="" />}<b>{team.tag}</b><strong>{match.maps ? (match.a === teamId ? match.scoreA : match.scoreB) : ''}</strong></div>; })}</div>)}</div>)}</div><div className={styles.travelOverlay} ref={overlayRef} /></div>;
}

function TimerBar({ pending, serverNow, isHost, onAdvance }) {
  const [remaining, setRemaining] = useState(10_000);
  useEffect(() => {
    const skew = Date.now() - serverNow;
    const tick = () => setRemaining(Math.max(0, pending.deadlineAt - (Date.now() - skew)));
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [pending.deadlineAt, serverNow]);
  const progress = remaining / 10_000;
  return <div className={styles.timerDock}><button onClick={isHost ? onAdvance : undefined} disabled={!isHost} style={{ '--remaining': progress }}><span>{isHost ? 'Play next match' : 'Next match'} · {Math.ceil(remaining / 1000)}s</span></button></div>;
}

function Deadline({ deadlineAt, serverNow }) {
  const [remaining, setRemaining] = useState(30_000);
  useEffect(() => {
    const skew = Date.now() - serverNow;
    const tick = () => setRemaining(Math.max(0, deadlineAt - (Date.now() - skew)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [deadlineAt, serverNow]);
  return <span className={styles.deadline}>{Math.ceil(remaining / 1000)}s remaining</span>;
}

function NameInput({ value, onChange }) { return <label>Squad name<input value={value} onChange={event => onChange(event.target.value.slice(0, 28))} maxLength={28} placeholder="Brisbane Bandits" required /></label>; }

function Toggle({ label, value, options, onChange }) { return <fieldset><legend>{label}</legend><div className={styles.toggle}>{options.map(([key, text]) => <button type="button" key={key} className={value === key ? styles.active : ''} onClick={() => onChange(key)}>{text}</button>)}</div></fieldset>; }
