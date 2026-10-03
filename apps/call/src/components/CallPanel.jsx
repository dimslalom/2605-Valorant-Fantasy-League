import { useMemo } from 'react';
import { CALL } from '../../../../src/engine/collect/rules';
import { STAT_KEYS, STAT_LABELS_FULL } from '../../../../src/data/statFields';
import { assetPath, thumbnailSrc } from '../../../../src/lib/utils';
import { colorsFor, logoFor } from '../lib/orgs';

const SCORES = { 1: [], 3: [[2, 0], [2, 1]], 5: [[3, 0], [3, 1], [3, 2]] };
const average = (items, read) => items.length ? Math.round(items.reduce((sum, item) => sum + read(item), 0) / items.length) : null;

function PlayerRow({ player, tracked, selected, disabled, onPick }) {
  const image = thumbnailSrc(player.card);
  return (
    <button className="analyst-player" data-selected={selected} aria-pressed={selected} disabled={disabled} onClick={onPick}>
      <span className="analyst-portrait">
        {image ? <img src={assetPath(image)} alt="" loading="lazy" /> : <span>{player.handle.slice(0, 2)}</span>}
      </span>
      <span className="analyst-player-name"><strong>{player.handle}</strong><small>{player.card.role}</small></span>
      {tracked && <span className="analyst-tracked">Tracked</span>}
      <span className="analyst-rating" aria-label={`${player.card.rating} card rating`}>{player.card.rating}</span>
      <span className="analyst-select" aria-hidden="true" />
    </button>
  );
}

export default function CallPanel({ match, call, onChange, players, tracked }) {
  const [a, b] = match.teams;
  const options = SCORES[match.bestOf] ?? SCORES[3];
  const mine = useMemo(() => new Set(tracked), [tracked]);
  const profiles = useMemo(() => [a, b].map(team => {
    const roster = Object.values(players)
      .filter(player => player.card && player.team === team.tag)
      .sort((left, right) => right.card.rating - left.card.rating);
    return {
      team,
      roster,
      rating: average(roster, player => player.card.rating),
      tracked: roster.filter(player => mine.has(player.pid)).length,
      stats: Object.fromEntries(STAT_KEYS.map(key => [key, average(roster, player => player.card.stats[key])])),
    };
  }), [a, b, players, mine]);

  const winnerIdx = call?.winner === a.tag ? 0 : call?.winner === b.tag ? 1 : -1;
  const picked = winnerIdx >= 0;
  const scoreFor = pair => winnerIdx === 0 ? pair : [pair[1], pair[0]];
  const sameScore = (left, right) => Array.isArray(left) && left[0] === right[0] && left[1] === right[1];
  const setWinner = tag => {
    if (call?.winner !== tag) onChange({ winner: tag, score: null, star: call?.star ?? null });
  };
  return (
    <div className="analyst-call">
      <section className="analyst-section" aria-labelledby="winner-heading">
        <div className="analyst-heading"><h3 id="winner-heading">Winner</h3><span>+{CALL.winner}</span></div>
        <div className="analyst-teams">
          {profiles.map(({ team, rating, tracked: trackedCount }, i) => {
            const logo = logoFor(team.tag);
            const selected = winnerIdx === i;
            return (
              <button key={team.tag} className="analyst-team" data-org={team.tag} data-selected={selected} aria-pressed={selected} style={{ '--team-color': colorsFor(team.tag)[0] }} onClick={() => setWinner(team.tag)}>
                <span className="analyst-team-identity">
                  {logo ? <img src={logo} alt="" /> : <span className="analyst-logo-fallback">{team.tag.slice(0, 3)}</span>}
                  <span><strong>{team.name}</strong><small>{team.tag}</small></span>
                </span>
                <span className="analyst-team-data"><b>{rating ?? '—'}</b><small>Avg rating</small></span>
                <span className="analyst-team-data"><b>{trackedCount}</b><small>Tracked</small></span>
              </button>
            );
          })}
        </div>
        <div className="analyst-comparison" aria-label="Roster card averages by stat">
          <div className="analyst-comparison-head"><span>{a.tag}</span><span>Card averages</span><span>{b.tag}</span></div>
          {STAT_KEYS.map(key => {
            const left = profiles[0].stats[key];
            const right = profiles[1].stats[key];
            return (
              <div key={key} className="analyst-stat-row">
                <strong data-lead={left != null && right != null && left > right}>{left ?? '—'}</strong>
                <span>{STAT_LABELS_FULL[key]}</span>
                <strong data-lead={left != null && right != null && right > left}>{right ?? '—'}</strong>
              </div>
            );
          })}
        </div>
      </section>

      {picked && options.length > 0 && <section className="analyst-section" aria-labelledby="score-heading">
        <div className="analyst-heading"><h3 id="score-heading">Score</h3><span>+{CALL.exactScore}</span></div>
        <div className="analyst-score-options">
          {options.map(pair => {
            const score = scoreFor(pair);
            const selected = sameScore(call.score, score);
            return <button key={pair.join('-')} className="analyst-score" data-selected={selected} aria-pressed={selected} onClick={() => onChange({ ...call, score: selected ? null : score })}>{a.tag} {score[0]}–{score[1]} {b.tag}</button>;
          })}
        </div>
      </section>}

      <section className="analyst-section" aria-labelledby="star-heading">
        <div className="analyst-heading"><h3 id="star-heading">Star</h3><span>{picked ? `+${CALL.star} first · +${CALL.starTop3} top 3` : 'Winner first'}</span></div>
        <div className="analyst-rosters">
          {profiles.map(({ team, roster }) => (
            <div key={team.tag} className="analyst-roster">
              <h4>{team.name}</h4>
              {roster.length ? roster.map(player => (
                <PlayerRow
                  key={player.pid}
                  player={player}
                  tracked={mine.has(player.pid)}
                  selected={call?.star === player.pid}
                  disabled={!picked}
                  onPick={() => onChange({ ...call, star: call.star === player.pid ? null : player.pid })}
                />
              )) : <p className="analyst-prompt">No card roster available.</p>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
