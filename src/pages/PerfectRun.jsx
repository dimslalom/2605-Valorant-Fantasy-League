import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import NavHeader from '../components/NavHeader';
import PlayerCard from '../components/PlayerCard';
import allCards from '../data/cards.json';
import { assetPath, countryName } from '../lib/utils';
import {
  mulberry32, todaySeed, ROSTER_SIZE,
  rollNationality, draftChoices, teamPower, samplePack, nextEndlessEvent,
  makeSeason, buildBracket, nextBracketRound, currentRound, playerMatch,
  setPlayerResult, resolveNpcMatches, seedOf,
  pickMaps, simMap, evaluateTournament, evaluateSeason,
  eligibleNationalPools, buildCpuNationalTeam, nationalChallengeTier,
  buildNationalBracket, resolveTournamentToChampion, updateEncRecords,
} from '../engine/perfectRun';
import {
  getClientId, submitDailyScore, fetchDailyLeaderboard, fetchOverallLeaderboard,
} from '../lib/leaderboardClient';
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
  const navigate = useNavigate();
  // menu | country | name | draft | review | intro | run | result | enc_result | locked | pack | over
  const [phase, setPhase] = useState('menu');
  const [mode, setMode] = useState('solo');           // solo | daily | enc
  const [runLength, setRunLength] = useState('season'); // season | endless
  const [squadName, setSquadName] = useState('');
  const rng = useRef(null);

  // leaderboard panel (menu)
  const [panelOpen, setPanelOpen] = useState(false);
  const [boardTab, setBoardTab] = useState('today');
  const [boardData, setBoardData] = useState({}); // {today, overall}: undefined=unfetched, null=offline

  // draft
  const [picks, setPicks] = useState([]);
  const [selectedNation, setSelectedNation] = useState(null);
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
  const usedCitiesRef = useRef([]); // endless: recent host cities, no repeats

  useEffect(() => () => {
    clearInterval(animTimer.current);
    clearInterval(revealTimer.current);
    clearTimeout(advanceTimer.current);
  }, []);

  const pickedIds = new Set(picks.map(p => p.id));
  const power = picks.length === ROSTER_SIZE ? teamPower(picks, iglId) : null;
  const nationalPools = useMemo(() => eligibleNationalPools(allCards), []);
  const nationalOptions = useMemo(() => {
    const teams = nationalPools
      .map(pool => ({ pool, team: buildCpuNationalTeam(pool.nationality, pool.cards) }))
      .filter(item => item.team)
      .sort((a, b) => b.team.power - a.team.power || a.pool.nationality.localeCompare(b.pool.nationality));
    return teams.map((item, index) => ({
      ...item.pool,
      projectedPower: item.team.power,
      projectedSeed: index + 1,
      tier: nationalChallengeTier(index + 1),
    }));
  }, [nationalPools]);

  // ── Draft flow ────────────────────────────────────────────────────────────

  function startRun(selectedMode, length = 'season') {
    const seed = selectedMode === 'daily' ? todaySeed() : (Date.now() & 0xffffffff);
    rng.current = mulberry32(seed);
    setMode(selectedMode);
    setRunLength(length);
    setSquadName('');
    setPicks([]); setIglId(null); setSelectedNation(null); setRipId(0);
    setRerolls(selectedMode === 'daily' ? 1 : 3);
    const openingSeason = makeSeason(rng.current);
    setSeason(openingSeason);
    usedCitiesRef.current = openingSeason.map(t => t.city);
    setTourIndex(0); setTourResults([]); setCurrentResult(null); setSeasonResult(null);
    setTour(null); setView('board'); setBoardState('pairings'); setRevealCount(0);
    setMaps([]); setMapResults([]); setLive(null);
    historyRef.current = [];
    setPackNat(null); setPackChoices([]); setPackPick(null);
    clearInterval(animTimer.current);
    clearInterval(revealTimer.current);
    clearTimeout(advanceTimer.current);
    seriesActive.current = false;
    setPanelOpen(false);
    if (selectedMode === 'enc') {
      setNat(null); setChoices([]);
      setSeason([{ kind: 'enc', city: '', label: 'Esports Nations Cup' }]);
      setPhase('country');
    } else {
      rollSlot(new Set(), selectedMode); // state hasn't committed yet, pass mode
      setPhase('name');
    }
  }

  function chooseNation(nationality) {
    const pool = nationalPools.find(item => item.nationality === nationality);
    if (!pool) return;
    setSelectedNation(nationality);
    setSquadName(countryName(nationality));
    setPicks([]); setIglId(null); setNat(nationality);
    setChoices(pool.cards);
    setPhase('draft');
  }

  function confirmSquadName(event) {
    event.preventDefault();
    const name = squadName.trim();
    if (!name) return;
    setSquadName(name);
    setPhase('draft');
  }

  // ENC drafts by nation roll; everyone else rips a pack of 5 random cards.
  function rollSlot(ids, m = mode) {
    if (m === 'enc') {
      const rolled = rollNationality(rng.current, allCards, ids);
      setNat(rolled);
      setChoices(draftChoices(allCards, rolled, ids));
    } else {
      setNat(null);
      setChoices(samplePack(rng.current, allCards, ids));
    }
    setRipId(id => id + 1);
  }

  function pickPlayer(card) {
    const next = [...picks, card];
    setPicks(next);
    if (next.length < ROSTER_SIZE) {
      if (mode === 'enc') {
        setChoices(draftChoices(allCards, selectedNation, new Set(next.map(p => p.id))));
      } else {
        rollSlot(new Set(next.map(p => p.id)));
      }
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
    const t = mode === 'enc'
      ? buildNationalBracket(allCards, selectedNation, picks, iglId)
      : buildBracket(rng.current, allCards, pickedIds, playerTeam, def.kind);
    if (mode === 'enc') {
      for (const team of Object.values(t.teams)) team.name = countryName(team.nationality);
      // A top-30 seed receives a preliminary bye. Resolve those two matches
      // before presenting the player's Round of 32 pairing.
      if (currentRound(t).key === 'preliminary' && !playerMatch(t)) {
        resolveNpcMatches(t, rng.current);
        nextBracketRound(t);
      }
    }
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
    if (outcome === 'out') {
      if (mode === 'enc') {
        const finishRound = round.label;
        const championId = resolveTournamentToChampion(tour, rng.current);
        setTour({ ...tour });
        endTournament(false, finishRound, championId);
      } else {
        endTournament(false);
      }
      return;
    }
    travelThenNextRound();
  }

  // Generate stable destination rows, then fly every winner forward while
  // keeping the completed source round mounted.
  function travelThenNextRound() {
    const prevRound = currentRound(tour);
    nextBracketRound(tour);
    const newRound = currentRound(tour);
    travelInfo.current = {
      moves: prevRound.matches.map((match, index) => ({
        teamId: match.winner,
        fromKey: `${prevRound.key}:${index}`,
        toKey: `${newRound.key}:${newRound.matches.findIndex(next => next.a === match.winner || next.b === match.winner)}`,
      })),
    };
    setTour({ ...tour });
    setBoardState('travel');
  }

  // Runs after the travel round has rendered: measure, clone, animate.
  useLayoutEffect(() => {
    if (boardState !== 'travel') return;
    const finish = () => setBoardState('pairings');
    const info = travelInfo.current;
    const overlay = overlayRef.current;
    const container = bracketRef.current;

    if (reduceMotion() || isMobile() || !info?.moves?.length || !overlay || !container) {
      finish();
      return;
    }

    const cRect = container.getBoundingClientRect();
    const cleanups = [];
    const animations = info.moves.map(move => {
      const fromEl = cellRefs.current[move.fromKey];
      const toEl = cellRefs.current[move.toKey];
      const fromRow = [...(fromEl?.querySelectorAll('[data-team-id]') ?? [])].find(row => row.dataset.teamId === move.teamId);
      const toRow = [...(toEl?.querySelectorAll('[data-team-id]') ?? [])].find(row => row.dataset.teamId === move.teamId);
      if (!fromRow || !toRow) return Promise.resolve();
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
      cleanups.push(() => {
        clone.remove();
        fromRow.style.visibility = '';
        toRow.style.visibility = '';
      });
      const bridgeX = x0 + (x1 - x0) * 0.5;
      return clone.animate([
        { transform: `translate(${x0}px, ${y0}px)` },
        { transform: `translate(${bridgeX}px, ${y0}px)`, offset: 0.35 },
        { transform: `translate(${bridgeX}px, ${y1}px)`, offset: 0.65 },
        { transform: `translate(${x1}px, ${y1}px)` },
      ], { duration: TRAVEL_MS, easing: 'cubic-bezier(0.5, 0, 0.2, 1)', fill: 'forwards' }).finished.catch(() => {});
    });

    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      cleanups.forEach(fn => fn());
      finish();
    };
    Promise.all(animations).then(cleanup);
    const guard = setTimeout(cleanup, TRAVEL_MS + 400);
    return () => { clearTimeout(guard); cleanup(); };
  }, [boardState]);

  function endTournament(champion, finishRound = round.label, championId = champion ? 'player' : null) {
    const finishedSeries = historyRef.current;
    const evalT = evaluateTournament(finishedSeries, champion);
    const result = {
      kind: def.kind, label: def.label, city: def.city,
      champion, series: finishedSeries, badges: evalT.badges,
      finishRound,
      championId,
      championNation: championId ? tour.teams[championId]?.nationality : null,
    };
    setTourResults(rs => [...rs, result]);
    setCurrentResult(result);
    if (mode === 'enc') {
      const saves = loadSaves();
      saves.enc = updateEncRecords(saves.enc, {
        series: finishedSeries, champion, mapsLost: evalT.mapsLost, finishRound,
      });
      saveSaves(saves);
      setPhase('enc_result');
    } else {
      setPhase('result');
    }
  }

  const endless = runLength === 'endless';

  function continueFromResult() {
    const isLast = !endless && tourIndex >= season.length - 1;
    if (isLast) { finishSeason(); return; }
    if (currentResult.champion) {
      setPhase('locked');
    } else {
      rollPack();
      setPhase('pack');
    }
  }

  function finishSeason() {
    const result = evaluateSeason(tourResults, { endless });
    setSeasonResult(result);

    const saves = loadSaves();
    // Endless scores grow without bound, so they get their own best and
    // never mix with the fixed-season record.
    if (endless) saves.bestEndless = Math.max(saves.bestEndless ?? 0, result.score);
    else saves.bestScore = Math.max(saves.bestScore ?? 0, result.score);
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
      // Shared board entry; the server's UNIQUE(date, client) is the real
      // once-per-day gate. Fire-and-forget: offline just means no submit.
      void submitDailyScore({ date: k, squadName, score: result.score });
    }
    saveSaves(saves);
    setPhase('over');
  }

  // Endless grows the season lazily: one more event whenever the player
  // steps past the end of the list.
  function nextTournament() {
    const next = tourIndex + 1;
    if (endless && next >= season.length) {
      const ev = nextEndlessEvent(rng.current, next, usedCitiesRef.current);
      usedCitiesRef.current = [...usedCitiesRef.current, ev.city].slice(-10);
      setSeason(s => [...s, ev]);
    }
    setTourIndex(next);
    setPhase('intro');
  }

  // ── Consolation pack ────────────────────────────────────────────────────────

  function rollPack() {
    const ids = new Set(picks.map(p => p.id));
    if (mode === 'enc') {
      const rolled = rollNationality(rng.current, allCards, ids);
      setPackNat(rolled);
      setPackChoices(draftChoices(allCards, rolled, ids));
    } else {
      setPackNat(null);
      setPackChoices(samplePack(rng.current, allCards, ids));
    }
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
  const dailyPlayed = todayBest != null;
  const titleCount = (saves.badges?.masters ?? 0) + (saves.badges?.champions ?? 0);

  // Open the leaderboard panel and lazy-fetch the tab once per menu visit.
  function openBoard(tab) {
    setPanelOpen(true);
    setBoardTab(tab);
    if (boardData[tab] !== undefined) return;
    const fetcher = tab === 'today'
      ? fetchDailyLeaderboard(dateKey())
      : fetchOverallLeaderboard();
    fetcher.then(rows => setBoardData(d => ({ ...d, [tab]: rows })));
  }

  const fanCards = useMemo(() =>
    allCards
      .filter(c => c.photo !== '/assets/players/placeholder.png')
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 3),
  []);

  // Memoized: endless runs make this O(events) and it renders often.
  const runningScore = useMemo(
    () => evaluateSeason(tourResults, { endless }),
    [tourResults, endless],
  );

  return (
    <div className={[styles.shell, mode === 'enc' && phase !== 'menu' ? styles.encTheme : ''].join(' ')}>
      <div className={styles.pageHeader}>
        <NavHeader right={phase === 'run' && round && def
          ? `${def.label} · ${round.label} (Bo${round.bestOf})`
          : undefined} />
      </div>

      <main className={styles.page}>

      {phase === 'menu' && (
        <>
          <section className={styles.menu}>
            <div className={styles.menuMain}>
              <h1 className={styles.menuTitle}>Perfect<br />Run<em>//</em></h1>
              <p className={styles.menuTag}>Pick your run. Zero maps dropped.</p>

              <div className={styles.menuModes}>
                <div className={`${styles.modeBtn} ${styles.modeSplit}`}>
                  <span className={styles.modeBtnName}>Solo Run</span>
                  <span className={styles.modeSplitActions}>
                    <button className={styles.modeSplitAction} onClick={() => startRun('solo', 'season')}>
                      One Season
                      <small>3 cities</small>
                    </button>
                    <button className={styles.modeSplitAction} onClick={() => startRun('solo', 'endless')}>
                      Endless
                      <small>no finish line</small>
                    </button>
                  </span>
                </div>
                {dailyPlayed ? (
                  <button className={styles.modeBtn} onClick={() => openBoard('today')}>
                    <span className={styles.modeBtnName}>Daily Challenge</span>
                    <span className={styles.modeBtnSub}>played today · view leaderboard</span>
                  </button>
                ) : (
                  <button className={styles.modeBtn} onClick={() => startRun('daily')}>
                    <span className={styles.modeBtnName}>Daily Challenge</span>
                    <span className={styles.modeBtnSub}>shared packs, 1 reroll, once a day</span>
                  </button>
                )}
                <button className={`${styles.modeBtn} ${styles.encTile}`} onClick={() => startRun('enc')}>
                  <span className={styles.modeBtnName}>
                    <span className={styles.encMark} aria-hidden="true">ENC</span>
                    Esports Nations Cup
                  </span>
                  <span className={styles.modeBtnSub}>choose a nation · 32-team cup</span>
                </button>
                <button className={styles.modeBtn} onClick={() => navigate('/multiplayer')}>
                  <span className={styles.modeBtnName}>Multiplayer</span>
                  <span className={styles.modeBtnSub}>2–16 squads · lobby code</span>
                </button>
              </div>

              <div className={styles.recordStrip}>
                <span>Best <b><CountUp value={saves.bestScore ?? 0} /></b></span>
                <span>Endless <b><CountUp value={saves.bestEndless ?? 0} /></b></span>
                <span>Titles <b><CountUp value={titleCount} /></b></span>
                <span>Slams <b><CountUp value={saves.badges?.grand_slam ?? 0} /></b></span>
                <span>Perfect <b><CountUp value={saves.badges?.perfect_season ?? 0} /></b></span>
                <button className={styles.boardToggle} onClick={() => (panelOpen ? setPanelOpen(false) : openBoard('today'))}>
                  {panelOpen ? 'Hide leaderboard' : 'Leaderboard'}
                </button>
              </div>

              {panelOpen && (
                <LeaderboardPanel
                  tab={boardTab}
                  onTab={openBoard}
                  data={boardData}
                  todayBest={todayBest}
                />
              )}
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
          <p className={styles.groupNote}>
            {runLength === 'endless'
              ? 'This name stays with your roster for as long as you keep the run going.'
              : mode === 'daily'
                ? 'This name goes on the daily leaderboard with your score.'
                : 'This name stays with your roster through all three cities.'}
          </p>
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

      {phase === 'country' && (
        <CountryPicker options={nationalOptions} onChoose={chooseNation} />
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
            hideReroll={mode === 'enc'}
            label={mode === 'enc' ? `Build the ${countryName(selectedNation)} roster` : undefined}
          />
        </section>
      )}

      {phase === 'review' && (
        <section>
          <h2 className={styles.sectionTitle}>Choose an IGL for {squadName}. Click a player.</h2>
          {mode === 'enc' && power?.lines.some(line => String(line.label).startsWith('Missing:')) && (
            <p className={styles.roleWarning}>This lineup is missing role coverage. You can still enter, but chemistry will reduce its power.</p>
          )}
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
          <span className={styles.introMarker}>
            {endless ? `Tournament ${tourIndex + 1}` : `Tournament ${tourIndex + 1} / ${season.length}`}
          </span>
          <h1 className={styles.introTitle}>{def.label}<em>//</em></h1>
          <p className={styles.introTag}>
            {mode === 'enc' ? `${nationalOptions.length} nations. One world champion.` : '16 teams. Single elimination.'}
          </p>
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
              {opp.logo && <img src={assetPath(opp.logo)} alt="" />}
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
          isLast={!endless && tourIndex >= season.length - 1}
          onEndRun={endless ? finishSeason : undefined}
        />
      )}

      {phase === 'enc_result' && currentResult && tour && (
        <EncResult
          result={currentResult}
          tour={tour}
          saves={saves.enc}
          onReplay={() => startRun('enc')}
          onMenu={() => setPhase('menu')}
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
            {endless
              ? <>Next up <b>tournament {tourIndex + 2}</b></>
              : <>Next up <b>{season[tourIndex + 1]?.label}</b></>}
          </div>
          <div className={styles.overButtons}>
            <button className={styles.primary} onClick={nextTournament}>
              {endless ? 'Keep it rolling' : `On to ${season[tourIndex + 1]?.city}`}
            </button>
            {endless && (
              <button className={styles.secondary} onClick={finishSeason}>
                End run · final results
              </button>
            )}
          </div>
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
          nextLabel={endless ? `tournament ${tourIndex + 2}` : season[tourIndex + 1]?.label}
          onEndRun={endless ? finishSeason : undefined}
        />
      )}

      {phase === 'over' && seasonResult && (
        <SeasonOver
          result={seasonResult}
          tourResults={tourResults}
          season={season}
          endless={endless}
          onReplay={() => startRun(mode, runLength)}
          onMenu={() => setPhase('menu')}
        />
      )}
      </main>
    </div>
  );
}

function CountryPicker({ options, onChoose }) {
  return (
    <section className={styles.countryStep}>
      <span className={styles.introMarker}>Esports Nations Cup</span>
      <h1 className={styles.countryTitle}>Choose your nation<em>//</em></h1>
      <p className={styles.groupNote}>Every country with at least seven available players enters the cup. Projected seed reflects its automatic balanced roster.</p>
      <div className={styles.tierLegend}>
        <span><b>Contender</b> seeds 1–8</span>
        <span><b>Challenger</b> seeds 9–24</span>
        <span><b>Underdog</b> seeds 25+</span>
      </div>
      <div className={styles.countryGrid}>
        {options.map(option => (
          <button key={option.nationality} className={styles.countryCard} onClick={() => onChoose(option.nationality)}>
            <span className={`fi fi-${option.nationality.toLowerCase()} ${styles.countryFlag}`} aria-hidden="true" />
            <span className={styles.countryIdentity}>
              <b>{countryName(option.nationality)}</b>
              <small>{option.cards.length} players</small>
            </span>
            <span className={`${styles.countryTier} ${styles['tier' + option.tier]}`}>{option.tier}</span>
            <span className={styles.countryProjection}>#{option.projectedSeed} · {option.projectedPower.toFixed(1)}</span>
          </button>
        ))}
      </div>
    </section>
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
          hideCurrentPlayer={false}
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

function Bracket({ tour, currentRoundKey, isRevealed, registerCell, bracketRef, overlayRef, hideCurrentPlayer }) {
  const preliminary = tour.rounds.find(round => round.key === 'preliminary');
  const keys = tour.roundKeys ?? ['r16', 'quarter', 'semi', 'final'];
  const baseMatches = (tour.mainSize ?? 16) / 2;
  const rounds = keys.map(key => tour.rounds.find(round => round.key === key));

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
      {preliminary && (
        <div className={styles.preliminaryBlock}>
          <span className={styles.poolLabel}>Preliminary Round</span>
          <div className={styles.preliminaryMatches}>
            {preliminary.matches.map((match, index) => (
              <BracketCell
                key={`preliminary-${index}`}
                tour={tour}
                match={match}
                revealed={preliminary.key === currentRoundKey ? isRevealed(match) : !!match.winner}
                hidePlayer={false}
                cellRef={el => registerCell(`preliminary:${index}`, el)}
              />
            ))}
          </div>
        </div>
      )}
      <div
        className={styles.bracket}
        ref={bracketRef}
        style={{
          gridTemplateColumns: keys.map((_, index) => index === keys.length - 1 ? 'minmax(190px, 1fr)' : 'minmax(190px, 1fr) 22px').join(' '),
          gridTemplateRows: `auto repeat(${baseMatches}, 92px)`,
          minWidth: `${keys.length * 220}px`,
        }}
      >
        {keys.map((key, roundIndex) => {
          const roundObj = rounds[roundIndex];
          const matchCount = baseMatches / (2 ** roundIndex);
          const span = 2 ** roundIndex;
          const column = roundIndex * 2 + 1;
          return [
            <span key={`${key}-label`} className={styles.poolLabel} style={{ gridColumn: column, gridRow: 1 }}>
              {roundObj?.label ?? ({ r32: 'Round of 32', r16: 'Round of 16', quarter: 'Quarterfinals', semi: 'Semifinals', final: 'Grand Final' }[key] ?? key)}
            </span>,
            ...Array.from({ length: matchCount }, (_, index) =>
              slot(column, index * span + 2, index * span + span + 2, cell(roundObj, index, key), `${key}-${index}`)),
            ...(roundIndex < keys.length - 1
              ? Array.from({ length: matchCount / 2 }, (_, index) =>
                conn(column + 1, index * span * 2 + 2, index * span * 2 + span * 2 + 2, `${key}-conn-${index}`))
              : []),
          ];
        })}
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
      {team.nationality
        ? <span className={`fi fi-${team.nationality.toLowerCase()}`} aria-hidden="true" />
        : team.logo ? <img src={assetPath(team.logo)} alt="" /> : <span className={styles.youMark}>★</span>}
      <span className={styles.cellSeed}>{seedOf(tour, team.id)}</span>
      <span className={styles.cellTag}>{team.isPlayer ? (team.nationality ? `YOU · ${team.tag}` : 'YOU') : team.tag}</span>
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

function EncResult({ result, tour, saves, onReplay, onMenu }) {
  const champion = tour.teams[result.championId];
  return (
    <section className={styles.encResult}>
      <span className={styles.introMarker}>Esports Nations Cup complete</span>
      <h1 className={result.champion ? styles.overWin : styles.overFail}>
        {result.champion ? `${countryName(champion.nationality)} are world champions` : `${countryName(champion.nationality)} win the cup`}
      </h1>
      <p className={styles.groupNote}>
        {result.champion ? 'You completed the national run.' : `${countryName(selectedNationFromTour(tour))} finished in the ${result.finishRound}.`}
      </p>
      <div className={styles.encRecordStrip}>
        <span>Best finish <b>{saves?.bestFinish ?? '—'}</b></span>
        <span>Titles <b>{saves?.titles ?? 0}</b></span>
        <span>Flawless <b>{saves?.flawless ?? 0}</b></span>
      </div>
      <Bracket
        tour={tour}
        currentRoundKey="complete"
        isRevealed={() => true}
        registerCell={() => {}}
        bracketRef={null}
        overlayRef={null}
        hideCurrentPlayer={false}
      />
      <div className={styles.overButtons}>
        <button className={styles.primary} onClick={onReplay}>Choose another nation</button>
        <button className={styles.secondary} onClick={onMenu}>Back to menu</button>
      </div>
    </section>
  );
}

function selectedNationFromTour(tour) {
  return tour.teams.player?.nationality;
}

// ── Tournament result interstitial ───────────────────────────────────────────

function TournamentResult({ result, runningScore, onContinue, isLast, onEndRun }) {
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

      <div className={styles.scoreLine}>{onEndRun ? 'Run score' : 'Season score'}<b>{runningScore}</b></div>

      <div className={styles.overButtons}>
        <button className={styles.primary} onClick={onContinue}>
          {isLast ? 'Season results' : 'Continue'}
        </button>
        {onEndRun && (
          <button className={styles.secondary} onClick={onEndRun}>
            End run · final results
          </button>
        )}
      </div>
    </section>
  );
}

// ── Consolation pack: pick one, swap one ─────────────────────────────────────

function PackPhase({ nat, choices, picks, iglId, ripId, pick, onPickNew, onSwap, onSkip, nextLabel, onEndRun }) {
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
          label={nat ? 'One roll' : 'Five cards, one roll'}
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
        {onEndRun && (
          <button className={styles.secondary} onClick={onEndRun}>
            End run · final results
          </button>
        )}
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

const OVER_HISTORY_CAP = 12;

function SeasonOver({ result, tourResults, season, endless, onReplay, onMenu }) {
  const headline = endless
    ? 'Run Complete'
    : result.perfectSeason ? 'Perfect Season'
    : result.grandSlam ? 'Grand Slam'
    : result.titles > 0 ? 'Season Complete'
    : 'Season Over';
  // Endless runs can span dozens of events; show only the tail.
  const skipped = Math.max(0, tourResults.length - OVER_HISTORY_CAP);
  const shown = tourResults.slice(skipped);
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
        {skipped > 0 && (
          <div className={styles.historyRow}>
            <span className={styles.historyStage}>Earlier</span>
            <span className={styles.historyOpp}>{skipped} more tournament{skipped > 1 ? 's' : ''}</span>
          </div>
        )}
        {shown.map((tr, i) => (
          <div key={skipped + i} className={[styles.historyRow, tr.champion ? styles.mapWin : styles.mapLoss].join(' ')}>
            <span className={styles.historyStage}>{season[skipped + i]?.kind === 'champions' ? 'Champions' : 'Masters'}</span>
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
        {endless ? ` ${result.events} ${result.events === 1 ? 'tournament' : 'tournaments'},` : ''}
        {' '}{result.titles} {result.titles === 1 ? 'title' : 'titles'}, {result.seriesWon} series won,
        {' '}{result.mapsWon} maps, {result.roundDiff >= 0 ? '+' : ''}{result.roundDiff} round differential
      </div>

      <div className={styles.overButtons}>
        <button className={styles.primary} onClick={onReplay}>Run it back</button>
        <button className={styles.secondary} onClick={onMenu}>Menu</button>
      </div>
    </section>
  );
}

// ── Leaderboard panel (menu): Today / Overall tabs ───────────────────────────

function LeaderboardPanel({ tab, onTab, data, todayBest }) {
  const rows = data[tab]; // undefined loading, null offline, [] empty
  const me = getClientId();
  return (
    <div className={styles.boardPanel}>
      <div className={styles.boardTabs}>
        <button
          className={[styles.boardTab, tab === 'today' ? styles.boardTabOn : ''].join(' ')}
          onClick={() => onTab('today')}
        >
          Today
        </button>
        <button
          className={[styles.boardTab, tab === 'overall' ? styles.boardTabOn : ''].join(' ')}
          onClick={() => onTab('overall')}
        >
          All time
        </button>
        {todayBest != null && <span className={styles.boardMine}>your score {todayBest}</span>}
      </div>

      {rows === undefined && <p className={styles.boardNote}>Loading…</p>}
      {rows === null && <p className={styles.boardNote}>Leaderboard offline.</p>}
      {Array.isArray(rows) && rows.length === 0 && (
        <p className={styles.boardNote}>
          {tab === 'today' ? 'No scores yet today. Set the pace.' : 'No scores yet.'}
        </p>
      )}
      {Array.isArray(rows) && rows.length > 0 && (
        <ol className={styles.boardList}>
          {rows.map((r, i) => (
            <li
              key={r.clientId ?? i}
              className={[styles.boardRow, r.clientId === me ? styles.boardMe : ''].join(' ')}
            >
              <span className={styles.boardRank}>{i + 1}</span>
              <span className={styles.boardName}>{r.squadName}</span>
              {tab === 'overall' && r.days != null && (
                <span className={styles.boardDays}>{r.days} day{r.days > 1 ? 's' : ''}</span>
              )}
              <span className={styles.boardScore}>{tab === 'today' ? r.score : r.best}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
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

  // nation === null means a "normal" unboxing pack of random cards
  const face = (
    <span className={styles.packFaceInner}>
      {nation && <span className={`fi fi-${nation.toLowerCase()}`} style={{ width: 46, height: 33 }} />}
      <span className={styles.packName}>{nation ? countryName(nation) : 'Five card pack'}</span>
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
            {nation && <span className={`fi fi-${nation.toLowerCase()}`} style={{ width: 34, height: 24 }} />}
            {nation ? countryName(nation) : 'Five card pack'}
            <small className={styles.draftCount}>
              {nation ? `${choices.length} available` : 'keep one'}
            </small>
          </span>
        </div>
        {interactive && !hideReroll && (
          <button className={styles.rerollBtn} onClick={onReroll} disabled={rerolls <= 0 || ripping}>
            {nation ? 'Reroll nation' : 'Reroll pack'} ({rerolls} left)
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
