import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { m, AnimatePresence } from 'motion/react';
import { DUR, EASE, STAGGER, eliminationFlash } from '../lib/motion';
import ModeRail from '../components/ModeRail';
import PlayerCard from '../components/PlayerCard';
import PlayerPortrait from '../components/PlayerPortrait';
import { hasRealPortrait } from '../lib/portrait';
import CardFocusOverlay from '../components/CardFocusOverlay';
import PhaseTransition from '../components/PhaseTransition';
import TacticalButton from '../components/TacticalButton';
import CountryFlag from '../components/CountryFlag';
import SquadBar from '../components/SquadBar';
import SquadDock from '../components/SquadDock';
import MatchBackdrop from '../components/MatchBackdrop';
import PackRip from '../components/PackRip';
import allCards from '../data/cards.json';
import { assetPath, countryName } from '../lib/utils';
import useSkippableTimeline from '../lib/useSkippableTimeline';
import useRunSpeed, { scaleDuration, scaleDurationWithFloor } from '../lib/useRunSpeed';
import useReducedMotion from '../lib/useReducedMotion';
import useScrollLean from '../lib/useScrollLean';
import { playUiSound } from '../lib/gameAudio';
import { buildRoundCascade } from '../lib/matchCascade';
import { loadPerfectRunSaves as loadSaves, savePerfectRunSaves as saveSaves } from '../lib/perfectRunSaves';
import {
  cardsRevision, clearEndlessRun, loadEndlessRun, readEndlessRunMeta, saveEndlessRun,
} from '../lib/endlessRunSave';
import {
  MAX_REPUTATION, PROMOTE_AT, RELEGATE_AT, STARTING_TIER, TIER_META, eventPoints,
  placementFor, reputationDelta, reputationRankProgress, slotUnlockAt, slotsFor, yearEndMovement,
} from '../engine/endless/ladder';
import { buildEndlessBracket, endlessFieldPool, endlessPlayerPower } from '../engine/endless/field';
import {
  SOFT_WEIGHT, cardSignals, effectiveRoster, emptyDev, isLegendEligible, softResidual,
  tickCareerYear, tickFatigue,
} from '../engine/endless/career';
import { bondChemistry, decayIdleBonds, pruneBonds, tickBondsAfterEvent } from '../engine/endless/bonds';
import { rollYouthProspect } from '../engine/endless/academy';
import { tickWorldYear } from '../engine/endless/world';
import {
  applyPrestige, canPrestige, canSign, maxSignableRating, packPool,
  rollNpcSignings, rollPoachOffer, signingCost, signingTargets,
} from '../engine/endless/market';
import { describeNews, newsKit, pushNews } from '../engine/endless/news';
import {
  mulberry32, todaySeed, ROSTER_SIZE,
  rollNationality, draftChoices, teamPower, samplePack,
  makeSeason, buildBracket, nextBracketRound, currentRound, playerMatch,
  setPlayerResult, resolveNpcMatches, seedOf,
  pickMaps, simMap, evaluateTournament, evaluateSeason,
  evaluateEndless,
  eligibleNationalPools, buildCpuNationalTeam, nationalChallengeTier,
  buildNationalBracket, resolveTournamentToChampion, updateEncRecords,
  teamSimulationPower, rngState, restoreRng,
} from '../engine/perfectRun';
import {
  getClientId, submitDailyScore, fetchDailyLeaderboard, fetchOverallLeaderboard,
} from '../lib/leaderboardClient';
import { describeRound, roundPacing, roundSignificance } from '../engine/roundEvents';
import styles from './PerfectRun.module.css';
import hub from '../styles/hub.module.css';

function dateKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
function newRunSeed(mode) {
  return mode === 'daily' ? todaySeed() : (Date.now() & 0xffffffff);
}
const TRAVEL_MS = 600;
// A committed score needs longer on screen than the engine's 150ms minimum
// pacing. Specialty chips keep their requested 140ms cadence, then each new
// round number holds long enough to be read before the next cascade begins.
const ROUND_SCORE_HOLD_MS = 240;
// Stable empty-Set default so BracketCell's `pendingArrivalIds?.has(...)`
// check never needs a fresh Set() on every render of every non-traveling cell.
const EMPTY_TEAM_ID_SET = new Set();

const FAN_POOL = allCards.filter(card => card.photo !== '/assets/players/placeholder.png');
function drawFanCards() {
  const shuffled = [...FAN_POOL];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled.slice(0, 3);
}

// Phases where the squad is the player's to arrange, so promoting an IGL is
// a legitimate action rather than a mid-animation jump.
const IGL_PHASES = new Set(['manage', 'run', 'result', 'pack']);

export default function PerfectRun() {
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();
  // menu | country | name | draft | intro | run | result | enc_result | manage | pack | over
  const [phase, setPhase] = useState('menu');
  const [mode, setMode] = useState('solo');           // solo | daily | enc
  const [runLength, setRunLength] = useState('season'); // season | endless
  const [squadName, setSquadName] = useState('');
  const [fanCards] = useState(drawFanCards);
  const rng = useRef(null);
  // Set at the year boundary (settleYear), consumed when the player actually
  // leaves that year's manage screen (nextTournament) — see the comment
  // there for why NPC signings are deferred to that moment.
  const pendingNpcSigningsRef = useRef(null);
  // The seed and run id belong to the saved run, not to a render; keeping
  // them in refs means an autosave can identify the run it is writing.
  // The run's seed. State rather than a ref because career signals are
  // derived from it during render, and a ref read on the render path is not
  // something React can track.
  const [runSeed, setRunSeed] = useState(null);
  const runIdRef = useRef(null);

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

  // The IGL is an explicit choice that DEFAULTS to the leftmost dock slot.
  // Dragging a card into position 0 still promotes it, so the existing
  // gesture is unchanged - but the choice now survives a reorder, which it
  // has to once endless unlocks bench slots and "slot 0" stops meaning
  // anything. The fallback also guarantees this can never point at a card
  // that has left the squad.

  // Circuit standing: which of the three tiers the squad currently competes
  // in, plus the points banked toward this year's promotion/relegation call.
  // Endless only - every other mode leaves this untouched.
  const [standing, setStanding] = useState(() => ({
    tier: STARTING_TIER, tierPoints: 0, seasonPlacements: [],
  }));
  const [reputation, setReputation] = useState(0);
  // Per-player development and per-pair chemistry bonds. Sparse by design:
  // only players who have actually deviated from their card carry an entry.
  const [dev, setDev] = useState({});
  const [bonds, setBonds] = useState({});
  // What changed over the year just finished, shown once on the manage screen.
  const [yearReport, setYearReport] = useState(null);
  // This year's academy prospect: a real card whose career clock has been
  // reset, so they develop on the prospect curve. The dev entry rides along
  // and is applied only if the player actually signs them.
  const [prospect, setProspect] = useState(null);
  // Years actually settled. Derived state would read the OLD value on the
  // manage screen where a year is settled but tourIndex has not advanced -
  // announcing "slot 6 unlocked" beside a five-slot dock.
  const [yearsCompleted, setYearsCompleted] = useState(0);
  // Market state: who rivals have taken off the board, the one open approach
  // for a player of yours, and the run's news feed.
  const [signedIds, setSignedIds] = useState({});
  const [poachOffer, setPoachOffer] = useState(null);
  const [feed, setFeed] = useState([]);
  // Fires once per release so SquadDock can animate the departing card and
  // highlight the slot it left behind - a thing you SEE happen, not a
  // sentence explaining that it happened. `token` changes every time even if
  // `index` repeats (releasing twice in a row from the same trailing slot),
  // so SquadDock's edge-triggered effect always re-fires.
  const [releaseSignal, setReleaseSignal] = useState(null);
  // Banked runs. Prestige is the voluntary anti-runaway lever: a solved run
  // is worth more walked away from than farmed.
  const [prestige, setPrestige] = useState({ level: 0, multiplier: 1, bankedScore: 0 });
  // The most recent ladder movement, shown once on the manage screen.
  const [ladderMove, setLadderMove] = useState(null);

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
  // skippable pause before returning to the board - null when no series is
  // waiting. A boolean-shaped active flag (`!== null`) rather than the array
  // itself, so useSkippableTimeline's effect (keyed on `active`) actually
  // retriggers series to series instead of staying permanently "active".
  const [pendingBoardReturn, setPendingBoardReturn] = useState(null);
  // Speedrunner preference - Normal/Fast/Instant - persisted alongside the
  // run's other saves. Scales the three longest auto-advance pauses below;
  // round-to-round pacing itself still runs through roundEvents.js's own
  // `roundPacing(desc, opts)` seam, so the engine file is never touched.
  // No menu control for it any more - the universal skip button (see
  // `currentSkip` below) now covers the "let me go faster" need directly,
  // for every automatic sequence in the run, not just these three. The
  // preference itself (and its persistence) stays wired for a possible
  // future settings page rather than being ripped out.
  // Records are read on the render path (the menu strip and the ENC panel),
  // and this component re-renders ~24x per map while one is animating. Held
  // in state and refreshed on write, rather than re-parsed from localStorage
  // every frame. The lazy initializer means even the first read happens once.
  const [saves, setSaves] = useState(loadSaves);
  // The banked endless run, if any. Read from its own small companion key so
  // the menu never parses the full run blob just to offer a resume.
  const [savedRun, setSavedRun] = useState(readEndlessRunMeta);
  // Records are mutated in place by the handlers below, so the copy is what
  // actually re-renders anything reading `saves`.
  const commitSaves = useCallback((next) => {
    saveSaves(next);
    setSaves({ ...next });
  }, []);

  const [runSpeed] = useRunSpeed(saves.motionSpeed, (next) => {
    const updated = { ...loadSaves(), motionSpeed: next };
    commitSaves(updated);
  });
  const [live, setLive] = useState(null);              // {a,b} while a map animates
  const [liveRound, setLiveRound] = useState(0);
  const [roundPulse, setRoundPulse] = useState(null);
  const [roundTrigger, setRoundTrigger] = useState(null);
  // Which side just won the most recent round - 'A' (player) or 'B' (opp) -
  // keyed so a repeat winner still re-flashes. The score digits key off
  // `key` to remount and replay a brief color flash toward --ink at rest.
  const [roundFlash, setRoundFlash] = useState(null);
  // Backdrop zoom is a persistent 1-3 state, not a pulse: it steps up when
  // play gets tense and then STAYS there - it does not auto-revert after a
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
  // series, since there are only two steps above 1) - tying image variety to
  // the same tension that drives the zoom, rather than a schedule no one
  // could see happening.
  const [backdropVariant, setBackdropVariant] = useState(0);

  // consolation pack
  const [packNat, setPackNat] = useState(null);
  const [packChoices, setPackChoices] = useState([]);
  // { card, targetId } once a pack card has been dragged onto a specific
  // dock chip - the swap doesn't touch `picks` yet at that point, only once
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
  // matchup - the traveling clone is what visually "delivers" the reveal, so
  // the destination never flashes the answer before the clone carrying it
  // actually arrives. Cleared per-team as each clone's own animation finishes.
  const [pendingArrivalIds, setPendingArrivalIds] = useState(EMPTY_TEAM_ID_SET);
  const historyRef = useRef([]);
  useEffect(() => () => {
    clearTimeout(animTimer.current);
    clearInterval(revealTimer.current);
  }, []);

  const cardsById = useMemo(() => new Map(allCards.map(card => [card.id, card])), []);
  const pickedIds = new Set(picks.map(p => p.id));
  const endless = runLength === 'endless';

  // Career signals for any card, in endless only. Every surface that shows a
  // player reads from here, so the card, the market and the focus overlay can
  // never disagree about who someone is.
  const signalsFor = useCallback(
    card => (endless && card ? cardSignals(runSeed, card, dev[card.id]) : null),
    [endless, dev, runSeed],
  );


  // Bench slots unlock as years complete. The leftmost five always start -
  // the dock's existing drag-to-reorder therefore doubles as "pick your
  // five", with no second gesture to learn - and anyone past them is rested.
  const slots = endless ? slotsFor(yearsCompleted) : ROSTER_SIZE;
  const starters = useMemo(() => picks.slice(0, ROSTER_SIZE), [picks]);
  const benched = useMemo(() => picks.slice(ROSTER_SIZE), [picks]);

  // In endless the game plays with the DEVELOPED starters: drift, role changes
  // and fatigue are baked into the cards before they reach any engine call, so
  // every existing formula (role coverage, countrymen, specialties, MVP
  // weighting) applies to developed players unchanged.
  const squad = useMemo(
    () => (endless ? effectiveRoster(starters, dev) : starters),
    [endless, starters, dev],
  );

  // The leftmost slot IS the IGL - a position, not a flag stuck onto whichever
  // card happened to get picked. The dock renders that slot as a single red
  // nameplate, so the armband is something you SEE in the layout rather than a
  // label floating over someone's art. Moving a card to slot 1 is the only way
  // to change caller, which keeps one source of truth.
  const iglId = starters[0]?.id ?? null;
  const power = squad.length === ROSTER_SIZE
    ? teamPower(squad, iglId, endless
      ? { extra: bondChemistry(bonds, squad), soft: softResidual(squad) * SOFT_WEIGHT }
      : {})
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
    setRunSeed(seed);
    runIdRef.current = `run-${seed}`;
    // Starting a run replaces whatever was banked; only one endless run is
    // ever resumable, so leaving the old one on disk would be a lie.
    if (length === 'endless') clearEndlessRun();
    setSavedRun(null);
    setStanding({ tier: STARTING_TIER, tierPoints: 0, seasonPlacements: [] });
    setReputation(0);
    setLadderMove(null);
    setDev({}); setBonds({}); setYearReport(null); setProspect(null); setYearsCompleted(0);
    setSignedIds({}); setPoachOffer(null); setFeed([]);
    setPrestige({ level: 0, multiplier: 1, bankedScore: 0 });
    setMode(selectedMode);
    setRunLength(length);
    setSquadName('');
    setPicks([]); setSelectedNation(null); setRipId(0);
    setPacks(selectedMode === 'daily' ? 1 : 3);
    const openingSeason = makeSeason(rng.current);
    setSeason(openingSeason);
    setTourIndex(0); setTourResults([]); setCurrentResult(null); setSeasonResult(null);
    setTour(null); setView('board'); setBoardState('pairings'); setRevealCount(0);
    setMaps([]); setMapResults([]); setLive(null); setLiveRound(0); setRoundPulse(null); setRoundTrigger(null); setRoundFlash(null); setBackdropVariant(0);
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

  // Dock-chip drag-to-swap. Safe to apply directly to local state - and
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
    // iglId matters even though the player's own matches sim from live
    // `power`: once a bracket resolves rounds the player isn't in, the team
    // goes through simNpcMatch -> simMap(..., teamA.iglId, ...), and omitting
    // it silently drops the IGL's chemistry and Mastermind roll.
    const playerTeam = {
      id: 'player', tag: 'YOU', name: squadName, logo: null,
      roster: squad, iglId, power: power.power, isPlayer: true,
    };
    const t = mode === 'enc'
      ? buildNationalBracket(rng.current, allCards, selectedNation, picks, iglId)
      : endless
        // The circuit tier picks the field, and every entrant gets a form
        // roll - so the ladder, not a hidden handicap, is the difficulty.
        ? buildEndlessBracket(rng.current, allCards, pickedIds, playerTeam, standing.tier, { kind: def.kind, dev })
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

  // Intro splash auto-advances into the bracket draw - skippable (Space,
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
    setRoundTrigger(null);
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

    // ENC freezes the player's power at bracket time; endless recomputes it
    // from live power so promoting a new IGL mid-tournament still lands,
    // while the tournament's form roll still applies.
    const playerMatchPower = mode === 'enc'
      ? teamSimulationPower(tour.teams.player)
      : endless ? endlessPlayerPower(tour, power.power) : power.power;
    const result = simMap(
      rng.current, playerMatchPower, teamSimulationPower(opp), squad, opp.roster,
      0,
      mode === 'enc' ? (tour.teams.player?.iglId ?? iglId) : iglId,
      opp.iglId ?? null,
    );
    const mapName = seriesMaps[resultsSoFar.length];

    setLive({ a: 0, b: 0 });
    setLiveRound(0);

    function finishMap() {
      matchSkipRef.current = null;
      setRoundTrigger(null);
      setLive(null);
      const updated = [...resultsSoFar, { ...result, map: mapName }];
      setMapResults(updated);

      const wonNow = updated.filter(r => r.winA).length;
      const lostNow = updated.length - wonNow;
      if (wonNow < needed && lostNow < needed) {
        animTimer.current = setTimeout(() => playNextMap(seriesMaps, updated), 650);
      } else {
        // Handed off to the seriesEndTimeline below (skippable, run-speed
        // scaled) rather than a bare setTimeout - pendingBoardReturn flipping
        // null -> array is what that hook's `active` flag keys off.
        setPendingBoardReturn(updated);
      }
    }

    function commitRound(desc, index) {
      setRoundTrigger(null);
      setLive({ a: desc.a, b: desc.b });
      setLiveRound(desc.round);
      setRoundFlash(previous => ({ key: (previous?.key ?? 0) + 1, side: desc.winner }));
      playUiSound('score');
      if (roundSignificance(desc) === 'significant') {
        // Zoom is a persistent state, so this only ever steps UP within a
        // match - never resets itself after a round the way a pulse would.
        // A close finish holds isMatchPoint true for several rounds in a
        // row, so most of those land here with nothing to do; only the
        // round that actually clears the next threshold changes anything.
        const nextZoom = (desc.isMapPoint || desc.isOvertime) ? 3 : 2;
        if (nextZoom > zoomLevelRef.current) {
          zoomLevelRef.current = nextZoom;
          setZoomLevel(nextZoom);
          setBackdropVariant(v => v + 1); // fresh imagery as tension escalates
        }
        if (desc.isMapPoint || desc.isOvertime || desc.isStreakBreak) {
          const amplitude = desc.isMapPoint ? 5 : 1.5;
          setRoundPulse(previous => ({ key: (previous?.key ?? 0) + 1, kind: 'shake', amplitude }));
          if (desc.isMapPoint) playUiSound('impact');
        }
      }

      // Reduced motion removes spatial choreography, not reading time. The
      // floor also prevents a stale per-browser Instant preference from
      // making Safari race through scores while a fresh Chrome profile uses
      // Normal speed.
      const hold = scaleDurationWithFloor(
        Math.max(roundPacing(desc), ROUND_SCORE_HOLD_MS),
        runSpeed,
        ROUND_SCORE_HOLD_MS,
      );
      if (index >= result.rounds.length - 1) {
        // Hold the deciding round for one beat so the counter visibly reaches
        // the final number before the row turns into a completed map.
        animTimer.current = setTimeout(finishMap, hold);
        return;
      }

      animTimer.current = setTimeout(() => revealRound(index + 1), hold);
    }

    function revealRound(index) {
      const desc = describeRound(result.rounds, index);
      if (!desc) return;
      const triggers = buildRoundCascade({
        rosterA: squad,
        rosterB: opp.roster,
        iglA: mode === 'enc' ? (tour.teams.player?.iglId ?? iglId) : iglId,
        iglB: opp.iglId ?? null,
        winner: desc.winner,
      });
      const triggerDelay = reducedMotion ? 0 : scaleDuration(140, runSpeed);
      if (!triggers.length || triggerDelay === 0) {
        commitRound(desc, index);
        return;
      }

      let cursor = 0;
      function showNextTrigger() {
        if (cursor >= triggers.length) {
          commitRound(desc, index);
          return;
        }
        const trigger = triggers[cursor];
        cursor += 1;
        setRoundTrigger(previous => ({ ...trigger, key: (previous?.key ?? 0) + 1 }));
        playUiSound('specialty');
        animTimer.current = setTimeout(showNextTrigger, triggerDelay);
      }
      showNextTrigger();
    }

    matchSkipRef.current = finishMap;
    revealRound(0);
  }

  // Cancels whatever round-reveal step is pending and jumps straight to the
  // current map's already-fully-computed result - simMap runs the whole map
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
      // Only maps the player's own side actually took - an opponent's MVP
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
        // boardCompleteTimeline (below) owns the pause into `advance()` now -
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

  // Skippable pause between a finished series and the board reveal -
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
  // - intro splash, series-end pause, or board-complete pause - drives one
  // shared skip hint. They're mutually exclusive by construction (distinct
  // phase/boardState/pendingBoardReturn conditions), so at most one is ever
  // truthy.
  const activeTimeline = phase === 'intro' ? introTimeline
    : pendingBoardReturn !== null ? seriesEndTimeline
      : boardState === 'complete' ? boardCompleteTimeline
        : null;

  // One shared skip affordance for every automatic sequence in the run -
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
    // The selected skip callback only reads animation refs when the key event
    // fires; retaining it for render is intentional and does not dereference
    // those refs here.
    // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/refs
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
    // clone actually arrives - this is what keeps the destination on "TBD"
    // for the moves still mid-flight. Keyed by "toKey:teamId", not bare
    // teamId: a winner's id is ALSO sitting in its OLD round's cell (the
    // match it just won, still on screen one column back) - a bare-id Set
    // would mask that already-decided source cell too, since the same id
    // legitimately appears in both places. The composite key only ever
    // matches the one destination slot a given move is actually flying to.
    setPendingArrivalIds(new Set(moves.map(move => `${move.toKey}:${move.teamId}`)));
    // Real bug this masked until now: revealCount carries the PREVIOUS
    // round's NPC-reveal progress (e.g. 7, from a Round-of-16 cycle). Left
    // unreset, the new round's own isRevealed() check - npcMatches.indexOf(m)
    // < revealCount - is satisfied for every match in a smaller round (a
    // Quarterfinal has only ~4), so every destination cell picked up
    // .revealed styling the instant travel started, one frame before its
    // row's own text ever changed. That combination - dressed as "revealed"
    // while its text still said TBD - is what actually read as "the TBD
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

    if (reducedMotion || !info?.moves?.length || !overlay || !container) {
      travelSkipRef.current = null;
      finish();
      return;
    }

    const cRect = container.getBoundingClientRect();
    const cleanups = [];
    const runningAnimations = [];
    const travelDuration = scaleDuration(TRAVEL_MS, runSpeed);
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
      // going neutral - it's carrying forward the result that just earned
      // this team the trip, so the color travels with it instead of cutting
      // out. The destination itself stays on "TBD" throughout (driven by
      // pendingArrivalIds, not a visibility hide) and only the clone ever
      // sits at that position mid-flight - nothing to hide there.
      const clone = fromRow.cloneNode(true);
      clone.classList.add(styles.travelClone);
      const cloneScore = clone.querySelector('[data-bracket-score]');
      if (cloneScore) cloneScore.textContent = '';
      clone.style.width = `${a.width}px`;
      clone.style.height = `${a.height}px`;
      overlay.appendChild(clone);
      cleanups.push(() => clone.remove());
      const bridgeX = x0 + (x1 - x0) * 0.5;
      const animation = clone.animate([
        { transform: `translate(${x0}px, ${y0}px)` },
        { transform: `translate(${bridgeX}px, ${y0}px)`, offset: 0.35 },
        { transform: `translate(${bridgeX}px, ${y1}px)`, offset: 0.65 },
        { transform: `translate(${x1}px, ${y1}px)` },
      ], { duration: travelDuration, easing: 'cubic-bezier(0.5, 0, 0.2, 1)', fill: 'forwards' });
      runningAnimations.push(animation);
      return animation.finished.then(() => {
        // This clone has landed - reveal its real matchup at the
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
      runningAnimations.forEach(animation => animation.cancel());
      cleanups.forEach(fn => fn());
      setPendingArrivalIds(EMPTY_TEAM_ID_SET);
      finish();
    };
    // Skipping just runs the same cleanup early - the in-flight clones get
    // torn down and any WAAPI animation still finishing on them lands on an
    // already-removed node, harmless. Their .finished callbacks racing in
    // after are already guarded (see the `prev.has` check above).
    travelSkipRef.current = cleanup;
    Promise.all(animations).then(cleanup);
    const guard = setTimeout(cleanup, travelDuration + 400);
    return () => { travelSkipRef.current = null; clearTimeout(guard); cleanup(); };
  }, [boardState, reducedMotion, runSpeed]);

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
      year: Math.floor(tourIndex / 3) + 1,
      mvpBoard,
      seriesWon: finishedSeries.filter(s => s.won).length,
      seriesPlayed: finishedSeries.length,
      mapsWonTotal: finishedSeries.reduce((s, x) => s + x.mapsWon, 0),
      mapsLostTotal: finishedSeries.reduce((s, x) => s + x.mapsLost, 0),
      igl: picks.find(p => p.id === iglId) ?? null,
      tier: endless ? standing.tier : null,
      placement: endless ? placementFor(finishRound, champion) : null,
    };
    setTourResults(rs => [...rs, result]);

    // Endless: an event played together builds the squad's per-pair bonds and
    // costs everyone who started some freshness. Both are per-EVENT; careers
    // tick once a year, where the change is legible as a report.
    if (endless) {
      const starterIds = starters.map(p => p.id);
      setBonds(prev => {
        const grown = tickBondsAfterEvent(prev, starterIds).bonds;
        // Nobody sat out at a five-man squad, so decay is a no-op today; it
        // starts mattering the moment bench slots unlock.
        return pruneBonds(decayIdleBonds(grown, starterIds).bonds, starterIds);
      });
      setDev(prev => {
        const next = { ...prev };
        // Both ends of the load band: whoever played loses freshness, whoever
        // sat recovers but starts going stale. This is what stops a deep
        // bench from being a straight upgrade.
        for (const p of starters) {
          next[p.id] = tickFatigue(next[p.id] ?? emptyDev(p), { started: true });
        }
        for (const p of benched) {
          next[p.id] = tickFatigue(next[p.id] ?? emptyDev(p), { started: false });
        }
        return next;
      });
    }

    // Endless: every finish moves you toward promotion or relegation, and
    // pays reputation weighted by how hard the tier was.
    if (endless) {
      const placement = placementFor(finishRound, champion);
      setStanding(st => ({
        ...st,
        tierPoints: st.tierPoints + eventPoints(placement),
        seasonPlacements: [...st.seasonPlacements, placement],
      }));
      setReputation(r => Math.min(MAX_REPUTATION, r + reputationDelta(standing.tier, placement)));
    }
    setCurrentResult(result);
    if (champion) setPacks(p => p + 1);
    if (mode === 'enc') {
      const record = loadSaves();
      record.enc = updateEncRecords(record.enc, {
        series: finishedSeries, champion, mapsLost: evalT.mapsLost, finishRound,
      });
      commitSaves(record);
      setPhase('enc_result');
    } else {
      setPhase('result');
    }
  }

  function continueFromResult() {
    const isLast = !endless && tourIndex >= season.length - 1;
    if (isLast) { finishSeason(); return; }
    // A year is three events. Settle it HERE, as its last event resolves,
    // rather than on the way into the next one - otherwise the development
    // report and the promotion notice would both land on a manage screen the
    // player only reaches a whole tournament later.
    if (endless && (tourIndex + 1) % 3 === 0) settleYear();
    setPhase('manage');
  }

  function settleYear() {
    const year = Math.floor(tourIndex / 3) + 1;
    setYearsCompleted(year);
    advanceCareers(year, slotUnlockAt(year));
    // A development path that does not depend on winning: even a run with no
    // titles and no packs gets one prospect a year.
    setProspect(rollYouthProspect(rng.current, allCards, pickedIds, runSeed));

    // Development lands now, but the market's NPC signings are deliberately
    // held back — see nextTournament, where they actually fire once the
    // player leaves this year's manage screen. That gives the player the
    // whole year's free-agent pool to shop before rivals react to whatever
    // is left, rather than always shopping in NPCs' leftovers.
    const tierPool = endlessFieldPool(allCards, pickedIds, standing.tier, dev);
    pendingNpcSigningsRef.current = tierPool;

    const offer = rollPoachOffer(rng.current, {
      squad, dev, reputation, pool: tierPool, signedIds,
    });
    setPoachOffer(offer);

    const items = [];
    if (offer) items.push({ kind: 'poach', ...offer });
    const move = yearEndMovement(standing.tier, standing.tierPoints);
    if (move.movement !== 'hold') {
      items.push({ kind: move.movement, tierLabel: TIER_META[move.tier].label });
    }
    setFeed(current => pushNews(current, items, { year, event: tourIndex }));

    setLadderMove(move.movement === 'hold' ? null : { ...move, from: standing.tier, year });
    setStanding({ tier: move.tier, tierPoints: 0, seasonPlacements: [] });
  }

  function finishSeason() {
    const result = endless ? evaluateEndless(tourResults) : evaluateSeason(tourResults);
    setSeasonResult(result);

    const record = loadSaves();
    // Endless scores grow without bound, so they get their own best and
    // never mix with the fixed-season record.
    if (endless) {
      record.endlessV3 ??= { bestScore: 0, bestYears: 0, bestTier: 0, bestPrestige: 0, titlesByTier: [0, 0, 0] };
      record.endlessV3.bestScore = Math.max(record.endlessV3.bestScore ?? 0, result.score);
      record.endlessV3.bestYears = Math.max(record.endlessV3.bestYears ?? 0, result.completedYears ?? 0);
    }
    else record.bestScore = Math.max(record.bestScore ?? 0, result.score);
    record.badges ??= {};
    for (const tr of tourResults) {
      if (!tr.champion) continue;
      const key = tr.kind === 'champions' ? 'champions' : 'masters';
      record.badges[key] = (record.badges[key] ?? 0) + 1;
    }
    const completedYearResults = endless ? result.years.slice(0, result.completedYears) : [result];
    const grandSlams = completedYearResults.filter(year => year.grandSlam).length;
    const perfectSeasons = completedYearResults.filter(year => year.perfectSeason).length;
    if (grandSlams) record.badges.grand_slam = (record.badges.grand_slam ?? 0) + grandSlams;
    if (perfectSeasons) record.badges.perfect_season = (record.badges.perfect_season ?? 0) + perfectSeasons;
    if (mode === 'daily') {
      record.dailyScores ??= {};
      const k = dateKey();
      record.dailyScores[k] = Math.max(record.dailyScores[k] ?? 0, result.score);
      // Shared board entry; the server's UNIQUE(date, client) is the real
      // once-per-day gate. Fire-and-forget: offline just means no submit.
      void submitDailyScore({ date: k, squadName, score: result.score });
    }
    commitSaves(record);
    // The run is over: its autosave must not outlive it, or the menu would
    // offer to resume a finished run.
    clearEndlessRun();
    setSavedRun(null);
    setPhase('over');
  }

  // One year of careers. Ticked at the year boundary rather than per event:
  // cheaper, and it gives the manage screen a single readable "here is what
  // the year did to your squad" report instead of a trickle of noise.
  function advanceCareers(year, unlock) {
    const titles = tourResults.filter(r => r.champion).length;
    const changes = [];
    // Computed OUTSIDE the state updater on purpose. This advances the run's
    // rng and accumulates a report, so it must run exactly once - a functional
    // updater is invoked twice under StrictMode, which would double-advance
    // the generator and duplicate every line of the report.
    const next = { ...dev };
    {
      for (const card of picks) {
        const current = next[card.id] ?? emptyDev(card);
        const before = current.d ?? 0;
        const result = tickCareerYear(rng.current, runSeed, card, current, {
          year,
          // Years this player has been on the squad, which is what continuity
          // rewards. Bonds and continuity are two views of the same idea:
          // keeping people together pays.
          yearsAtOrg: (current.cy ?? 0) + 1,
          rested: current.idle ?? 0,
          cohesion: bondChemistry(bonds, picks).total,
        });
        let updated = result.dev;
        // A player who has won enough with you stops declining for good.
        if (isLegendEligible(updated, titles)) {
          updated = { ...updated, lg: 1 };
          changes.push({ id: card.id, player: card.player, kind: 'legend', n: 0 });
        }
        next[card.id] = updated;
        const delta = (updated.d ?? 0) - before;
        if (delta !== 0) {
          changes.push({ id: card.id, player: card.player, kind: delta > 0 ? 'growth' : 'decline', n: delta });
        }
      }
    }
    // The world ages too. Ticking the tier the player actually competes in
    // keeps the field genuinely different by year six without putting every
    // org in the game into the save.
    const withWorld = tickWorldYear(
      rng.current, runSeed,
      endlessFieldPool(allCards, pickedIds, standing.tier, next),
      next, { year },
    );

    setDev(withWorld);
    setYearReport({ year, changes, unlock });
  }

  // ── Endless autosave / resume ────────────────────────────────────────────
  //
  // The manage screen is the run's quiescent point: the last tournament is
  // banked, the next bracket has not been drawn, and no animation owns the
  // rng. Snapshotting the generator state HERE is what makes resume exact -
  // restoring it and re-running beginBracket regenerates the identical
  // tournament, so the bracket never has to be serialized at all. Quitting
  // mid-tournament therefore costs you that tournament, not the run.
  function snapshotRun() {
    return {
      runId: runIdRef.current,
      createdAt: runSeed,
      seed: runSeed,
      rngState: rngState(rng.current),
      cardsRev: cardsRevision(allCards),
      squadName,
      tourIndex,
      yearsCompleted,
      season,
      squad: { slots, roster: picks, starters, iglId },
      packs,
      reputation,
      standing,
      prestige,
      world: { ladder: [[], [], []], orgs: {}, signedIds: {} },
      dev,
      bonds,
      market: { signedIds, poachOffer, prospect },
      feed,
      yearSummaries: [],
      tourResults,
      active: null,
      // Computed here rather than read from the memoized render-time value:
      // snapshotRun runs from effects and handlers that are declared above
      // that memo, and depending on it is a use-before-declare.
      score: evaluateEndless(tourResults).score,
    };
  }

  useEffect(() => {
    // Writing to storage is exactly what an effect is for; this synchronizes
    // React state out to an external system rather than back into React.
    // Guarding on a FULL squad would stop saving exactly when the run gets
    // interesting: a player poached away leaves four until you replace him.
    if (!endless || phase !== 'manage' || !picks.length) return;
    saveEndlessRun(snapshotRun());
    // Every piece of persisted run state has to be listed, or a change that
    // touches only one of them (refusing an approach spends reputation and
    // appends to the feed, and nothing else) would never reach disk.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    endless, phase, tourIndex, yearsCompleted, packs, iglId, picks, tourResults,
    reputation, standing, prestige, dev, bonds, signedIds, poachOffer, prospect, feed,
  ]);

  function resumeEndlessRun() {
    const saved = loadEndlessRun(allCards);
    if (!saved) { clearEndlessRun(); setSavedRun(null); return; }

    setRunSeed(saved.seed);
    runIdRef.current = saved.runId;
    rng.current = restoreRng(saved.rngState);

    setMode('solo');
    setRunLength('endless');
    setSquadName(saved.squadName);
    setPicks(saved.squad.roster);
    setPacks(saved.packs);
    setProspect(saved.market?.prospect ?? null);
    setSignedIds(saved.market?.signedIds ?? {});
    setPoachOffer(saved.market?.poachOffer ?? null);
    setPrestige(saved.prestige ?? { level: 0, multiplier: 1, bankedScore: 0 });
    setFeed(saved.feed ?? []);
    setStanding(saved.standing);
    setReputation(saved.reputation);
    setYearsCompleted(saved.yearsCompleted ?? Math.floor((saved.tourIndex ?? 0) / 3));
    setDev(saved.dev ?? {});
    setBonds(saved.bonds ?? {});
    setYearReport(null);
    setLadderMove(null);
    setSeason(saved.season);
    setTourIndex(saved.tourIndex);
    setTourResults(saved.tourResults);
    setCurrentResult(null);
    setSeasonResult(null);

    // Everything below is per-tournament presentation, rebuilt by the next
    // beginBracket - the same reset startRun performs.
    setTour(null); setView('board'); setBoardState('pairings'); setRevealCount(0);
    setMaps([]); setMapResults([]); setLive(null); setLiveRound(0);
    setRoundPulse(null); setRoundFlash(null); setBackdropVariant(0);
    setZoomLevel(1); zoomLevelRef.current = 1;
    setPendingBoardReturn(null);
    setPendingArrivalIds(EMPTY_TEAM_ID_SET);
    setPackNat(null); setPackChoices([]); setPendingSwap(null);
    setNat(null); setChoices([]); setSelectedNation(null);
    historyRef.current = [];
    clearTimeout(animTimer.current);
    clearInterval(revealTimer.current);
    seriesActive.current = false;
    setPanelOpen(false);
    setSavedRun(null);
    setPhase('manage');
  }

  function nextTournament() {
    // A poach is a decision, not a notification. Without this guard a club
    // with too little reputation could leave the offer sitting in the inbox
    // forever and advance anyway, effectively keeping the player for free.
    if (poachOffer) return;

    // Same year-boundary check settleYear used to decide to run at all —
    // tourIndex hasn't incremented yet, so this still identifies "the
    // manage screen I'm leaving right now was this year's." Firing here,
    // rather than when the year started, is what gives the player first
    // pick of the free-agent pool before rivals sign from what's left.
    if (endless && (tourIndex + 1) % 3 === 0 && pendingNpcSigningsRef.current) {
      const signings = rollNpcSignings(rng.current, {
        pool: pendingNpcSigningsRef.current, cards: allCards,
        squadIds: pickedIds, signedIds, world: { orgs: {} },
      });
      setSignedIds(signings.signedIds);
      setFeed(current => pushNews(current, signings.news, { year: yearsCompleted, event: tourIndex }));
      pendingNpcSigningsRef.current = null;
    }

    const next = tourIndex + 1;
    if (endless && next >= season.length) {
      setSeason(s => [...s, ...makeSeason(rng.current)]);
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
      // Rivals have taken players off the board since the draft - a pack can
      // only ever offer someone who is actually available.
      setPackChoices(samplePack(rng.current, endless ? packPool(allCards, ids, signedIds) : allCards, ids));
    }
    setPendingSwap(null);
    setRipId(id => id + 1);
  }

  // Spends one banked pack, opening it right away. Committed the instant
  // it's opened - declining the swap afterward still costs the pack, same
  // as a draft reroll spends its pack whether or not you like what you see.
  function openPack() {
    if (packs <= 0) return;
    setPacks(p => p - 1);
    rollPack();
    setPhase('pack');
  }

  // In-place replacement (same index) - if the outgoing card was the
  // leftmost/IGL slot, the incoming one lands there too and just inherits
  // the title, no separate reassignment needed.
  function confirmSwap() {
    if (!pendingSwap) return;
    const { card: incoming, targetId } = pendingSwap;
    // With an open bench slot the card joins the squad instead of displacing
    // someone - that is the whole point of unlocking depth.
    const next = targetId === null
      ? [...picks, incoming]
      : picks.map(p => (p.id === targetId ? incoming : p));
    setPicks(next);
    setPendingSwap(null);
    setPhase('manage');
  }

  // Promote a squad member to IGL without disturbing the dock order. Free and
  // available mid-tournament by design - solo re-reads `power` every map, so
  // a change takes effect on the next map played.
  // True when the squad has an unlocked slot standing empty.
  function hasOpenSlot() {
    return endless && picks.length < slots;
  }

  function signToOpenSlot(card) {
    if (!hasOpenSlot() || !card) return;
    setPendingSwap({ card, targetId: null });
  }

  // Refusing spends standing; letting them go pays packs. Either way the
  // squad you built has a price, which is the point.
  function resolvePoach(accept) {
    if (!poachOffer) return;
    const card = picks.find(p => p.id === poachOffer.cardId);
    if (!card) { setPoachOffer(null); return; }

    if (accept) {
      // Removing this card shifts every later slot down by one, so the slot
      // that ends up empty is always the trailing one - same expression
      // `newSlotIndex` uses for a freshly unlocked slot below.
      setReleaseSignal({ index: picks.length - 1, token: Date.now() });
      setPicks(prev => prev.filter(p => p.id !== card.id));
      setBonds(prev => pruneBonds(prev, picks.filter(p => p.id !== card.id).map(p => p.id)));
      setPacks(p => p + poachOffer.releaseFee);
      setSignedIds(prev => ({ ...prev, [card.id]: poachOffer.orgId }));
      setFeed(cur => pushNews(cur, [{ kind: 'departure', player: card.player, orgId: poachOffer.orgId, orgName: poachOffer.orgName, cardId: card.id }], { year: yearsCompleted, event: tourIndex }));
    } else {
      setReputation(r => Math.max(0, r - poachOffer.holdCost));
      setFeed(cur => pushNews(cur, [{ kind: 'held', player: card.player, orgName: poachOffer.orgName }], { year: yearsCompleted, event: tourIndex }));
    }
    setPoachOffer(null);
  }

  function signTarget(card) {
    const cost = signingCost(card);
    if (!canSign(card, { packs, reputation, roster: squad }).ok) return;
    setPacks(p => p - cost);
    setPackNat(null);
    setPackChoices([card]);
    setRipId(id => id + 1);
    setPendingSwap(null);
    setFeed(cur => pushNews(cur, [{ kind: 'signed', player: card.player, cardId: card.id }], { year: yearsCompleted, event: tourIndex }));
    setPhase('pack');
  }

  function doPrestige() {
    const titles = tourResults.filter(r => r.champion).length;
    if (!canPrestige({ tier: standing.tier, titles, prestige }).ok) return;
    setPrestige(applyPrestige(prestige, evaluateEndless(tourResults).score));
    finishSeason();
  }

  function signProspect() {
    if (!prospect) return;
    const card = allCards.find(c => c.id === prospect.cardId);
    if (!card) return;
    setDev(prev => ({ ...prev, [card.id]: prospect.dev }));
    setPackNat(null);
    setPackChoices([card]);
    setRipId(id => id + 1);
    setPendingSwap(null);
    setProspect(null);
    setPhase('pack');
  }

  // Promoting a caller MOVES them to the leftmost slot, because that slot is
  // what "IGL" means here. Free and available mid-tournament by design - solo
  // re-reads `power` every map, so it lands on the next map played.
  function chooseIgl(cardId) {
    setPicks(prev => {
      const index = prev.findIndex(p => p.id === cardId);
      if (index <= 0) return prev;
      const next = [...prev];
      const [card] = next.splice(index, 1);
      next.unshift(card);
      return next;
    });
  }

  function cancelSwap() {
    setPendingSwap(null);
  }

  // ── Render ────────────────────────────────────────────────────────────────

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
    () => endless ? evaluateEndless(tourResults) : evaluateSeason(tourResults),
    [tourResults, endless],
  );

  // Everything the persistent bottom row needs, derived per phase. The row
  // owns the primary gameplay actions so the player always acts in one place.
  const barActions = (() => {
    switch (phase) {
      // Rerolling now lives on the dock's own pack badge (see SquadDock's
      // onOpenPack below) - clicking the pack IS the reroll, no separate
      // labeled button competing for the same bottom row.
      case 'draft':
        return [];
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
        // No dedicated IGL-review step anymore - the leftmost dock slot
        // always has someone in it the instant the roster's full, and this
        // same screen (chemistry + portraits) is also the very first stop
        // after drafting, before any tournament has a result to report on.
        const preSeason = !currentResult;
        const mustResolvePoach = endless && Boolean(poachOffer);
        return [
          {
            key: 'next', kind: 'primary',
            // Replacing a departed player is the cost of losing one; the
            // market, a pack and the academy are all sitting on this screen.
            disabled: mustResolvePoach || (endless && starters.length < ROSTER_SIZE),
            onClick: preSeason ? () => setPhase('intro') : nextTournament,
            label: mustResolvePoach
              ? 'Resolve poach offer'
              : preSeason
              ? `Enter ${season[0]?.label ?? 'the season'}`
              : endless && tourIndex % 3 === 2
                ? `Start Year ${Math.floor(tourIndex / 3) + 2}`
                : `On to ${season[tourIndex + 1]?.city}`,
          },
          // Offered only where it is earned: at the top of the ladder, with
          // titles behind you. Banking beats farming a solved run.
          ...(endless && !preSeason
            && canPrestige({ tier: standing.tier, titles: tourResults.filter(r => r.champion).length, prestige }).ok
            ? [{ key: 'prestige', kind: 'secondary', onClick: doPrestige, label: `Prestige ×${(prestige.multiplier + 0.5).toFixed(1)}` }]
            : []),
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
  // On to X, Play your match →) - everywhere skip doesn't already own the
  // key. Skipped while focus sits on something that already handles
  // Space/Enter itself (a button, a link) or is mid-typing (the squad name
  // field) - this is a global convenience shortcut, not a replacement for
  // normal keyboard activation of whatever's actually focused.
  const primaryBarAction = barActions.find(a => a.kind === 'primary' && !a.disabled);
  // currentSkip carries event callbacks that may read animation refs later;
  // coercing the object here does not invoke them.
  // eslint-disable-next-line react-hooks/refs
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
  // The dock IS the squad, everywhere in the loop. It only stands down inside
  // a match, where the broadcast plate already lists both rosters and a second
  // copy of your five would just compete with it.
  const dockInBar = barVisible;
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
          phase === 'draft' ? styles.draftPage : '',
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
                {savedRun && (
                  <button className={`${styles.modeBtn} ${styles.resumeTile}`} onClick={resumeEndlessRun}>
                    <span className={styles.modeBtnName}>
                      Resume Run
                      <span className={styles.modeBtnFlag}>{savedRun.squadName}</span>
                    </span>
                    <span className={styles.resumeMeta}>
                      <span>Year <b>{savedRun.year}</b></span>
                      <span>Score <b>{savedRun.score.toLocaleString()}</b></span>
                    </span>
                  </button>
                )}
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
                <span>Endless <b><CountUp value={saves.endlessV3?.bestScore ?? 0} /></b></span>
                <span>Years <b><CountUp value={saves.endlessV3?.bestYears ?? 0} /></b></span>
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
                  <PlayerCard card={card} displayScale={0.52} portraitLoading="eager" portraitFetchPriority="high" />
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
        <section className={styles.draftStage}>
          <DraftLane
            nation={nat}
            choices={choices}
            ripId={ripId}
            interactive
            onPick={pickPlayer}
            label={mode === 'enc' ? `Build the ${countryName(selectedNation)} roster` : undefined}
            displayScale={0.65}
            packScale={1.3}
          />
        </section>
        </PhaseTransition>
      )}

      {phase === 'intro' && def && (
        <PhaseTransition phaseKey="intro">
        <section className={styles.intro}>
          <span className={styles.introMarker}>
            {endless
              ? `Year ${Math.floor(tourIndex / 3) + 1} · Tournament ${(tourIndex % 3) + 1} / 3`
              : `Tournament ${tourIndex + 1} / ${season.length}`}
          </span>
          <h1 className={styles.introTitle}>{def.label}<em>//</em></h1>
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
            <HeroBand roster={squad} side="left" />
            <HeroBand roster={opp.roster} side="right" />
          </div>

          <div className={`${styles.castSide} ${styles.castSideLeft}`}>
            <span className={styles.castTeamName}>{squadName}</span>
            <span className={styles.castPower}>
              Power {power.power.toFixed(1)}
              {mode === 'enc' && <FormBadge label={tour.teams.player.formLabel} />}
            </span>
            {squad.map(p => (
              <CastPlayer key={p.id} card={p} isIgl={p.id === iglId} trigger={roundTrigger?.side === 'A' && roundTrigger.cardId === p.id ? roundTrigger : null} />
            ))}
          </div>

          <div className={styles.castCentre} aria-live="polite">
            <span className={styles.liveTag}>
              {seriesOver
                ? (mapsWon >= needed ? 'Series won' : 'Series lost')
                : `Live · ${maps[mapResults.length]}`}
            </span>
            <div className={styles.castScore} data-specialty-active={roundTrigger ? 'true' : undefined}>
              <span className={styles.castSeries}>Series {mapsWon}–{mapsLost}</span>
              {/* Flashes the round-winner's color (--accent for the player,
                  --opponent for them) and settles back to --ink - the
                  smallest change that makes "who just won that round"
                  unmistakable without a bespoke banner. Keying on
                  roundFlash.key remounts the span so a repeat winner still
                  replays the flash instead of no-op-ing on an unchanged
                  initial value. */}
              <m.span
                key={roundFlash?.key ?? 'idle'}
                className={styles.castBig}
                initial={roundFlash ? {
                  color: roundFlash.side === 'A' ? 'var(--accent)' : 'var(--opponent)',
                  opacity: 0.72,
                  y: reducedMotion ? 0 : (roundFlash.side === 'A' ? -7 : 7),
                } : false}
                animate={{ color: 'var(--ink)', opacity: 1, y: 0 }}
                transition={{
                  duration: reducedMotion
                    ? DUR.micro
                    : Math.max(DUR.micro, scaleDuration(DUR.enter * 1000, runSpeed) / 1000),
                  ease: EASE.out,
                }}
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
              <CastPlayer key={p.id} card={p} isIgl={p.id === opp.iglId} trigger={roundTrigger?.side === 'B' && roundTrigger.cardId === p.id ? roundTrigger : null} />
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
        <section className={[styles.between, styles.desk].join(' ')}>
          {/* The heading carries its own weight - no kicker above it. What
              used to be a marker line is now the standing strip, which says
              the same thing with data. */}
          <h2 className={styles.deskTitle}>
            {!currentResult ? 'Take the field' : currentResult.champion ? 'Champions stay together' : 'Back to the drawing board'}
          </h2>

          {/* Only Circuit standing + the decision inbox pair with the feed —
              that's the empty space the sidebar is actually filling. Sticky
              only works right when its own column is the SHORT one: sizing
              this pair's row to their own height (not the whole desk's,
              which runs on through the market and season strip below) is
              what stops the sidebar from later floating on top of/past
              content it was never meant to sit beside. */}
          {endless && (
            <div className={styles.deskTopRow}>
              <div className={styles.deskTop}>
                <CircuitPanel
                  tier={standing.tier}
                  tierPoints={standing.tierPoints}
                  reputation={reputation}
                  eventInYear={(tourIndex % 3) + 1}
                  year={Math.floor(tourIndex / 3) + 1}
                  move={ladderMove}
                />

                {/* ── Decisions, first and always. A worklist that empties:
                      once nothing here wants an answer, the column is simply
                      gone and the screen becomes reference material. ── */}
                {(poachOffer || prospect) && (
                  <div className={styles.inbox}>
                    <PoachOffer
                      offer={poachOffer}
                      card={poachOffer ? picks.find(p => p.id === poachOffer.cardId) : null}
                      signals={poachOffer ? signalsFor(picks.find(p => p.id === poachOffer.cardId)) : null}
                      reputation={reputation}
                      onResolve={resolvePoach}
                      onInspect={setFocusCard}
                    />
                    {prospect && (
                      <ProspectOffer
                        card={cardsById.get(prospect.cardId)}
                        signals={cardSignals(runSeed, cardsById.get(prospect.cardId), prospect.dev)}
                        onSign={signProspect}
                        onDecline={() => setProspect(null)}
                        onInspect={setFocusCard}
                      />
                    )}
                  </div>
                )}

                {/* These are left-column reports, with the same outer width
                    as the academy frame. Keeping them inside this wrapper
                    also gives the circuit feed the intended sticky runway:
                    it releases only when the full-width market begins. */}
                {power && <ChemPanel power={power} />}
                <SquadReport report={yearReport} squad={squad} />
              </div>

              {/* This wrapper is the feed's actual sticky containing block,
                  so it must let go before the full-width market below. */}
              <aside className={styles.deskSide}>
                <NewsFeed feed={feed} cardsById={cardsById} />
              </aside>
            </div>
          )}

          {/* The transfer market is the first screen-wide region. It sits
              outside .deskTopRow, which is the exact point where the sticky
              circuit feed must release. */}
          <div className={styles.deskRest}>
            {mode === 'enc' && power?.lines.some(line => String(line.label).startsWith('Missing:')) && (
              <p className={styles.deskWarning}>This lineup is missing role coverage. You can still enter, but chemistry will reduce its power.</p>
            )}

            {!endless && power && <ChemPanel power={power} />}

            {endless && (
              <TransferMarket
                targets={signingTargets(allCards, { squadIds: pickedIds, signedIds, reputation, roster: squad, limit: 9 })}
                packs={packs}
                ceiling={maxSignableRating(reputation, squad)}
                onSign={signTarget}
                onInspect={setFocusCard}
                signalsFor={signalsFor}
              />
            )}

            {/* The year as three slots rather than a growing pile of cards. */}
            <SeasonStrip
              results={tourResults}
              season={season}
              tourIndex={tourIndex}
              endless={endless}
            />
          </div>
        </section>
        </PhaseTransition>
      )}

      {phase === 'pack' && (
        <PhaseTransition phaseKey="pack">
        <PackPhase
          key={ripId}
          nat={packNat}
          choices={packChoices}
          openSlot={hasOpenSlot()}
          onSign={signToOpenSlot}
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

      {/* Rendering the callback as a prop does not invoke or dereference it. */}
      {/* eslint-disable-next-line react-hooks/refs */}
      {currentSkip && (
        <SkipHint onSkip={currentSkip.skip} progress={currentSkip.progress} />
      )}
      </main>
      </div>

      {barVisible && (
        <SquadBar
          dock={dockInBar ? (
            <SquadDock
              roster={drawerRoster}
              size={endless ? slots : ROSTER_SIZE}
              starterCount={endless && slots > ROSTER_SIZE ? ROSTER_SIZE : null}
              // Only while the year's report is up - the mark is for the
              // moment the slot appears, not a permanent decoration.
              newSlotIndex={endless && yearReport?.unlock ? picks.length : null}
              releaseSignal={endless ? releaseSignal : null}
              dev={endless ? dev : null}
              // Bigger where the squad is the subject of the screen.
              scale={phase === 'manage' ? 'large' : 'normal'}
              iglId={iglId}
              squadName={squadName}
              onFocusCard={setFocusCard}
              focusCardId={focusCard?.id ?? null}
              onSwap={swapPicks}
            />
          ) : null}
          packs={packs}
          // Only wired up on the phases that have a real pack-spending
          // action right now - the pack badge stays a visible readout
          // everywhere else (run, result…) but forcing phase to 'pack'
          // from, say, mid-match would be a broken jump, not a shortcut.
          // On the draft screen, clicking it IS the reroll - the same
          // currency, spent the same way, so it reuses the badge instead of
          // a separate labeled button. ENC's draft has no packs to spend,
          // so it stays inert there.
          onOpenPack={phase === 'manage' ? openPack : phase === 'draft' && mode !== 'enc' ? reroll : null}
          packActionLabel={phase === 'draft' ? `Reroll ${nat ? 'nation' : 'pack'}` : 'Open a pack'}
          large={phase === 'manage'}
        >
          {/* action.onClick (playMatch, reroll, etc.) is passed by reference
              here, never called; whatever refs those functions touch
              internally are only actually read once the button fires,
              inside the event handler React's own docs name as the
              sanctioned place for it. */}
          {/* eslint-disable-next-line react-hooks/refs */}
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
          firing the phase's action blind - the action moves into the overlay,
          where you can actually read the card you're acting on. */}
      <CardFocusOverlay
        card={focusCard}
        onClose={() => setFocusCard(null)}
        // Promoting a caller is deliberately free and available mid-run:
        // solo re-reads team power every map, so the swap lands on the next
        // map played. Offered only for cards actually on the squad, and only
        // on the phases where the roster is yours to arrange.
        action={
          focusCard && IGL_PHASES.has(phase) && picks.some(p => p.id === focusCard.id)
            ? { label: focusCard.id === iglId ? 'Is your IGL' : 'Make IGL', disabled: focusCard.id === iglId }
            : null
        }
        onAction={() => chooseIgl(focusCard?.id)}
        signals={signalsFor(focusCard)}
      />
    </div>
    </>
  );
}

// One team's five as overlapping cut-out photos - the broadcast match view
// runs two of these, mirrored, flanking the score plate.
// One roster row on the broadcast plate. The faces behind the plate are a
// backdrop wash at 16% opacity - deliberately unreadable - so during a match
// you could not actually tell who was playing. This puts the portrait on the
// name, which is what a broadcast lower-third does and what makes a squad
// recognisable across a long run.
function CastPlayer({ card, isIgl, trigger = null }) {
  return (
    <span className={styles.castPlayer} data-triggered={trigger ? 'true' : undefined}>
      <span className={styles.castPlayerFace} aria-hidden="true">
        {hasRealPortrait(card)
          ? <PlayerPortrait card={card} fluid loading="lazy" />
          // A third of the pool has no cutout. Their initial is at least
          // per-player and legible at this size, where the grey silhouette
          // just reads as a failed image.
          : <span className={styles.castPlayerInitial}>{card.player.slice(0, 2)}</span>}
      </span>
      <span className={styles.castPlayerName}>
        {card.player}
        {isIgl && <b className={styles.castIglTag}>IGL</b>}
      </span>
      <span className={styles.castPlayerRating}>{card.rating}</span>
      {trigger && (
        <span key={trigger.key} className={styles.castTrigger} aria-hidden="true">
          <b>{trigger.label}</b>
          <i>{trigger.detail}</i>
        </span>
      )}
    </span>
  );
}

function HeroBand({ roster, side }) {
  // No photo filter - see SquadHero. Dropping photo-less players here left one
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
            <CountryFlag code={option.nationality} className={styles.countryFlag} />
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
        // bare teamId - a winner's id also already sits in its OLD round's
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
  // renders as TBD here too - data-team-id stays put either way so the travel
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
              ? <CountryFlag code={team.nationality} />
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
        <span>Best finish <b>{saves?.bestFinish ?? '-'}</b></span>
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
        // that snaps back - the run is actually over, so the color stays
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

function PackPhase({ nat, choices, ripId, picks, pendingSwap, onDropSwap, onConfirm, onCancel, onSign, openSlot }) {
  const outgoing = pendingSwap ? picks.find(p => p.id === pendingSwap.targetId) : null;
  const [keyboardCard, setKeyboardCard] = useState(null);

  function choosePackCard(card, targetId) {
    if (targetId) {
      setKeyboardCard(null);
      onDropSwap(card, targetId);
    }
    else setKeyboardCard(card);
  }

  function startKeyboardSwap(targetId) {
    if (!keyboardCard) return;
    const incoming = keyboardCard;
    setKeyboardCard(null);
    if (targetId == null) onSign(incoming);
    else onDropSwap(incoming, targetId);
  }

  return (
    <section>
      <div className={styles.boardHead}>
        <span className={styles.stageLabel}>Open pack</span>
      </div>

      {/* Always mounted, just hidden - conditionally rendering this in and
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
          onPick={choosePackCard}
          dropTarget="chip"
          clickable
        />
        <p className={styles.swapHint}>
          {openSlot
            ? 'You have an open squad slot - select a card to sign it, or drag one onto a player to replace them.'
            : 'Drag a card into the dock, or select it and choose a player below.'}
        </p>
        {keyboardCard && (
          <div className={styles.keyboardSwap} role="group" aria-label={`Choose who ${keyboardCard.player} replaces`}>
            <b>{openSlot ? `Sign ${keyboardCard.player}` : `Replace with ${keyboardCard.player}`}</b>
            {openSlot && (
              <button type="button" onClick={() => startKeyboardSwap(null)}>Take the open slot</button>
            )}
            {picks.map(card => <button type="button" key={card.id} onClick={() => startKeyboardSwap(card.id)}>{card.player}</button>)}
            <button type="button" onClick={() => setKeyboardCard(null)}>Cancel</button>
          </div>
        )}
      </div>

      {pendingSwap && (outgoing || pendingSwap.targetId === null) && (
        <div className={styles.swapArea}>
          <div className={styles.swapConfirm}>
            <div className={styles.swapIncoming}>
              <span className={styles.stripLabel}>Incoming</span>
              <PlayerCard card={pendingSwap.card} displayScale={0.42} />
            </div>
            {outgoing && <span className={styles.swapArrow} aria-hidden="true">→</span>}
            {outgoing && (
              <div className={styles.swapOutgoing}>
                <span className={styles.stripLabel}>Leaving</span>
                <PlayerCard card={outgoing} displayScale={0.42} />
              </div>
            )}
          </div>
          <div className={styles.swapConfirmActions}>
            <TacticalButton className={styles.secondary} onClick={onCancel}>Cancel</TacticalButton>
            <TacticalButton className={styles.primary} onClick={onConfirm}>{outgoing ? 'Confirm swap' : 'Sign player'}</TacticalButton>
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
        {endless ? ` ${result.completedYears} completed ${result.completedYears === 1 ? 'year' : 'years'},` : ''}
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

// Where the squad sits on the three-tier circuit, and what this year's
// results are doing about it. The ladder is the difficulty curve, so it has
// to be readable at a glance rather than inferred from who you keep drawing.
// What the year did to the squad. Development is invisible by design while
// it happens - this is the one place it is stated plainly, once, so a player
// can see that keeping a core together is paying off rather than having to
// infer it from a slowly moving power number.
// The academy's yearly offer. A raw, cheap card whose value is entirely in
// front of them - the counterweight to a pack economy that only pays winners.
// A rival has made an approach. Deliberately a blocking decision at the top
// of the manage screen rather than a line in the feed: the whole point of the
// mechanic is that dominance costs you something, and a cost you can scroll
// past is not a cost.
// The year as three slots. A long run produced dozens of report cards; this
// says the same thing in one line and keeps the detail one tap away.
// Power and the reasons for it. Reading material rather than something you
// manipulate - the squad itself lives in the dock, where you can move it.
function ChemPanel({ power }) {
  const chemSign = power.chem > 0 ? 'up' : power.chem < 0 ? 'down' : 'flat';
  return (
    <div className={styles.chem}>
      <div className={styles.chemHead}>
        <b className={styles.chemTotal}>{power.power.toFixed(1)}</b>
        <span className={styles.chemLabel}>
          Team power
          <i>avg {power.base.toFixed(1)}</i>
        </span>
        {/* Chemistry as a badge with its own arrow, not a number folded into
            a sentence - the direction is the thing to notice at a glance. */}
        <span className={styles.chemBadge} data-sign={chemSign}>
          <span className={styles.chemBadgeArrow} aria-hidden="true">
            {chemSign === 'up' ? '▲' : chemSign === 'down' ? '▼' : '–'}
          </span>
          {Math.abs(power.chem)}
        </span>
      </div>
      {power.lines?.length > 0 && (
        <ul className={styles.chemList}>
          {power.lines.map(line => (
            <li key={line.label}>
              <span>{line.label}</span>
              <b data-sign={String(line.value).startsWith('-') ? 'down' : 'up'}>{line.value}</b>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SeasonStrip({ results, season, tourIndex, endless }) {
  const [openIndex, setOpenIndex] = useState(null);
  const yearIndex = endless ? Math.floor(tourIndex / 3) : 0;
  const thisYear = results.slice(yearIndex * 3, yearIndex * 3 + 3);
  const events = (endless ? season.slice(yearIndex * 3, yearIndex * 3 + 3) : season).slice(0, 3);
  if (!events.length) return null;

  return (
    <div className={styles.season}>
      <span className={styles.seasonLabel}>{endless ? `Year ${yearIndex + 1}` : 'Season'}</span>
      <ol className={styles.seasonList}>
        {events.map((event, i) => {
          const played = thisYear[i];
          const state = played ? (played.champion ? 'won' : 'played') : i === tourIndex % 3 ? 'next' : 'upcoming';
          const Tag = played ? 'button' : 'div';
          return (
            <li key={event.label}>
              <Tag
                type={played ? 'button' : undefined}
                className={styles.seasonSlot}
                data-state={state}
                data-open={openIndex === i ? 'true' : undefined}
                onClick={played ? () => setOpenIndex(openIndex === i ? null : i) : undefined}
              >
                <span className={styles.seasonCity}>{event.city || event.label}</span>
                <span className={styles.seasonResult}>
                  {played ? (played.champion ? 'Champion' : played.finishRound) : state === 'next' ? 'Next' : '-'}
                </span>
              </Tag>
            </li>
          );
        })}
      </ol>
      {/* Detail stays one tap away rather than stacked on the page. */}
      {openIndex != null && thisYear[openIndex] && (
        <TournamentReport result={thisYear[openIndex]} />
      )}
    </div>
  );
}

function PoachOffer({ offer, card, signals, reputation, onResolve, onInspect }) {
  if (!offer || !card) return null;
  const canHold = reputation >= offer.holdCost;
  const short = offer.holdCost - reputation;
  return (
    <div className={styles.poach}>
      <button
        type="button"
        className={styles.poachCard}
        onClick={() => onInspect(card)}
        aria-label={`Inspect ${card.player}`}
      >
        <PlayerCard card={card} displayScale={0.32} tilt={false} signals={signals} />
      </button>
      <span className={styles.poachBody}>
        <b className={styles.poachName}>{offer.orgName} want {offer.player}</b>
        {/* Cost as badges, not a sentence — a rep tag and a pack-icon tag,
            same idiom the market's own sign price and chemistry badge use. */}
        <span className={styles.poachTerms}>
          <span className={styles.poachTerm} data-ok={canHold ? 'true' : 'false'}>
            <b>{offer.holdCost}</b>
            <small>REP to refuse</small>
          </span>
          <span className={styles.poachTerm}>
            <img className={styles.poachTermIcon} src={assetPath('/assets/brand/gauntlet-icon.webp')} alt="" aria-hidden="true" />
            <b>+{offer.releaseFee}</b>
            <small>to release</small>
          </span>
        </span>
      </span>
      <span className={styles.poachActions}>
        <span className={styles.poachRefuse}>
          <TacticalButton className={styles.secondary} disabled={!canHold} onClick={() => onResolve(false)}>
            Refuse
          </TacticalButton>
          {/* The button alone doesn't say WHY it's greyed out — this does,
              instead of making the player go do the subtraction themselves
              against the badge above. */}
          {!canHold && <span className={styles.poachShort}>Need {short} more rep</span>}
        </span>
        <TacticalButton className={styles.primary} onClick={() => onResolve(true)}>
          Let him go
        </TacticalButton>
      </span>
    </div>
  );
}

// Bleeds an element out to the frame's actual edges - the mode rail on the
// left, the safe-area inset on the right - regardless of how it's nested.
// `.desk`'s content column is independently width-capped AND centered
// inside `.page`'s own padding, so which one ends up narrower (and by how
// much) depends on viewport width; duplicating that math in CSS would mean
// two competing centering formulas fighting for the right answer. Measuring
// the live gap instead sidesteps that entirely. Purely visual - an inline
// width/margin layered on top of the flow position the element already has
// - so it still reserves its own height normally; nothing downstream in
// `.desk` has to account for it stepping out of flow.
function useFrameBleed(ref) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    function measure() {
      // Reset first: last run's own margin/width would otherwise be baked
      // into this run's measured rect.
      el.style.marginLeft = '0px';
      el.style.width = '';
      const rect = el.getBoundingClientRect();
      const root = getComputedStyle(document.documentElement);
      const railSize = parseFloat(root.getPropertyValue('--rail-size')) || 0;
      const safeL = parseFloat(root.getPropertyValue('--safe-l')) || 0;
      const safeR = parseFloat(root.getPropertyValue('--safe-r')) || 0;
      // Mirrors PerfectRun.module.css's own `.frame` breakpoint: the rail
      // becomes a top bar under 680px, so it stops reserving left space.
      const mobile = window.matchMedia('(max-width: 680px)').matches;
      const frameLeft = mobile ? safeL : railSize + safeL;
      const frameWidth = window.innerWidth - frameLeft - safeR;
      el.style.marginLeft = `${frameLeft - rect.left}px`;
      el.style.width = `${frameWidth}px`;
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [ref]);
}

// Spend packs on a NAMED player instead of a gamble. Reputation decides who
// will even take the call, which is what stops it being a shop.
function TransferMarket({ targets, packs, ceiling, onSign, onInspect, signalsFor }) {
  const marketRef = useRef(null);
  useFrameBleed(marketRef);

  // A plain vertical wheel gesture (a mouse, not a trackpad) does nothing on
  // an overflow-x shelf - there's no vertical room to scroll. Redirect that
  // delta into horizontal motion so the shelf reacts to scrolling either way.
  const listRef = useRef(null);
  useScrollLean(listRef);
  const onWheel = useCallback((event) => {
    const el = listRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    el.scrollLeft += event.deltaY;
    event.preventDefault();
  }, []);

  return (
    <div className={styles.market} ref={marketRef}>
      <div className={styles.marketHeadRow}>
        <span className={styles.marketHead}>Transfer market</span>
        <span className={styles.marketMeta}>
          <img className={styles.marketPackIcon} src={assetPath('/assets/brand/gauntlet-icon.webp')} alt="" aria-hidden="true" />
          <b>{packs}</b> · up to {ceiling}
        </span>
      </div>
      {targets.length === 0 ? (
        <p className={styles.marketEmpty}>Nobody in reach is available.</p>
      ) : (
        // The real card, not a summary of one. Rating, role, nationality, the
        // five stats, specialties and career stage are all already drawn on
        // it - restating any of them beside it would be telling. Everyone
        // your club could plausibly attract shows up here, not just who you
        // can afford this instant - a shop window, not a receipt: seeing a
        // name and knowing you're 2 packs short is the point, not a reason
        // to hide it.
        <ul className={styles.marketList} ref={listRef} onWheel={onWheel}>
          {targets.map(card => {
            const cost = signingCost(card);
            const affordable = packs >= cost;
            return (
              <li key={card.id} className={styles.marketPick}>
                <div className={styles.marketCard}>
                  <PlayerCard
                    card={card}
                    displayScale={0.34}
                    onClick={() => onInspect(card)}
                    signals={signalsFor(card)}
                  />
                </div>
                {/* Cost as a pack icon with the count on it, not the words
                    "N packs" - same idiom as the dock's own pack badge.
                    Disabled (not hidden) when short on packs, so the target
                    stays visible as something to save toward. */}
                <TacticalButton
                  className={styles.secondary}
                  onClick={() => onSign(card)}
                  disabled={!affordable}
                  aria-label={affordable
                    ? `Sign for ${cost} pack${cost === 1 ? '' : 's'}`
                    : `Need ${cost} packs, have ${packs}`}
                >
                  <span className={styles.marketCost} aria-hidden="true">
                    <img className={styles.marketCostIcon} src={assetPath('/assets/brand/gauntlet-icon.webp')} alt="" />
                    <b>{cost}</b>
                  </span>
                </TacticalButton>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// Everything that happened while you were not looking. Transfers render the
// player in their NEW kit - the portrait compositor already supports it, and
// seeing your man in someone else's shirt is the whole emotional payload.
function NewsFeed({ feed, cardsById }) {
  if (!feed?.length) return null;
  return (
    <div className={styles.news}>
      <span className={styles.newsHead}>Around the circuit</span>
      <ul className={styles.newsList}>
        {feed.slice(0, 8).map((item, i) => {
          const { title, note } = describeNews(item);
          const card = item.cardId ? cardsById.get(item.cardId) : null;
          const kit = newsKit(item);
          return (
            <li key={`${item.y}-${item.t}-${i}`} className={styles.newsRow}>
              {card ? (
                <span className={styles.castPlayerFace} aria-hidden="true">
                  {hasRealPortrait(card)
                    ? <PlayerPortrait card={card} kit={kit ?? undefined} fluid loading="lazy" />
                    : <span className={styles.castPlayerInitial}>{card.player.slice(0, 2)}</span>}
                </span>
              ) : (
                <span className={styles.newsDot} aria-hidden="true" />
              )}
              <span className={styles.newsTitle}>{title}</span>
              <span className={styles.newsNote}>{note}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ProspectOffer({ card, signals, onSign, onDecline, onInspect }) {
  if (!card) return null;
  return (
    <div className={styles.prospect}>
      {/* No copy about "years of growth ahead" - the card carries an age, a
          PROSPECT chip and a headroom bar, which is the same claim made in
          data the player can check. */}
      <button
        type="button"
        className={styles.prospectCard}
        onClick={() => onInspect(card)}
        aria-label={`Inspect ${card.player}`}
      >
        <PlayerCard card={card} displayScale={0.38} tilt={false} signals={signals} />
      </button>
      <span className={styles.prospectSide}>
        <span className={styles.prospectHead}>From the academy</span>
      </span>
      <span className={styles.prospectActions}>
        <TacticalButton className={styles.primary} onClick={onSign}>Sign free</TacticalButton>
        <TacticalButton className={styles.secondary} onClick={onDecline}>Pass</TacticalButton>
      </span>
    </div>
  );
}

function SquadReport({ report, squad }) {
  if (!report?.changes?.length) return null;
  const byId = new Map(squad.map(card => [card.id, card]));
  const order = { legend: 0, growth: 1, decline: 2 };
  const changes = [...report.changes].sort(
    (a, b) => order[a.kind] - order[b.kind] || Math.abs(b.n) - Math.abs(a.n),
  );

  return (
    <div className={styles.squadReport}>
      <span className={styles.squadReportHead}>Year {report.year} · Squad development</span>

      <ul className={styles.squadReportList}>
        {changes.map(change => {
          const card = byId.get(change.id);
          return (
            <li key={`${change.id}-${change.kind}`} className={styles.squadReportRow} data-kind={change.kind}>
              <span className={styles.castPlayerFace} aria-hidden="true">
                {card && hasRealPortrait(card)
                  ? <PlayerPortrait card={card} fluid loading="lazy" />
                  : <span className={styles.castPlayerInitial}>{change.player.slice(0, 2)}</span>}
              </span>
              <span className={styles.squadReportName}>{change.player}</span>
              <span className={styles.squadReportNote}>
                {change.kind === 'legend' ? 'Became a legend - no longer declines'
                  : change.kind === 'growth' ? 'Improving' : 'Slipping'}
              </span>
              <span className={styles.squadReportDelta}>
                {change.kind === 'legend' ? '★' : `${change.n > 0 ? '+' : ''}${change.n}`}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CircuitPanel({ tier, tierPoints, reputation, eventInYear, year, move }) {
  const { rank, next, pct: repPct } = reputationRankProgress(reputation);
  // Position on a track running from the relegation line to the promotion
  // line, so "how close am I to dropping" is a distance, not a number.
  const span = PROMOTE_AT - RELEGATE_AT;
  const pct = Math.max(0, Math.min(1, (tierPoints - RELEGATE_AT) / span)) * 100;

  return (
    <div className={styles.circuit}>
      <div className={styles.circuitHead}>
        <h3 className={styles.circuitTitle}>Circuit standing</h3>
        <span className={styles.circuitWhen}>Y{year} · E{eventInYear}/3</span>
      </div>

      {/* Reputation as a badge with its own meter, not a label glued to a
          number - the rank IS the read, and how close the next one is
          should be a bar you glance at, not arithmetic you do. */}
      <div className={styles.circuitRank}>
        <span className={styles.circuitRankBadge} data-rank={rank.key}>{rank.label}</span>
        <div
          className={styles.circuitRankTrack}
          role="img"
          aria-label={`${reputation} reputation${next ? `; ${next.label} at ${next.min}` : ' - highest rank reached'}`}
        >
          <span className={styles.circuitRankFill} style={{ width: `${repPct}%` }} />
        </div>
        <span className={styles.circuitRankValue}>{reputation}</span>
      </div>

      <ol className={styles.circuitTiers}>
        {TIER_META.map((meta, i) => (
          <li
            key={meta.key}
            className={styles.circuitTier}
            data-state={i === tier ? 'current' : i < tier ? 'below' : 'above'}
          >
            {meta.label}
          </li>
        ))}
      </ol>

      {move && (
        <p className={styles.circuitMove} data-move={move.movement}>
          {move.movement === 'promote'
            ? `Promoted to ${TIER_META[move.tier].label} after year ${move.year}.`
            : `Relegated to ${TIER_META[move.tier].label} after year ${move.year}.`}
        </p>
      )}

      <div className={styles.circuitTrack} role="img"
        aria-label={`${tierPoints} circuit points; promotion at ${PROMOTE_AT}, relegation at ${RELEGATE_AT}`}>
        <span className={styles.circuitFill} style={{ width: `${pct}%` }} />
        <span className={styles.circuitPin} style={{ left: `${pct}%` }} />
      </div>
      <div className={styles.circuitScale}>
        <span data-edge="drop">Relegation</span>
        <span data-edge="rise">Promotion</span>
      </div>
    </div>
  );
}

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

function DraftLane({ nation, choices, ripId, interactive, onPick, label, dropTarget, clickable, displayScale = 0.5, packScale = 1 }) {
  return (
    <PackRip
      ripId={ripId}
      nation={nation}
      packTitle={nation ? countryName(nation) : undefined}
      choices={choices}
      interactive={interactive}
      onPick={onPick}
      headerLabel={label}
      displayScale={displayScale}
      packScale={packScale}
      dropTarget={dropTarget}
      clickable={clickable}
    />
  );
}

// Eased count-up for the records strip
function CountUp({ value }) {
  const [n, setN] = useState(0);
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    if (!value || reducedMotion) {
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
  }, [value, reducedMotion]);
  return <>{n}</>;
}

// The shared skip affordance for every automatic sequence in the run - the
// three duration-based pauses (intro splash, series-end, board-complete),
// the live match round-reveal, and the bracket travel flight. `progress`
// (1 -> 0, a draining bar) only exists for the duration-based ones; the
// other two are indeterminate, so the button renders alone - deliberately
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
