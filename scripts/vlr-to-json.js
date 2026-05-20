/**
 * One-time VCT 2026 player data injection.
 *
 * Strategy:
 *  1. Fetch /v2/event/{id} for each VCT 2026 event → player IDs + team info
 *  2. Fetch /v2/team?id= for each team → alias→role map
 *  3. Fetch /v2/player?id= for each player → stats + country + agents
 *  4. Normalise stats against regional baselines from /v2/stats
 *  5. Write src/data/cards.json
 *
 * Usage:
 *   npm run sync-vlr
 *
 * If the public API is down, self-host:
 *   git clone https://github.com/axsddlr/vlrggapi && cd vlrggapi
 *   python main.py   (runs on :3001)
 *   then change BASE_URL below to 'http://127.0.0.1:3001'
 */

import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { EVENTS, TEAMS, PLAYER_OVERRIDES } from './vlr-players.config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT    = resolve(__dirname, '../src/data/cards.json');
const BASE_URL  = 'https://vlrggapi.vercel.app';
const DELAY_MS  = 350;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function get(path, retries = 2) {
  const url = `${BASE_URL}${path}`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
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
        throw new Error(`${err.message} — ${url}`);
      }
    }
  }
}

// Parse a stat value — strips "%" and converts to float
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

function cap(str) {
  if (!str) return 'Flex';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

// ── Stat derivation ──────────────────────────────────────────────────────────

// Weighted average of agent_stats[].{key} by rounds played
// agent_stats field names (from /v2/player): rating, acs, kd, adr, kast(%), kpr, apr, fkpr, fdpr
function wavg(agentStats, key) {
  const total = agentStats.reduce((s, a) => s + p(a.rounds), 0);
  if (!total) return 0;
  return agentStats.reduce((s, a) => s + p(a[key]) * p(a.rounds), 0) / total;
}

// Scale raw score to 60–99 range
function norm(raw, min, max) {
  if (max <= min) return 75;
  return Math.round(60 + (Math.max(min, Math.min(max, raw)) - min) / (max - min) * 39);
}

// Fetch regional stat baselines from /v2/stats
// Field names from stats endpoint differ from player endpoint — map them here
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
    return { aim: fallback, positioning: fallback, ability: fallback, mentality: fallback, synergy: fallback, rating: { min: 1.0, max: 1.5 } };
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

// Derive 5 card stats from player agent_stats + baselines
// agent_stats field names: fkpr, kd, kpr, fdpr, kast(%), adr, apr, rating
function deriveStats(agentStats, bl) {
  const fkpr = wavg(agentStats, 'fkpr');
  const kd   = wavg(agentStats, 'kd');
  const kpr  = wavg(agentStats, 'kpr');
  const fdpr = wavg(agentStats, 'fdpr');
  const kast = wavg(agentStats, 'kast');
  const adr  = wavg(agentStats, 'adr');
  const apr  = wavg(agentStats, 'apr');
  const rtg  = wavg(agentStats, 'rating');

  return {
    aim:         norm(fkpr * 100 + kd * 50 + kpr * 50,               bl.aim.min,         bl.aim.max),
    positioning: norm(kast * 50 + (1 - Math.min(fdpr, 1)) * 50,      bl.positioning.min, bl.positioning.max),
    ability:     norm(apr * 60 + adr * 0.4,                           bl.ability.min,     bl.ability.max),
    mentality:   norm(kast * 40 + rtg * 40,                           bl.mentality.min,   bl.mentality.max),
    synergy:     norm(apr * 40 + kast * 60,                           bl.synergy.min,     bl.synergy.max),
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
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

  // Step 2: build alias→role map from team endpoints
  console.log(`\nFetching team rosters for role lookup...`);
  const aliasRoleMap = {}; // alias.toLowerCase() → role
  for (const teamCfg of TEAMS) {
    try {
      const res  = await get(`/v2/team?id=${teamCfg.id}`);
      const roster = res?.data?.roster ?? [];
      for (const p of roster) {
        if (p.alias) aliasRoleMap[p.alias.toLowerCase()] = p.role ?? 'Flex';
      }
      process.stdout.write('.');
    } catch (err) {
      process.stdout.write('x');
    }
    await sleep(DELAY_MS);
  }
  console.log(` done (${Object.keys(aliasRoleMap).length} aliases mapped)`);

  // Step 3: collect player IDs + team context from event endpoints
  console.log(`\nFetching event rosters for player IDs...`);
  // Map: playerId → { name, flag, teamName, teamLogo, teamTag, region, apiRegion }
  const playerMeta = {};

  for (const eventCfg of EVENTS) {
    console.log(`  Event ${eventCfg.id} (${eventCfg.region})`);
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
      const teamName = team.name ?? '';
      const teamLogo = team.logo ?? '';
      const teamId   = String(team.id ?? '');
      // Derive a short tag from the team name if no tag field
      const teamTag  = team.tag ?? teamName;
      const players  = team.players ?? [];

      for (const player of players) {
        const id = String(player.id ?? '');
        if (!id) continue;
        if (playerMeta[id]) continue; // already seen from another event
        playerMeta[id] = {
          name:       player.name ?? '',
          flag:       player.flag ?? '',
          teamName,
          teamLogo,
          teamTag,
          teamId,
          region:     eventCfg.region,
          apiRegion:  eventCfg.apiRegion,
        };
      }
    }
  }

  const playerIds = Object.keys(playerMeta);
  console.log(`  Found ${playerIds.length} unique players across all events`);

  // Step 4: fetch each player's profile and build cards
  console.log(`\nFetching player profiles...`);
  const cards = [];

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
      console.warn(`  ⚠ No agent_stats for ${meta.name} (${playerId}) — using fallback`);
    }

    const playerName  = info.name ?? meta.name ?? 'Unknown';
    const nationality = info.country
      ? toISO2(info.country)
      : parseFlag(meta.flag);

    // Top 2 agents by usage
    const topAgents = [...agentStats]
      .sort((a, b) => p(b.use_count ?? b.usage_count) - p(a.use_count ?? a.usage_count))
      .slice(0, 2)
      .map(a => a.agent)
      .filter(Boolean);

    // Card rating: normalised VLR rating
    const bl         = baselines[meta.apiRegion];
    const avgRating  = agentStats.length ? wavg(agentStats, 'rating') : 1.0;
    const cardRating = norm(avgRating, bl.rating.min, bl.rating.max);

    // 5 derived stats
    const stats = agentStats.length
      ? deriveStats(agentStats, bl)
      : { aim: 70, positioning: 70, ability: 70, mentality: 70, synergy: 70 };

    // Role: look up by alias in the team roster map
    const role = aliasRoleMap[playerName.toLowerCase()] ?? 'Flex';

    // Manual overrides
    const ov      = PLAYER_OVERRIDES[playerId] ?? {};
    const tier    = ov.tier    ?? 'silver';
    const palette = ov.palette ?? tier;
    const power   = ov.power   ?? null;
    const edition = ov.edition ?? null;

    const orgTag  = meta.teamTag;
    const cardId  = `${slug(orgTag)}-${slug(playerName)}-${tier}-001`;

    cards.push({
      id:          cardId,
      player:      playerName,
      org:         orgTag,
      org_logo:    meta.teamLogo || `/assets/orgs/${slug(orgTag)}.png`,
      region:      meta.region,
      nationality,
      tier,
      edition,
      rating:      cardRating,
      role,
      agents:      topAgents,
      photo:       '/assets/players/placeholder.png',
      stats,
      power,
      palette,
    });

    console.log(`  ✓  ${playerName.padEnd(20)} ${nationality.padEnd(4)} ${cap(role).padEnd(12)} rating:${cardRating}`);
  }

  writeFileSync(OUTPUT, JSON.stringify(cards, null, 2));
  console.log(`\n✓ Wrote ${cards.length} cards → ${OUTPUT}\n`);
}

main().catch(err => {
  console.error('\n✗ Fatal:', err.message);
  process.exit(1);
});
