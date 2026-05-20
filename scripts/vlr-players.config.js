// VCT 2026 events — source of player IDs + team membership
// Event detail endpoint gives us: team ID, team name/logo, player IDs, player names
export const EVENTS = [
  { id: 2860, region: 'Americas', apiRegion: 'na' },
  { id: 2863, region: 'EMEA',     apiRegion: 'eu' },
  { id: 2775, region: 'Pacific',  apiRegion: 'ap' },
  { id: 2685, region: 'China',    apiRegion: 'cn' },
];

// VCT 2026 team IDs — used to look up roles (team endpoint has alias+role, no player IDs)
export const TEAMS = [
  // AMERICAS
  { id: 120,   region: 'Americas', apiRegion: 'na' },
  { id: 188,   region: 'Americas', apiRegion: 'na' },
  { id: 5248,  region: 'Americas', apiRegion: 'na' },
  { id: 2406,  region: 'Americas', apiRegion: 'na' },
  { id: 11058, region: 'Americas', apiRegion: 'na' },
  { id: 2355,  region: 'Americas', apiRegion: 'na' },
  { id: 2359,  region: 'Americas', apiRegion: 'na' },
  { id: 6961,  region: 'Americas', apiRegion: 'na' },
  { id: 7386,  region: 'Americas', apiRegion: 'na' },
  { id: 2,     region: 'Americas', apiRegion: 'na' },
  // EMEA
  { id: 397,   region: 'EMEA', apiRegion: 'eu' },
  { id: 6392,  region: 'EMEA', apiRegion: 'eu' },
  { id: 2593,  region: 'EMEA', apiRegion: 'eu' },
  { id: 1184,  region: 'EMEA', apiRegion: 'eu' },
  { id: 12694, region: 'EMEA', apiRegion: 'eu' },
  { id: 14419, region: 'EMEA', apiRegion: 'eu' },
  { id: 8877,  region: 'EMEA', apiRegion: 'eu' },
  { id: 4915,  region: 'EMEA', apiRegion: 'eu' },
  { id: 1001,  region: 'EMEA', apiRegion: 'eu' },
  { id: 474,   region: 'EMEA', apiRegion: 'eu' },
  { id: 2059,  region: 'EMEA', apiRegion: 'eu' },
  // PACIFIC
  { id: 278,   region: 'Pacific', apiRegion: 'ap' },
  { id: 8185,  region: 'Pacific', apiRegion: 'ap' },
  { id: 4050,  region: 'Pacific', apiRegion: 'ap' },
  { id: 17,    region: 'Pacific', apiRegion: 'ap' },
  { id: 918,   region: 'Pacific', apiRegion: 'ap' },
  { id: 11060, region: 'Pacific', apiRegion: 'ap' },
  { id: 624,   region: 'Pacific', apiRegion: 'ap' },
  { id: 878,   region: 'Pacific', apiRegion: 'ap' },
  { id: 14,    region: 'Pacific', apiRegion: 'ap' },
  { id: 6199,  region: 'Pacific', apiRegion: 'ap' },
  { id: 11229, region: 'Pacific', apiRegion: 'ap' },
  // CHINA
  { id: 1119,  region: 'China', apiRegion: 'cn' },
  { id: 12010, region: 'China', apiRegion: 'cn' },
  { id: 11981, region: 'China', apiRegion: 'cn' },
  { id: 1120,  region: 'China', apiRegion: 'cn' },
  { id: 11328, region: 'China', apiRegion: 'cn' },
  { id: 13576, region: 'China', apiRegion: 'cn' },
  { id: 12064, region: 'China', apiRegion: 'cn' },
  { id: 14137, region: 'China', apiRegion: 'cn' },
  { id: 12685, region: 'China', apiRegion: 'cn' },
  { id: 731,   region: 'China', apiRegion: 'cn' },
  { id: 13790, region: 'China', apiRegion: 'cn' },
  { id: 13581, region: 'China', apiRegion: 'cn' },
];

// Manual overrides keyed by vlr.gg player ID (string).
// Populate after the first run to promote players to higher tiers, assign powers, etc.
// Example:
// '9': { tier: 'gold', palette: 'gold', power: { name: '...', description: '...', effect: '...', value: 2, duration: 3 } }
export const PLAYER_OVERRIDES = {};
