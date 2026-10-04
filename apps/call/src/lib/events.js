// The events the feed tracks, each with its logo (self-hosted under public/assets/events,
// since the site only loads images from its own origin). Kickoff and Stage events run one per
// league at the same time: list each league's event here and the Matches header turns into a
// league selector while more than one has matches. League logos are shared across a season.
export const LOGOS = {
  champions: '/assets/events/champions.png',
  championsShanghai: '/assets/events/champions-shanghai.png',
  masters: '/assets/events/masters.png',
  americas: '/assets/events/americas.png',
  emea: '/assets/events/emea.png',
  pacific: '/assets/events/pacific.png',
  china: '/assets/events/china.png',
};

// Same ids as scripts/feed/events.json (the feed only has matches for events listed there).
// `color` is the logo's own colour, used for the soft glow behind it in the Matches header.
export const EVENTS = [
  { id: 2766, name: 'Champions Shanghai', logo: LOGOS.championsShanghai, color: '#c9ad6b' },
  { id: 2765, name: 'Masters London', logo: LOGOS.masters, color: '#9468f2' },
  { id: 2760, name: 'Masters Santiago', logo: LOGOS.masters, color: '#9468f2' },
  { id: 2682, name: 'Americas Kickoff', logo: LOGOS.americas, color: '#f25a1a' },
  { id: 2684, name: 'EMEA Kickoff', logo: LOGOS.emea, color: '#e8e4dc' },
  { id: 2683, name: 'Pacific Kickoff', logo: LOGOS.pacific, color: '#18d0d0' },
  { id: 2685, name: 'China Kickoff', logo: LOGOS.china, color: '#e2385a' },
];

// The events "on" right now: any with a match in the last 10 days or the next 14. Between
// seasons nothing qualifies, so fall back to whichever event played most recently.
const DAY = 86400;
export function currentEvents(events, matches, now) {
  const near = events.filter(ev => matches.some(m => m.eventId === ev.id && m.startsAt > now - 10 * DAY && m.startsAt < now + 14 * DAY));
  if (near.length) return near;
  const last = matches.filter(m => m.startsAt).sort((a, b) => b.startsAt - a.startsAt)[0];
  return last ? events.filter(ev => ev.id === last.eventId) : [];
}
