import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { m, AnimatePresence } from 'motion/react';
import { DUR, EASE, STAGGER, eliminationFlash } from '../lib/motion';
import ModeRail from '../components/ModeRail';
import PlayerCard from '../components/PlayerCard';
import PlayerPortrait from '../components/PlayerPortrait';
import CardFocusOverlay from '../components/CardFocusOverlay';
import PhaseTransition from '../components/PhaseTransition';
import TacticalButton from '../components/TacticalButton';
import SquadBar from '../components/SquadBar';
import SquadDock from '../components/SquadDock';
import MatchBackdrop from '../components/MatchBackdrop';
import PackRip from '../components/PackRip';
import allCards from '../data/cards.json';
import { assetPath, countryName } from '../lib/utils';
import useSkippableTimeline from '../lib/useSkippableTimeline';
import useRunSpeed, { scaleDuration } from '../lib/useRunSpeed';
import {
  mulberry32, todaySeed, ROSTER_SIZE,
  rollNationality, draftChoices, teamPower, samplePack,
  makeSeason, buildBracket, nextBracketRound, currentRound, playerMatch,
  setPlayerResult, resolveNpcMatches, seedOf,
  pickMaps, simMap, evaluateTournament, evaluateSeason,
  eligibleNationalPools, buildCpuNationalTeam, nationalChallengeTier,
  buildNationalBracket, resolveTournamentToChampion, updateEncRecords,
  teamSimulationPower,
  buildEndlessBracket, effectiveTeamPower, nextEndlessCycle,
} from '../engine/perfectRun';
import {
  getClientId, submitDailyScore, fetchDailyLeaderboard, fetchOverallLeaderboard,
} from '../lib/leaderboardClient';
import { describeRound, roundPacing, roundSignificance } from '../engine/roundEvents';
import styles from './PerfectRun.module.css';
import hub from '../styles/hub.module.css';

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
function newRunSeed(mode) {
  return mode === 'daily' ? todaySeed() : (Date.now() & 0xffffffff);
}
const TRAVEL_MS = 900;
// Stable empty-Set default so BracketCell's `pendingArrivalIds?.has(...)`
// check never needs a fresh Set() on every render of every non-traveling cell.
const EMPTY_TEAM_ID_SET = new Set();

// Endless no longer carries fatigue/boosts; effectiveTeamPower still runs so
// event modifiers apply, fed this inert run-state.
const NO_RUN_FX = { fatigue: {}, boosts: {}, teamChemBonus: 0 };

const FAN_POOL = allCards.filter(card => card.photo !== '/assets/players/placeholder.png');
function drawFanCards() {
  const shuffled = [...FAN_POOL];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled.slice(0, 3);
}

export default function PerfectRun() {
  const navigate = useNavigate();
  // menu | country | name | draft | intro | run | result | enc_result | manage | pack | over
  const [phase, setPhase] = useState('menu');
  const [mode, setMode] = useState('solo');           // solo | daily | enc
  const [runLength, setRunLength] = useState('season'); // season | endless
  const [squadName, setSquadName] = useState('');
  const [fanCards] = useState(drawFanCards);
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
  const [packs, setPacks] = useState(3);
  const [ripId, setRipId] = useState(0); // bumped per roll, keys the pack-rip

  // review — the leftmost dock slot is always the IGL, so there's no
  // separate stored choice: dragging a card into position 0 (SquadDock's
  // chip-swap) or tapping a face on SquadHero both just reorder `picks`,
  // and this recomputes from wherever that reorder landed.
  const iglId = picks[0]?.id ?? null;

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
  // Holds the series' finished results between "series over" and the
  // skippable pause before returning to the board — null when no series is
  // waiting. A boolean-shaped active flag (`!== null`) rather than the array
  // itself, so useSkippableTimeline's effect (keyed on `active`) actually
  // retriggers series to series instead of staying permanently "active".
  const [pendingBoardReturn, setPendingBoardReturn] = useState(null);
  // Speedrunner preference — Normal/Fast/Instant — persisted alongside the
  // run's other saves. Scales the three longest auto-advance pauses below;
  // round-to-round pacing itself still runs through roundEvents.js's own
  // `roundPacing(desc, opts)` seam, so the engine file is never touched.
  // No menu control for it any more — the universal skip button (see
  // `currentSkip` below) now covers the "let me go faster" need directly,
  // for every automatic sequence in the run, not just these three. The
  // preference itself (and its persistence) stays wired for a possible
  // future settings page rather than being ripped out.
  const [runSpeed] = useRunSpeed(loadSaves().motionSpeed, (next) => {
    const saves = loadSaves();
    saves.motionSpeed = next;
    saveSaves(saves);
  });
  const [live, setLive] = useState(null);              // {a,b} while a map animates
  const [liveRound, setLiveRound] = useState(0);
  const [roundPulse, setRoundPulse] = useState(null);
  // Which side just won the most recent round — 'A' (player) or 'B' (opp) —
  // keyed so a repeat winner still re-flashes. The score digits key off
  // `key` to remount and replay a brief color flash toward --ink at rest.
  const [roundFlash, setRoundFlash] = useState(null);
  // Backdrop zoom is a persistent 1-3 state, not a pulse: it steps up when
  // play gets tense and then STAYS there — it does not auto-revert after a
  // round the way the old one-shot "surge" animation did. It only resets at
  // two points: a fresh series (playMatch) and back at the bracket board
  // (backToBoard), which must always read as the calmest, most zoomed-out
  // view. zoomLevelRef mirrors the state for synchronous reads inside the
  // reveal timeout chain, where the state value in that closure would
  // otherwise be stale from whenever playNextMap was originally called.
  const [zoomLevel, setZoomLevel] = useState(1);
  const zoomLevelRef = useRef(1);
  // Picks which backdrop image shows. Bumped once when a series starts, and
  // again each time zoomLevel actually escalates (so at most twice more per
  // series, since there are only two steps above 1) — tying image variety to
  // the same tension that drives the zoom, rather than a schedule no one
  // could see happening.
  const [backdropVariant, setBackdropVariant] = useState(0);

  // consolation pack
  const [packNat, setPackNat] = useState(null);
  const [packChoices, setPackChoices] = useState([]);
  // { card, targetId } once a pack card has been dragged onto a specific
  // dock chip — the swap doesn't touch `picks` yet at that point, only once
  // it's confirmed (see confirmSwap/cancelSwap below). Picking is drag-only
  // here on purpose: a plain tap can't tell PackRip which existing roster
  // member it's meant to replace, only that a card was chosen.
  const [pendingSwap, setPendingSwap] = useState(null);

  // Squad chip → single-card focus overlay (flip, specialties).
  const [focusCard, setFocusCard] = useState(null);

  const animTimer = useRef(null);
  const revealTimer = useRef(null);
  const seriesActive = useRef(false); // guards double "Play your match"
  // The currently-live map's finishMap, so a skip button can jump straight
  // to that map's (already fully computed) result instead of waiting out
  // the round-by-round reveal. Bracket travel's equivalent early-exit sits
  // next to its own animation below (travelSkipRef).
  const matchSkipRef = useRef(null);
  const travelSkipRef = useRef(null);

  // travel animation plumbing
  const cellRefs = useRef({});
  const bracketRef = useRef(null);
  const overlayRef = useRef(null);
  const travelInfo = useRef(null);
  // Team ids currently mid-flight to the next round. While a team's id is in
  // this set, its destination cell renders literal "TBD" instead of the real
  // matchup — the traveling clone is what visually "delivers" the reveal, so
  // the destination never flashes the answer before the clone carrying it
  // actually arrives. Cleared per-team as each clone's own animation finishes.
  const [pendingArrivalIds, setPendingArrivalIds] = useState(EMPTY_TEAM_ID_SET);
  const historyRef = useRef([]);
  const usedCitiesRef = useRef([]); // endless: recent host cities, no repeats

  useEffect(() => () => {
    clearTimeout(animTimer.current);
    clearInterval(revealTimer.current);
  }, []);

  const pickedIds = new Set(picks.map(p => p.id));
  const endless = runLength === 'endless';
  const currentModifier = season[tourIndex]?.modifier?.key ?? null;
  const power = picks.length === ROSTER_SIZE
    ? (endless ? effectiveTeamPower(picks, iglId, NO_RUN_FX, currentModifier) : teamPower(picks, iglId))
    : null;
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
    const seed = newRunSeed(selectedMode);
    rng.current = mulberry32(seed);
    setMode(selectedMode);
    setRunLength(length);
    setSquadName('');
    setPicks([]); setSelectedNation(null); setRipId(0);
    setPacks(selectedMode === 'daily' ? 1 : 3);
    const openingSeason = length === 'endless' ? nextEndlessCycle(rng.current, 0) : makeSeason(rng.current);
    setSeason(openingSeason);
    usedCitiesRef.current = openingSeason.map(t => t.city);
    setTourIndex(0); setTourResults([]); setCurrentResult(null); setSeasonResult(null);
    setTour(null); setView('board'); setBoardState('pairings'); setRevealCount(0);
    setMaps([]); setMapResults([]); setLive(null); setLiveRound(0); setRoundPulse(null); setRoundFlash(null); setBackdropVariant(0);
    setZoomLevel(1); zoomLevelRef.current = 1;
    setPendingBoardReturn(null);
    setPendingArrivalIds(EMPTY_TEAM_ID_SET);
    historyRef.current = [];
    setPackNat(null); setPackChoices([]); setPendingSwap(null);
    clearTimeout(animTimer.current);
    clearInterval(revealTimer.current);
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
    setPicks([]); setNat(nationality);
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
      setPhase('manage');
    }
  }

  // Dock-chip drag-to-swap. Safe to apply directly to local state — and
  // load-bearing now, not just cosmetic: the leftmost slot (index 0) is
  // always the IGL (see `iglId` above), so swapping a card into or out of
  // position 0 is how you change who leads the team, including mid-season
  // between matches (the dock stays visible everywhere `barVisible` is true
  // except live match simulation itself).
  function swapPicks(idA, idB) {
    setPicks(prev => {
      const iA = prev.findIndex(p => p.id === idA);
      const iB = prev.findIndex(p => p.id === idB);
      if (iA === -1 || iB === -1 || iA === iB) return prev;
      const next = [...prev];
      [next[iA], next[iB]] = [next[iB], next[iA]];
      return next;
    });
  }

  function reroll() {
    if (packs <= 0) return;
    setPacks(p => p - 1);
    rollSlot(pickedIds);
  }

  // ── Tournament flow ───────────────────────────────────────────────────────

  function beginBracket() {
    const def = season[tourIndex];
    const playerTeam = {
      id: 'player', tag: 'YOU', name: squadName, logo: null,
      roster: picks, power: power.power, isPlayer: true,
    };
    const t = mode === 'enc'
      ? buildNationalBracket(rng.current, allCards, selectedNation, picks, iglId)
      : endless
        ? buildEndlessBracket(rng.current, allCards, pickedIds, playerTeam, def.kind, def.cycle, def.modifier)
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

  // Intro splash auto-advances into the bracket draw — skippable (Space,
  // Enter, or a click on the hint) and scaled by the run-speed preference.
  // useSkippableTimeline's own useReducedMotion subscription replaces the
  // ad hoc reduceMotion() read here, so toggling the OS setting mid-splash
  // now actually takes effect instead of waiting for the next mount.
  const introTimeline = useSkippableTimeline({
    duration: scaleDuration(1900, runSpeed),
    active: phase === 'intro',
    reducedDuration: 250,
    onDone: beginBracket,
  });

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
    setLiveRound(0);
    setRoundPulse(null);
    setRoundFlash(null);
    setBackdropVariant(v => v + 1); // this series' baseline backdrop
    setZoomLevel(1); zoomLevelRef.current = 1; // every series starts calm
    setView('match');
    animTimer.current = setTimeout(() => playNextMap(seriesMaps, []), 350);
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

    const playerMatchPower = mode === 'enc' ? teamSimulationPower(tour.teams.player) : power.power;
    const result = simMap(
      rng.current, playerMatchPower, teamSimulationPower(opp), picks, opp.roster,
      endless ? (def.modifier?.bias ?? 0) : 0,
      mode === 'enc' ? (tour.teams.player?.iglId ?? iglId) : iglId,
      opp.iglId ?? null,
    );
    const mapName = seriesMaps[resultsSoFar.length];

    setLive({ a: 0, b: 0 });
    setLiveRound(0);

    function finishMap() {
      matchSkipRef.current = null;
      setLive(null);
      const updated = [...resultsSoFar, { ...result, map: mapName }];
      setMapResults(updated);

      const wonNow = updated.filter(r => r.winA).length;
      const lostNow = updated.length - wonNow;
      if (wonNow < needed && lostNow < needed) {
        animTimer.current = setTimeout(() => playNextMap(seriesMaps, updated), 650);
      } else {
        // Handed off to the seriesEndTimeline below (skippable, run-speed
        // scaled) rather than a bare setTimeout — pendingBoardReturn flipping
        // null -> array is what that hook's `active` flag keys off.
        setPendingBoardReturn(updated);
      }
    }

    function revealRound(index) {
      const desc = describeRound(result.rounds, index);
      if (!desc) return;
      setLive({ a: desc.a, b: desc.b });
      setLiveRound(desc.round);
      setRoundFlash(previous => ({ key: (previous?.key ?? 0) + 1, side: desc.winner }));
      if (roundSignificance(desc) === 'significant') {
        // Zoom is a persistent state, so this only ever steps UP within a
        // match — never resets itself after a round the way a pulse would.
        // A close finish holds isMatchPoint true for several rounds in a
        // row, so most of those land here with nothing to do; only the
        // round that actually clears the next threshold changes anything.
        const nextZoom = (desc.isMapPoint || desc.isOvertime) ? 3 : 2;
        if (nextZoom > zoomLevelRef.current) {
          zoomLevelRef.current = nextZoom;
          setZoomLevel(nextZoom);
          setBackdropVariant(v => v + 1); // fresh imagery as tension escalates
        }
        if (desc.isOvertime || desc.isStreakBreak) {
          setRoundPulse(previous => ({ key: (previous?.key ?? 0) + 1, kind: 'shake' }));
        }
      }

      if (index >= result.rounds.length - 1) {
        // Hold the deciding round for one beat so the counter visibly reaches
        // the final number before the row turns into a completed map.
        animTimer.current = setTimeout(finishMap, roundPacing(desc));
        return;
      }

      animTimer.current = setTimeout(() => revealRound(index + 1), roundPacing(desc));
    }

    matchSkipRef.current = finishMap;
    revealRound(0);
  }

  // Cancels whatever round-reveal step is pending and jumps straight to the
  // current map's already-fully-computed result — simMap runs the whole map
  // upfront, the reveal is purely presentational, so nothing here is a
  // shortcut past unknown outcomes.
  function skipMatch() {
    clearTimeout(animTimer.current);
    const fn = matchSkipRef.current;
    matchSkipRef.current = null;
    fn?.();
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
      // Only maps the player's own side actually took — an opponent's MVP
      // isn't a squad-report stat. Feeds the manage screen's tournament
      // report (most MVPs) after the tournament ends.
      mvpIds: results.filter(r => r.winA).map(r => r.mvp.id),
    };
    const nextHistory = [...historyRef.current, seriesResult];
    historyRef.current = nextHistory;

    setPlayerResult(tour, results, won);
    resolveNpcMatches(tour, rng.current);
    setTour({ ...tour });

    const npcCount = round.matches.filter(m => !m.isPlayerMatch).length;
    setRevealCount(0);
    setView('board');
    setZoomLevel(1); zoomLevelRef.current = 1; // the bracket page is always the calmest view
    setBoardState('revealing');
    let shown = 0;
    revealTimer.current = setInterval(() => {
      shown++;
      setRevealCount(shown);
      if (shown >= npcCount) {
        clearInterval(revealTimer.current);
        // boardCompleteTimeline (below) owns the pause into `advance()` now —
        // skippable and run-speed scaled, keyed off boardState === 'complete'.
        setBoardState('complete');
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

  // Skippable pause between a finished series and the board reveal —
  // pendingBoardReturn carries the just-played results across the wait.
  // Reset to null on fire so the boolean `active` flag actually toggles
  // false -> true again for the *next* series (an array reference alone
  // wouldn't retrigger the hook's effect, which is keyed on `active`).
  const seriesEndTimeline = useSkippableTimeline({
    duration: scaleDuration(1700, runSpeed),
    active: pendingBoardReturn !== null,
    onDone: () => {
      const results = pendingBoardReturn;
      setPendingBoardReturn(null);
      backToBoard(results);
    },
  });

  // Skippable pause once the bracket board finishes revealing NPC results,
  // before advancing the player onward (next round / result / consolation).
  const boardCompleteTimeline = useSkippableTimeline({
    duration: scaleDuration(2200, runSpeed),
    active: boardState === 'complete',
    onDone: advance,
  });

  // Whichever of the run's three long auto-advance pauses is currently live
  // — intro splash, series-end pause, or board-complete pause — drives one
  // shared skip hint. They're mutually exclusive by construction (distinct
  // phase/boardState/pendingBoardReturn conditions), so at most one is ever
  // truthy.
  const activeTimeline = phase === 'intro' ? introTimeline
    : pendingBoardReturn !== null ? seriesEndTimeline
      : boardState === 'complete' ? boardCompleteTimeline
        : null;

  // One shared skip affordance for every automatic sequence in the run —
  // not just the three duration-based pauses above, but the live match
  // round-reveal (`live !== null`) and the bracket travel flight
  // (`boardState === 'travel'`) too. All four are mutually exclusive by
  // construction, so at most one is ever truthy; `progress` is only
  // meaningful for the duration-based ones (a plain button otherwise).
  const currentSkip = activeTimeline && activeTimeline.remaining > 0
    ? { skip: activeTimeline.skip, progress: activeTimeline.progress }
    : live !== null
      ? { skip: skipMatch, progress: null }
      : boardState === 'travel'
        ? { skip: skipTravel, progress: null }
        : null;

  useEffect(() => {
    if (!currentSkip) return undefined;
    function onKey(e) {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        currentSkip.skip();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSkip?.skip]);

  // Generate stable destination rows, then fly every winner forward while
  // keeping the completed source round mounted.
  function travelThenNextRound() {
    const prevRound = currentRound(tour);
    nextBracketRound(tour);
    const newRound = currentRound(tour);
    const moves = prevRound.matches.map((match, index) => ({
      teamId: match.winner,
      fromKey: `${prevRound.key}:${index}`,
      toKey: `${newRound.key}:${newRound.matches.findIndex(next => next.a === match.winner || next.b === match.winner)}`,
    }));
    travelInfo.current = { moves };
    // nextBracketRound already placed every winner into the new round's real
    // matchups, but the UI shouldn't show that answer until each winner's
    // clone actually arrives — this is what keeps the destination on "TBD"
    // for the moves still mid-flight. Keyed by "toKey:teamId", not bare
    // teamId: a winner's id is ALSO sitting in its OLD round's cell (the
    // match it just won, still on screen one column back) — a bare-id Set
    // would mask that already-decided source cell too, since the same id
    // legitimately appears in both places. The composite key only ever
    // matches the one destination slot a given move is actually flying to.
    setPendingArrivalIds(new Set(moves.map(move => `${move.toKey}:${move.teamId}`)));
    // Real bug this masked until now: revealCount carries the PREVIOUS
    // round's NPC-reveal progress (e.g. 7, from a Round-of-16 cycle). Left
    // unreset, the new round's own isRevealed() check — npcMatches.indexOf(m)
    // < revealCount — is satisfied for every match in a smaller round (a
    // Quarterfinal has only ~4), so every destination cell picked up
    // .revealed styling the instant travel started, one frame before its
    // row's own text ever changed. That combination — dressed as "revealed"
    // while its text still said TBD — is what actually read as "the TBD
    // animating": two mismatched visual changes landing apart instead of
    // one clean swap when the traveling clone lands.
    setRevealCount(0);
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
      travelSkipRef.current = null;
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
      // The clone keeps its won/lost border for the whole flight rather than
      // going neutral — it's carrying forward the result that just earned
      // this team the trip, so the color travels with it instead of cutting
      // out. The destination itself stays on "TBD" throughout (driven by
      // pendingArrivalIds, not a visibility hide) and only the clone ever
      // sits at that position mid-flight — nothing to hide there.
      const clone = fromRow.cloneNode(true);
      clone.classList.add(styles.travelClone);
      const cloneScore = clone.querySelector('[data-bracket-score]');
      if (cloneScore) cloneScore.textContent = '';
      clone.style.width = `${a.width}px`;
      clone.style.height = `${a.height}px`;
      overlay.appendChild(clone);
      cleanups.push(() => clone.remove());
      const bridgeX = x0 + (x1 - x0) * 0.5;
      return clone.animate([
        { transform: `translate(${x0}px, ${y0}px)` },
        { transform: `translate(${bridgeX}px, ${y0}px)`, offset: 0.35 },
        { transform: `translate(${bridgeX}px, ${y1}px)`, offset: 0.65 },
        { transform: `translate(${x1}px, ${y1}px)` },
      ], { duration: TRAVEL_MS, easing: 'cubic-bezier(0.5, 0, 0.2, 1)', fill: 'forwards' }).finished.then(() => {
        // This clone has landed — reveal its real matchup at the
        // destination. Other still-in-flight moves keep their own keys in
        // the set until their own clone lands, independently.
        const arrivalKey = `${move.toKey}:${move.teamId}`;
        setPendingArrivalIds(prev => {
          if (!prev.has(arrivalKey)) return prev;
          const next = new Set(prev);
          next.delete(arrivalKey);
          return next;
        });
      }).catch(() => {});
    });

    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      cleanups.forEach(fn => fn());
      setPendingArrivalIds(EMPTY_TEAM_ID_SET);
      finish();
    };
    // Skipping just runs the same cleanup early — the in-flight clones get
    // torn down and any WAAPI animation still finishing on them lands on an
    // already-removed node, harmless. Their .finished callbacks racing in
    // after are already guarded (see the `prev.has` check above).
    travelSkipRef.current = cleanup;
    Promise.all(animations).then(cleanup);
    const guard = setTimeout(cleanup, TRAVEL_MS + 400);
    return () => { travelSkipRef.current = null; clearTimeout(guard); cleanup(); };
  }, [boardState]);

  function skipTravel() {
    travelSkipRef.current?.();
  }

  function endTournament(champion, finishRound = round.label, championId = champion ? 'player' : null) {
    const finishedSeries = historyRef.current;
    const evalT = evaluateTournament(finishedSeries, champion);

    // Tournament-report stats for the manage screen: an MVP leaderboard
    // across every map the player's side won this tournament, plus the
    // series/map record and who led. Computed here (once, at the moment the
    // tournament actually ends) rather than re-derived on every manage-screen
    // render, since `picks`/`iglId` may have already moved on by the time
    // that screen re-renders after a pack swap.
    const mvpCounts = new Map();
    for (const s of finishedSeries) {
      for (const id of s.mvpIds ?? []) mvpCounts.set(id, (mvpCounts.get(id) ?? 0) + 1);
    }
    const mvpBoard = [...mvpCounts.entries()]
      .map(([id, count]) => ({ card: picks.find(p => p.id === id), count }))
      .filter(entry => entry.card)
      .sort((a, b) => b.count - a.count);

    const result = {
      kind: def.kind, label: def.label, city: def.city,
      champion, series: finishedSeries, badges: evalT.badges,
      finishRound,
      championId,
      championNation: championId ? tour.teams[championId]?.nationality : null,
      cycle: def.cycle ?? Math.floor(tourIndex / 3),
      mvpBoard,
      seriesWon: finishedSeries.filter(s => s.won).length,
      seriesPlayed: finishedSeries.length,
      mapsWonTotal: finishedSeries.reduce((s, x) => s + x.mapsWon, 0),
      mapsLostTotal: finishedSeries.reduce((s, x) => s + x.mapsLost, 0),
      igl: picks.find(p => p.id === iglId) ?? null,
    };
    setTourResults(rs => [...rs, result]);
    setCurrentResult(result);
    if (champion) setPacks(p => p + 1);
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

  function continueFromResult() {
    const isLast = !endless && tourIndex >= season.length - 1;
    if (isLast) { finishSeason(); return; }
    setPhase('manage');
  }

  function finishSeason() {
    const result = evaluateSeason(tourResults, { endless });
    setSeasonResult(result);

    const saves = loadSaves();
    // Endless scores grow without bound, so they get their own best and
    // never mix with the fixed-season record.
    if (endless) {
      saves.bestEndless = Math.max(saves.bestEndless ?? 0, result.score);
      saves.bestCycle = Math.max(saves.bestCycle ?? 0, result.bestCycle ?? 0);
    }
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

  function nextTournament() {
    const next = tourIndex + 1;
    if (endless && next >= season.length) {
      const events = nextEndlessCycle(rng.current, Math.floor(next / 3), usedCitiesRef.current);
      usedCitiesRef.current = [...usedCitiesRef.current, ...events.map(event => event.city)].slice(-10);
      setSeason(s => [...s, ...events]);
    }
    setTourIndex(next);
    setPhase('intro');
  }

  // ── Squad packs ──────────────────────────────────────────────────────────

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
    setPendingSwap(null);
    setRipId(id => id + 1);
  }

  // Spends one banked pack, opening it right away. Committed the instant
  // it's opened — declining the swap afterward still costs the pack, same
  // as a draft reroll spends its pack whether or not you like what you see.
  function openPack() {
    if (packs <= 0) return;
    setPacks(p => p - 1);
    rollPack();
    setPhase('pack');
  }

  // In-place replacement (same index) — if the outgoing card was the
  // leftmost/IGL slot, the incoming one lands there too and just inherits
  // the title, no separate reassignment needed.
  function confirmSwap() {
    if (!pendingSwap) return;
    const { card: incoming, targetId } = pendingSwap;
    const next = picks.map(p => (p.id === targetId ? incoming : p));
    setPicks(next);
    setPendingSwap(null);
    setPhase('manage');
  }

  function cancelSwap() {
    setPendingSwap(null);
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

  // Memoized: endless runs make this O(events) and it renders often.
  const runningScore = useMemo(
    () => evaluateSeason(tourResults, { endless }),
    [tourResults, endless],
  );

  // Everything the persistent bottom row needs, derived per phase. The row
  // owns the primary gameplay actions so the player always acts in one place.
  const barActions = (() => {
    switch (phase) {
      case 'draft':
        return mode === 'enc' ? [] : [{
          key: 'reroll', kind: 'secondary', onClick: reroll,
          disabled: packs <= 0,
          label: `Reroll ${nat ? 'nation' : 'pack'} (${packs})`,
        }];
      case 'run':
        return view === 'board' && boardState === 'pairings'
          ? [{ key: 'play', kind: 'primary', onClick: playMatch, label: 'Play your match →' }]
          : [];
      case 'result':
        return [
          {
            key: 'continue', kind: 'primary', onClick: continueFromResult,
            label: !endless && tourIndex >= season.length - 1 ? 'Season results' : 'Continue',
          },
          ...(endless ? [{ key: 'end', kind: 'secondary', onClick: finishSeason, label: 'End run' }] : []),
        ];
      case 'manage': {
        // No dedicated IGL-review step anymore — the leftmost dock slot
        // always has someone in it the instant the roster's full, and this
        // same screen (chemistry + portraits) is also the very first stop
        // after drafting, before any tournament has a result to report on.
        const preSeason = !currentResult;
        return [
          {
            key: 'next', kind: 'primary',
            onClick: preSeason ? () => setPhase('intro') : nextTournament,
            label: preSeason
              ? `Enter ${season[0]?.label ?? 'the season'}`
              : (endless ? 'Keep it rolling' : `On to ${season[tourIndex + 1]?.city}`),
          },
          ...(endless && !preSeason ? [{ key: 'end', kind: 'secondary', onClick: finishSeason, label: 'End run' }] : []),
        ];
      }
      case 'pack':
        return [
          {
            key: 'skip', kind: 'secondary',
            onClick: () => setPhase('manage'),
            label: 'Keep squad',
          },
          ...(endless ? [{ key: 'end', kind: 'secondary', onClick: finishSeason, label: 'End run' }] : []),
        ];
      default:
        return [];
    }
  })();

  // Space also fires whatever the bar's single primary action is (Continue,
  // On to X, Play your match →) — everywhere skip doesn't already own the
  // key. Skipped while focus sits on something that already handles
  // Space/Enter itself (a button, a link) or is mid-typing (the squad name
  // field) — this is a global convenience shortcut, not a replacement for
  // normal keyboard activation of whatever's actually focused.
  const primaryBarAction = barActions.find(a => a.kind === 'primary' && !a.disabled);
  const hasSkip = Boolean(currentSkip);
  const primaryOnClick = primaryBarAction?.onClick;
  useEffect(() => {
    if (hasSkip || !primaryOnClick) return undefined;
    function onKey(e) {
      if (e.key !== ' ' && e.key !== 'Enter') return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'A') return;
      e.preventDefault();
      primaryOnClick();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hasSkip, primaryOnClick]);

  const barVisible = ['draft', 'intro', 'run', 'result', 'manage', 'pack'].includes(phase)
    && !(phase === 'run' && view === 'match');
  const drawerRoster = picks;
  const latestMap = mapResults.at(-1) ?? null;
  const stageScore = live ?? latestMap ?? { a: 0, b: 0 };

  return (
    <>
    <MatchBackdrop
      active={phase !== 'menu'}
      mode={phase === 'run' && view === 'match' ? 'live' : 'calm'}
      kind={def?.kind ?? null}
      variant={backdropVariant}
      reaction={roundPulse}
      // Belt and suspenders on top of the explicit resets in playMatch and
      // backToBoard: even if some future path forgot to reset the state,
      // the bracket page (and everywhere else that isn't the live match)
      // can never render an escalated zoom, because it isn't live.
      zoomLevel={phase === 'run' && view === 'match' ? zoomLevel : 1}
    />
    <div className={[
      styles.shell,
      phase !== 'menu' ? styles.immersive : '',
      mode === 'enc' && phase !== 'menu' ? styles.encTheme : '',
      barVisible ? styles.withBar : '',
    ].join(' ')}>
      <ModeRail />

      <div className={styles.frame}>
        <main className={[
          styles.page,
          phase === 'menu' ? styles.menuPage : '',
          phase === 'run' && view === 'match' ? styles.matchPage : '',
        ].join(' ')}>

      <AnimatePresence mode="wait">
      {phase === 'menu' && (
        <PhaseTransition phaseKey="menu">
        <div className={hub.column}>
          <div className={`${hub.title} ${styles.rise}`}>
            <img
              className={hub.logotype}
              src={assetPath('/assets/brand/gauntlet-logotype.webp')}
              alt="VCT Gauntlet"
            />
          </div>

          <div className={hub.body}>
            <div className={styles.menuStack}>
              <div className={`${styles.menuModes} ${styles.rise} ${styles.riseB}`}>
                <div className={`${styles.modeBtn} ${styles.modeSplit}`}>
                  <span className={styles.modeBtnName}>Solo Run</span>
                  <span className={styles.modeSplitActions}>
                    <button className={styles.modeSplitAction} onClick={() => startRun('solo', 'season')}>
                      One Season
                    </button>
                    <button className={styles.modeSplitAction} onClick={() => startRun('solo', 'endless')}>
                      Endless
                    </button>
                  </span>
                </div>
                {dailyPlayed ? (
                  <button className={styles.modeBtn} onClick={() => openBoard('today')}>
                    <span className={styles.modeBtnName}>
                      Daily Challenge
                      <span className={styles.modeBtnFlag}>Played</span>
                    </span>
                  </button>
                ) : (
                  <button className={styles.modeBtn} onClick={() => startRun('daily')}>
                    <span className={styles.modeBtnName}>Daily Challenge</span>
                  </button>
                )}
                <button className={`${styles.modeBtn} ${styles.encTile}`} onClick={() => startRun('enc')}>
                  <span className={styles.modeBtnName}>
                    <span className={styles.encMark} aria-hidden="true">ENC</span>
                    Esports Nations Cup
                  </span>
                </button>
                <button className={styles.modeBtn} onClick={() => navigate('/multiplayer')}>
                  <span className={styles.modeBtnName}>Multiplayer</span>
                </button>
              </div>

              <div className={`${hub.meta} ${styles.recordStrip} ${styles.rise} ${styles.riseC}`}>
                <span>Best <b><CountUp value={saves.bestScore ?? 0} /></b></span>
                <span>Endless <b><CountUp value={saves.bestEndless ?? 0} /></b></span>
                <span>Cycle <b><CountUp value={saves.bestCycle ?? 0} /></b></span>
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

            <div className={`${styles.menuFan} ${styles.fanIn}`} aria-hidden="true">
              {fanCards.map(card => (
                <div key={card.id} className={styles.fanCard}>
                  <PlayerCard card={card} displayScale={0.52} />
                </div>
              ))}
            </div>
          </div>

          <p className={styles.disclaimer}>
            Ratings are approximations tuned for game balance, not official VCT statistics.
          </p>
        </div>
        </PhaseTransition>
      )}

      {phase === 'name' && (
        <PhaseTransition phaseKey="name">
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
        </PhaseTransition>
      )}

      {phase === 'country' && (
        <PhaseTransition phaseKey="country">
        <CountryPicker options={nationalOptions} onChoose={chooseNation} />
        </PhaseTransition>
      )}

      {phase === 'draft' && (
        <PhaseTransition phaseKey="draft">
        <section>
          <DraftLane
            nation={nat}
            choices={choices}
            ripId={ripId}
            interactive
            onPick={pickPlayer}
            label={mode === 'enc' ? `Build the ${countryName(selectedNation)} roster` : undefined}
          />
        </section>
        </PhaseTransition>
      )}

      {phase === 'intro' && def && (
        <PhaseTransition phaseKey="intro">
        <section className={`${styles.intro} ${def.kind === 'champions' && endless ? styles.bossIntro : ''}`}>
          <span className={styles.introMarker}>
            {endless ? `Tournament ${tourIndex + 1}` : `Tournament ${tourIndex + 1} / ${season.length}`}
          </span>
          <h1 className={styles.introTitle}>{def.label}<em>//</em></h1>
          {endless && def.kind === 'champions' && <span className={styles.bossBadge}>BOSS EVENT</span>}
          {endless && def.modifier && <div className={styles.modifierBanner}><b>{def.modifier.label}</b><span>{def.modifier.desc}</span></div>}
          {endless && def.kind === 'masters' && season.find((event, index) => index >= tourIndex && event.kind === 'champions')?.modifier && (
            <div className={styles.nextBoss}>NEXT BOSS: {season.find((event, index) => index >= tourIndex && event.kind === 'champions').modifier.label}</div>
          )}
        </section>
        </PhaseTransition>
      )}

      {phase === 'run' && view === 'board' && tour && round && (
        <PhaseTransition phaseKey="run:board">
        <Board
          tour={tour}
          round={round}
          boardState={boardState}
          revealCount={revealCount}
          outcome={playerOutcome()}
          squadName={squadName}
          pendingArrivalIds={pendingArrivalIds}
          registerCell={(k, el) => { if (el) cellRefs.current[k] = el; }}
          bracketRef={bracketRef}
          overlayRef={overlayRef}
        />
        </PhaseTransition>
      )}

      {phase === 'run' && view === 'match' && round && opp && (
        <PhaseTransition phaseKey="run:match">
        <section className={styles.broadcast}>
          <div className={styles.castHeroes} aria-hidden="true">
            <HeroBand roster={picks} side="left" />
            <HeroBand roster={opp.roster} side="right" />
          </div>

          <div className={`${styles.castSide} ${styles.castSideLeft}`}>
            <span className={styles.castTeamName}>{squadName}</span>
            <span className={styles.castPower}>
              Power {power.power.toFixed(1)}
              {mode === 'enc' && <FormBadge label={tour.teams.player.formLabel} />}
            </span>
            {picks.map(p => (
              <span key={p.id} className={styles.castPlayer}>
                {p.player}{p.id === iglId ? ' (IGL)' : ''} · {p.rating}
              </span>
            ))}
          </div>

          <div className={styles.castCentre} aria-live="polite">
            <span className={styles.liveTag}>
              {seriesOver
                ? (mapsWon >= needed ? 'Series won' : 'Series lost')
                : `Live · ${maps[mapResults.length]}`}
            </span>
            <div className={styles.castScore}>
              <span className={styles.castSeries}>Series {mapsWon}–{mapsLost}</span>
              {/* Flashes the round-winner's color (--accent for the player,
                  --opponent for them) and settles back to --ink — the
                  smallest change that makes "who just won that round"
                  unmistakable without a bespoke banner. Keying on
                  roundFlash.key remounts the span so a repeat winner still
                  replays the flash instead of no-op-ing on an unchanged
                  initial value. */}
              <m.span
                key={roundFlash?.key ?? 'idle'}
                className={styles.castBig}
                initial={roundFlash ? { color: roundFlash.side === 'A' ? 'var(--accent)' : 'var(--opponent)' } : false}
                animate={{ color: 'var(--ink)' }}
                transition={{ duration: DUR.hero }}
              >
                {stageScore.a}–{stageScore.b}
              </m.span>
              <span className={styles.castRound}>
                {live ? `Round ${liveRound}` : latestMap ? `${latestMap.map} final` : 'Map loading'}
              </span>
            </div>
            <div className={styles.castMaps}>
              {maps.map((m, i) => {
                const r = mapResults[i];
                const isLive = live && i === mapResults.length;
                return (
                  <div key={m} className={[styles.castMapRow, r ? (r.winA ? styles.mapWin : styles.mapLoss) : '', isLive ? styles.castMapLive : ''].join(' ')}>
                    <span className={styles.castMapName}>{m}</span>
                    {r && <span className={styles.castMapScore}>{r.a} – {r.b}</span>}
                    {isLive && <span className={styles.castMapScore}>{live.a} – {live.b}</span>}
                    {!r && !isLive && <span className={styles.castMapScore}><i>up next</i></span>}
                    {r && <span className={styles.castMapMvp}>MVP <b>{r.mvp.player}</b></span>}
                    {!r && <span className={styles.castMapMvp} />}
                  </div>
                );
              })}
            </div>
          </div>

          <div className={`${styles.castSide} ${styles.castSideRight}`}>
            <span className={styles.castTeamName}>
              {opp.name}
              {opp.logo && <img src={assetPath(opp.logo)} alt="" />}
            </span>
            <span className={styles.castPower}>
              Power {opp.power.toFixed(1)}
              {mode === 'enc' && <FormBadge label={opp.formLabel} />}
            </span>
            {opp.roster.map(p => (
              <span key={p.id} className={styles.castPlayer}>
                {p.player}{p.id === opp.iglId ? ' (IGL)' : ''} · {p.rating}
              </span>
            ))}
          </div>
        </section>
        </PhaseTransition>
      )}

      {phase === 'result' && currentResult && (
        <PhaseTransition phaseKey="result">
        <TournamentResult
          result={currentResult}
          runningScore={runningScore.score}
          endless={endless}
        />
        </PhaseTransition>
      )}

      {phase === 'enc_result' && currentResult && tour && (
        <PhaseTransition phaseKey="enc_result">
        <EncResult
          result={currentResult}
          tour={tour}
          saves={saves.enc}
          squadName={squadName}
          onReplay={() => startRun('enc')}
          onMenu={() => setPhase('menu')}
        />
        </PhaseTransition>
      )}

      {phase === 'manage' && def && (
        <PhaseTransition phaseKey="manage">
        <section className={[styles.between, styles.manageScreen].join(' ')}>
          <span className={styles.introMarker}>
            {!currentResult ? 'Squad ready' : currentResult.champion ? 'Squad locked in' : 'Regroup'}
          </span>
          <h2 className={styles.betweenTitle}>
            {!currentResult ? 'Take the field' : currentResult.champion ? 'Champions stay together' : 'Back to the drawing board'}
          </h2>
          {mode === 'enc' && power?.lines.some(line => String(line.label).startsWith('Missing:')) && (
            <p className={styles.roleWarning}>This lineup is missing role coverage. You can still enter, but chemistry will reduce its power.</p>
          )}
          {power && <ChemPanel power={power} />}
          {/* Newest first — `tourResults` accumulates in chronological order
              as each tournament resolves, currentResult already being its
              own last entry. */}
          <div className={styles.tourReportList}>
            {[...tourResults].reverse().map((result, i) => (
              <TournamentReport key={`${tourResults.length - 1 - i}-${result.label}`} result={result} />
            ))}
          </div>
        </section>
        </PhaseTransition>
      )}

      {phase === 'pack' && (
        <PhaseTransition phaseKey="pack">
        <PackPhase
          nat={packNat}
          choices={packChoices}
          ripId={ripId}
          picks={picks}
          pendingSwap={pendingSwap}
          onDropSwap={(card, targetId) => setPendingSwap({ card, targetId })}
          onConfirm={confirmSwap}
          onCancel={cancelSwap}
        />
        </PhaseTransition>
      )}

      {phase === 'over' && seasonResult && (
        <PhaseTransition phaseKey="over">
        <SeasonOver
          result={seasonResult}
          tourResults={tourResults}
          season={season}
          endless={endless}
          onReplay={() => startRun(mode, runLength)}
          onMenu={() => setPhase('menu')}
        />
        </PhaseTransition>
      )}
      </AnimatePresence>

      {currentSkip && (
        <SkipHint onSkip={currentSkip.skip} progress={currentSkip.progress} />
      )}
      </main>
      </div>

      {/* Fixed chrome, not scrolling page content — a sibling of SquadBar,
          entirely outside AnimatePresence/PhaseTransition above, so no
          Framer Motion ancestor's clip-path wipe can trap it into the wrong
          containing block for position: fixed (see .manageFaces). Purely
          decorative here (no onPick), the roster's already reachable via
          the dock chips right below it. */}
      {phase === 'manage' && (
        <div className={styles.manageFaces} aria-hidden="true">
          <SquadHero picks={picks} iglId={iglId} />
        </div>
      )}

      {barVisible && (
        <SquadBar
          dock={(
            <SquadDock
              roster={drawerRoster}
              size={ROSTER_SIZE}
              iglId={iglId}
              squadName={squadName}
              onFocusCard={setFocusCard}
              focusCardId={focusCard?.id ?? null}
              packs={packs}
              // Only wired up while the manage screen owns the "open a
              // pack" action — the pack badge stays a visible readout on
              // every other phase (draft, run, result…) but forcing phase
              // to 'pack' from, say, mid-match would be a broken jump, not
              // a shortcut.
              onOpenPack={phase === 'manage' ? openPack : null}
              onSwap={swapPicks}
            />
          )}
        >
          {/* action.onClick (playMatch, reroll, etc.) is passed by reference
              here, never called; whatever refs those functions touch
              internally are only actually read once the button fires,
              inside the event handler React's own docs name as the
              sanctioned place for it. */}
          {barActions.map(action => (
            <TacticalButton
              key={action.key}
              className={action.kind === 'primary' ? styles.primary : styles.secondary}
              onClick={action.onClick}
              disabled={action.disabled}
            >
              {action.label}
            </TacticalButton>
          ))}
        </SquadBar>
      )}

      {/* Clicking a dock chip opens it full size (and flippable) rather than
          firing the phase's action blind — the action moves into the overlay,
          where you can actually read the card you're acting on. */}
      <CardFocusOverlay
        card={focusCard}
        onClose={() => setFocusCard(null)}
      />
    </div>
    </>
  );
}

// ── Squad hero: the drafted five as overlapping cut-out photos, dealt in
//    one at a time. Purely decorative — shown on the manage screen, in front
//    of the chemistry/tournament report. IGL is a position (leftmost dock
//    slot, reassigned there by drag-to-swap), not something picked here. ──

function SquadHero({ picks, iglId }) {
  // Every card has a portrait now — a photo-less one composites a grey head
  // onto its org's kit, exactly as its card does. Filtering on `photo` used to
  // drop those players out of the lineup entirely, so a squad with two
  // photo-less picks silently showed three faces.
  const mid = (picks.length - 1) / 2;
  return (
    <div className={styles.squadHero} aria-hidden="true">
      {picks.map((card, i) => (
        <div
          key={card.id}
          className={styles.heroFace}
          style={{ '--i': i, zIndex: Math.round(10 - Math.abs(i - mid)) }}
        >
          <PlayerPortrait card={card} fluid loading="lazy" />
          {card.id === iglId && <span className={styles.squadIgl}>IGL</span>}
        </div>
      ))}
    </div>
  );
}

// One team's five as overlapping cut-out photos — the broadcast match view
// runs two of these, mirrored, flanking the score plate.
function HeroBand({ roster, side }) {
  // No photo filter — see SquadHero. Dropping photo-less players here left one
  // side of the broadcast plate with fewer faces than the other.
  const list = roster.slice(0, ROSTER_SIZE);
  const mid = (list.length - 1) / 2;
  return (
    <div className={[styles.castBand, side === 'right' ? styles.castBandRight : ''].join(' ')}>
      {list.map((card, i) => (
        <div
          key={card.id}
          className={styles.castFace}
          style={{ '--i': i, zIndex: Math.round(10 - Math.abs(i - mid)) }}
        >
          <PlayerPortrait card={card} fluid loading="lazy" />
        </div>
      ))}
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

function Board({ tour, round, boardState, revealCount, outcome, squadName, pendingArrivalIds, registerCell, bracketRef, overlayRef }) {
  const npcMatches = round.matches.filter(m => !m.isPlayerMatch);
  const isRevealed = (m) => {
    if (m.isPlayerMatch) return !!m.winner;
    if (boardState === 'pairings') return false;
    return npcMatches.indexOf(m) < revealCount;
  };

  const statusLine = (() => {
    // Nothing has happened yet at this state, and no line reads better than a
    // restated rule (the bracket itself already shows the format).
    if (boardState === 'pairings') return '';
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
        <span className={styles.boardStatus}>
          {tour.kind === 'enc' && <FormBadge label={tour.teams.player?.formLabel} prefix="Your form" />}
          <span className={styles.groupNote}>{statusLine}</span>
        </span>
      </div>

      <Bracket
        tour={tour}
        currentRoundKey={round.key}
        isRevealed={isRevealed}
          squadName={squadName}
          pendingArrivalIds={pendingArrivalIds}
          registerCell={registerCell}
          bracketRef={bracketRef}
          overlayRef={overlayRef}
          hideCurrentPlayer={false}
      />
    </section>
  );
}

function FormBadge({ label, prefix }) {
  if (!label) return null;
  return (
    <span className={`${styles.formBadge} ${styles['form' + label]}`}>
      {prefix ? `${prefix}: ${label}` : label}
    </span>
  );
}

function Bracket({ tour, currentRoundKey, isRevealed, squadName, pendingArrivalIds, registerCell, bracketRef, overlayRef, hideCurrentPlayer }) {
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
        squadName={squadName}
        // BracketCell checks pendingArrivalIds by "thisCellKey:teamId", not
        // bare teamId — a winner's id also already sits in its OLD round's
        // cell (the match it just won, still on screen one column back), so
        // a bare-id check would mask that already-decided source cell too.
        // Passing this cell's own key lets BracketCell match only its own
        // slot's entry, so a raw id shared between the source and
        // destination cells never collides.
        pendingArrivalIds={pendingArrivalIds}
        cellKey={key}
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
                squadName={squadName}
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

function BracketCell({ tour, match, revealed, hidePlayer, squadName, pendingArrivalIds = EMPTY_TEAM_ID_SET, cellKey, cellRef }) {
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
  // A team mid-flight to this slot (see travelThenNextRound/pendingArrivalIds)
  // renders as TBD here too — data-team-id stays put either way so the travel
  // effect's querySelector still finds this exact row to measure and animate
  // toward. The traveling clone is what visually delivers the reveal; this
  // cell only shows the real matchup once that clone has actually landed.
  // Checked as "thisCellKey:teamId", not bare teamId: a winner's id also
  // already sits in its OLD round's cell one column back (the match it just
  // won), and a bare-id check would mask that already-decided cell too.
  const row = (team, score, isWinner, isLoser) => {
    const pending = pendingArrivalIds.has(`${cellKey}:${team.id}`);
    return (
      <div
        className={[styles.bracketTeam, isWinner ? styles.cellWon : '', isLoser ? styles.cellLost : '', team.isPlayer ? styles.bracketYou : '', hidePlayer && team.isPlayer ? styles.roundHidden : ''].join(' ')}
        data-team-id={team.id}
      >
        {pending ? (
          <span className={styles.cellTag}>TBD</span>
        ) : (
          <>
            {team.nationality
              ? <span className={`fi fi-${team.nationality.toLowerCase()}`} aria-hidden="true" />
              : team.logo ? <img src={assetPath(team.logo)} alt="" /> : <span className={styles.youMark}>★</span>}
            <span className={styles.cellSeed}>{seedOf(tour, team.id)}</span>
            <span className={styles.cellTag}>
              {team.isPlayer ? (team.nationality ? `${squadName} · ${team.tag}` : squadName) : team.tag}
            </span>
            <span className={styles.bracketScore} data-bracket-score>{revealed ? score : ''}</span>
          </>
        )}
      </div>
    );
  };
  return (
    <div className={[styles.bracketCell, match.isPlayerMatch ? styles.playerMatch : '', revealed ? styles.revealed : ''].join(' ')} ref={cellRef}>
      {row(a, match.scoreA, revealed && match.winner === a.id, revealed && match.winner === b.id)}
      {row(b, match.scoreB, revealed && match.winner === b.id, revealed && match.winner === a.id)}
    </div>
  );
}

function EncResult({ result, tour, saves, squadName, onReplay, onMenu }) {
  const champion = tour.teams[result.championId];
  return (
    <section className={styles.encResult}>
      <span className={styles.introMarker}>Esports Nations Cup complete</span>
      <h1 className={result.champion ? styles.overWin : styles.overFail}>
        {result.champion ? `${countryName(champion.nationality)} are world champions` : `${countryName(champion.nationality)} win the cup`}
      </h1>
      {result.champion ? (
        <p className={styles.groupNote}>You completed the national run.</p>
      ) : (
        <m.p className={styles.groupNote} animate={eliminationFlash.animate}>
          {`${countryName(selectedNationFromTour(tour))} finished in the ${result.finishRound}.`}
        </m.p>
      )}
      <div className={styles.encRecordStrip}>
        <span>Best finish <b>{saves?.bestFinish ?? '—'}</b></span>
        <span>Titles <b>{saves?.titles ?? 0}</b></span>
        <span>Flawless <b>{saves?.flawless ?? 0}</b></span>
      </div>
      <Bracket
        tour={tour}
        currentRoundKey="complete"
        isRevealed={() => true}
        squadName={squadName}
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

function TournamentResult({ result, runningScore, endless }) {
  return (
    <section className={styles.result}>
      <span className={styles.introMarker}>{result.label}</span>
      {result.champion ? (
        <h2 className={styles.overWin}>Champions</h2>
      ) : (
        // Elimination is one of R3's four rationed triggers: a single
        // authored glitch that settles into a desaturated hold, not a pulse
        // that snaps back — the run is actually over, so the color stays
        // drained rather than recovering.
        <m.h2 className={styles.overFail} animate={eliminationFlash.animate}>
          {`Out in the ${result.finishRound}`}
        </m.h2>
      )}

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
          <m.div
            key={i}
            className={[styles.historyRow, h.won ? styles.mapWin : styles.mapLoss].join(' ')}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: DUR.enter, ease: EASE.out, delay: i * STAGGER }}
          >
            <span className={styles.historyStage}>{h.stage}</span>
            <span className={styles.historyOpp}>vs {h.opp}</span>
            <span className={styles.historyScore}>{h.mapsWon}–{h.mapsLost}</span>
            <span className={styles.historyMaps}>{h.score}</span>
          </m.div>
        ))}
      </div>

      <div className={styles.scoreLine}>{endless ? 'Run score' : 'Season score'}<b>{runningScore}</b></div>
    </section>
  );
}

// ── Squad pack: pick one, swap one ───────────────────────────────────────────

// Picking is drag-only: dragging a pack card onto a specific dock chip is
// what tells the game which roster member it's proposed to replace, so a
// blind tap can't stand in for that (there's no chip for it to name). The
// drop only proposes the swap — nothing touches `picks` until Confirm.
function PackPhase({ nat, choices, ripId, picks, pendingSwap, onDropSwap, onConfirm, onCancel }) {
  const outgoing = pendingSwap ? picks.find(p => p.id === pendingSwap.targetId) : null;
  return (
    <section>
      <div className={styles.boardHead}>
        <span className={styles.stageLabel}>Open pack</span>
      </div>

      {/* Always mounted, just hidden — conditionally rendering this in and
          out of the tree instead would remount PackRip/PackTear every time
          Cancel clears `pendingSwap`, replaying the whole tear-open
          animation from scratch instead of snapping straight back to the
          already-revealed strip. */}
      <div style={pendingSwap ? { display: 'none' } : undefined}>
        <DraftLane
          nation={nat}
          choices={choices}
          ripId={ripId}
          interactive
          onPick={onDropSwap}
          dropTarget="chip"
          clickable={false}
        />
        <p className={styles.swapHint}>Drag a card into the dock below to choose who it replaces.</p>
      </div>

      {pendingSwap && outgoing && (
        <div className={styles.swapArea}>
          <div className={styles.swapConfirm}>
            <div className={styles.swapIncoming}>
              <span className={styles.stripLabel}>Incoming</span>
              <PlayerCard card={pendingSwap.card} displayScale={0.42} />
            </div>
            <span className={styles.swapArrow} aria-hidden="true">→</span>
            <div className={styles.swapOutgoing}>
              <span className={styles.stripLabel}>Leaving</span>
              <PlayerCard card={outgoing} displayScale={0.42} />
            </div>
          </div>
          <div className={styles.swapConfirmActions}>
            <TacticalButton className={styles.secondary} onClick={onCancel}>Cancel</TacticalButton>
            <TacticalButton className={styles.primary} onClick={onConfirm}>Confirm swap</TacticalButton>
          </div>
        </div>
      )}
    </section>
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

// The manage screen's backdrop: a flat stat readout for the tournament that
// just ended, in the same label/big-number/breakdown-rows language ChemPanel
// already uses on the review screen — not a fresh "card of stats" template.
// Sits behind SquadHero's portraits (lower z-index, same section), so it
// reads as the report the squad is standing in front of, not a separate box.
function TournamentReport({ result }) {
  if (!result) return null;
  const topMvp = result.mvpBoard?.[0];
  const seriesLost = result.seriesPlayed - result.seriesWon;
  return (
    <div className={styles.tourReport} aria-hidden="true">
      <div className={styles.tourReportTotal}>
        <span>{result.label}</span>
        <b>{result.champion ? 'Champion' : result.finishRound}</b>
      </div>
      <ul className={styles.tourReportLines}>
        <li><span>Series</span><b>{result.seriesWon}–{seriesLost}</b></li>
        <li><span>Maps</span><b>{result.mapsWonTotal}–{result.mapsLostTotal}</b></li>
        {topMvp && (
          <li><span>Most MVPs</span><b>{topMvp.card.player} · {topMvp.count}</b></li>
        )}
        {result.igl && (
          <li><span>In-game leader</span><b>{result.igl.player}</b></li>
        )}
      </ul>
    </div>
  );
}

// ── Draft lane: header + pack rip + horizontal choice strip + picks ─────────

function DraftLane({ nation, choices, ripId, interactive, onPick, label, dropTarget, clickable }) {
  return (
    <PackRip
      ripId={ripId}
      nation={nation}
      packTitle={nation ? countryName(nation) : undefined}
      choices={choices}
      interactive={interactive}
      onPick={onPick}
      headerLabel={label}
      displayScale={0.5}
      dropTarget={dropTarget}
      clickable={clickable}
    />
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

// The shared skip affordance for every automatic sequence in the run — the
// three duration-based pauses (intro splash, series-end, board-complete),
// the live match round-reveal, and the bracket travel flight. `progress`
// (1 -> 0, a draining bar) only exists for the duration-based ones; the
// other two are indeterminate, so the button renders alone — deliberately
// the smaller of the two looks, since those two already have their own
// clear motion (a scoreline ticking, a team flying across the bracket) to
// read as "this is still going," where the button's only job is offering
// the door out, not narrating progress that's already visible elsewhere.
// Space/Enter is wired globally in the effect above; this is the visible +
// pointer-reachable door into the same skip.
function SkipHint({ onSkip, progress }) {
  return (
    <div className={styles.skipHint} role="status">
      <div className={styles.skipTrack}>
        <div className={styles.skipFill} style={progress != null ? { '--progress': progress } : undefined} />
      </div>
      <button type="button" className={styles.skipBtn} onClick={onSkip}>
        Space to skip
      </button>
    </div>
  );
}
