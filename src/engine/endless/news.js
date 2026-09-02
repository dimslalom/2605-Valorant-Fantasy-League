// The run's news feed.
//
// Items are stored STRUCTURED - a kind plus ids - and formatted at render
// time. Storing sentences would bloat the save and would freeze the copy: a
// wording change would need a save migration to avoid a run showing a mix of
// old and new phrasing.
//
// This is the surface for the "legible after it happens" rule: development,
// bonds, transfers and ladder movement are all invisible while they happen,
// and every one of them lands here afterwards, named and attributable.

export const FEED_CAP = 40;

export const NEWS_KINDS = [
  'signing',    // a rival org signed a free agent
  'poach',      // a rival came for one of yours
  'departure',  // ...and you let them go
  'held',       // ...and you refused
  'signed',     // you signed a specific player
  'prospect',   // an academy prospect joined
  'promote',
  'relegate',
  'legend',
  'bond',
  'growth',
  'decline',
];

/** Append items, newest first, bounded so a long run cannot grow the save. */
export function pushNews(feed, items, { year, event }) {
  const stamped = items.map(item => ({ ...item, y: year, t: event }));
  return [...stamped, ...(feed ?? [])].slice(0, FEED_CAP);
}

/**
 * Turn a stored item into display text. Kept here rather than in the
 * component so the vocabulary has one home and stays consistent.
 */
export function describeNews(item) {
  switch (item.kind) {
    case 'signing':
      return { title: `${item.orgName} sign ${item.player}`, note: 'Off the market' };
    case 'poach':
      return { title: `${item.orgName} want ${item.player}`, note: 'Approach made' };
    case 'departure':
      return { title: `${item.player} leaves for ${item.orgName}`, note: 'Transfer complete' };
    case 'held':
      return { title: `${item.player} stays`, note: `${item.orgName} turned away` };
    case 'signed':
      return { title: `${item.player} signs for you`, note: 'Transfer complete' };
    case 'prospect':
      return { title: `${item.player} joins from the academy`, note: 'Youth signing' };
    case 'promote':
      return { title: `Promoted to ${item.tierLabel}`, note: 'Circuit' };
    case 'relegate':
      return { title: `Relegated to ${item.tierLabel}`, note: 'Circuit' };
    case 'legend':
      return { title: `${item.player} is a club legend`, note: 'No longer declines' };
    case 'bond':
      return { title: `${item.player} and ${item.player2} are clicking`, note: 'Chemistry' };
    case 'growth':
      return { title: `${item.player} is improving`, note: `+${item.n}` };
    case 'decline':
      return { title: `${item.player} is slipping`, note: `${item.n}` };
    default:
      return { title: item.title ?? 'Update', note: '' };
  }
}

/** A transfer is the only kind that should render a portrait in a new kit. */
export function newsKit(item) {
  return item.kind === 'signing' || item.kind === 'departure' ? item.orgId : null;
}
