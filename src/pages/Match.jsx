import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import MapCanvas from '../components/MapCanvas';
import PlayerCard from '../components/PlayerCard';
import AppFrame from '../components/AppFrame';
import StatusStrip from '../components/StatusStrip';
import allCards from '../data/cards.json';
import { simMap } from '../engine/perfectRun';
import styles from './Match.module.css';

export default function Match() {
  const location = useLocation();
  const navigate = useNavigate();

  // Use pre-match selections when present, with a stable direct-route fallback.
  const stateData = location.state || {};
  const playerSquad = stateData.playerSquad || allCards.slice(0, 5);
  const iglId = stateData.iglId || playerSquad[0]?.id;
  const isImportantMatch = stateData.isImportant ?? true;

  // CPU opponent team (e.g. Fnatic / PRX / LOUD)
  const oppSquad = allCards.slice(15, 20);

  // States
  const [showIntroHero, setShowIntroHero] = useState(isImportantMatch);
  const [viewMode, setViewMode] = useState('cardtable');
  const [liveScore, setLiveScore] = useState({ a: 0, b: 0 });
  const [isSimulating, setIsSimulating] = useState(false);
  const [matchFinished, setMatchFinished] = useState(false);
  const [roundLogs, setRoundLogs] = useState([]);
  const [currentRoundIdx, setCurrentRoundIdx] = useState(0);
  const simulationTimer = useRef(null);

  useEffect(() => () => {
    if (simulationTimer.current) clearInterval(simulationTimer.current);
  }, []);

  // Tactical Ops data calculations
  const playerOvr = Math.round(playerSquad.reduce((a, b) => a + b.rating, 0) / 5);
  const oppOvr = Math.round(oppSquad.reduce((a, b) => a + b.rating, 0) / 5);

  const startSimulation = () => {
    if (isSimulating) return;
    setShowIntroHero(false);
    setIsSimulating(true);

    // Pre-calculate full map simulation using engine
    const simResult = simMap(
      Math.random,
      playerOvr + 5,
      oppOvr,
      playerSquad,
      oppSquad,
      0
    );

    let idx = 0;
    let scoreA = 0;
    let scoreB = 0;

    simulationTimer.current = setInterval(() => {
      if (idx < simResult.rounds.length) {
        const winner = simResult.rounds[idx];
        if (winner === 'A') scoreA++;
        else scoreB++;

        setLiveScore({ a: scoreA, b: scoreB });
        setCurrentRoundIdx(idx + 1);

        // Generate detailed Tactical Ops duel log
        const pPlayer = playerSquad[idx % 5];
        const oPlayer = oppSquad[idx % 5];
        const zone = ['A Site', 'B Site', 'C Site', 'Mid'][idx % 4];

        setRoundLogs(prev => [
          {
            round: idx + 1,
            winner: winner === 'A' ? 'YOU' : 'OPP',
            zone,
            pName: pPlayer.player,
            oName: oPlayer.player,
            aimBonus: Math.round(pPlayer.stats.aim * 0.8),
            posBonus: Math.round(pPlayer.stats.positioning * 0.7),
            econCall: idx === 0 || idx === 12 ? 'ECO' : idx % 3 === 0 ? 'FORCE' : 'FULL BUY',
          },
          ...prev,
        ]);

        idx++;
      } else {
        clearInterval(simulationTimer.current);
        simulationTimer.current = null;
        setIsSimulating(false);
        setMatchFinished(true);
      }
    }, 400);
  };

  return (
    <AppFrame>
      <StatusStrip crumb="Match Simulation" count="Haven · Map 1 of 3 (Bo3)" />

        <div className={styles.mainContainer}>
          {/* Important-match hero overlay */}
          {showIntroHero ? (
            <div className={styles.heroOverlay}>
              <div className={styles.heroHeader}>
                <span className={styles.heroBadge}>★ IMPORTANT MATCH // GRAND FINAL</span>
                <h1 className={styles.heroTitle}>VCT MASTERS TOKYO</h1>
                <p className={styles.heroSub}>High Stakes Broadcast Stage</p>
              </div>

              <div className={styles.heroStage}>
                {/* Team A */}
                <div className={styles.teamHeroCard}>
                  <span className={styles.teamSideLabel}>YOUR SQUAD</span>
                  <h2 className={styles.teamName}>BRISBANE BANDITS</h2>
                  <div className={styles.teamOvrBadge}>OVR {playerOvr}</div>
                  <div className={styles.heroRosterCards}>
                    {playerSquad.map(card => (
                      <PlayerCard key={card.id} card={card} displayScale={0.34} />
                    ))}
                  </div>
                </div>

                <div className={styles.vsDivider}>
                  <span>VS</span>
                  <span className={styles.mapBadge}>MAP: HAVEN</span>
                </div>

                {/* Team B */}
                <div className={styles.teamHeroCard}>
                  <span className={styles.teamSideLabel}>OPPONENT</span>
                  <h2 className={styles.teamName}>OPPOSITION</h2>
                  <div className={styles.teamOvrBadge}>OVR {oppOvr}</div>
                  <div className={styles.heroRosterCards}>
                    {oppSquad.map(card => (
                      <PlayerCard key={card.id} card={card} displayScale={0.34} />
                    ))}
                  </div>
                </div>
              </div>

              <button className={styles.lockInBtn} onClick={startSimulation}>
                LOCK IN & START SIMULATION →
              </button>
            </div>
          ) : (
            /* Regular match shell with card-table and tactical views. */
            <div className={styles.matchShell}>
              {/* Match Header Bar */}
              <div className={styles.matchHeader}>
                <div className={styles.scoreBoard}>
                  <div className={styles.teamScore}>
                    <span className={styles.teamTag}>YOU</span>
                    <span className={styles.scoreNum}>{liveScore.a}</span>
                  </div>
                  <div className={styles.scoreDivider}>
                    <span className={styles.roundCount}>ROUND {currentRoundIdx}</span>
                    <span className={styles.vsText}>FIRST TO 13</span>
                  </div>
                  <div className={styles.teamScore}>
                    <span className={styles.scoreNum}>{liveScore.b}</span>
                    <span className={styles.teamTag}>OPP</span>
                  </div>
                </div>

                {/* View Mode Toggle: 1b Card Table vs 1c Tactical Ops */}
                <div className={styles.modeToggleBar}>
                  <button
                    className={[styles.modeBtn, viewMode === 'cardtable' ? styles.modeActive : ''].join(' ')}
                    onClick={() => setViewMode('cardtable')}
                  >
                    Card Table
                  </button>
                  <button
                    className={[styles.modeBtn, viewMode === 'tacticalops' ? styles.modeActive : ''].join(' ')}
                    onClick={() => setViewMode('tacticalops')}
                  >
                    Tactical Ops
                  </button>
                </div>
              </div>

              {/* Card-table view */}
              {viewMode === 'cardtable' && (
                <div className={styles.cardTableContainer}>
                  {/* Opponent Hand (Top) */}
                  <div className={styles.handStrip}>
                    <span className={styles.handLabel}>Opponent Hand</span>
                    <div className={styles.handCards}>
                      {oppSquad.map(c => (
                        <PlayerCard key={c.id} card={c} displayScale={0.32} />
                      ))}
                    </div>
                  </div>

                  {/* Center tactical canvas */}
                  <div className={styles.centerStage}>
                    <MapCanvas liveScore={liveScore} activeRound={currentRoundIdx} />
                  </div>

                  {/* Player Hand (Bottom) */}
                  <div className={styles.handStrip}>
                    <span className={styles.handLabel}>Your Roster Hand</span>
                    <div className={styles.handCards}>
                      {playerSquad.map(c => (
                        <PlayerCard
                          key={c.id}
                          card={c}
                          displayScale={0.32}
                          selected={c.id === iglId}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Tactical-ops view */}
              {viewMode === 'tacticalops' && (
                <div className={styles.tacticalOpsContainer}>
                  <div className={styles.tacticalGrid}>
                    {/* Panel 1: Formula Math & Duel Resolver */}
                    <div className={styles.tacPanel}>
                      <h3 className={styles.tacTitle}>⚡ Duel Resolution Matrix</h3>
                      <div className={styles.formulaBox}>
                        <code>duel_score = (AIM × 0.4) + (POS × 0.3) + (ABIL × 0.15) + (MNT × 0.15) + RNG(±10%)</code>
                      </div>

                      <div className={styles.statCompareList}>
                        {playerSquad.map((p, i) => {
                          const o = oppSquad[i];
                          return (
                            <div key={p.id} className={styles.statPairRow}>
                              <span className={styles.pName}>{p.player} ({p.role})</span>
                              <div className={styles.barWrap}>
                                <div
                                  className={styles.barFillPlayer}
                                  style={{ width: `${(p.stats.aim / 100) * 50}%` }}
                                />
                                <div
                                  className={styles.barFillOpp}
                                  style={{ width: `${(o.stats.aim / 100) * 50}%` }}
                                />
                              </div>
                              <span className={styles.oName}>{o.player} ({o.role})</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Panel 2: Zone Control Percentage */}
                    <div className={styles.tacPanel}>
                      <h3 className={styles.tacTitle}>🎯 Map Zone Control</h3>
                      <div className={styles.zoneBars}>
                        <div className={styles.zoneRow}>
                          <span>A SITE</span>
                          <div className={styles.zoneMeter}>
                            <div style={{ width: '65%', background: 'var(--accent)' }}>65% YOU</div>
                            <div style={{ width: '35%', background: 'var(--opponent)' }}>35% OPP</div>
                          </div>
                        </div>
                        <div className={styles.zoneRow}>
                          <span>MID / B SITE</span>
                          <div className={styles.zoneMeter}>
                            <div style={{ width: '48%', background: 'var(--accent)' }}>48% YOU</div>
                            <div style={{ width: '52%', background: 'var(--opponent)' }}>52% OPP</div>
                          </div>
                        </div>
                        <div className={styles.zoneRow}>
                          <span>C SITE</span>
                          <div className={styles.zoneMeter}>
                            <div style={{ width: '70%', background: 'var(--accent)' }}>70% YOU</div>
                            <div style={{ width: '30%', background: 'var(--opponent)' }}>30% OPP</div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Panel 3: Round Log & Economy calls */}
                    <div className={`${styles.tacPanel} ${styles.logPanel}`}>
                      <h3 className={styles.tacTitle}>📜 Tactical Log Feed</h3>
                      <div className={styles.logList}>
                        {roundLogs.map(log => (
                          <div key={log.round} className={styles.logItem}>
                            <span className={styles.logRound}>R{log.round}</span>
                            <span className={styles.logZone}>{log.zone}</span>
                            <span className={styles.logEcon}>{log.econCall}</span>
                            <span className={log.winner === 'YOU' ? styles.logWin : styles.logLoss}>
                              {log.winner} WON ({log.pName} vs {log.oName})
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* End of Match Controls */}
              {matchFinished && (
                <div className={styles.matchOverBar}>
                  <h2>MATCH COMPLETE: {liveScore.a > liveScore.b ? 'VICTORY 🎉' : 'DEFEAT 💔'}</h2>
                  <button
                    className={styles.finishBtn}
                    onClick={() => navigate('/run')}
                  >
                    Return to Tournament Bracket →
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
    </AppFrame>
  );
}
