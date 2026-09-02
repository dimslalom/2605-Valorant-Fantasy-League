import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { m } from 'motion/react';
import { DUR, EASE, STAGGER } from '../lib/motion';
import ModeRail from '../components/ModeRail';
import CardFocusOverlay from '../components/CardFocusOverlay';
import SquadBar from '../components/SquadBar';
import SquadDock from '../components/SquadDock';
import SquadSheet from '../components/SquadSheet';
import PackRip from '../components/PackRip';
import TacticalButton from '../components/TacticalButton';
import cards from '../data/cards.json';
import { ROSTER_SIZE, teamPower } from '../engine/perfectRun';
import { connectLobby, createLobby, joinLobby, loadSession, makeCommand } from '../lib/multiplayerClient';
import { assetPath, countryName } from '../lib/utils';
import useReducedMotion from '../lib/useReducedMotion';
import styles from './Multiplayer.module.css';
import hub from '../styles/hub.module.css';
import soloStyles from './PerfectRun.module.css';

const cardMap = new Map(cards.map(card => [card.id, card]));
// Stable empty-Set default so MultiplayerBracketCell's pending-arrival check
// never needs a fresh Set() on every render of every non-traveling cell.
const EMPTY_TEAM_ID_SET = new Set();

export default function Multiplayer() {
  const { code: routeCode } = useParams();
  const navigate = useNavigate();
  const [screen, setScreen] = useState(routeCode ? 'room' : 'menu');
  const [code, setCode] = useState(routeCode ?? '');
  const [name, setName] = useState('');
  const [settings, setSettings] = useState({ gameLength: 'year', unboxing: 'normal' });
  const [session, setSession] = useState(() => routeCode ? loadSession(routeCode) : null);
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState('');
  const [animationEvent, setAnimationEvent] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const socketRef = useRef(null);
  const clearAnimation = useCallback(() => setAnimationEvent(null), []);

  useEffect(() => {
    if (!routeCode || !session?.sessionToken) return;
    let reconnectTimer;
    let stopped = false;
    let reconnectAttempt = 0;
    const open = () => {
      setConnectionStatus(reconnectAttempt ? 'reconnecting' : 'connecting');
      socketRef.current = connectLobby(routeCode, session.sessionToken, message => {
        if (message.snapshot) setSnapshot(message.snapshot);
        const roundEvent = message.events?.find(event => event.type === 'round_advance');
        if (roundEvent) setAnimationEvent(roundEvent);
        if (message.type === 'command_rejected') setError(message.message);
      }, nextStatus => {
        if (nextStatus === 'connected') {
          reconnectAttempt = 0;
          setConnectionStatus('connected');
          return;
        }
        if (stopped) return;
        if (nextStatus === 'error') setConnectionStatus('failed');
        if (nextStatus === 'disconnected') {
          reconnectAttempt += 1;
          setConnectionStatus(reconnectAttempt > 4 ? 'failed' : 'reconnecting');
          reconnectTimer = setTimeout(open, Math.min(1000 * 2 ** (reconnectAttempt - 1), 8000));
        }
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
    if (!snapshot || socketRef.current?.readyState !== WebSocket.OPEN) {
      setError('The lobby is offline. Your command was not sent; reconnect and try again.');
      return;
    }
    setError('');
    socketRef.current.send(JSON.stringify(makeCommand(type, snapshot, payload)));
  }

  if (routeCode && !session) {
    return (
      <main className={styles.page}>
        <ModeRail />
        <section className={hub.column}>
          <div className={hub.title}>
            <h1 className={hub.titleText}>Enter your<br /><em>squad</em></h1>
          </div>
          <div className={hub.body}>
            <form className={styles.panel} onSubmit={handleJoin}>
              <h2>Join lobby {routeCode}</h2>
              <NameInput value={name} onChange={setName} />
              <button className={styles.primary}>Join lobby</button>
            </form>
          </div>
          {error && <p className={styles.error} role="alert">{error}</p>}
        </section>
      </main>
    );
  }

  if (!routeCode || screen !== 'room') {
    return (
      <main className={styles.page}>
        <ModeRail />
        <section className={hub.column}>
          <div className={hub.title}>
            <h1 className={hub.titleText}>GAUNTLET<br /><em>Multiplayer</em></h1>
          </div>
          <div className={hub.body}>
            <form className={styles.panel} onSubmit={handleCreate}>
              <h2>Create lobby</h2>
              <NameInput value={name} onChange={setName} />
              <Toggle label="Game length" value={settings.gameLength} options={[['year', 'Year'], ['endless', 'Endless']]} onChange={value => setSettings({ ...settings, gameLength: value })} />
              <Toggle label="Unboxing" value={settings.unboxing} options={[['normal', 'Normal'], ['enc', 'National packs']]} onChange={value => setSettings({ ...settings, unboxing: value })} />
              <button className={styles.primary}>Create private lobby</button>
            </form>
            <form className={styles.panel} onSubmit={handleJoin}>
              <h2>Join lobby</h2>
              <label>Lobby code<input value={code} onChange={event => setCode(event.target.value.replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase())} placeholder="ABC234" required /></label>
              <NameInput value={name} onChange={setName} />
              <button className={styles.primary}>Join lobby</button>
            </form>
          </div>
          {error && <p className={styles.error} role="alert">{error}</p>}
        </section>
      </main>
    );
  }

  return <LobbyRoom snapshot={snapshot} session={session} error={error} send={send} animationEvent={animationEvent} clearAnimation={clearAnimation} connectionStatus={connectionStatus} />;
}

function LobbyRoom({ snapshot, session, error, send, animationEvent, clearAnimation, connectionStatus }) {
  // Squad chip -> single-card focus overlay; SQUAD button / manual dismiss
  // of an optional pinned action. Declared unconditionally (Rules of Hooks)
  // even though the "connecting…" branch below doesn't need any of them yet.
  const [focusCard, setFocusCard] = useState(null);
  const [sheetTapOpen, setSheetTapOpen] = useState(false);
  const [sheetDismissed, setSheetDismissed] = useState(false);

  const myId = snapshot && (session.competitorId ?? session.spectatorId);
  const me = snapshot?.competitors.find(player => player.id === myId);
  const isHost = snapshot?.hostId === myId;
  const activeId = snapshot?.draft?.activeCompetitorId ?? snapshot?.consolation?.activeCompetitorId;
  const offers = snapshot?.phase === 'draft' ? snapshot.draft?.offers : snapshot?.consolation?.offers;
  const active = snapshot?.competitors.find(player => player.id === activeId);

  // My squad, always — regardless of whose turn it is. The draft/consolation
  // stage shows whoever is currently opening a pack (often not me); the dock
  // is a fixed "this is you", visible from the first pick through the
  // season's final standings.
  const dockRoster = me ? me.rosterIds.map(id => cardMap.get(id)).filter(Boolean) : [];
  const dockPower = dockRoster.length === ROSTER_SIZE ? teamPower(dockRoster, me?.iglId) : null;
  const dockVisible = Boolean(snapshot) && snapshot.phase !== 'lobby' && dockRoster.length > 0;

  // Consolation swaps reuse the same squad selection surface as IGL choice.
  const consolationSelected = snapshot?.phase === 'consolation' && activeId === myId && Boolean(snapshot.consolation?.selectedCardId);

  // Shaped for the SquadSheet contract — clicking an eligible card fires the
  // pick directly, no separate per-card button needed.
  const squadAction = snapshot?.phase === 'igl_select' && me
    ? {
        prompt: 'Choose your in-game leader',
        onPick: (card) => send('choose_igl', { cardId: card.id }),
        isEligible: (card) => card.id !== me.iglId,
        dismissible: false,
        confirmPrompt: (card) => `Name ${card.player} as IGL?`,
      }
    : consolationSelected
      ? {
          prompt: 'Choose who leaves',
          onPick: (card) => send('choose_swap', { replaceCardId: card.id }),
          dismissible: true,
          confirmPrompt: (card) => `Swap out ${card.player}?`,
        }
      : null;

  // Same three phase actions, shaped for the single-card focus overlay
  // (opened from a dock chip) instead — a button rather than a bare click,
  // matching the overlay's existing action/onAction contract.
  function chipActionLabel(card) {
    if (snapshot?.phase === 'igl_select' && me) {
      return card.id === me.iglId ? { label: 'Current IGL', disabled: true } : { label: 'Name as IGL' };
    }
    if (consolationSelected) return { label: 'Swap out' };
    return null;
  }
  function runChipAction(card) {
    if (!card) return;
    if (snapshot?.phase === 'igl_select' && me) { if (card.id !== me.iglId) send('choose_igl', { cardId: card.id }); return; }
    if (consolationSelected) send('choose_swap', { replaceCardId: card.id });
  }

  // Identifies *which* pin is asking, so a dismiss can be scoped to it and a
  // dismissed sheet becomes pinnable again the moment the trigger changes.
  const pinTrigger = snapshot?.phase === 'igl_select' && me && !me.iglId
    ? 'igl'
    : consolationSelected
      ? `consolation:${snapshot.consolation.selectedCardId}`
      : null;

  // Adjusted during render (React's documented pattern for "reset on prop
  // change"), matching CardFocusOverlay's own flip-reset idiom.
  const prevPinTrigger = useRef(pinTrigger);
  if (prevPinTrigger.current !== pinTrigger) {
    prevPinTrigger.current = pinTrigger;
    if (sheetDismissed) setSheetDismissed(false);
  }
  const prevPhaseForSheet = useRef(snapshot?.phase);
  if (prevPhaseForSheet.current !== snapshot?.phase) {
    prevPhaseForSheet.current = snapshot?.phase;
    if (sheetTapOpen) setSheetTapOpen(false);
  }
  const sheetPinned = Boolean(pinTrigger) && !sheetDismissed;
  const sheetOpen = dockVisible && (sheetPinned || sheetTapOpen);

  function closeSquadSheet() {
    setSheetTapOpen(false);
    setSheetDismissed(true);
  }

  if (!snapshot) return <main className={styles.page}><ModeRail /><div className={styles.loading} role="status">{connectionStatus === 'failed' ? 'Connection failed. Retrying…' : connectionStatus === 'reconnecting' ? 'Reconnecting to lobby…' : 'Connecting to lobby…'}</div></main>;

  // TimerBar is its own fixed bottom banner; when it's up, it sits ABOVE the
  // squad bar (see .timerDock's bottom offset) rather than the two competing
  // for the same strip, so the page needs to clear both stacked.
  const timerVisible = (snapshot.phase === 'match_ready' && !animationEvent && Boolean(snapshot.pendingTransition))
    || snapshot.phase === 'match_transition';

  return (
    <main className={[styles.page, dockVisible ? styles.withDock : '', timerVisible ? styles.withTimer : ''].join(' ')}>
      <ModeRail />
      <header className={styles.roomHeader}>
        <div><span className={styles.kicker}>Private lobby</span><h1>{snapshot.code}</h1></div>
        <div className={styles.meta}><b>{snapshot.settings.gameLength}</b>{snapshot.season && <span>Year {snapshot.season.year} · Tournament {snapshot.season.eventIndex + 1}/3</span>}<span>{snapshot.settings.unboxing === 'enc' ? 'National' : 'Normal'} packs</span><span>{snapshot.competitors.length}/16 squads</span></div>
      </header>
      {connectionStatus !== 'connected' && <p className={styles.connection} role="status">{connectionStatus === 'failed' ? 'Connection failed — retrying automatically. Commands are paused.' : 'Reconnecting — commands are paused until the lobby is back online.'}</p>}
      {error && <p className={styles.error}>{error}</p>}

      {snapshot.phase === 'lobby' && (
        <section className={styles.lobbyGrid}>
          <div><h2>Competitors</h2><RosterList snapshot={snapshot} isHost={isHost} myId={myId} send={send} /></div>
          <aside className={styles.rules}><h2>Ready check</h2><p>Five snake-draft rounds. Cards are unique across the lobby. Late arrivals spectate once the host starts.</p>{isHost ? <TacticalButton className={styles.primary} disabled={snapshot.competitors.length < 2} onClick={() => send('start_game')}>Start game</TacticalButton> : <span>Waiting for the host</span>}</aside>
        </section>
      )}

      {(snapshot.phase === 'draft' || snapshot.phase === 'consolation') && (
        <section className={styles.draftStage}>
          <span className={styles.kicker}>{snapshot.phase === 'draft' ? `Draft pick ${(snapshot.draft.turnIndex ?? 0) + 1}/${snapshot.draft.turns.length}` : 'Consolation unboxing'}</span>
          <h2>{active?.squadName} is opening</h2>
          <MultiplayerDraftLane
            phase={snapshot.phase}
            turnIndex={snapshot.draft?.turnIndex ?? snapshot.consolation?.turnIndex ?? 0}
            totalTurns={snapshot.draft?.turns.length ?? snapshot.consolation?.order.length ?? 0}
            nation={snapshot.draft?.nation ?? snapshot.consolation?.nation}
            choices={(offers ?? []).map(id => cardMap.get(id)).filter(Boolean)}
            picks={active?.rosterIds.map(id => cardMap.get(id)).filter(Boolean) ?? []}
            selectedId={snapshot.consolation?.selectedCardId}
            interactive={activeId === myId}
            onPick={card => send('choose_card', { cardId: card.id })}
            squadName={active?.squadName ?? 'Squad'}
          />
          {snapshot.phase === 'consolation' && activeId === myId && <TacticalButton className={styles.secondary} onClick={() => send('skip_consolation')}>Skip pack</TacticalButton>}
          <Deadline deadlineAt={snapshot.draft?.deadlineAt ?? snapshot.consolation?.deadlineAt} serverNow={snapshot.serverNow} />
        </section>
      )}

      {snapshot.phase === 'igl_select' && (
        <section className={styles.draftStage}>
          <span className={styles.kicker}>Concurrent selection</span>
          <h2>Choose your IGL</h2>
          {!me && <p>Competitors are choosing their callers.</p>}
          <Deadline deadlineAt={snapshot.draft.deadlineAt} serverNow={snapshot.serverNow} />
        </section>
      )}

      {(snapshot.phase === 'tournament' || snapshot.phase === 'match_ready' || snapshot.phase === 'match_transition') && snapshot.tournament && (
        <section className={styles.tournamentBoard}>
          <div className={styles.eventTitle}><span>{snapshot.tournament.meta.label}</span><b>{snapshot.tournament.rounds[snapshot.tournament.roundIdx].label}</b></div>
          <MultiplayerBracket tournament={snapshot.tournament} animationEvent={animationEvent} onAnimationDone={clearAnimation} />
          {snapshot.settings.gameLength === 'endless' && isHost && <button className={styles.endless} onClick={() => send('end_endless')}>End run after this tournament</button>}
        </section>
      )}

      {snapshot.phase === 'season_over' && <Standings snapshot={snapshot} isHost={isHost} send={send} />}
      {snapshot.phase === 'match_ready' && !animationEvent && snapshot.pendingTransition && <TimerBar label="Play match" waitingLabel="Match starts" pending={snapshot.pendingTransition} serverNow={snapshot.serverNow} isHost={isHost} onAdvance={() => send('advance_early')} />}
      {snapshot.phase === 'match_transition' && <TimerBar label="Play next match" waitingLabel="Next match" pending={snapshot.pendingTransition} serverNow={snapshot.serverNow} isHost={isHost} onAdvance={() => send('advance_early')} />}

      {dockVisible && (
        <SquadBar
          dock={(
            <SquadDock
              roster={dockRoster}
              size={ROSTER_SIZE}
              iglId={me?.iglId}
              squadName={me?.squadName}
              onFocusCard={setFocusCard}
              focusCardId={focusCard?.id ?? null}
              onOpenSheet={() => setSheetTapOpen(true)}
            />
          )}
        />
      )}

      {/* Clicking a dock chip opens it full size (and flippable) rather than
          firing the phase's action blind. */}
      <CardFocusOverlay
        card={focusCard}
        onClose={() => setFocusCard(null)}
        action={focusCard ? chipActionLabel(focusCard) : null}
        onAction={() => runChipAction(focusCard)}
      />

      {/* The full team scoreboard opens from the SQUAD button or when the
          current phase requires an IGL or consolation selection. */}
      <SquadSheet
        open={sheetOpen}
        onClose={closeSquadSheet}
        roster={dockRoster}
        iglId={me?.iglId}
        squadName={me?.squadName}
        power={dockPower}
        action={squadAction}
      />
    </main>
  );
}

function RosterList({ snapshot, isHost, myId, send }) {
  return <div className={styles.rosterList}>{snapshot.competitors.map((player, index) => <div key={player.id} className={styles.rosterRow}><span>{index + 1}</span><b>{player.squadName}{player.id === myId ? ' · YOU' : ''}</b><i className={player.connected ? styles.online : styles.offline}>{player.connected ? 'online' : 'offline'}</i>{player.id === snapshot.hostId && <em>HOST</em>}{isHost && player.id !== myId && snapshot.phase === 'lobby' && <button onClick={() => send('kick_player', { competitorId: player.id })}>Remove</button>}</div>)}</div>;
}

function Standings({ snapshot, isHost, send }) {
  const rows = Object.values(snapshot.season.standings).sort((a, b) => b.score - a.score || b.titles - a.titles);
  return (
    <section className={styles.standings}>
      <span className={styles.kicker}>Season complete</span>
      <h1>Final standings</h1>
      {/* Parity with Gauntlet's TournamentResult history rows — same
          tokenized entrance and stagger, snapping the final order into
          place one row at a time instead of dumping the whole table at
          once. */}
      {rows.map((row, index) => (
        <m.div
          key={row.competitorId}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DUR.enter, ease: EASE.out, delay: index * STAGGER }}
        >
          <span>{index + 1}</span>
          <b>{row.squadName}</b>
          <span>{snapshot.settings.gameLength === 'endless' ? `${row.yearsCompleted} years · ${row.titles} titles` : `${row.titles} titles`}</span>
          <span>{row.matchWins} wins</span>
          <strong>{row.score}</strong>
        </m.div>
      ))}
      {isHost && <TacticalButton className={styles.primary} onClick={() => send('return_to_lobby')}>Return everyone to lobby</TacticalButton>}
    </section>
  );
}

function MultiplayerDraftLane({ phase, turnIndex, totalTurns, nation, choices, picks, selectedId, interactive, onPick, squadName }) {
  const ripId = `${phase}:${turnIndex}:${choices.map(card => card.id).join(',')}`;
  return (
    <PackRip
      ripId={ripId}
      nation={nation}
      packTitle={nation ? countryName(nation) : 'Five card pack'}
      choices={choices}
      interactive={interactive}
      onPick={onPick}
      selectedId={selectedId}
      displayScale={0.45}
      headerLabel={squadName}
      headerSlot={phase === 'draft' ? `Pick ${Math.min(picks.length + 1, ROSTER_SIZE)} of ${ROSTER_SIZE}` : `Consolation ${turnIndex + 1} of ${totalTurns}`}
      className={styles.multiplayerLane}
    />
  );
}

function MultiplayerBracket({ tournament, animationEvent, onAnimationDone }) {
  const refs = useRef({});
  const overlayRef = useRef(null);
  const wrapRef = useRef(null);
  const reducedMotion = useReducedMotion();
  // "destinationSlot:teamId" pairs currently mid-flight — that exact
  // destination cell renders "TBD" until its own clone lands, same idiom as
  // Gauntlet's solo bracket. Keyed by slot+team, not bare team id: a
  // winner's id also already sits in its OLD round's cell (the match it
  // just won, still on screen one column back) — a bare-id Set would mask
  // that already-decided source cell too, since the same id legitimately
  // appears in both places.
  const [pendingArrivalIds, setPendingArrivalIds] = useState(EMPTY_TEAM_ID_SET);

  useLayoutEffect(() => {
    if (!animationEvent?.moves?.length) return undefined;
    if (reducedMotion) { onAnimationDone(); return undefined; }
    const wrap = wrapRef.current;
    const overlay = overlayRef.current;
    const base = wrap?.getBoundingClientRect();
    if (!wrap || !overlay || !base) { onAnimationDone(); return undefined; }
    setPendingArrivalIds(new Set(animationEvent.moves.map(move => `${move.destinationSlot}:${move.teamId}`)));
    const cleanups = [];
    const runningAnimations = [];
    let cancelled = false;
    const animations = animationEvent.moves.map(move => {
      const source = refs.current[move.sourceSlot]?.querySelector(`[data-team-id="${CSS.escape(move.teamId)}"]`);
      const destination = refs.current[move.destinationSlot]?.querySelector(`[data-team-id="${CSS.escape(move.teamId)}"]`);
      if (!source || !destination) return Promise.resolve();
      const a = source.getBoundingClientRect();
      const b = destination.getBoundingClientRect();
      const clone = source.cloneNode(true);
      clone.classList.add(soloStyles.travelClone);
      clone.style.width = `${a.width}px`;
      clone.style.height = `${a.height}px`;
      overlay.appendChild(clone);
      cleanups.push(() => clone.remove());
      const x0 = a.left - base.left, y0 = a.top - base.top, x1 = b.left - base.left, y1 = b.top - base.top;
      const bridge = x0 + (x1 - x0) / 2;
      const animation = clone.animate([
        { transform: `translate(${x0}px, ${y0}px)` },
        { transform: `translate(${bridge}px, ${y0}px)`, offset: .35 },
        { transform: `translate(${bridge}px, ${y1}px)`, offset: .65 },
        { transform: `translate(${x1}px, ${y1}px)` },
      ], { duration: DUR.travel * 1000, easing: 'cubic-bezier(.5,0,.2,1)', fill: 'forwards' });
      runningAnimations.push(animation);
      return animation.finished.then(() => {
        if (cancelled) return;
        const arrivalKey = `${move.destinationSlot}:${move.teamId}`;
        setPendingArrivalIds(prev => {
          if (!prev.has(arrivalKey)) return prev;
          const next = new Set(prev);
          next.delete(arrivalKey);
          return next;
        });
      }).catch(() => {});
    });
    Promise.all(animations).then(() => {
      if (cancelled) return;
      cleanups.forEach(fn => fn());
      setPendingArrivalIds(EMPTY_TEAM_ID_SET);
      onAnimationDone();
    });
    return () => {
      cancelled = true;
      runningAnimations.forEach(animation => animation.cancel());
      cleanups.forEach(fn => fn());
    };
  }, [animationEvent, onAnimationDone, reducedMotion]);

  const byKey = key => tournament.rounds.find(round => round.key === key);
  const r16 = byKey('r16');
  const quarter = byKey('quarter');
  const semi = byKey('semi');
  const final = byKey('final');
  const cell = (round, index, key) => (
    <MultiplayerBracketCell
      tournament={tournament}
      match={round?.matches[index]}
      pendingArrivalIds={pendingArrivalIds}
      cellKey={`${key}:${index}`}
      cellRef={element => { refs.current[`${key}:${index}`] = element; }}
    />
  );
  const slot = (column, rowStart, rowEnd, child, key) => (
    <div key={key} className={soloStyles.bracketSlot} style={{ gridColumn: column, gridRow: `${rowStart} / ${rowEnd}` }}>{child}</div>
  );
  const connector = (column, rowStart, rowEnd, key) => (
    <div key={key} className={soloStyles.conn} style={{ gridColumn: column, gridRow: `${rowStart} / ${rowEnd}` }} />
  );

  return (
    <div className={soloStyles.bracketWrap} ref={wrapRef}>
      <div className={soloStyles.bracket}>
        <span className={soloStyles.poolLabel} style={{ gridColumn: 1, gridRow: 1 }}>Round of 16</span>
        <span className={soloStyles.poolLabel} style={{ gridColumn: 3, gridRow: 1 }}>Quarterfinals</span>
        <span className={soloStyles.poolLabel} style={{ gridColumn: 5, gridRow: 1 }}>Semifinals</span>
        <span className={soloStyles.poolLabel} style={{ gridColumn: 7, gridRow: 1 }}>Grand Final</span>
        {[0, 1, 2, 3, 4, 5, 6, 7].map(index => slot(1, index + 2, index + 3, cell(r16, index, 'r16'), `r16-${index}`))}
        {[0, 1, 2, 3].map(index => connector(2, 2 * index + 2, 2 * index + 4, `c2-${index}`))}
        {[0, 1, 2, 3].map(index => slot(3, 2 * index + 2, 2 * index + 4, cell(quarter, index, 'quarter'), `qf-${index}`))}
        {[0, 1].map(index => connector(4, 4 * index + 2, 4 * index + 6, `c4-${index}`))}
        {[0, 1].map(index => slot(5, 4 * index + 2, 4 * index + 6, cell(semi, index, 'semi'), `sf-${index}`))}
        {connector(6, 2, 10, 'c6')}
        {slot(7, 2, 10, cell(final, 0, 'final'), 'gf')}
      </div>
      <div className={soloStyles.travelOverlay} ref={overlayRef} aria-hidden="true" />
    </div>
  );
}

function MultiplayerBracketCell({ tournament, match, pendingArrivalIds = EMPTY_TEAM_ID_SET, cellKey, cellRef }) {
  if (!match) {
    return (
      <div className={soloStyles.bracketCell} ref={cellRef}>
        <div className={soloStyles.bracketTeam}><span className={soloStyles.cellTag}>TBD</span></div>
        <div className={soloStyles.bracketTeam}><span className={soloStyles.cellTag}>TBD</span></div>
      </div>
    );
  }
  const revealed = Boolean(match.winner);
  // A team mid-flight to this slot renders as TBD until its own clone lands
  // — data-team-id stays put either way so the travel effect's querySelector
  // still finds this row to measure and animate toward. Checked as
  // "thisCellKey:teamId", not bare teamId: a winner's id also already sits
  // in its OLD round's cell one column back (the match it just won), and a
  // bare-id check would mask that already-decided cell too.
  const row = (teamId, score) => {
    const team = tournament.teams[teamId];
    const winner = revealed && match.winner === teamId;
    const pending = pendingArrivalIds.has(`${cellKey}:${teamId}`);
    return (
      <div
        key={teamId}
        data-team-id={teamId}
        className={[soloStyles.bracketTeam, winner ? soloStyles.cellWon : '', revealed && !winner ? soloStyles.cellLost : '', team.human ? soloStyles.bracketYou : ''].join(' ')}
      >
        {pending ? (
          <span className={soloStyles.cellTag}>TBD</span>
        ) : (
          <>
            {team.logo ? <img src={assetPath(team.logo)} alt="" /> : <span className={soloStyles.youMark}>★</span>}
            <span className={soloStyles.cellSeed}>{tournament.seeds.indexOf(teamId) + 1}</span>
            <span className={soloStyles.cellTag}>{team.tag}</span>
            <span className={soloStyles.bracketScore} data-bracket-score>{revealed ? score : ''}</span>
          </>
        )}
      </div>
    );
  };
  return (
    <div className={[soloStyles.bracketCell, match.humanInvolved ? soloStyles.playerMatch : '', revealed ? soloStyles.revealed : ''].join(' ')} ref={cellRef}>
      {row(match.a, match.scoreA)}
      {row(match.b, match.scoreB)}
    </div>
  );
}

function TimerBar({ label, waitingLabel, pending, serverNow, isHost, onAdvance }) {
  const [remaining, setRemaining] = useState(10_000);
  useEffect(() => {
    const skew = Date.now() - serverNow;
    const tick = () => setRemaining(Math.max(0, pending.deadlineAt - (Date.now() - skew)));
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [pending.deadlineAt, serverNow]);
  const progress = remaining / 10_000;
  return <div className={styles.timerDock}><button onClick={isHost ? onAdvance : undefined} disabled={!isHost} style={{ '--remaining': progress }}><span>{isHost ? label : waitingLabel} · {Math.ceil(remaining / 1000)}s</span></button></div>;
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
