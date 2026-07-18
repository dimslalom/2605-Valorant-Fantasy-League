import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import NavHeader from '../components/NavHeader';
import PlayerCard from '../components/PlayerCard';
import allCards from '../data/cards.json';
import { countryName } from '../lib/utils';
import {
  mulberry32, todaySeed, ROSTER_SIZE,
  rollNationality, draftChoices, teamPower,
  makeSeason, buildBracket, nextBracketRound, currentRound, playerMatch,
  setPlayerResult, resolveNpcMatches, seedOf,
  pickMaps, simMap, evaluateTournament, evaluateSeason,
} from '../engine/perfectRun';
import styles from './PerfectRun.module.css';

const STORAGE_KEY = 'vfl-perfectrun';

function loadSaves() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {}; }
  catch { return {}; }
}
function saveSaves(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}
function dateKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
function reduceMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
function isMobile() {
  return window.matchMedia('(max-width: 680px)').matches;
}

const TRAVEL_MS = 900;

export default function PerfectRun() {
  // menu | name | draft | review | intro | run | result | locked | pack | over
  const [phase, setPhase] = useState('menu');
  const [mode, setMode] = useState('solo');
  const [squadName, setSquadName] = useState('');
  const rng = useRef(null);

  // draft
  const [picks, setPicks] = useState([]);
  const [nat, setNat] = useState(null);
  const [choices, setChoices] = useState([]);
  const [rerolls, setRerolls] = useState(3);
  const [ripId, setRipId] = useState(0); // bumped per roll, keys the pack-rip

  // review
  const [iglId, setIglId] = useState(null);

  // season
  const [season, setSeason] = useState([]);          // [{kind,city,label} x3]
  const [tourIndex, setTourIndex] = useState(0);
  const [tourResults, setTourResults] = useState([]); // finished tournaments
  const [currentResult, setCurrentResult] = useState(null);
  const [seasonResult, setSeasonResult] = useState(null);

  // tournament
  const [tour, setTour] = useState(null);
  const [view, setView] = useState('board');           // board | match
  const [boardState, setBoardState] = useState('pairings'); // pairings | revealing | complete | travel
  const [revealCount, setRevealCount] = useState(0);
  const [maps, setMaps] = useState([]);                // map names for the player's series
  const [mapResults, setMapResults] = useState([]);    // finished {a,b,winA,mvp,map}
  const [live, setLive] = useState(null);              // {a,b} while a map animates

  // consolation pack
  const [packNat, setPackNat] = useState(null);
  const [packChoices, setPackChoices] = useState([]);
  const [packPick, setPackPick] = useState(null);

  const animTimer = useRef(null);
  const revealTimer = useRef(null);
  const advanceTimer = useRef(null);
  const seriesActive = useRef(false); // guards double "Play your match"

  // travel animation plumbing
  const cellRefs = useRef({});
  const bracketRef = useRef(null);
  const overlayRef = useRef(null);
  const travelInfo = useRef(null);
  const historyRef = useRef([]);

  useEffect(() => () => {
    clearInterval(animTimer.current);
    clearInterval(revealTimer.current);
    clearTimeout(advanceTimer.current);
  }, []);

  const pickedIds = new Set(picks.map(p => p.id));
  const power = picks.length === ROSTER_SIZE ? teamPower(picks, iglId) : null;

  // ── Draft flow ────────────────────────────────────────────────────────────

  function startRun(selectedMode) {
    const seed = selectedMode === 'daily' ? todaySeed() : (Date.now() & 0xffffffff);
    rng.current = mulberry32(seed);
    setMode(selectedMode);
    setSquadName('');
    setPicks([]); setIglId(null);
    setRerolls(selectedMode === 'daily' ? 1 : 3);
    setSeason(makeSeason(rng.current));
    setTourIndex(0); setTourResults([]); setCurrentResult(null); setSeasonResult(null);
    setTour(null); setView('board'); setBoardState('pairings'); setRevealCount(0);
    setMaps([]); setMapResults([]); setLive(null);
    historyRef.current = [];
    setPackNat(null); setPackChoices([]); setPackPick(null);
    clearInterval(animTimer.current);
    clearInterval(revealTimer.current);
    clearTimeout(advanceTimer.current);
    seriesActive.current = false;
    rollSlot(new Set());
    setPhase('name');
  }

  function confirmSquadName(event) {
    event.preventDefault();
    const name = squadName.trim();
    if (!name) return;
    setSquadName(name);
    setPhase('draft');
  }

  function rollSlot(ids) {
    const rolled = rollNationality(rng.current, allCards, ids);
    setNat(rolled);
    setChoices(draftChoices(allCards, rolled, ids));
    setRipId(id => id + 1);
  }

  function pickPlayer(card) {
    const next = [...picks, card];
    setPicks(next);
    if (next.length < ROSTER_SIZE) {
      rollSlot(new Set(next.map(p => p.id)));
    } else {
      setPhase('review');
    }
  }

  function reroll() {
    if (rerolls <= 0) return;
    setRerolls(r => r - 1);
    rollSlot(pickedIds);
  }

  // ── Tournament flow ───────────────────────────────────────────────────────

  // Intro splash auto-advances into the bracket draw.
  useEffect(() => {
    if (phase !== 'intro') return undefined;
    const timer = setTimeout(beginBracket, reduceMotion() ? 250 : 1900);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, tourIndex]);

  function beginBracket() {
    const def = season[tourIndex];
    const playerTeam = {
      id: 'player', tag: 'YOU', name: squadName, logo: null,
      roster: picks, power: power.power, isPlayer: true,
    };
    const t = buildBracket(rng.current, allCards, pickedIds, playerTeam, def.kind);
    historyRef.current = [];
    setTour({ ...t });
    setView('board');
    setBoardState('pairings');
    setRevealCount(0);
    seriesActive.current = false;
    setPhase('run');
  }

  const round = tour ? currentRound(tour) : null;
  const pMatch = tour ? playerMatch(tour) : null;
  const opp = pMatch && tour ? tour.teams[pMatch.a === 'player' ? pMatch.b : pMatch.a] : null;
  const def = season[tourIndex] ?? null;

  function playMatch() {
    if (seriesActive.current) return;
    seriesActive.current = true;
    const seriesMaps = pickMaps(rng.current, round.bestOf);
    setMaps(seriesMaps);
    setMapResults([]);
    setView('match');
    setTimeout(() => playNextMap(seriesMaps, []), 350);
  }

  // ── Player series (match view, auto-plays map to map) ────────────────────

  const needed = round ? Math.ceil(round.bestOf / 2) : 0;
  const mapsWon = mapResults.filter(r => r.winA).length;
  const mapsLost = mapResults.length - mapsWon;
  const seriesOver = mapsWon >= needed || mapsLost >= needed;

  function playNextMap(seriesMaps, resultsSoFar) {
    const wonSoFar = resultsSoFar.filter(r => r.winA).length;
    const lostSoFar = resultsSoFar.length - wonSoFar;
    if (wonSoFar >= needed || lostSoFar >= needed) return;

    const result = simMap(rng.current, power.power, opp.power, picks, opp.roster);
    const mapName = seriesMaps[resultsSoFar.length];

    const startedAt = performance.now();
    setLive({ a: 0, b: 0 });
    animTimer.current = setInterval(() => {
      const i = Math.min(result.rounds.length, Math.floor((performance.now() - startedAt) / 55) + 1);
      const seq = result.rounds.slice(0, i);
      setLive({
        a: seq.filter(r => r === 'A').length,
        b: seq.filter(r => r === 'B').length,
      });
      if (i >= result.rounds.length) {
        clearInterval(animTimer.current);
        setLive(null);
        const updated = [...resultsSoFar, { ...result, map: mapName }];
        setMapResults(updated);

        const wonNow = updated.filter(r => r.winA).length;
        const lostNow = updated.length - wonNow;
        if (wonNow < needed && lostNow < needed) {
          setTimeout(() => playNextMap(seriesMaps, updated), 650);
        } else {
          setTimeout(() => backToBoard(updated), 1700);
        }
      }
    }, 55);
  }

  function backToBoard(results) {
    const wonMaps = results.filter(r => r.winA).length;
    const lostMaps = results.length - wonMaps;
    const won = wonMaps >= needed;
    const roundDiff = results.reduce((s, r) => s + (r.a - r.b), 0);
    const seriesResult = {
      tournament: def.label,
      stage: round.label, opp: opp.name,
      mapsWon: wonMaps, mapsLost: lostMaps, roundDiff, won,
      score: results.map(r => `${r.a}-${r.b}`).join('  '),
    };
    const nextHistory = [...historyRef.current, seriesResult];
    historyRef.current = nextHistory;

    setPlayerResult(tour, results, won);
    resolveNpcMatches(tour, rng.current);
    setTour({ ...tour });

    const npcCount = round.matches.filter(m => !m.isPlayerMatch).length;
    setRevealCount(0);
    setView('board');
    setBoardState('revealing');
    let shown = 0;
    revealTimer.current = setInterval(() => {
      shown++;
      setRevealCount(shown);
      if (shown >= npcCount) {
        clearInterval(revealTimer.current);
        setBoardState('complete');
        advanceTimer.current = setTimeout(advance, 2200);
      }
    }, 200);
  }

  // Player's fate after this round: champion (won final), out (lost), through.
  function playerOutcome() {
    if (!round || !pMatch?.winner) return null;
    const wonSeries = pMatch.winner === 'player';
    if (round.key === 'final') return wonSeries ? 'champion' : 'out';
    return wonSeries ? 'through' : 'out';
  }

  function advance() {
    seriesActive.current = false;
    const outcome = playerOutcome();
    if (outcome === 'champion') { endTournament(true); return; }
    if (outcome === 'out') { endTournament(false); return; }
    travelThenNextRound();
  }

  // Generate the next round (hidden), then fly the squad's cell along the
  // bracket connectors into its new slot before revealing it.
  function travelThenNextRound() {
    const prevRound = currentRound(tour);
    const fromIdx = prevRound.matches.findIndex(m => m.isPlayerMatch);
    const fromKey = `${prevRound.key}:${fromIdx}`;
    nextBracketRound(tour);
    const newRound = currentRound(tour);
    const toIdx = newRound.matches.findIndex(m => m.isPlayerMatch);
    travelInfo.current = { fromKey, toKey: `${newRound.key}:${toIdx}` };
    setTour({ ...tour });
    setBoardState('travel');
  }

  // Runs after the travel round has rendered: measure, clone, animate.
  useLayoutEffect(() => {
    if (boardState !== 'travel') return;
    const finish = () => setBoardState('pairings');
    const info = travelInfo.current;
    const fromEl = info && cellRefs.current[info.fromKey];
    const toEl = info && cellRefs.current[info.toKey];
    const overlay = overlayRef.current;
    const container = bracketRef.current;

    if (reduceMotion() || isMobile() || !fromEl || !toEl || !overlay || !container) {
      finish();
      return;
    }

    const cRect = container.getBoundingClientRect();
    const fromRow = fromEl.querySelector('[data-team-id="player"]');
    const toRow = toEl.querySelector('[data-team-id="player"]');
    if (!fromRow || !toRow) {
      finish();
      return;
    }
    const a = fromRow.getBoundingClientRect();
    const b = toRow.getBoundingClientRect();
    const x0 = a.left - cRect.left, y0 = a.top - cRect.top;
    const x1 = b.left - cRect.left, y1 = b.top - cRect.top;

    const clone = fromRow.cloneNode(true);
    clone.classList.add(styles.travelClone);
    clone.classList.remove(styles.cellWon, styles.cellLost);
    const cloneScore = clone.querySelector('[data-bracket-score]');
    if (cloneScore) cloneScore.textContent = '';
    clone.style.width = `${a.width}px`;
    clone.style.height = `${a.height}px`;
    overlay.appendChild(clone);

    fromRow.style.visibility = 'hidden';
    toRow.style.visibility = 'hidden';
    // Follow the bracket connector: right, vertical, then right into the slot.
    const bridgeX = x0 + (x1 - x0) * 0.5;
    const anim = clone.animate([
      { transform: `translate(${x0}px, ${y0}px)` },
      { transform: `translate(${bridgeX}px, ${y0}px)`, offset: 0.35 },
      { transform: `translate(${bridgeX}px, ${y1}px)`, offset: 0.65 },
      { transform: `translate(${x1}px, ${y1}px)` },
    ], { duration: TRAVEL_MS, easing: 'cubic-bezier(0.5, 0, 0.2, 1)', fill: 'forwards' });

    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      clone.remove();
      if (fromRow) fromRow.style.visibility = '';
      if (toRow) toRow.style.visibility = '';
      finish();
    };
    anim.onfinish = cleanup;
    const guard = setTimeout(cleanup, TRAVEL_MS + 400);
    return () => { clearTimeout(guard); cleanup(); };
  }, [boardState]);

  function endTournament(champion) {
    const finishedSeries = historyRef.current;
    const evalT = evaluateTournament(finishedSeries, champion);
    const result = {
      kind: def.kind, label: def.label, city: def.city,
      champion, series: finishedSeries, badges: evalT.badges,
      finishRound: round.label,
    };
    setTourResults(rs => [...rs, result]);
    setCurrentResult(result);
    setPhase('result');
  }

  function continueFromResult() {
    const isLast = tourIndex >= season.length - 1;
    if (isLast) { finishSeason(); return; }
    if (currentResult.champion) {
      setPhase('locked');
    } else {
      rollPack();
      setPhase('pack');
    }
  }

  function finishSeason() {
    const result = evaluateSeason(tourResults);
    setSeasonResult(result);

    const saves = loadSaves();
    saves.bestScore = Math.max(saves.bestScore ?? 0, result.score);
    saves.badges ??= {};
    for (const tr of tourResults) {
      if (!tr.champion) continue;
      const key = tr.kind === 'champions' ? 'champions' : 'masters';
      saves.badges[key] = (saves.badges[key] ?? 0) + 1;
    }
    if (result.grandSlam) saves.badges.grand_slam = (saves.badges.grand_slam ?? 0) + 1;
    if (result.perfectSeason) saves.badges.perfect_season = (saves.badges.perfect_season ?? 0) + 1;
    if (mode === 'daily') {
      saves.dailyScores ??= {};
      const k = dateKey();
      saves.dailyScores[k] = Math.max(saves.dailyScores[k] ?? 0, result.score);
    }
    saveSaves(saves);
    setPhase('over');
  }

  function nextTournament() {
    setTourIndex(i => i + 1);
    setPhase('intro');
  }

  // ── Consolation pack ────────────────────────────────────────────────────────

  function rollPack() {
    const ids = new Set(picks.map(p => p.id));
    const rolled = rollNationality(rng.current, allCards, ids);
    setPackNat(rolled);
    setPackChoices(draftChoices(allCards, rolled, ids));
    setPackPick(null);
    setRipId(id => id + 1);
  }

  function swapInto(oldCard) {
    const next = picks.map(p => (p.id === oldCard.id ? packPick : p));
    setPicks(next);
    if (iglId === oldCard.id) {
      const newIgl = [...next].sort((a, b) => b.rating - a.rating)[0];
      setIglId(newIgl.id);
    }
    nextTournament();
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const saves = loadSaves();
  const todayBest = saves.dailyScores?.[dateKey()];
  const titleCount = (saves.badges?.masters ?? 0) + (saves.badges?.champions ?? 0);

  const fanCards = useMemo(() =>
    allCards
      .filter(c => c.photo !== '/assets/players/placeholder.png')
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 3),
  []);

  const runningScore = evaluateSeason(tourResults);

  return (
    <div className={styles.page}>
      <NavHeader right={phase === 'run' && round && def
        ? `${def.label} · ${round.label} (Bo${round.bestOf})`
        : undefined} />

      {phase === 'menu' && (
        <>
          <section className={styles.menu}>
            <div className={styles.menuMain}>
              <h1 className={styles.menuTitle}>Perfect<br />Run<em>//</em></h1>
              <p className={styles.menuTag}>Three cities. One season. Zero maps dropped.</p>

              <div className={styles.menuModes}>
                <button className={styles.modeBtn} onClick={() => startRun('solo')}>
                  <span className={styles.modeBtnName}>Solo Season</span>
                  <span className={styles.modeBtnSub}>3 rerolls</span>
                </button>
                <button className={styles.modeBtn} onClick={() => startRun('daily')}>
                  <span className={styles.modeBtnName}>Daily Challenge</span>
                  <span className={styles.modeBtnSub}>
                    {todayBest != null ? `best today ${todayBest}` : 'shared draft, 1 reroll'}
                  </span>
                </button>
              </div>

              <div className={styles.recordStrip}>
                <span>Best <b><CountUp value={saves.bestScore ?? 0} /></b></span>
                <span>Titles <b><CountUp value={titleCount} /></b></span>
                <span>Slams <b><CountUp value={saves.badges?.grand_slam ?? 0} /></b></span>
                <span>Perfect <b><CountUp value={saves.badges?.perfect_season ?? 0} /></b></span>
              </div>
            </div>

            <div className={styles.menuFan} aria-hidden="true">
              {fanCards.map(card => (
                <div key={card.id} className={styles.fanCard}>
                  <PlayerCard card={card} displayScale={0.52} />
                </div>
              ))}
            </div>
          </section>
          <p className={styles.disclaimer}>
            Ratings are approximations tuned for game balance, not official VCT statistics.
          </p>
        </>
      )}

      {phase === 'name' && (
        <section className={styles.nameStep}>
          <span className={styles.introMarker}>Build your season</span>
          <h2 className={styles.nameTitle}>Name your squad<em>//</em></h2>
          <p className={styles.groupNote}>This name stays with your roster through all three cities.</p>
          <form className={styles.nameForm} onSubmit={confirmSquadName}>
            <label htmlFor="squad-name">Squad name</label>
            <input
              id="squad-name"
              value={squadName}
              onChange={event => setSquadName(event.target.value)}
              maxLength={28}
              placeholder="Brisbane Reapers"
              autoFocus
              autoComplete="off"
            />
            <span className={styles.nameCount}>{squadName.length} / 28</span>
            <button className={styles.primary} type="submit" disabled={!squadName.trim()}>
              Start the draft
            </button>
          </form>
        </section>
      )}

      {phase === 'draft' && (
        <section>
          <DraftLane
            pickNumber={picks.length + 1}
            nation={nat}
            choices={choices}
            picks={picks}
            rerolls={rerolls}
            ripId={ripId}
            interactive
            onPick={pickPlayer}
            onReroll={reroll}
            squadName={squadName}
          />
        </section>
      )}

      {phase === 'review' && (
        <section>
          <h2 className={styles.sectionTitle}>Choose an IGL for {squadName}. Click a player.</h2>
          <div className={styles.reviewRoster}>
            {picks.map(card => (
              <div key={card.id} className={styles.reviewCard}>
                <PlayerCard
                  card={card}
                  displayScale={0.42}
                  selected={iglId === card.id}
                  onClick={() => setIglId(card.id)}
                />
                {iglId === card.id && <span className={styles.iglTag}>IGL</span>}
              </div>
            ))}
          </div>

          {power && <ChemPanel power={power} />}

          <button className={styles.primary} onClick={() => setPhase('intro')} disabled={!iglId}>
            {iglId ? `Enter ${season[0]?.label ?? 'the season'}` : 'Choose an IGL first'}
          </button>
        </section>
      )}

      {phase === 'intro' && def && (
        <section className={styles.intro}>
          <span className={styles.introMarker}>Tournament {tourIndex + 1} / {season.length}</span>
          <h1 className={styles.introTitle}>{def.label}<em>//</em></h1>
          <p className={styles.introTag}>16 teams. Single elimination.</p>
        </section>
      )}

      {phase === 'run' && view === 'board' && tour && round && (
        <Board
          tour={tour}
          round={round}
          boardState={boardState}
          revealCount={revealCount}
          outcome={playerOutcome()}
          onPlay={playMatch}
          registerCell={(k, el) => { if (el) cellRefs.current[k] = el; }}
          bracketRef={bracketRef}
          overlayRef={overlayRef}
        />
      )}

      {phase === 'run' && view === 'match' && round && opp && (
        <section>
          <div className={styles.scoreHead}>
            <span className={styles.stageLabel}>{round.label} (Bo{round.bestOf})</span>
            <span className={styles.groupNote}>Single elimination. Win or go home.</span>
          </div>

          <div className={styles.scoreMain}>
            <span className={styles.teamA}>{squadName}</span>
            <span className={styles.bigScore}>{mapsWon}–{mapsLost}</span>
            <span className={styles.teamB}>
              {opp.name}
              {opp.logo && <img src={opp.logo} alt="" />}
            </span>
          </div>

          <div className={styles.rosters}>
            <div className={styles.rosterCol}>
              <span className={styles.powerNote}>power {power.power.toFixed(1)}</span>
              {picks.map(p => (
                <span key={p.id}>{p.player}{p.id === iglId ? ' (IGL)' : ''} · {p.rating}</span>
              ))}
            </div>
            <div className={`${styles.rosterCol} ${styles.right}`}>
              <span className={styles.powerNote}>power {opp.power.toFixed(1)}</span>
              {opp.roster.map(p => <span key={p.id}>{p.player} · {p.rating}</span>)}
            </div>
          </div>

          <div className={styles.mapList}>
            {maps.slice(0, Math.max(mapResults.length + 1, needed)).map((m, i) => {
              const r = mapResults[i];
              const isLive = live && i === mapResults.length;
              if (!r && !isLive && i > mapResults.length) return null;
              return (
                <div key={m} className={[styles.mapRow, r ? (r.winA ? styles.mapWin : styles.mapLoss) : ''].join(' ')}>
                  <span className={styles.mapName}>{m}</span>
                  {r && <span className={styles.mapScore}>{r.a} – {r.b}</span>}
                  {isLive && <span className={styles.mapScore}>{live.a} – {live.b}</span>}
                  {r && <span className={styles.mapMvp}>MVP <b>{r.mvp.player}</b></span>}
                  {!r && !isLive && <span className={styles.mapPending}>up next</span>}
                </div>
              );
            })}
          </div>

          <span className={styles.liveTag}>
            {seriesOver
              ? (mapsWon >= needed ? 'Series won' : 'Series lost')
              : `Live: ${maps[mapResults.length]}`}
          </span>
        </section>
      )}

      {phase === 'result' && currentResult && (
        <TournamentResult
          result={currentResult}
          runningScore={runningScore.score}
          onContinue={continueFromResult}
          isLast={tourIndex >= season.length - 1}
        />
      )}

      {phase === 'locked' && def && (
        <section className={styles.between}>
          <span className={styles.introMarker}>Squad locked in</span>
          <h2 className={styles.betweenTitle}>Champions stay together</h2>
          <p className={styles.groupNote}>
            You took {currentResult?.label}. Your winning squad rolls on unchanged.
          </p>
          <SquadStrip picks={picks} iglId={iglId} squadName={squadName} />
          <div className={styles.nextTeaser}>
            Next up <b>{season[tourIndex + 1]?.label}</b>
          </div>
          <button className={styles.primary} onClick={nextTournament}>
            On to {season[tourIndex + 1]?.city}
          </button>
        </section>
      )}

      {phase === 'pack' && (
        <PackPhase
          nat={packNat}
          choices={packChoices}
          picks={picks}
          iglId={iglId}
          ripId={ripId}
          pick={packPick}
          onPickNew={setPackPick}
          onSwap={swapInto}
          onSkip={nextTournament}
          nextLabel={season[tourIndex + 1]?.label}
        />
      )}

      {phase === 'over' && seasonResult && (
        <SeasonOver
          result={seasonResult}
          tourResults={tourResults}
          season={season}
          onReplay={() => startRun(mode)}
          onMenu={() => setPhase('menu')}
        />
      )}
    </div>
  );
}

// ── Board: the current stage as a live bracket ───────────────────────────────

function Board({ tour, round, boardState, revealCount, outcome, onPlay, registerCell, bracketRef, overlayRef }) {
  const npcMatches = round.matches.filter(m => !m.isPlayerMatch);
  const isRevealed = (m) => {
    if (m.isPlayerMatch) return !!m.winner;
    if (boardState === 'pairings') return false;
    return npcMatches.indexOf(m) < revealCount;
  };

  const statusLine = (() => {
    if (boardState === 'pairings') return 'Single elimination. Win or go home.';
    if (boardState === 'complete') {
      if (outcome === 'champion') return 'You are the champions.';
      if (outcome === 'out') return 'Your run ends here.';
      return 'You advance.';
    }
    if (boardState === 'travel') return 'Moving on.';
    return 'Results coming in.';
  })();

  return (
    <section className={styles.boardScreen}>
      <div className={styles.boardHead}>
        <span className={styles.stageLabel}>{round.label} (Bo{round.bestOf})</span>
        <span className={styles.groupNote}>{statusLine}</span>
      </div>

      <Bracket
        tour={tour}
        currentRoundKey={round.key}
        isRevealed={isRevealed}
          registerCell={registerCell}
          bracketRef={bracketRef}
          overlayRef={overlayRef}
          hideCurrentPlayer={boardState === 'travel'}
      />

      {boardState === 'pairings' && (
        <div className={styles.bracketCta}>
          <button className={`${styles.primary} ${styles.playButton}`} onClick={onPlay}>
            <span>Play your match</span>
            <b aria-hidden="true">→</b>
          </button>
        </div>
      )}
    </section>
  );
}

// Four-column single-elimination bracket. Cells in columns 1/3/5/7, connectors
// in 2/4/6. Row 1 is labels; rows 2-9 are eight 92px slots. Feeders always sit
// at 25%/75% of a parent's span, so one connector shape serves every round.
function Bracket({ tour, currentRoundKey, isRevealed, registerCell, bracketRef, overlayRef, hideCurrentPlayer }) {
  const byKey = k => tour.rounds.find(r => r.key === k);
  const r16 = byKey('r16'), qf = byKey('quarter'), sf = byKey('semi'), gf = byKey('final');

  const cell = (roundObj, i, colKey) => {
    const m = roundObj?.matches[i];
    const key = `${colKey}:${i}`;
    const isCurrent = roundObj && roundObj.key === currentRoundKey;
    const revealed = m ? (!isCurrent || isRevealed(m)) : false;
    return (
      <BracketCell
        tour={tour}
        match={m}
        revealed={revealed}
        hidePlayer={hideCurrentPlayer && isCurrent}
        cellRef={el => registerCell(key, el)}
      />
    );
  };

  const slot = (col, rowStart, rowEnd, child, k) => (
    <div key={k} className={styles.bracketSlot} style={{ gridColumn: col, gridRow: `${rowStart} / ${rowEnd}` }}>
      {child}
    </div>
  );
  const conn = (col, rowStart, rowEnd, k) => (
    <div key={k} className={styles.conn} style={{ gridColumn: col, gridRow: `${rowStart} / ${rowEnd}` }} />
  );

  return (
    <div className={styles.bracketWrap}>
      <div className={styles.bracket} ref={bracketRef}>
        <span className={styles.poolLabel} style={{ gridColumn: 1, gridRow: 1 }}>Round of 16</span>
        <span className={styles.poolLabel} style={{ gridColumn: 3, gridRow: 1 }}>Quarterfinals</span>
        <span className={styles.poolLabel} style={{ gridColumn: 5, gridRow: 1 }}>Semifinals</span>
        <span className={styles.poolLabel} style={{ gridColumn: 7, gridRow: 1 }}>Grand Final</span>

        {[0, 1, 2, 3, 4, 5, 6, 7].map(i => slot(1, i + 2, i + 3, cell(r16, i, 'r16'), `r16-${i}`))}
        {[0, 1, 2, 3].map(i => conn(2, 2 * i + 2, 2 * i + 4, `c2-${i}`))}

        {[0, 1, 2, 3].map(i => slot(3, 2 * i + 2, 2 * i + 4, cell(qf, i, 'quarter'), `qf-${i}`))}
        {[0, 1].map(i => conn(4, 4 * i + 2, 4 * i + 6, `c4-${i}`))}

        {[0, 1].map(i => slot(5, 4 * i + 2, 4 * i + 6, cell(sf, i, 'semi'), `sf-${i}`))}
        {conn(6, 2, 10, 'c6')}

        {slot(7, 2, 10, cell(gf, 0, 'final'), 'gf')}
      </div>
      <div className={styles.travelOverlay} ref={overlayRef} aria-hidden="true" />
    </div>
  );
}

function BracketCell({ tour, match, revealed, hidePlayer, cellRef }) {
  if (!match) {
    return (
      <div className={styles.bracketCell} ref={cellRef}>
        <div className={styles.bracketTeam}><span className={styles.cellTag}>TBD</span></div>
        <div className={styles.bracketTeam}><span className={styles.cellTag}>TBD</span></div>
      </div>
    );
  }
  const a = tour.teams[match.a];
  const b = tour.teams[match.b];
  const row = (team, score, isWinner, isLoser) => (
    <div
      className={[styles.bracketTeam, isWinner ? styles.cellWon : '', isLoser ? styles.cellLost : '', team.isPlayer ? styles.bracketYou : '', hidePlayer && team.isPlayer ? styles.roundHidden : ''].join(' ')}
      data-team-id={team.id}
    >
      {team.logo ? <img src={team.logo} alt="" /> : <span className={styles.youMark}>★</span>}
      <span className={styles.cellSeed}>{seedOf(tour, team.id)}</span>
      <span className={styles.cellTag}>{team.isPlayer ? 'YOU' : team.tag}</span>
      <span className={styles.bracketScore} data-bracket-score>{revealed ? score : ''}</span>
    </div>
  );
  return (
    <div className={[styles.bracketCell, match.isPlayerMatch ? styles.playerMatch : '', revealed ? styles.revealed : ''].join(' ')} ref={cellRef}>
      {row(a, match.scoreA, revealed && match.winner === a.id, revealed && match.winner === b.id)}
      {row(b, match.scoreB, revealed && match.winner === b.id, revealed && match.winner === a.id)}
    </div>
  );
}

// ── Tournament result interstitial ───────────────────────────────────────────

function TournamentResult({ result, runningScore, onContinue, isLast }) {
  return (
    <section className={styles.result}>
      <span className={styles.introMarker}>{result.label}</span>
      <h2 className={result.champion ? styles.overWin : styles.overFail}>
        {result.champion ? 'Champions' : `Out in the ${result.finishRound}`}
      </h2>

      {result.badges.length > 0 && (
        <div className={styles.badges}>
          {result.badges.map(b => (
            <div key={b.key} className={`${styles.badge} ${styles['badge_' + b.key]}`}>
              <b>{b.label}</b>
              <span>{b.desc}</span>
            </div>
          ))}
        </div>
      )}

      <div className={styles.historyList}>
        {result.series.map((h, i) => (
          <div key={i} className={[styles.historyRow, h.won ? styles.mapWin : styles.mapLoss].join(' ')}>
            <span className={styles.historyStage}>{h.stage}</span>
            <span className={styles.historyOpp}>vs {h.opp}</span>
            <span className={styles.historyScore}>{h.mapsWon}–{h.mapsLost}</span>
            <span className={styles.historyMaps}>{h.score}</span>
          </div>
        ))}
      </div>

      <div className={styles.scoreLine}>Season score<b>{runningScore}</b></div>

      <button className={styles.primary} onClick={onContinue}>
        {isLast ? 'Season results' : 'Continue'}
      </button>
    </section>
  );
}

// ── Consolation pack: pick one, swap one ─────────────────────────────────────

function PackPhase({ nat, choices, picks, iglId, ripId, pick, onPickNew, onSwap, onSkip, nextLabel }) {
  return (
    <section>
      <div className={styles.boardHead}>
        <span className={styles.stageLabel}>Consolation pack</span>
        <span className={styles.groupNote}>
          {pick
            ? 'Click a squad member to swap out, or keep your squad.'
            : 'Pick one player to bring into your squad, or skip.'}
        </span>
      </div>

      {!pick && (
        <DraftLane
          pickNumber={1}
          nation={nat}
          choices={choices}
          picks={[]}
          rerolls={0}
          ripId={ripId}
          interactive
          onPick={onPickNew}
          onReroll={() => {}}
          hideReroll
          label="One roll"
        />
      )}

      {pick && (
        <div className={styles.swapArea}>
          <div className={styles.swapIncoming}>
            <span className={styles.stripLabel}>Incoming</span>
            <PlayerCard card={pick} displayScale={0.42} />
          </div>
          <div>
            <span className={styles.stripLabel}>Swap out</span>
            <div className={styles.swapRoster}>
              {picks.map(card => (
                <div key={card.id} className={styles.swapChoice}>
                  <PlayerCard card={card} displayScale={0.34} onClick={() => onSwap(card)} />
                  <SwapDelta picks={picks} iglId={iglId} oldCard={card} newCard={pick} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className={styles.boardActions}>
        <button className={styles.secondary} onClick={onSkip}>
          Keep squad{nextLabel ? ` · on to ${nextLabel}` : ''}
        </button>
      </div>
    </section>
  );
}

// Chemistry-power delta from swapping oldCard out for newCard.
function SwapDelta({ picks, iglId, oldCard, newCard }) {
  const before = teamPower(picks, iglId);
  const nextRoster = picks.map(p => (p.id === oldCard.id ? newCard : p));
  const nextIgl = iglId === oldCard.id
    ? [...nextRoster].sort((a, b) => b.rating - a.rating)[0].id
    : iglId;
  const after = teamPower(nextRoster, nextIgl);
  const delta = after.power - before.power;
  const cls = delta > 0.05 ? styles.pos : delta < -0.05 ? styles.neg : '';
  return (
    <span className={[styles.swapDelta, cls].join(' ')}>
      <small>Power</small> {before.power.toFixed(1)} → {after.power.toFixed(1)}
      <small>Chem</small> {before.chem >= 0 ? '+' : ''}{before.chem} → {after.chem >= 0 ? '+' : ''}{after.chem}
    </span>
  );
}

// ── Season over ──────────────────────────────────────────────────────────────

function SeasonOver({ result, tourResults, season, onReplay, onMenu }) {
  const headline = result.perfectSeason ? 'Perfect Season'
    : result.grandSlam ? 'Grand Slam'
    : result.titles > 0 ? 'Season Complete'
    : 'Season Over';
  return (
    <section className={styles.overScreen}>
      <h2 className={result.titles > 0 ? styles.overWin : styles.overFail}>{headline}</h2>

      {result.badges.length > 0 && (
        <div className={styles.badges}>
          {result.badges.map(b => (
            <div key={b.key} className={`${styles.badge} ${styles['badge_' + b.key]}`}>
              <b>{b.label}</b>
              <span>{b.desc}</span>
            </div>
          ))}
        </div>
      )}

      <div className={styles.historyList}>
        {tourResults.map((tr, i) => (
          <div key={i} className={[styles.historyRow, tr.champion ? styles.mapWin : styles.mapLoss].join(' ')}>
            <span className={styles.historyStage}>{season[i]?.kind === 'champions' ? 'Champions' : 'Masters'}</span>
            <span className={styles.historyOpp}>{tr.city}</span>
            <span className={styles.historyScore}>{tr.champion ? 'Champion' : `Out · ${tr.finishRound}`}</span>
            <span className={styles.historyMaps}>
              {tr.badges.map(b => b.label).join(' · ')}
            </span>
          </div>
        ))}
      </div>

      <div className={styles.scoreLine}>
        Score<b>{result.score}</b>
        {result.titles} {result.titles === 1 ? 'title' : 'titles'}, {result.seriesWon} series won,
        {' '}{result.mapsWon} maps, {result.roundDiff >= 0 ? '+' : ''}{result.roundDiff} round differential
      </div>

      <div className={styles.overButtons}>
        <button className={styles.primary} onClick={onReplay}>Run it back</button>
        <button className={styles.secondary} onClick={onMenu}>Menu</button>
      </div>
    </section>
  );
}

// ── Shared bits ──────────────────────────────────────────────────────────────

function ChemPanel({ power }) {
  return (
    <div className={styles.chemPanel}>
      <div className={styles.chemTotal}>
        <span>Team power</span>
        <b>{power.power.toFixed(1)}</b>
        <small>avg rating {power.base.toFixed(1)}, chemistry {power.chem >= 0 ? '+' : ''}{power.chem}</small>
      </div>
      <ul className={styles.chemLines}>
        {power.lines.map((l, i) => (
          <li key={i}>
            <span>{l.label}</span>
            <b className={String(l.value).startsWith('-') ? styles.neg : styles.pos}>
              {typeof l.value === 'number' && l.value > 0 ? `+${l.value}` : l.value}
            </b>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SquadStrip({ picks, iglId, squadName = 'Your squad' }) {
  return (
    <div className={styles.rosterStrip}>
      <span className={styles.stripLabel}>{squadName}</span>
      {picks.map(card => (
        <div key={card.id} className={styles.squadStripCard}>
          <PlayerCard card={card} displayScale={0.3} />
          {card.id === iglId && <span className={styles.squadIgl}>IGL</span>}
        </div>
      ))}
    </div>
  );
}

// ── Draft lane: header + pack rip + horizontal choice strip + picks ─────────

const RIP_MS = 850;

function DraftLane({ pickNumber, nation, choices, picks, rerolls, ripId, interactive, onPick, onReroll, label, hideReroll, squadName = 'Your squad' }) {
  const [ripping, setRipping] = useState(false);
  const stripRef = useRef(null);
  const ripTimer = useRef(null);

  useEffect(() => {
    if (!ripId) return undefined;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const startTimer = setTimeout(() => {
      setRipping(!reduced);
      if (stripRef.current) stripRef.current.scrollLeft = 0;
      if (!reduced) ripTimer.current = setTimeout(() => setRipping(false), RIP_MS);
    }, 0);
    return () => {
      clearTimeout(startTimer);
      clearTimeout(ripTimer.current);
    };
  }, [ripId]);

  const onWheel = (e) => {
    if (stripRef.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      stripRef.current.scrollLeft += e.deltaY;
    }
  };

  const face = (
    <span className={styles.packFaceInner}>
      <span className={`fi fi-${nation?.toLowerCase()}`} style={{ width: 46, height: 33 }} />
      <span className={styles.packName}>{countryName(nation)}</span>
      <span className={styles.packSlash}>//</span>
    </span>
  );

  return (
    <div className={styles.lane}>
      <div className={styles.draftBar}>
        <div>
          {label && <span className={styles.laneLabel}>{label}</span>}
          <span className={styles.draftSlot}>Pick {pickNumber} of {ROSTER_SIZE}</span>
          <span className={styles.draftNat}>
            <span className={`fi fi-${nation?.toLowerCase()}`} style={{ width: 34, height: 24 }} />
            {countryName(nation)}
            <small className={styles.draftCount}>{choices.length} available</small>
          </span>
        </div>
        {interactive && !hideReroll && (
          <button className={styles.rerollBtn} onClick={onReroll} disabled={rerolls <= 0 || ripping}>
            Reroll nation ({rerolls} left)
          </button>
        )}
      </div>

      <div className={styles.strip} ref={stripRef} onWheel={onWheel}>
        {ripping && (
          <div className={styles.pack} key={`p${ripId}`} aria-hidden="true">
            <div className={`${styles.packFace} ${styles.packTop}`}>{face}</div>
            <div className={`${styles.packFace} ${styles.packBottom}`}>{face}</div>
          </div>
        )}
        <div key={`c${ripId}`} className={[styles.stripCards, ripping ? styles.stripHidden : styles.stripReveal].join(' ')}>
          {choices.map((card, i) => (
            <div key={card.id} className={styles.stripCard} style={{ '--i': Math.min(i, 10) }}>
              <PlayerCard card={card} displayScale={0.45} onClick={interactive ? () => onPick(card) : undefined} />
            </div>
          ))}
        </div>
      </div>

      {picks.length > 0 && (
        <div className={styles.rosterStrip}>
          <span className={styles.stripLabel}>{interactive ? squadName : 'Squad'}</span>
          {picks.map(card => (
            <PlayerCard key={card.id} card={card} displayScale={0.28} />
          ))}
        </div>
      )}
    </div>
  );
}

// Eased count-up for the records strip
function CountUp({ value }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!value || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const raf = requestAnimationFrame(() => setN(value ?? 0));
      return () => cancelAnimationFrame(raf);
    }
    let raf;
    const t0 = performance.now();
    const dur = 900;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      setN(Math.round(value * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{n}</>;
}
