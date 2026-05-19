export function roleAbbr(role) {
  const map = {
    'Duelist':    'DLT',
    'Initiator':  'INI',
    'Controller': 'CTL',
    'Sentinel':   'SEN',
  };
  return map[role] ?? role.slice(0, 3).toUpperCase();
}

export const TEXT_COLOR = {
  silver:    '#1a1f2e',
  gold:      '#3F3418',
  legendary: '#f0d0ff',
  iconic:    '#e8e0ff',
};

export function cardTextColor(palette) {
  if (palette.startsWith('prestige')) return '#fff5f0';
  if (palette.startsWith('iconic'))   return TEXT_COLOR.iconic;
  return TEXT_COLOR[palette] ?? '#ffffff';
}
