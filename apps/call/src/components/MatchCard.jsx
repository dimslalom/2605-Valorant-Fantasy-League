import { useState } from 'react';
import { fetchMatch } from '../lib/feed';
import { useGame } from '../lib/gameContext';
import { colorsFor, logoFor } from '../lib/orgs';
import CallPanel from './CallPanel';
import { CallSummary, MatchHead, MatchHero, MatchStrip } from './MatchFacts';
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

  return (
    <article className="match" data-status={live ? 'live' : match.status}>
      <MatchStrip match={match} eventLabel={eventLabel} now={now} live={live} />

      <div className="teams">
        <TeamRow team={a} score={report ? a.score : null} win={winnerIdx === 0} dim={winnerIdx === 1} />
        <TeamRow team={b} score={report ? b.score : null} win={winnerIdx === 1} dim={winnerIdx === 0} />
      </div>

      {!started && state && (
        <div className="callwrap">
          <button className="callbtn" data-called={Boolean(myCall?.winner)} onClick={() => setOpen(true)}>
            {myCall?.winner ? <CallSummary call={myCall} players={players} /> : <span className="callsum-none">No call yet</span>}
            <span className="callbtn-go">{myCall?.winner ? 'Edit' : 'Make call'} <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6" /></svg></span>
          </button>
          <Sheet open={open} onClose={() => setOpen(false)} title={`${a.tag} vs ${b.tag}`} head={<MatchHead match={match} now={now} live={live} />} size="full" pickedSide={pickedSide} style={{
            '--team-left-1': leftColors[0], '--team-left-2': leftColors[1] ?? leftColors[0], '--team-left-3': leftColors[2] ?? leftColors[0],
            '--team-right-1': rightColors[0], '--team-right-2': rightColors[1] ?? rightColors[0], '--team-right-3': rightColors[2] ?? rightColors[0],
          }}>
            <MatchHero match={match} eventLabel={eventLabel} />
            <CallPanel match={match} call={myCall} players={players} tracked={state.tracked} onChange={c => setCall(match.matchId, c)} />
            <div className="call-commit">
              {myCall?.winner && <span className="call-saved">Saved</span>}
              <button className="primary big" onClick={() => setOpen(false)}>Done</button>
            </div>
          </Sheet>
        </div>
      )}

      {started && !done && (
        <div className="locked"><small>Locked</small>{myCall?.winner ? <CallSummary call={myCall} players={players} /> : <span className="callsum-none">No call made</span>}</div>
      )}

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
              {report.call ? (
                <ul className="verdict">
                  <li data-ok={report.result.winnerRight}><small>Winner</small><b>{report.call.winner}</b><em>{report.result.winnerRight ? 'Right' : 'Miss'}</em></li>
                  {report.call.score && <li data-ok={report.result.scoreRight}><small>Score</small><b>{report.call.score[0]}-{report.call.score[1]}</b><em>{report.result.scoreRight ? 'Right' : 'Miss'}</em></li>}
                  {report.call.star && <li data-ok={report.result.starRight}><small>Star</small><b>{players[report.call.star]?.handle ?? report.call.star}</b><em>{report.result.starRight ? 'Right' : 'Miss'}</em></li>}
                </ul>
              ) : <p className="muted">No call on this one.</p>}
              <dl className="ledger">
                {report.call && <div><dt>Your call</dt><dd>{sign(report.callPoints)}</dd></div>}
                {report.trackedLines.map(l => <div key={l.pid}><dt>{players[l.pid]?.handle ?? l.pid}<small>Tracked</small></dt><dd>{sign(l.total)}</dd></div>)}
                {!report.trackedLines.length && <div className="ledger-empty"><dt>None of your Tracked players played</dt><dd /></div>}
                <div className="ledger-total"><dt>Total</dt><dd>{sign(report.total)}</dd></div>
              </dl>
            </>
          )}
        </div>
      )}

    </article>
  );
}
