import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import PlayerCard from '../components/PlayerCard';
import allCards from '../data/cards.json';
import { countryName } from '../lib/utils';
import {
  mulberry32, todaySeed, ROSTER_SIZE,
  rollNationality, draftChoices, teamPower,
  STAGE_META, buildField, generateNextRound, currentRound, playerMatch,
  setPlayerResult, resolveNpcMatches, applySwissRecords,
  pickMaps, simMap, evaluateRun,
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

export default function PerfectRun() {
  const [phase, setPhase] = useState('menu'); // menu | draft | review | run | over
  const [mode, setMode] = useState('solo');
  const rng = useRef(null);

  // draft
  const [picks, setPicks] = useState([]);
  const [nat, setNat] = useState(null);
  const [choices, setChoices] = useState([]);
  const [rerolls, setRerolls] = useState(3);

  // review
  const [iglId, setIglId] = useState(null);

  // tournament
  const [tour, setTour] = useState(null);
  const [view, setView] = useState('board');          // board | match
  const [boardState, setBoardState] = useState('pairings'); // pairings | revealing | complete
  const [revealCount, setRevealCount] = useState(0);
  const [maps, setMaps] = useState([]);               // map names for the player's series
  const [mapResults, setMapResults] = useState([]);   // finished {a,b,winA,mvp,map}
  const [history, setHistory] = useState([]);         // player series summaries
  const [live, setLive] = useState(null);             // {a,b} while a map animates
  const [failed, setFailed] = useState(false);
  const [finalResult, setFinalResult] = useState(null);
  const animTimer = useRef(null);
  const revealTimer = useRef(null);
  const advanceTimer = useRef(null);
  const seriesActive = useRef(false); // guards double "Play your match"

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
    setPicks([]); setIglId(null);
    setRerolls(selectedMode === 'daily' ? 1 : 3);
    setTour(null); setView('board'); setBoardState('pairings'); setRevealCount(0);
    setMaps([]); setMapResults([]); setHistory([]);
    setLive(null); setFailed(false); setFinalResult(null);
    clearInterval(animTimer.current);
    clearInterval(revealTimer.current);
    clearTimeout(advanceTimer.current);
    seriesActive.current = false;
    rollSlot(new Set());
    setPhase('draft');
  }

  function rollSlot(ids) {
    const rolled = rollNationality(rng.current, allCards, ids);
    setNat(rolled);
    setChoices(draftChoices(rng.current, allCards, rolled, ids));
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

  function enterTournament() {
    const playerTeam = {
      id: 'player', tag: 'YOU', name: 'Your Squad', logo: null,
      roster: picks, power: power.power, isPlayer: true,
    };
    const t = buildField(rng.current, allCards, pickedIds, playerTeam);
    generateNextRound(t, rng.current);
    setTour({ ...t });
    setView('board');
    setBoardState('pairings');
    setPhase('run');
  }

  const round = tour ? currentRound(tour) : null;
  const pMatch = tour ? playerMatch(tour) : null;
  const opp = pMatch && tour ? tour.teams[pMatch.b] : null;
  const isPlayoffs = tour ? tour.stageIdx >= 4 : false;

  function playMatch() {
    if (seriesActive.current) return;
    seriesActive.current = true;
    const seriesMaps = pickMaps(rng.current, round.bestOf);
    setMaps(seriesMaps);
    setMapResults([]);
    setView('match');
    // small beat so the match view has mounted before the first map animates
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

    // Elapsed-time driven so a throttled background tab catches up instantly
    // instead of crawling at the throttled timer rate.
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
          // series decided: hold on the final score, then back to the board
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
    setHistory(h => [...h, {
      stage: round.label, opp: opp.name,
      mapsWon: wonMaps, mapsLost: lostMaps, roundDiff, won,
      score: results.map(r => `${r.a}-${r.b}`).join('  '),
    }]);

    setPlayerResult(tour, results, won);
    resolveNpcMatches(tour, rng.current);
    applySwissRecords(tour);
    setTour({ ...tour });

    // staggered reveal of the other matches, then advance on its own
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
    }, 280);
  }

  // What happens after this round, from the player's perspective
  function playerOutcome() {
    if (!round || !pMatch?.winner) return null;
    const wonSeries = pMatch.winner === 'player';
    if (round.key === 'final') return wonSeries ? 'champion' : 'out';
    if (STAGE_META[round.key].swiss) {
      return tour.records.player.l >= 2 ? 'out' : 'through';
    }
    return wonSeries ? 'through' : 'out';
  }

  function advance() {
    seriesActive.current = false;
    const outcome = playerOutcome();
    if (outcome === 'champion') { endRun(true); return; }
    if (outcome === 'out') { endRun(false); return; }
    generateNextRound(tour, rng.current);
    setTour({ ...tour });
    setBoardState('pairings');
    setRevealCount(0);
  }

  function endRun(champion) {
    const result = evaluateRun(history, champion);
    setFinalResult(result);
    setFailed(!champion);

    const saves = loadSaves();
    saves.bestScore = Math.max(saves.bestScore ?? 0, result.score);
    saves.badges ??= {};
    for (const b of result.badges) saves.badges[b.key] = (saves.badges[b.key] ?? 0) + 1;
    if (mode === 'daily') {
      saves.dailyScores ??= {};
      const k = dateKey();
      saves.dailyScores[k] = Math.max(saves.dailyScores[k] ?? 0, result.score);
    }
    saveSaves(saves);
    setPhase('over');
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const saves = loadSaves();
  const todayBest = saves.dailyScores?.[dateKey()];
  const compactHeader = phase === 'run' || phase === 'over';

  // Menu key art: the three highest-rated cards that have real photos
  const fanCards = useMemo(() =>
    allCards
      .filter(c => c.photo !== '/assets/players/placeholder.png')
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 3),
  []);

  return (
    <div className={styles.page}>
      {phase === 'menu' ? (
        <header className={styles.slimHeader}>
          <Link to="/collection" className={styles.navLink}>Collection</Link>
        </header>
      ) : compactHeader ? (
        <header className={styles.slimHeader}>
          <Link to="/collection" className={styles.navLink}>Collection</Link>
          <span className={styles.slimTitle}>Perfect Run</span>
          {phase === 'run' && round && <span className={styles.slimStage}>{round.label}</span>}
        </header>
      ) : (
        <header className={styles.header}>
          <Link to="/collection" className={styles.navLink}>Collection</Link>
          <span className={styles.eyebrow}>VCT Champions Simulator</span>
          <h1 className={styles.title}>Perfect Run</h1>
          <span className={styles.subtitle}>
            Draft a five-man roster from random nations, then try to win the whole
            event without dropping a single map.
          </span>
        </header>
      )}

      {phase === 'menu' && (
        <>
          <section className={styles.menu}>
            <div className={styles.menuMain}>
              <h1 className={styles.menuTitle}>Perfect<br />Run<em>//</em></h1>
              <p className={styles.menuTag}>Seven series. Zero maps dropped.</p>

              <div className={styles.menuModes}>
                <button className={styles.modeBtn} onClick={() => startRun('solo')}>
                  <span className={styles.modeBtnName}>Solo Run</span>
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
                <span>Titles <b><CountUp value={saves.badges?.champion ?? 0} /></b></span>
                <span>7-0 <b><CountUp value={saves.badges?.sweep ?? 0} /></b></span>
                <span>Perfect <b><CountUp value={saves.badges?.perfect ?? 0} /></b></span>
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

      {phase === 'draft' && (
        <section>
          <div className={styles.draftBar}>
            <div>
              <span className={styles.draftSlot}>Pick {picks.length + 1} of {ROSTER_SIZE}</span>
              <span className={styles.draftNat}>
                <span className={`fi fi-${nat?.toLowerCase()}`} style={{ width: 34, height: 24 }} />
                {countryName(nat)}
              </span>
            </div>
            <button className={styles.rerollBtn} onClick={reroll} disabled={rerolls <= 0}>
              Reroll nation ({rerolls} left)
            </button>
          </div>

          <div className={styles.choices}>
            {choices.map(card => (
              <PlayerCard key={card.id} card={card} displayScale={0.45} onClick={() => pickPlayer(card)} />
            ))}
          </div>

          {picks.length > 0 && (
            <div className={styles.rosterStrip}>
              <span className={styles.stripLabel}>Your squad</span>
              {picks.map(card => (
                <PlayerCard key={card.id} card={card} displayScale={0.28} />
              ))}
            </div>
          )}
        </section>
      )}

      {phase === 'review' && (
        <section>
          <h2 className={styles.sectionTitle}>Name your IGL. Click a player.</h2>
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

          {power && (
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
          )}

          <button className={styles.primary} onClick={enterTournament} disabled={!iglId}>
            {iglId ? 'Enter Champions' : 'Choose an IGL first'}
          </button>
        </section>
      )}

      {phase === 'run' && view === 'board' && tour && round && (
        <Board
          tour={tour}
          round={round}
          boardState={boardState}
          revealCount={revealCount}
          isPlayoffs={isPlayoffs}
          outcome={playerOutcome()}
          onPlay={playMatch}
        />
      )}

      {phase === 'run' && view === 'match' && round && opp && (
        <section>
          <div className={styles.scoreHead}>
            <span className={styles.stageLabel}>{round.label} (Bo{round.bestOf})</span>
            {STAGE_META[round.key].swiss && (
              <span className={styles.groupNote}>
                record {tour.records.player.w}-{tour.records.player.l}, two losses and you are out
              </span>
            )}
          </div>

          <div className={styles.scoreMain}>
            <span className={styles.teamA}>Your Squad</span>
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

      {phase === 'over' && finalResult && (
        <section className={styles.overScreen}>
          <h2 className={failed ? styles.overFail : styles.overWin}>
            {failed ? 'Run over' : finalResult.badges.some(b => b.key === 'perfect') ? 'Perfect run' : 'Champions'}
          </h2>

          {finalResult.badges.length > 0 && (
            <div className={styles.badges}>
              {finalResult.badges.map(b => (
                <div key={b.key} className={`${styles.badge} ${styles['badge_' + b.key]}`}>
                  <b>{b.label}</b>
                  <span>{b.desc}</span>
                </div>
              ))}
            </div>
          )}

          <div className={styles.scoreLine}>
            Score<b>{finalResult.score}</b>
            {finalResult.seriesWon} series won, {finalResult.mapsWon} maps,
            {' '}{finalResult.roundDiff >= 0 ? '+' : ''}{finalResult.roundDiff} round differential
          </div>

          <div className={styles.historyList}>
            {history.map((h, i) => (
              <div key={i} className={[styles.historyRow, h.won ? styles.mapWin : styles.mapLoss].join(' ')}>
                <span className={styles.historyStage}>{h.stage}</span>
                <span className={styles.historyOpp}>vs {h.opp}</span>
                <span className={styles.historyScore}>{h.mapsWon}–{h.mapsLost}</span>
                <span className={styles.historyMaps}>{h.score}</span>
              </div>
            ))}
          </div>

          <div className={styles.overButtons}>
            <button className={styles.primary} onClick={() => startRun(mode)}>Run it back</button>
            <button className={styles.secondary} onClick={() => setPhase('menu')}>Menu</button>
          </div>
        </section>
      )}
    </div>
  );
}

// ── Board: all matches of the current stage, plus the playoff bracket ────────

function Board({ tour, round, boardState, revealCount, isPlayoffs, outcome, onPlay }) {
  const swiss = STAGE_META[round.key].swiss;

  // NPC matches reveal one by one after the player's series
  const npcMatches = round.matches.filter(m => !m.isPlayerMatch);
  const isRevealed = (m) => {
    if (m.isPlayerMatch) return !!m.winner;
    if (boardState === 'pairings') return false;
    return npcMatches.indexOf(m) < revealCount;
  };

  const statusLine = (() => {
    if (boardState === 'pairings') {
      if (round.key === 'playin') return 'Win and you are in the group stage.';
      if (swiss) return `Your record: ${tour.records.player.w}-${tour.records.player.l}. Two losses and you are out.`;
      return 'Single elimination. Win or go home.';
    }
    if (boardState === 'complete') {
      if (outcome === 'champion') return 'You have won VCT Champions.';
      if (outcome === 'out') return 'Your run ends here.';
      if (swiss) return `Your record: ${tour.records.player.w}-${tour.records.player.l}. On to the next round.`;
      return 'You advance.';
    }
    return 'Results coming in.';
  })();

  return (
    <section>
      <div className={styles.boardHead}>
        <span className={styles.stageLabel}>{round.label} (Bo{round.bestOf})</span>
        <span className={styles.groupNote}>{statusLine}</span>
      </div>

      {isPlayoffs ? (
        <Bracket tour={tour} round={round} isRevealed={isRevealed} />
      ) : (
        <PoolBoard tour={tour} round={round} swiss={swiss} isRevealed={isRevealed} />
      )}

      <div className={styles.boardActions}>
        {boardState === 'pairings' && (
          <button className={styles.primary} onClick={onPlay}>Play your match</button>
        )}
      </div>
    </section>
  );
}

function PoolBoard({ tour, round, swiss, isRevealed }) {
  // Group matches by pool label ('0-0', '1-0', ...), player match pool first
  const pools = [];
  for (const m of round.matches) {
    let pool = pools.find(p => p.label === m.pool);
    if (!pool) { pool = { label: m.pool, matches: [] }; pools.push(pool); }
    pool.matches.push(m);
  }

  return (
    <div className={styles.poolBoard}>
      {pools.map(pool => (
        <div key={pool.label} className={styles.pool}>
          {pools.length > 1 && (
            <span className={styles.poolLabel}>
              {pool.label === '2-0' ? '2-0 seeding matches' : `${pool.label} pool`}
            </span>
          )}
          {pool.matches.map((m, i) => (
            <MatchRow key={i} tour={tour} match={m} swiss={swiss} revealed={isRevealed(m)} />
          ))}
        </div>
      ))}
    </div>
  );
}

function MatchRow({ tour, match, swiss, revealed }) {
  const a = tour.teams[match.a];
  const b = tour.teams[match.b];
  return (
    <div className={[styles.boardMatch, match.isPlayerMatch ? styles.playerMatch : '', revealed ? styles.revealed : ''].join(' ')}>
      <TeamCell team={a} tour={tour} swiss={swiss} won={revealed && match.winner === a.id} lost={revealed && match.winner === b.id} />
      <span className={styles.boardScore}>
        {revealed ? `${match.scoreA} : ${match.scoreB}` : 'vs'}
      </span>
      <TeamCell team={b} tour={tour} swiss={swiss} right won={revealed && match.winner === b.id} lost={revealed && match.winner === a.id} />
    </div>
  );
}

function TeamCell({ team, tour, swiss, right = false, won, lost }) {
  const rec = swiss ? tour.records[team.id] : null;
  return (
    <span className={[styles.teamCell, right ? styles.teamCellRight : '', won ? styles.cellWon : '', lost ? styles.cellLost : ''].join(' ')}>
      {team.logo
        ? <img src={team.logo} alt="" />
        : <span className={styles.youMark}>★</span>}
      <span className={styles.cellTag}>{team.isPlayer ? 'YOUR SQUAD' : team.tag}</span>
      {rec && <span className={styles.cellRec}>{rec.w}-{rec.l}</span>}
    </span>
  );
}

function Bracket({ tour, round, isRevealed }) {
  const qf = tour.rounds.find(r => r.key === 'quarter');
  const sf = tour.rounds.find(r => r.key === 'semi');
  const gf = tour.rounds.find(r => r.key === 'final');

  const cell = (m, key) => {
    if (!m) return <BracketCell key={key} />;
    // Matches from past rounds are always revealed; the current round animates
    const isCurrent = round.matches.includes(m);
    return <BracketCell key={key} tour={tour} match={m} revealed={!isCurrent || isRevealed(m)} />;
  };

  // Explicit grid: cell columns 1/3/5, connector columns 2/4, label row 1.
  const slot = (col, rowStart, rowEnd, child) => (
    <div key={`${col}-${rowStart}`} className={styles.bracketSlot} style={{ gridColumn: col, gridRow: `${rowStart} / ${rowEnd}` }}>
      {child}
    </div>
  );

  return (
    <div className={styles.bracket}>
      <span className={styles.poolLabel} style={{ gridColumn: 1, gridRow: 1 }}>Quarterfinals</span>
      <span className={styles.poolLabel} style={{ gridColumn: 3, gridRow: 1 }}>Semifinals</span>
      <span className={styles.poolLabel} style={{ gridColumn: 5, gridRow: 1 }}>Grand Final</span>

      {[0, 1, 2, 3].map(i => slot(1, i + 2, i + 3, cell(qf?.matches[i], `qf${i}`)))}

      <div className={styles.conn} style={{ gridColumn: 2, gridRow: '2 / 4' }} />
      <div className={styles.conn} style={{ gridColumn: 2, gridRow: '4 / 6' }} />

      {[0, 1].map(i => slot(3, i * 2 + 2, i * 2 + 4, cell(sf?.matches[i], `sf${i}`)))}

      <div className={styles.conn} style={{ gridColumn: 4, gridRow: '2 / 6' }} />

      {slot(5, 2, 6, cell(gf?.matches[0], 'gf'))}
    </div>
  );
}

// Eased count-up for the records strip
function CountUp({ value }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!value || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setN(value ?? 0);
      return;
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

function BracketCell({ tour, match, revealed }) {
  if (!match) {
    return (
      <div className={styles.bracketCell}>
        <div className={styles.bracketTeam}><span className={styles.cellTag}>TBD</span></div>
        <div className={styles.bracketTeam}><span className={styles.cellTag}>TBD</span></div>
      </div>
    );
  }
  const a = tour.teams[match.a];
  const b = tour.teams[match.b];
  const row = (team, score, isWinner, isLoser) => (
    <div className={[styles.bracketTeam, isWinner ? styles.cellWon : '', isLoser ? styles.cellLost : '', team.isPlayer ? styles.bracketYou : ''].join(' ')}>
      {team.logo ? <img src={team.logo} alt="" /> : <span className={styles.youMark}>★</span>}
      <span className={styles.cellTag}>{team.isPlayer ? 'YOU' : team.tag}</span>
      <span className={styles.bracketScore}>{revealed ? score : ''}</span>
    </div>
  );
  return (
    <div className={[styles.bracketCell, match.isPlayerMatch ? styles.playerMatch : '', revealed ? styles.revealed : ''].join(' ')}>
      {row(a, match.scoreA, revealed && match.winner === a.id, revealed && match.winner === b.id)}
      {row(b, match.scoreB, revealed && match.winner === b.id, revealed && match.winner === a.id)}
    </div>
  );
}
