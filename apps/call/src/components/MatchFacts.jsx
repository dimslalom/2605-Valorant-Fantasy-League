import { EVENTS } from '../lib/events';
import { logoFor } from '../lib/orgs';
import { timeOf, untilOf } from '../lib/time';

// Each fact about a match gets its own slot and its own type, never one run-on string:
// the start time is the headline, stage reads as a place in the event, and the format is
// shown once, as "Bo3".

function Start({ match, now, live }) {
  if (!match.startsAt) return null;
  return (
    <>
      <time className="fact-time" dateTime={new Date(match.startsAt * 1000).toISOString()}>{timeOf(match.startsAt)}</time>
      {/* A live match is already marked by its LIVE section and ruby glass, so it needs no tag;
          one past its start time that the feed has not marked live yet says so in plain text. */}
      {match.status === 'live' ? null : <small>{live ? 'Starting' : match.status === 'final' ? 'Final' : untilOf(match.startsAt, now)}</small>}
    </>
  );
}

// Match screen, top bar: the screen's name centred, with the logistics that stay in view while
// you scroll on either side (start time left, format right).
export function MatchHead({ match, now, live }) {
  return (
    <div className="mhead">
      <span className="fact-start"><Start match={match} now={now} live={live} /></span>
      <span className="mhead-title" aria-hidden="true">Call sheet</span>
      {match.bestOf && <span className="fact-format">Bo{match.bestOf}</span>}
    </div>
  );
}

// Match screen, hero: where this match sits, centred and big. The event logo glows in its own
// colour (the same wash as the Matches header); without a logo the event name stands in.
export function MatchHero({ match, eventLabel }) {
  const event = EVENTS.find(ev => ev.id === match.eventId);
  return (
    <div className="mhero" style={event ? { '--event': event.color } : undefined}>
      {event ? <img src={event.logo} alt={event.name} /> : <strong>{eventLabel}</strong>}
      {match.stage && <p>{match.stage}</p>}
    </div>
  );
}

// Compact: the strip along the top of a match card.
export function MatchStrip({ match, eventLabel, now, live }) {
  return (
    <div className="strip">
      <span className="fact-start"><Start match={match} now={now} live={live} /></span>
      <span className="strip-stage">{match.stage ?? eventLabel}</span>
      {match.bestOf && <span className="fact-format">Bo{match.bestOf}</span>}
    </div>
  );
}

// Your call as parts on one line: the winner (logo and tag), the score read winner-first (it is
// stored in team order), and the star with a label.
export function CallSummary({ call, players }) {
  const logo = logoFor(call.winner);
  const star = call.star && players[call.star];
  return (
    <span className="callsum">
      <span className="callsum-team">{logo && <img src={logo} alt="" />}<b>{call.winner}</b></span>
      {call.score && <span className="callsum-score">{Math.max(...call.score)}<i />{Math.min(...call.score)}</span>}
      {star && <span className="callsum-star"><small>Star</small>{star.handle}</span>}
    </span>
  );
}
