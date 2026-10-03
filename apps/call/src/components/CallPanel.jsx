import { useMemo } from 'react';
import { CALL } from '../../../../src/engine/collect/rules';

// Make a call on one upcoming series: the winner (required), then the exact score and the
// star player (both optional bonuses). Saved as you tap. Nothing is staked and nothing
// can be lost: a wrong call just scores nothing.
const SCORES = { 1: [], 3: [[2, 0], [2, 1]], 5: [[3, 0], [3, 1], [3, 2]] };

export default function CallPanel({ match, call, onChange, players, tracked }) {
  const [a, b] = match.teams;
  const options = SCORES[match.bestOf] ?? SCORES[3];

  const roster = useMemo(
    () => Object.values(players).filter(p => p.card && (p.team === a.tag || p.team === b.tag)).sort((x, y) => x.team.localeCompare(y.team) || x.handle.localeCompare(y.handle)),
    [players, a.tag, b.tag],
  );

  const trackedOn = tag => tracked.filter(pid => players[pid]?.team === tag).length;
  const winnerIdx = call?.winner === a.tag ? 0 : call?.winner === b.tag ? 1 : -1;
  const scoreFor = pair => (winnerIdx === 0 ? pair : [pair[1], pair[0]]);
  const sameScore = (x, y) => Array.isArray(x) && x[0] === y[0] && x[1] === y[1];

  const setWinner = tag => onChange({ winner: tag, score: null, star: call?.star ?? null });
  const backing = call?.winner ? Math.min(CALL.backingCap, trackedOn(call.winner) * CALL.backing) : 0;

  return (
    <div className="call">
      <p className="call-title">Who wins?</p>
      <div className="pick-row">
        {[a, b].map((t, i) => (
          <button key={t.tag} className="pick" data-on={winnerIdx === i} onClick={() => setWinner(t.tag)}>
            <strong>{t.tag}</strong>
            {trackedOn(t.tag) > 0 && <small>You track {trackedOn(t.tag)}</small>}
          </button>
        ))}
      </div>

      {winnerIdx >= 0 && options.length > 0 && (
        <>
          <p className="call-title">Exact score <small>+{CALL.exactScore}</small></p>
          <div className="pick-row">
            {options.map(pair => {
              const score = scoreFor(pair);
              return (
                <button key={pair.join('-')} className="pick small" data-on={sameScore(call.score, score)} onClick={() => onChange({ ...call, score: sameScore(call.score, score) ? null : score })}>
                  {score[0]} - {score[1]}
                </button>
              );
            })}
          </div>
        </>
      )}

      {winnerIdx >= 0 && (
        <>
          <p className="call-title">Star of the series <small>+{CALL.star}</small></p>
          <select className="star" value={call.star ?? ''} onChange={e => onChange({ ...call, star: e.target.value ? Number(e.target.value) : null })}>
            <option value="">No pick</option>
            {roster.map(p => <option key={p.pid} value={p.pid}>{p.handle} ({p.team})</option>)}
          </select>
          {backing > 0 && <p className="hint">You Track {trackedOn(call.winner)} {call.winner} player{trackedOn(call.winner) > 1 ? 's' : ''}: +{backing} if you are right.</p>}
        </>
      )}
    </div>
  );
}
