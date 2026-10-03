import { logoFor } from '../lib/orgs';
import { timeOf } from '../lib/time';

function TeamRow({ team, score, win, dim }) {
  const logo = logoFor(team.tag);
  return (
    <div className="team" data-win={win} data-dim={dim}>
      {logo ? <img className="logo" src={logo} alt="" loading="lazy" /> : <span className="logo mono">{(team.tag || team.name || '?').slice(0, 3)}</span>}
      <strong className="tag">{team.tag || team.name}</strong>
      <span className="name">{team.name}</span>
      {score != null && <span className="score">{score}</span>}
    </div>
  );
}

// One real series. Finished series are spoiler-guarded: you see who played, not what
// happened, until you choose to reveal it (the same ritual as the official schedule).
export default function MatchCard({ match, eventLabel, revealed, onReveal }) {
  const [a, b] = match.teams;
  const done = match.status === 'final';
  const live = match.status === 'live';
  const guarded = done && !revealed;
  // Nothing that hints at the result (colour included) shows until it is revealed.
  const winnerIdx = done && !guarded ? (match.winner ?? 0) - 1 : -1;

  return (
    <article className="match" data-status={match.status}>
      <div className="match-top">
        {live && <span className="live">LIVE</span>}
        {!live && match.startsAt && <span className="when">{timeOf(match.startsAt)}</span>}
        {done && <span className="when">FINAL</span>}
      </div>

      <div className="teams">
        <TeamRow team={a} score={done && !guarded ? a.score : null} win={winnerIdx === 0} dim={winnerIdx === 1} />
        <TeamRow team={b} score={done && !guarded ? b.score : null} win={winnerIdx === 1} dim={winnerIdx === 0} />
      </div>

      {guarded && (
        <button className="reveal" onClick={onReveal}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M3 3l18 18" /><path d="M10.6 6.2A9.8 9.8 0 0 1 12 6c5 0 8.5 4 9.5 6a12.6 12.6 0 0 1-2.6 3.3M6.5 7.7A12.7 12.7 0 0 0 2.5 12c1 2 4.5 6 9.5 6a9.6 9.6 0 0 0 3.2-.6" />
          </svg>
          Click to reveal
        </button>
      )}

      <footer className="match-foot">
        <span>{eventLabel}</span>
        {match.stage && <span>{match.stage}</span>}
        {match.bestOf && <span>Bo{match.bestOf}</span>}
      </footer>
    </article>
  );
}
