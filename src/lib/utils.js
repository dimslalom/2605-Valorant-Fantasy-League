export function roleAbbr(role) {
  const map = {
    'Duelist':    'DLT',
    'Initiator':  'INI',
    'Controller': 'CTL',
    'Sentinel':   'SEN',
  };
  return map[role] ?? role.slice(0, 3).toUpperCase();
}

let regionNames;
export function countryName(iso2) {
  if (!iso2 || iso2 === 'UN') return 'Unknown';
  regionNames ??= new Intl.DisplayNames(['en'], { type: 'region' });
  return regionNames.of(iso2.toUpperCase()) ?? iso2;
}

// VCT competitive regions — distinct from the ISO country codes above
const REGION_NAMES = {
  EMEA: 'Europe, Middle East & Africa',
};
export function regionFullName(region) {
  return REGION_NAMES[region] ?? region;
}

export const TEXT_COLOR = {
  bronze:    '#543504',
  silver:    '#1a1f2e',
  gold:      '#3F3418',
  icon:      '#C7B94F',
  legendary: '#f0d0ff',
  iconic:    '#e8e0ff',
};

export function cardTextColor(palette) {
  if (palette.startsWith('prestige')) return '#fff5f0';
  if (palette.startsWith('iconic'))   return TEXT_COLOR.iconic;
  return TEXT_COLOR[palette] ?? '#ffffff';
}
export function assetPath(path) {
  if (!path || !path.startsWith('/assets/')) return path;
  return `${import.meta.env.BASE_URL.replace(/\/$/, '')}${path}`;
}
