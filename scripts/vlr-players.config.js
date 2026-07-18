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

// ── Icon tier: retired legends ───────────────────────────────────────────────
// Hand-authored cards. Stats are set here (90-99, sparing with 99s), never
// derived from the API; only the portrait and past teams come from vlr.gg.
// vlrId is optional: when omitted the sync resolves it via /v2/search using an
// exact alias match. region is the player's era region for the card badge.
export const ICONS = [
  // Duelists
  { name: 'TenZ',       vlrId: '9', nationality: 'CA', region: 'Americas', role: 'Duelist',    igl: false, agents: ['jett', 'chamber'],   stats: { aim: 99, positioning: 93, ability: 92, mentality: 91, synergy: 92 } },
  { name: 'ScreaM',     nationality: 'BE', region: 'EMEA',     role: 'Duelist',    igl: false, agents: ['reyna', 'jett'],     stats: { aim: 98, positioning: 92, ability: 90, mentality: 93, synergy: 91 } },
  { name: 'yay',        nationality: 'US', region: 'Americas', role: 'Duelist',    igl: false, agents: ['chamber', 'jett'],   stats: { aim: 98, positioning: 94, ability: 91, mentality: 90, synergy: 90 } },
  { name: 'cNed',       nationality: 'TR', region: 'EMEA',     role: 'Duelist',    igl: false, agents: ['jett', 'chamber'],   stats: { aim: 97, positioning: 92, ability: 91, mentality: 91, synergy: 90 } },
  { name: 'Wardell',    nationality: 'CA', region: 'Americas', role: 'Duelist',    igl: false, agents: ['jett', 'chamber'],   stats: { aim: 96, positioning: 91, ability: 90, mentality: 90, synergy: 91 } },
  { name: 'Mixwell',    nationality: 'ES', region: 'EMEA',     role: 'Duelist',    igl: false, agents: ['jett', 'omen'],      stats: { aim: 94, positioning: 92, ability: 91, mentality: 93, synergy: 94 } },
  { name: 'Victor',     nationality: 'US', region: 'Americas', role: 'Duelist',    igl: false, agents: ['raze', 'phoenix'],   stats: { aim: 93, positioning: 92, ability: 94, mentality: 92, synergy: 94 } },
  { name: 'Sayaplayer', nationality: 'KR', region: 'Pacific',  role: 'Duelist',    igl: false, agents: ['jett', 'raze'],      stats: { aim: 96, positioning: 90, ability: 90, mentality: 90, synergy: 91 } },
  { name: 'nukkye',     nationality: 'LT', region: 'EMEA',     role: 'Duelist',    igl: false, agents: ['raze', 'jett'],      stats: { aim: 93, positioning: 92, ability: 91, mentality: 91, synergy: 92 } },
  // Initiators
  { name: 'Hiko',       nationality: 'US', region: 'Americas', role: 'Initiator',  igl: false, agents: ['sova', 'breach'],    stats: { aim: 92, positioning: 97, ability: 93, mentality: 96, synergy: 94 } },
  { name: 'Sacy',       nationality: 'BR', region: 'Americas', role: 'Initiator',  igl: false, agents: ['sova', 'fade'],      stats: { aim: 91, positioning: 94, ability: 96, mentality: 94, synergy: 97 } },
  { name: 'shahzaM',    nationality: 'US', region: 'Americas', role: 'Initiator',  igl: true,  agents: ['sova', 'skye'],      stats: { aim: 91, positioning: 93, ability: 94, mentality: 96, synergy: 97 } },
  { name: 'Subroza',    nationality: 'CA', region: 'Americas', role: 'Initiator',  igl: false, agents: ['skye', 'reyna'],     stats: { aim: 92, positioning: 91, ability: 93, mentality: 91, synergy: 93 } },
  { name: 'Zest',       nationality: 'KR', region: 'Pacific',  role: 'Initiator',  igl: false, agents: ['fade', 'chamber'],   stats: { aim: 92, positioning: 93, ability: 95, mentality: 94, synergy: 93 } },
  { name: 'Lakia',      nationality: 'KR', region: 'Pacific',  role: 'Initiator',  igl: false, agents: ['fade', 'kayo'],      stats: { aim: 91, positioning: 94, ability: 95, mentality: 92, synergy: 93 } },
  { name: 'soulcas',    nationality: 'GB', region: 'EMEA',     role: 'Initiator',  igl: false, agents: ['skye', 'raze'],      stats: { aim: 90, positioning: 93, ability: 94, mentality: 92, synergy: 95 } },
  { name: 'FNS',        nationality: 'CA', region: 'Americas', role: 'Initiator',  igl: true,  agents: ['fade', 'sova'],      stats: { aim: 90, positioning: 96, ability: 94, mentality: 99, synergy: 98 } },
  // Controllers
  { name: 'nitr0',      nationality: 'US', region: 'Americas', role: 'Controller', igl: false, agents: ['omen', 'astra'],     stats: { aim: 91, positioning: 95, ability: 94, mentality: 96, synergy: 95 } },
  { name: 'Marved',     nationality: 'CA', region: 'Americas', role: 'Controller', igl: false, agents: ['omen', 'astra'],     stats: { aim: 93, positioning: 94, ability: 97, mentality: 93, synergy: 94 } },
  { name: 'pANcada',    nationality: 'BR', region: 'Americas', role: 'Controller', igl: false, agents: ['astra', 'omen'],     stats: { aim: 92, positioning: 95, ability: 96, mentality: 94, synergy: 95 } },
  { name: 'ANGE1',      nationality: 'UA', region: 'EMEA',     role: 'Controller', igl: true,  agents: ['astra', 'kayo'],     stats: { aim: 90, positioning: 94, ability: 95, mentality: 98, synergy: 96 } },
  { name: 'Vanity',     nationality: 'US', region: 'Americas', role: 'Controller', igl: true,  agents: ['omen', 'astra'],     stats: { aim: 90, positioning: 94, ability: 94, mentality: 97, synergy: 96 } },
  { name: 'Klaus',      nationality: 'AR', region: 'Americas', role: 'Controller', igl: true,  agents: ['omen', 'astra'],     stats: { aim: 90, positioning: 93, ability: 94, mentality: 96, synergy: 96 } },
  { name: 'xeta',       nationality: 'KR', region: 'Pacific',  role: 'Controller', igl: false, agents: ['astra', 'viper'],    stats: { aim: 91, positioning: 94, ability: 95, mentality: 93, synergy: 94 } },
  // Sentinels
  { name: 'dapr',       nationality: 'US', region: 'Americas', role: 'Sentinel',   igl: false, agents: ['killjoy', 'cypher'], stats: { aim: 91, positioning: 97, ability: 94, mentality: 93, synergy: 95 } },
  { name: 'steel',      nationality: 'CA', region: 'Americas', role: 'Sentinel',   igl: true,  agents: ['killjoy', 'cypher'], stats: { aim: 90, positioning: 96, ability: 93, mentality: 98, synergy: 96 } },
  { name: 'BONECOLD',   nationality: 'FI', region: 'EMEA',     role: 'Sentinel',   igl: true,  agents: ['killjoy', 'sage'],   stats: { aim: 90, positioning: 95, ability: 93, mentality: 97, synergy: 96 } },
  { name: 'shroud',     nationality: 'CA', region: 'Americas', role: 'Sentinel',   igl: false, agents: ['chamber', 'sage'],   stats: { aim: 96, positioning: 95, ability: 91, mentality: 92, synergy: 90 } },
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
