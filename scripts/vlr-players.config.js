// VCT 2026 events: source of player IDs + team membership.
// Event detail endpoint gives us: team ID, team name/logo, player IDs, player names.
export const EVENTS = [
  { id: 2860, region: 'Americas', apiRegion: 'na' },
  { id: 2863, region: 'EMEA',     apiRegion: 'eu' },
  { id: 2775, region: 'Pacific',  apiRegion: 'ap' },
  { id: 2685, region: 'China',    apiRegion: 'cn' },
];

// ── Tier 2 (Challengers) ─────────────────────────────────────────────────────
// Discovered at sync time via /v2/events?q=<query>. Titles must look like a
// 2026 Challengers league (not a qualifier). Add manual entries to
// TIER2_EVENTS for anything the search misses; they are merged in.
export const TIER2_QUERY = 'challengers';
export const TIER2_TITLE_MUST = [/challengers/i, /2026/];
export const TIER2_TITLE_SKIP = [/qualif/i, /open /i, /academy/i, /game changers/i];

// Manual supplements: { id, region: 'Americas'|'EMEA'|'Pacific'|'China', apiRegion }
export const TIER2_EVENTS = [];

// Map a Challengers league's region text (or title) to a parent VCT region for
// stat baselines and the card's region badge. First match wins, so the most
// specific tokens come first (e.g. 'southeast asia' before anything EMEA;
// beware substrings: a bare 'east' would swallow 'southEAST asia').
export const TIER2_REGION_KEYWORDS = [
  { region: 'China',    apiRegion: 'cn', words: ['china'] },
  { region: 'Pacific',  apiRegion: 'ap', words: ['pacific', 'southeast asia', 'south asia', 'indonesia', 'malaysia', 'singapore', 'philippines', 'thailand', 'vietnam', 'japan', 'korea', 'india', 'oceania', 'taiwan', 'hong kong'] },
  { region: 'Americas', apiRegion: 'na', words: ['north america', 'america', 'brazil', 'latam', 'latin'] },
  { region: 'EMEA',     apiRegion: 'eu', words: ['emea', 'europe', 'mena', 'turkey', 'türkiye', 'france', 'spain', 'dach', 'italy', 'portugal', 'poland', 'north//east', 'northeast'] },
];
export const TIER2_REGION_FALLBACK = { region: 'Pacific', apiRegion: 'ap' };

// How hard tier-2 stats are dampened (weaker competition inflates the
// normalized numbers). Subtracted from every stat, floored at 50.
export const TIER2_STAT_PENALTY = 9;

// Tier-1 players are the best ~180 in the world: lift them so the franchised
// league reads as elite. Added to every VCT stat, capped at 99.
export const VCT_STAT_BONUS = 3;

// ── Real IGLs ────────────────────────────────────────────────────────────────
// Lowercased aliases of players who actually call the game. Best-effort list,
// review and extend freely; rosters shift and tier-2 IGLs are mostly unknown.
// A flagged player named as your IGL in Perfect Run earns a bigger bonus.
export const IGL_NAMES = new Set([
  'boaster', 'saadhak', 'stax', 'kingg', 'valyn', 'boostio', 'munchkin',
  'd4v41', 'haodong', 'nobody', 'boo', 'kr1stal', 'crazyguy', 'melser',
  'ethan', 'johnqt',
]);

// VCT 2026 team IDs: kept for reference only. The sync script discovers teams
// from the event endpoints, and vlr.gg does not expose player roles on team
// pages (roles are derived from each player's most-used agent instead).
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
// Supported fields: tier, palette, power, edition, photo.
// Tier is otherwise derived from the card rating (80+ gold, 70+ silver, below 70 bronze).
// Example:
// '123': { tier: 'gold', palette: 'gold', power: { name: '...', description: '...', effect: '...', value: 2, duration: 3 } }
export const PLAYER_OVERRIDES = {
  // Hand-made stylized card art: pinned so re-syncs never replace it
  '8480': { photo: '/assets/players/gold-img-aspas.png' },     // aspas
  '9801': { photo: '/assets/players/gold-img-f0rsakeN.png' },  // f0rsakeN
  '4':    { photo: '/assets/players/silver-img-crashies.png' } // crashies
};
