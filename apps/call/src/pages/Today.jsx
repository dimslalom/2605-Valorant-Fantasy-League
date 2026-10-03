import { useEffect, useMemo, useState } from 'react';
import { useGame } from '../lib/gameContext';
import MatchCard from '../components/MatchCard';
import { fetchSchedule } from '../lib/feed';
import { dayKey, longDay, todayKey } from '../lib/time';

// The events the feed tracks. Add Open Qualifiers and the 2027 events here as they appear.
const EVENTS = [{ id: 2766, label: 'Champions' }];

export default function Today() {
  const [matches, setMatches] = useState(null);
  const [day, setDay] = useState(null);
  const [league, setLeague] = useState('all');
  const { state, score, record } = useGame();
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    let live = true;
    Promise.all(EVENTS.map(async ev => ((await fetchSchedule(ev.id)) ?? []).map(m => ({ ...m, eventLabel: ev.label, eventId: ev.id }))))
      .then(parts => { if (live) setMatches(parts.flat()); });
    return () => { live = false; };
  }, []);

  // Keeps LIVE/locked states honest without a refresh.
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30000);
    return () => clearInterval(t);
  }, []);

  const visible = useMemo(
    () => (matches ?? []).filter(m => m.startsAt && (league === 'all' || String(m.eventId) === league)),
    [matches, league],
  );
  const days = useMemo(() => [...new Set(visible.map(m => dayKey(m.startsAt)))].sort(), [visible]);

  // Open on today, or the nearest day that actually has matches.
  const today = todayKey();
  const current = day ?? (days.includes(today) ? today : (days.filter(d => d <= today).pop() ?? days[0] ?? today));
  const dayMatches = visible.filter(m => dayKey(m.startsAt) === current).sort((x, y) => x.startsAt - y.startsAt);

  const live = dayMatches.filter(m => m.status === 'live');
  const later = dayMatches.filter(m => m.status === 'upcoming');
  const earlier = dayMatches.filter(m => m.status === 'final').reverse();
  const isToday = current === today;
  const prev = days.filter(d => d < current).pop();
  const next = days.find(d => d > current);

  const card = m => <MatchCard key={m.matchId} match={m} eventLabel={m.eventLabel} now={now} />;

  return (
    <section>
      <h1>{isToday ? 'Today' : longDay(current)}</h1>

      {state && (
        <div className="stats">
          <div><span>Score</span><strong>{score}</strong></div>
          <div><span>Credits</span><strong>{state.credits}</strong></div>
          <div><span>Streak</span><strong>{state.streak}</strong></div>
          <div><span>Calls right</span><strong>{record.right}/{record.made}</strong></div>
        </div>
      )}

      <div className="controls">
        <div className="day-switch">
          <button aria-label="Previous day with matches" disabled={!prev} onClick={() => setDay(prev)}>&larr;</button>
          <span>{isToday ? 'Today' : longDay(current)}</span>
          <button aria-label="Next day with matches" disabled={!next} onClick={() => setDay(next)}>&rarr;</button>
        </div>
        <label className="filter">
          <span className="sr">League</span>
          <select value={league} onChange={e => setLeague(e.target.value)}>
            <option value="all">All leagues</option>
            {EVENTS.map(ev => <option key={ev.id} value={String(ev.id)}>{ev.label}</option>)}
          </select>
        </label>
      </div>

      {matches == null && <p className="note">Loading the schedule</p>}
      {matches != null && dayMatches.length === 0 && (
        <p className="note">
          No matches on this day.{' '}
          {prev && <button className="link" onClick={() => setDay(prev)}>Previous matches</button>}
          {prev && next && ' or '}
          {next && <button className="link" onClick={() => setDay(next)}>next matches</button>}
        </p>
      )}

      {live.length > 0 && <><h2 className="section">Live</h2>{live.map(card)}</>}
      {later.length > 0 && <><h2 className="section">{isToday ? 'Later today' : 'Upcoming'}</h2>{later.map(card)}</>}
      {earlier.length > 0 && <><h2 className="section">{isToday ? 'Earlier today' : 'Results'}</h2>{earlier.map(card)}</>}
    </section>
  );
}
