import { useState } from 'react';
import { fetchMatch } from '../lib/feed';
import { useGame } from '../lib/gameContext';
import { colorsFor, logoFor } from '../lib/orgs';
import { timeOf } from '../lib/time';
import CallPanel from './CallPanel';
import Sheet from './Sheet';

function TeamRow({ team, score, win, dim }) {
  const logo = logoFor(team.tag);
  return (
    <div className="team" data-org={team.tag} data-win={win} data-dim={dim}>
      {logo ? <img className="logo" src={logo} alt="" loading="lazy" /> : <span className="logo mono">{(team.tag || team.name || '?').slice(0, 3)}</span>}
      <strong className="tag">{team.tag || team.name}</strong>
      <span className="name">{team.name !== team.tag && team.name}</span>
      {score != null && <span className="score">{score}</span>}
    </div>
  );
}

const sign = n => (n > 0 ? `+${n}` : String(n));

// One real series. Upcoming: call it. Started: your call is locked. Finished: spoiler-guarded
// until you reveal it, then it shows the result and exactly how your call and Tracked cards scored.
export default function MatchCard({ match, eventLabel, now }) {
  const { state, players, call: setCall, reveal } = useGame();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const [a, b] = match.teams;
  const started = match.status !== 'upcoming' || (match.startsAt && match.startsAt <= now);
  const live = match.status === 'live' || (match.status === 'upcoming' && started);
  const done = match.status === 'final';
  const report = state?.revealed[match.matchId];
  const guarded = done && !report;
  const myCall = state?.calls[match.matchId];
  const pickedSide = myCall?.winner === a.tag ? 'left' : myCall?.winner === b.tag ? 'right' : undefined;
  const leftColors = colorsFor(a.tag);
  const rightColors = colorsFor(b.tag);
  const winnerIdx = done && !guarded ? (match.winner ?? 0) - 1 : -1;

  const doReveal = async () => {
    setBusy(true);
    setFailed(false);
    const detail = await fetchMatch(match.matchId);
    if (detail && reveal(detail)) { setBusy(false); return; }
    setBusy(false);
    setFailed(true);
  };

  const callLine = () => {
    if (!myCall?.winner) return null;
    const bits = [`Your call: ${myCall.winner}`];
    if (myCall.score) bits.push(`${myCall.score[0]}-${myCall.score[1]}`);
    if (myCall.star && players[myCall.star]) bits.push(`star ${players[myCall.star].handle}`);
    return bits.join(', ');
  };

  return (
    <article className="match" data-status={live ? 'live' : match.status}>
      <div className="match-top">
        <span className="match-context">{match.stage ?? eventLabel}{match.bestOf && <> <span aria-hidden="true">/</span> Bo{match.bestOf}</>}</span>
        <span className="match-timing">{match.startsAt && <time className="when">{timeOf(match.startsAt)}</time>}{live && <span className="live">{match.status === 'live' ? 'Live' : 'Starting'}</span>}</span>
      </div>

      <div className="teams">
        <TeamRow team={a} score={report ? a.score : null} win={winnerIdx === 0} dim={winnerIdx === 1} />
        <TeamRow team={b} score={report ? b.score : null} win={winnerIdx === 1} dim={winnerIdx === 0} />
      </div>

      {!started && state && (
        <div className="callwrap">
          <button className="callbtn" data-called={Boolean(myCall?.winner)} onClick={() => setOpen(true)}>
            <span><strong>{myCall?.winner ? callLine().replace('Your call: ', '') : 'No call'}</strong></span>
            <span className="callbtn-go">{myCall?.winner ? 'Edit' : 'Make call'} <span aria-hidden="true">→</span></span>
          </button>
          <Sheet open={open} onClose={() => setOpen(false)} title={`${a.tag} vs ${b.tag}`} size="full" pickedSide={pickedSide} style={{
            '--team-left-1': leftColors[0], '--team-left-2': leftColors[1] ?? leftColors[0], '--team-left-3': leftColors[2] ?? leftColors[0],
            '--team-right-1': rightColors[0], '--team-right-2': rightColors[1] ?? rightColors[0], '--team-right-3': rightColors[2] ?? rightColors[0],
          }}>
            <p className="sheet-meta"><span>{timeOf(match.startsAt)}</span>{match.bestOf && <span>Bo{match.bestOf}</span>}{match.stage && <span>{match.stage}</span>}</p>
            <CallPanel match={match} call={myCall} players={players} tracked={state.tracked} onChange={c => setCall(match.matchId, c)} />
            <div className="call-commit">
              {myCall?.winner && <span className="call-saved">Saved</span>}
              <button className="primary big" onClick={() => setOpen(false)}>Done</button>
            </div>
          </Sheet>
        </div>
      )}

      {started && !done && <p className="locked">{callLine() ?? 'Calls closed. You made no call on this one.'}</p>}

      {guarded && (
        <button className="reveal" onClick={doReveal} disabled={busy} aria-busy={busy}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M3 3l18 18" /><path d="M10.6 6.2A9.8 9.8 0 0 1 12 6c5 0 8.5 4 9.5 6a12.6 12.6 0 0 1-2.6 3.3M6.5 7.7A12.7 12.7 0 0 0 2.5 12c1 2 4.5 6 9.5 6a9.6 9.6 0 0 0 3.2-.6" />
          </svg>
          {busy ? 'Revealing' : 'Reveal result'}
        </button>
      )}
      {failed && <p className="error">Could not load the result. Try again.</p>}

      {report && (
        <div className="result">
          {report.preJoin && <p className="muted">Played before you joined, so it does not score.</p>}
          {!report.preJoin && (
            <>
              <p className="result-line" data-ok={report.result?.winnerRight}>
                {report.result
                  ? (report.result.winnerRight ? `You called it: ${report.call.winner}. +${report.callPoints}` : `You called ${report.call.winner}. Not this time, +${report.callPoints}`)
                  : 'You made no call on this one.'}
              </p>
              {report.result?.scoreRight && <p className="result-sub">Exact score, nice.</p>}
              {report.result?.starRight && <p className="result-sub">You picked the star.</p>}
              {report.trackedLines.length > 0 ? (
                <ul className="tracked-lines">
                  {report.trackedLines.map(l => <li key={l.pid}><span>{players[l.pid]?.handle ?? l.pid}</span><strong>{sign(l.total)}</strong></li>)}
                </ul>
              ) : <p className="muted">None of your Tracked players were in this one.</p>}
              <p className="result-total">{sign(report.total)} points</p>
            </>
          )}
        </div>
      )}

    </article>
  );
}
