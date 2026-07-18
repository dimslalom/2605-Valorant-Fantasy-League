/**
 * VCT 2026 player data injection.
 *
 * Strategy:
 *  1. Fetch /v2/event/{id} for each VCT 2026 event → player IDs + team IDs
 *  2. Fetch /v2/team?id= for each discovered team → tag + logo (downloaded)
 *  3. Fetch /v2/player?id= for each player → stats + country + avatar
 *  4. Normalise stats against regional baselines from /v2/stats
 *  5. Download avatars, run scripts/process_avatars.py (rembg cutout → 400x412)
 *  6. Write src/data/cards.json
 *
 * Usage:
 *   npm run sync-vlr
 *
 * Requires a running vlrggapi instance (the public vercel one is dead):
 *   git clone https://github.com/axsddlr/vlrggapi ../vlrggapi
 *   cd ../vlrggapi && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
 *   .venv/bin/python main.py   (serves on :3001)
 * Override the API location with VLR_API_BASE if hosted elsewhere.
 *
 * Tier rule: card rating 80+ → gold, 70+ → silver, below 70 → bronze.
 * Bronze card art doesn't exist yet, so bronze cards fall back to the
 * silver palette until bronze-bg.png / bronze-stat-bg.png are added.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import {
  EVENTS, PLAYER_OVERRIDES, IGL_NAMES, ICONS,
  TIER2_QUERY, TIER2_TITLE_MUST, TIER2_TITLE_SKIP, TIER2_EVENTS,
  TIER2_REGION_KEYWORDS, TIER2_REGION_FALLBACK, TIER2_STAT_PENALTY,
  VCT_STAT_BONUS,
} from './vlr-players.config.js';

const __dirname   = dirname(fileURLToPath(import.meta.url));
const OUTPUT      = resolve(__dirname, '../src/data/cards.json');
const ORGS_DIR    = resolve(__dirname, '../public/assets/orgs');
const PLAYERS_DIR = resolve(__dirname, '../public/assets/players');
const CACHE_DIR   = resolve(__dirname, '.cache/avatars');
const CARD_BG_DIR = resolve(__dirname, '../public/assets/card-bg');
const BASE_URL    = process.env.VLR_API_BASE ?? 'http://127.0.0.1:3001';
const DELAY_MS    = 350;
const PLACEHOLDER = '/assets/players/placeholder.png';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function get(path, retries = 2) {
  const url = `${BASE_URL}${path}`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      clearTimeout(timer);
      if (attempt < retries) {
        console.warn(`    retry ${attempt + 1}/${retries}: ${path} (${err.message})`);
        await sleep(1000 * (attempt + 1));
      } else {
        throw new Error(`${err.message} (${url})`);
      }
    }
  }
}

async function healthCheck() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    const res = await fetch(`${BASE_URL}/v2/health`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    console.error(`
✗ vlrggapi is not reachable at ${BASE_URL} (${err.message})

  Start a local instance:
    cd ../vlrggapi && .venv/bin/python main.py

  Or point VLR_API_BASE at a running instance:
    VLR_API_BASE=http://host:port npm run sync-vlr
`);
    process.exit(1);
  }
}

// Download a binary file if the destination doesn't already exist.
// Returns true when the file exists afterwards.
async function download(url, dest) {
  if (existsSync(dest)) return true;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    return true;
  } catch (err) {
    console.warn(`    ⚠ download failed: ${url} (${err.message})`);
    return false;
  }
}

// vlr.gg serves this image when a player has no photo
function isRealAvatar(url) {
  return !!url && !url.includes('/base/ph/');
}

// Parse a stat value: strips "%" and converts to float
function p(v) {
  if (v === null || v === undefined || v === '') return 0;
  return parseFloat(String(v).replace('%', '')) || 0;
}

// Parse a flag string like "mod-us" or "flag_us" → "US"
function parseFlag(flag) {
  if (!flag) return 'UN';
  return flag.replace(/^(mod-|flag_)/i, '').slice(0, 2).toUpperCase();
}

// Country name → ISO alpha-2
const COUNTRY_MAP = {
  'indonesia':'ID','brazil':'BR','united states':'US','usa':'US',
  'south korea':'KR','korea':'KR','japan':'JP','thailand':'TH',
  'philippines':'PH','singapore':'SG','malaysia':'MY','vietnam':'VN',
  'china':'CN','turkey':'TR','sweden':'SE','denmark':'DK',
  'france':'FR','germany':'DE','spain':'ES','united kingdom':'GB',
  'russia':'RU','ukraine':'UA','portugal':'PT','belgium':'BE',
  'poland':'PL','finland':'FI','norway':'NO','canada':'CA',
  'argentina':'AR','chile':'CL','colombia':'CO','mexico':'MX',
  'peru':'PE','morocco':'MA','latvia':'LV','kazakhstan':'KZ',
  'czechia':'CZ','czech republic':'CZ','netherlands':'NL',
  'israel':'IL','georgia':'GE','australia':'AU','taiwan':'TW',
  'hong kong':'HK','india':'IN','iceland':'IS','austria':'AT',
  'italy':'IT','romania':'RO','serbia':'RS','croatia':'HR',
};

function toISO2(country) {
  if (!country) return 'UN';
  const s = String(country).trim();
  if (s.length === 2) return s.toUpperCase();
  return COUNTRY_MAP[s.toLowerCase()] ?? s.slice(0, 2).toUpperCase();
}

function slug(str) {
  return String(str).toLowerCase().replace(/[^a-z0-9]/g, '');
}

// vlr.gg team pages don't expose player roles, so derive the role from the
// player's most-used agent instead.
const AGENT_ROLES = {
  jett:'Duelist', raze:'Duelist', reyna:'Duelist', phoenix:'Duelist',
  yoru:'Duelist', neon:'Duelist', iso:'Duelist', waylay:'Duelist',
  brimstone:'Controller', omen:'Controller', viper:'Controller',
  astra:'Controller', harbor:'Controller', clove:'Controller',
  sova:'Initiator', breach:'Initiator', skye:'Initiator', kayo:'Initiator',
  fade:'Initiator', gekko:'Initiator', tejo:'Initiator',
  killjoy:'Sentinel', cypher:'Sentinel', sage:'Sentinel',
  chamber:'Sentinel', deadlock:'Sentinel', vyse:'Sentinel',
};

function roleFromAgents(topAgents) {
  for (const agent of topAgents) {
    const role = AGENT_ROLES[slug(agent)];
    if (role) return role;
  }
  return 'Flex';
}

// ── Past-team stints (hidden on cards, powers chemistry) ────────────────────

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};
const MONTH_RE = '(?:january|february|march|april|may|june|july|august|september|october|november|december)';
// e.g. "October 2022 to November 2025" with a dash separator on vlr.gg
const RANGE_RE = new RegExp(`(${MONTH_RE})\\s+(\\d{4})\\s*[\\u2013\\u2014-]\\s*(${MONTH_RE})\\s+(\\d{4})`, 'i');
const JOINED_RE = new RegExp(`(${MONTH_RE})\\s+(\\d{4})`, 'i');

const ymOf = (monthName, year) => Number(year) * 12 + MONTHS[monthName.toLowerCase()];

// Build [{org, from, to}] with year-month integers; to=null means ongoing.
// Entries without a parseable date range (showmatch rosters, national teams)
// are dropped: the game only uses stints for overlap checks.
function parseStints(info) {
  const stints = [];

  const cur = info.current_team;
  if (cur?.name) {
    const j = String(cur.joined ?? '').match(JOINED_RE);
    stints.push({ org: cur.name, from: j ? ymOf(j[1], j[2]) : null, to: null });
  }

  for (const t of info.past_teams ?? []) {
    // the range sometimes leaks into the team name, so search both fields
    const hay = `${t.name ?? ''} ${t.dates ?? ''}`;
    const m = hay.match(RANGE_RE);
    if (!m) continue;
    const org = String(t.name ?? '').replace(RANGE_RE, '').trim();
    if (!org) continue;
    stints.push({ org, from: ymOf(m[1], m[2]), to: ymOf(m[3], m[4]) });
  }

  return stints;
}

// ── Tier-2 (Challengers) event discovery ────────────────────────────────────

async function discoverTier2Events() {
  console.log(`\nDiscovering Challengers events (search: "${TIER2_QUERY} 2026")...`);
  let found = [];
  try {
    const res = await get(`/v2/search?q=${encodeURIComponent(TIER2_QUERY + ' 2026')}`);
    found = res?.data?.segments?.results?.events ?? [];
  } catch (err) {
    console.warn(`  ⚠ Event search failed: ${err.message}`);
  }

  const events = [];
  for (const ev of found) {
    const title = ev.name ?? '';
    if (!TIER2_TITLE_MUST.every(re => re.test(title))) continue;
    if (TIER2_TITLE_SKIP.some(re => re.test(title))) continue;
    const lower = title.toLowerCase();
    const match = TIER2_REGION_KEYWORDS.find(k => k.words.some(w => lower.includes(w))) ?? TIER2_REGION_FALLBACK;
    events.push({ id: Number(ev.id), region: match.region, apiRegion: match.apiRegion, title });
  }
  for (const manual of TIER2_EVENTS) {
    if (!events.some(e => e.id === manual.id)) events.push({ ...manual, title: `manual ${manual.id}` });
  }

  console.log(`  ${events.length} Challengers league events kept (of ${found.length} search hits)`);
  for (const e of events) console.log(`    ${String(e.id).padEnd(6)} ${e.region.padEnd(9)} ${e.title}`);
  return events;
}

// Tier from card rating, thresholds inclusive: 80+ gold, 70+ silver, else bronze
function tierFromRating(rating) {
  if (rating >= 80) return 'gold';
  if (rating >= 70) return 'silver';
  return 'bronze';
}

// Fall back through nicer palettes until the art exists on disk
// (icon art may not be drawn yet; same pattern bronze used before its art landed)
function paletteForTier(tier) {
  const chain = tier === 'icon' ? ['icon', 'gold', 'silver'] : [tier, 'silver'];
  for (const p of chain) {
    if (existsSync(resolve(CARD_BG_DIR, `${p}-bg.png`))) return p;
  }
  return 'silver';
}

// ── Stat derivation ──────────────────────────────────────────────────────────

// Weighted average of agent_stats[].{key} by rounds played
function wavg(agentStats, key) {
  const total = agentStats.reduce((s, a) => s + p(a.rounds), 0);
  if (!total) return 0;
  return agentStats.reduce((s, a) => s + p(a[key]) * p(a.rounds), 0) / total;
}

// Scale raw score to the 60 to 99 range
function norm(raw, min, max) {
  if (max <= min) return 75;
  return Math.round(60 + (Math.max(min, Math.min(max, raw)) - min) / (max - min) * 39);
}

// Fetch regional stat baselines from /v2/stats
// Field names from stats endpoint differ from player endpoint, map them here
async function fetchBaselines(apiRegion) {
  let segments = [];
  try {
    const data = await get(`/v2/stats?region=${apiRegion}&timespan=90`);
    segments = data?.data?.segments ?? [];
  } catch (err) {
    console.warn(`  ⚠ Baselines unavailable for ${apiRegion}: ${err.message}`);
  }

  const fallback = { min: 0, max: 100 };
  if (!segments.length) {
    return { aim: fallback, positioning: fallback, ability: fallback, mentality: fallback, synergy: fallback, rating: { min: 0.8, max: 1.4 } };
  }

  // Compute raw composite scores using stats-endpoint field names
  const raws = segments.map(s => {
    const fkpr = p(s.first_kills_per_round);         // e.g. "0.19" → 0.19
    const kd   = p(s.kill_deaths);                   // e.g. "1.19" → 1.19
    const kpr  = p(s.kills_per_round);               // e.g. "0.81" → 0.81
    const fdpr = p(s.first_deaths_per_round);        // e.g. "0.13" → 0.13
    const kast = p(s.kill_assists_survived_traded);  // e.g. "72%"  → 72
    const adr  = p(s.average_damage_per_round);      // e.g. "158.4"
    const apr  = p(s.assists_per_round);             // e.g. "0.29"
    const rtg  = p(s.rating);                        // e.g. "1.18"
    return {
      aim:         fkpr * 100 + kd * 50 + kpr * 50,
      positioning: kast * 50 + (1 - Math.min(fdpr, 1)) * 50,
      ability:     apr * 60 + adr * 0.4,
      mentality:   kast * 40 + rtg * 40,
      synergy:     apr * 40 + kast * 60,
      rating:      rtg,
    };
  });

  const result = {};
  for (const k of ['aim','positioning','ability','mentality','synergy','rating']) {
    const vals = raws.map(r => r[k]).filter(v => v > 0);
    result[k] = vals.length ? { min: Math.min(...vals), max: Math.max(...vals) } : fallback;
  }
  return result;
}

// Which two stats a role's real-world VLR rating speaks to most
const SIGNATURE_STATS = {
  Duelist:    ['aim', 'ability'],
  Initiator:  ['ability', 'synergy'],
  Controller: ['mentality', 'synergy'],
  Sentinel:   ['positioning', 'mentality'],
  Flex:       ['aim', 'ability'],
};
const VLR_WEIGHT_SIGNATURE = 0.45;
const VLR_WEIGHT_OTHER     = 0.15;

// Derive 5 card stats from player agent_stats + baselines, then blend in the
// normalized VLR rating (role-weighted) so real-world performance shows up in
// the numbers, not just the composite formulas.
// agent_stats field names: fkpr, kd, kpr, fdpr, kast(%), adr, apr, rating
function deriveStats(agentStats, bl, vlrNorm, role) {
  const fkpr = wavg(agentStats, 'fkpr');
  const kd   = wavg(agentStats, 'kd');
  const kpr  = wavg(agentStats, 'kpr');
  const fdpr = wavg(agentStats, 'fdpr');
  const kast = wavg(agentStats, 'kast');
  const adr  = wavg(agentStats, 'adr');
  const apr  = wavg(agentStats, 'apr');
  const rtg  = wavg(agentStats, 'rating');

  const base = {
    aim:         norm(fkpr * 100 + kd * 50 + kpr * 50,               bl.aim.min,         bl.aim.max),
    positioning: norm(kast * 50 + (1 - Math.min(fdpr, 1)) * 50,      bl.positioning.min, bl.positioning.max),
    ability:     norm(apr * 60 + adr * 0.4,                           bl.ability.min,     bl.ability.max),
    mentality:   norm(kast * 40 + rtg * 40,                           bl.mentality.min,   bl.mentality.max),
    synergy:     norm(apr * 40 + kast * 60,                           bl.synergy.min,     bl.synergy.max),
  };

  const signature = SIGNATURE_STATS[role] ?? SIGNATURE_STATS.Flex;
  const blended = {};
  for (const [key, value] of Object.entries(base)) {
    const w = signature.includes(key) ? VLR_WEIGHT_SIGNATURE : VLR_WEIGHT_OTHER;
    blended[key] = Math.round(value * (1 - w) + vlrNorm * w);
  }
  return blended;
}

// ── Icon tier: retired legends ───────────────────────────────────────────────
// Stats are hand-authored in the ICONS config; only the portrait and past
// teams (for the played-together chemistry) come from vlr.gg.

// Resolve a legend's vlr.gg player id via exact alias match on /v2/search
async function resolveIconId(icon) {
  if (icon.vlrId) return String(icon.vlrId);
  const res = await get(`/v2/search?q=${encodeURIComponent(icon.name)}`);
  const players = res?.data?.segments?.results?.players ?? [];
  const hit = players.find(p => (p.name ?? '').toLowerCase() === icon.name.toLowerCase()) ?? players[0];
  return hit ? String(hit.id) : null;
}

// Fetch avatar + past teams for every ICONS entry. Adds {file, style: 'icon'}
// manifest entries so the avatar batch applies the golden monochrome.
async function fetchIcons(manifest) {
  console.log(`\nFetching ${ICONS.length} icon profiles...`);
  const out = [];
  for (const icon of ICONS) {
    try {
      const playerId = await resolveIconId(icon);
      if (!playerId) { console.warn(`  ✗ ${icon.name}: no vlr.gg profile found`); continue; }
      await sleep(DELAY_MS);
      const res = await get(`/v2/player?id=${playerId}&timespan=all`);
      const info = res?.data?.segments?.[0] ?? {};
      let hasAvatar = false;
      if (isRealAvatar(info.avatar)) {
        hasAvatar = await download(info.avatar, resolve(CACHE_DIR, `${playerId}.png`));
      }
      if (hasAvatar) manifest[playerId] = { file: `icon-${slug(icon.name)}.png`, style: 'icon' };
      out.push({ icon, playerId, info });
      console.log(`  ✓  ${icon.name.padEnd(14)} id:${String(playerId).padEnd(7)} avatar:${hasAvatar ? 'yes' : 'no '}`);
      await sleep(DELAY_MS);
    } catch (err) {
      console.warn(`  ✗ ${icon.name}: ${err.message}`);
    }
  }
  return out;
}

// Pure build step; photo existence is checked after the avatar batch has run
function buildIconCards(iconData) {
  return iconData.map(({ icon, info }) => {
    const statVals = Object.values(icon.stats);
    const rating = Math.round(statVals.reduce((s, v) => s + v, 0) / statVals.length);
    const file = `icon-${slug(icon.name)}.png`;
    const photo = existsSync(resolve(PLAYERS_DIR, file)) ? `/assets/players/${file}` : PLACEHOLDER;
    return {
      id:          `icon-${slug(icon.name)}`,
      player:      icon.name,
      org:         '',
      org_name:    'Retired',
      org_logo:    '',
      region:      icon.region,
      nationality: icon.nationality,
      tier:        'icon',
      edition:     null,
      rating,
      role:        icon.role,
      agents:      icon.agents,
      photo,
      stats:       { ...icon.stats },
      power:       null,
      palette:     paletteForTier('icon'),
      league:      'icon',
      igl:         !!icon.igl,
      stints:      parseStints(info),
    };
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nUsing vlrggapi at ${BASE_URL}`);
  await healthCheck();
  mkdirSync(CACHE_DIR, { recursive: true });

  // Step 1: fetch region baselines
  const uniqueRegions = [...new Set(EVENTS.map(e => e.apiRegion))];
  console.log(`\nFetching stat baselines: ${uniqueRegions.join(', ')}`);
  const baselines = {};
  for (const region of uniqueRegions) {
    process.stdout.write(`  ${region} ... `);
    baselines[region] = await fetchBaselines(region);
    console.log('done');
    await sleep(DELAY_MS);
  }

  // Step 2: collect player IDs + team IDs from event endpoints.
  // Tier-1 events run first so a player seen in both keeps league 'vct'.
  const tier2Events = await discoverTier2Events();
  const allEvents = [
    ...EVENTS.map(e => ({ ...e, league: 'vct' })),
    ...tier2Events.map(e => ({ ...e, league: 't2' })),
  ];

  console.log(`\nFetching event rosters for player IDs (${allEvents.length} events)...`);
  // Map: playerId → { name, flag, teamName, teamId, region, apiRegion, league }
  const playerMeta = {};
  const teamIds = new Set();

  for (const eventCfg of allEvents) {
    console.log(`  Event ${eventCfg.id} (${eventCfg.region}, ${eventCfg.league})`);
    let eventData;
    try {
      const res = await get(`/v2/event/${eventCfg.id}`);
      eventData = res?.data?.segments ?? res?.data;
    } catch (err) {
      console.warn(`  ✗ Event ${eventCfg.id}: ${err.message}`);
      await sleep(DELAY_MS);
      continue;
    }
    await sleep(DELAY_MS);

    const teams = eventData?.teams ?? [];
    for (const team of teams) {
      const teamId = String(team.id ?? '');
      if (teamId) teamIds.add(teamId);

      for (const player of team.players ?? []) {
        const id = String(player.id ?? '');
        if (!id) continue;
        if (playerMeta[id]) continue; // already seen from another event
        playerMeta[id] = {
          name:       player.name ?? '',
          flag:       player.flag ?? '',
          teamName:   team.name ?? '',
          teamId,
          region:     eventCfg.region,
          apiRegion:  eventCfg.apiRegion,
          league:     eventCfg.league,
        };
      }
    }
  }

  const playerIds = Object.keys(playerMeta);
  console.log(`  Found ${playerIds.length} unique players across ${teamIds.size} teams`);

  // Step 3: fetch team profiles → tag + logo (downloaded to /assets/orgs/)
  console.log(`\nFetching team profiles...`);
  // Map: teamId → { tag, name, logoPath }
  const teamInfo = {};
  for (const teamId of teamIds) {
    try {
      const res  = await get(`/v2/team?id=${teamId}`);
      const team = res?.data?.segments?.[0] ?? {};
      const name = team.name ?? '';
      const tag  = team.tag || name;
      let logoPath = `/assets/orgs/${slug(tag)}.png`;
      if (team.logo) {
        const ok = await download(team.logo, resolve(ORGS_DIR, `${slug(tag)}.png`));
        if (!ok) logoPath = '';
      }
      teamInfo[teamId] = { tag, name, logoPath };
      process.stdout.write('.');
    } catch (err) {
      process.stdout.write('x');
    }
    await sleep(DELAY_MS);
  }
  console.log(` done (${Object.keys(teamInfo).length}/${teamIds.size} teams)`);

  // Step 4: fetch each player's profile, download avatar
  console.log(`\nFetching player profiles...`);
  const players = [];

  for (const playerId of playerIds) {
    const meta = playerMeta[playerId];
    let playerData;
    try {
      const res = await get(`/v2/player?id=${playerId}&timespan=all`);
      playerData = res?.data?.segments?.[0];
    } catch (err) {
      console.warn(`  ✗ Player ${meta.name} (${playerId}): ${err.message}`);
      await sleep(DELAY_MS);
      continue;
    }
    await sleep(DELAY_MS);

    const info       = playerData ?? {};
    const agentStats = playerData?.agent_stats ?? [];
    if (!agentStats.length) {
      console.warn(`  ⚠ No agent_stats for ${meta.name} (${playerId}), using fallback`);
    }

    const playerName = info.name ?? meta.name ?? 'Unknown';

    // Download the raw avatar; the processed 400x412 cutout is produced
    // by scripts/process_avatars.py after this loop.
    let hasAvatar = false;
    if (isRealAvatar(info.avatar)) {
      hasAvatar = await download(info.avatar, resolve(CACHE_DIR, `${playerId}.png`));
    }

    players.push({ playerId, meta, info, agentStats, playerName, hasAvatar });
    console.log(`  ✓  ${playerName.padEnd(20)} agents:${String(agentStats.length).padEnd(3)} avatar:${hasAvatar ? 'yes' : 'no '}`);
  }

  // Step 5: process avatars (background removal + 400x412 canvas)
  const manifest = {};
  for (const pl of players) {
    if (pl.hasAvatar) manifest[pl.playerId] = `${slug(pl.playerName)}.png`;
  }
  // Icons ride along in the same avatar batch
  const iconData = await fetchIcons(manifest);

  writeFileSync(resolve(CACHE_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log(`\nProcessing ${Object.keys(manifest).length} avatars (rembg cutout → 400x412)...`);
  const venvPython = resolve(__dirname, '.venv/bin/python');
  const py = spawnSync(existsSync(venvPython) ? venvPython : 'python3', [resolve(__dirname, 'process_avatars.py')], {
    stdio: 'inherit',
    cwd: __dirname,
  });
  if (py.status !== 0) {
    console.warn(`  ⚠ Avatar processing failed: cards whose cutout is missing keep the placeholder.`);
    console.warn(`    Install deps with: pip3 install -r scripts/requirements.txt`);
  }

  // Step 6: build cards
  console.log(`\nBuilding cards...`);
  const cards = [];

  for (const { playerId, meta, info, agentStats, playerName } of players) {
    const nationality = info.country
      ? toISO2(info.country)
      : parseFlag(meta.flag);

    // Top 2 agents by usage
    const topAgents = [...agentStats]
      .sort((a, b) => p(b.use_count ?? b.usage_count) - p(a.use_count ?? a.usage_count))
      .slice(0, 2)
      .map(a => a.agent)
      .filter(Boolean);

    const role = roleFromAgents(topAgents);

    // 5 derived stats, with the normalized VLR rating blended in role-weighted
    const bl      = baselines[meta.apiRegion];
    const vlrRaw  = agentStats.length ? wavg(agentStats, 'rating') : 0;
    const vlrNorm = vlrRaw ? norm(vlrRaw, bl.rating.min, bl.rating.max) : 70;
    const stats   = agentStats.length
      ? deriveStats(agentStats, bl, vlrNorm, role)
      : { aim: 70, positioning: 70, ability: 70, mentality: 70, synergy: 70 };

    // League adjustment: tier-2 stats come from weaker competition so dampen
    // them, and lift tier-1 so the franchised league reads as elite.
    for (const key of Object.keys(stats)) {
      stats[key] = meta.league === 't2'
        ? Math.max(50, stats[key] - TIER2_STAT_PENALTY)
        : Math.min(99, stats[key] + VCT_STAT_BONUS);
    }

    // Card rating = average of the 5 displayed stats, so the headline number
    // is always consistent with what's shown underneath.
    const statVals   = Object.values(stats);
    const cardRating = Math.round(statVals.reduce((s, v) => s + v, 0) / statVals.length);

    // Photo: processed cutout if it exists, else placeholder
    const cutout = `/assets/players/${slug(playerName)}.png`;
    const photo  = existsSync(resolve(PLAYERS_DIR, `${slug(playerName)}.png`))
      ? cutout
      : PLACEHOLDER;

    // Manual overrides
    const ov      = PLAYER_OVERRIDES[playerId] ?? {};
    const tier    = ov.tier    ?? tierFromRating(cardRating);
    const palette = ov.palette ?? paletteForTier(tier);
    const power   = ov.power   ?? null;
    const edition = ov.edition ?? null;

    const team    = teamInfo[meta.teamId] ?? {};
    const orgTag  = team.tag || meta.teamName;
    const cardId  = `${slug(orgTag)}-${slug(playerName)}-${tier}-001`;

    cards.push({
      id:          cardId,
      player:      playerName,
      org:         orgTag,
      org_name:    team.name || orgTag,
      org_logo:    team.logoPath || `/assets/orgs/${slug(orgTag)}.png`,
      region:      meta.region,
      nationality,
      tier,
      edition,
      rating:      cardRating,
      role,
      agents:      topAgents,
      photo:       ov.photo ?? photo,
      stats,
      power,
      palette,
      league:      meta.league,
      igl:         IGL_NAMES.has(playerName.toLowerCase()),
      // hidden: past/current team stints for the played-together chemistry bonus
      stints:      parseStints(info),
    });

    console.log(`  ✓  ${playerName.padEnd(20)} ${nationality.padEnd(4)} ${role.padEnd(12)} rating:${String(cardRating).padEnd(4)} ${tier} ${meta.league}`);
  }

  cards.push(...buildIconCards(iconData));

  writeFileSync(OUTPUT, JSON.stringify(cards, null, 2));
  const tiers = cards.reduce((acc, c) => { acc[c.tier] = (acc[c.tier] ?? 0) + 1; return acc; }, {});
  const photos = cards.filter(c => c.photo !== PLACEHOLDER).length;
  console.log(`\n✓ Wrote ${cards.length} cards → ${OUTPUT}`);
  console.log(`  tiers: ${JSON.stringify(tiers)} | with photo: ${photos}/${cards.length}\n`);
}

// Rebuild only the icon cards and patch them into the existing cards.json,
// so tweaking the legends does not cost a full 40-minute sync.
async function iconsOnly() {
  console.log(`\nUsing vlrggapi at ${BASE_URL} (icons only)`);
  await healthCheck();
  mkdirSync(CACHE_DIR, { recursive: true });

  const manifest = {};
  const iconData = await fetchIcons(manifest);
  writeFileSync(resolve(CACHE_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log(`\nProcessing ${Object.keys(manifest).length} icon avatars (rembg + golden monochrome)...`);
  const venvPython = resolve(__dirname, '.venv/bin/python');
  const py = spawnSync(existsSync(venvPython) ? venvPython : 'python3', [resolve(__dirname, 'process_avatars.py')], {
    stdio: 'inherit',
    cwd: __dirname,
  });
  if (py.status !== 0) {
    console.warn(`  ⚠ Avatar processing failed: icons whose cutout is missing keep the placeholder.`);
  }

  const iconCards = buildIconCards(iconData);
  const existing = JSON.parse(readFileSync(OUTPUT, 'utf8')).filter(c => !String(c.id).startsWith('icon-'));
  const all = [...existing, ...iconCards];
  writeFileSync(OUTPUT, JSON.stringify(all, null, 2));
  console.log(`\n✓ Patched ${iconCards.length} icon cards into ${OUTPUT} (${all.length} total)\n`);
}

const run = process.argv.includes('--icons-only') ? iconsOnly : main;
run().catch(err => {
  console.error('\n✗ Fatal:', err.message);
  process.exit(1);
});
