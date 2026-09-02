// The five card stats, shared between PlayerCard (which draws them) and any
// other surface that reads the same values (CardFocusOverlay's stat bars) -
// kept out of PlayerCard.jsx itself so that file can stay component-only for
// fast refresh.
export const STAT_KEYS = ['aim', 'positioning', 'ability', 'mentality', 'synergy'];
export const STAT_LABELS = { aim: 'AIM', positioning: 'POS', ability: 'ABL', mentality: 'MNT', synergy: 'SYN' };
export const STAT_LABELS_FULL = {
  aim: 'Aim', positioning: 'Positioning', ability: 'Ability', mentality: 'Mentality', synergy: 'Synergy',
};
