# VCT Card Game — Design Knowledge Base
## Everything decided so far

---

## 1. Project identity

**Logline:** FIFA Ultimate Team, but for the Valorant Champions Tour.

**Fantasy:** You are the coach, not the player. You build a roster of real VCT pro player cards, set strategy, and guide your team through simulated matches.

**Project type:** Fan passion project. No monetisation. Goal is a working proof-of-concept to show Riot Games.

**IP status:** Fan project with a clear "not affiliated with Riot Games" disclaimer. No monetisation = safe to operate. Approach Riot's fan content policy before any public launch.

---

## 2. Target audience

Primary: VCT fans who do not necessarily play Valorant themselves. A large underserved audience that follows the esports scene but has no game to express that fandom in.

Secondary: FIFA Ultimate Team players who follow esports.

---

## 3. Core gameplay loop

### Before the match
1. Pick 5 player cards from your collection
2. Future feature: pick a coach card
3. Map pick/ban (best of 3, mirroring real VCT format)
4. After each map is selected, assign agents to each player
5. Set your team strategy for next map

### During the match
- Match fast-forwards automatically, round scores tick
- You watch your game plan execute — most rounds you do nothing
- **Economy calls** between rounds: full buy / force / eco (This can be automatic or changed by you)
- **Timeouts** (2 per map, limited): pause both sides, adjust strategy or activate a player power
- **Player power activation** outside timeout (limited uses)
- Halftime: Free timeout

The tension is knowing *when* to intervene, not micromanaging every round. Burning a timeout on round 5 vs saving it for round 12 is the skill expression.

### After the map
- Repeat for maps 2 and 3

---

## 4. Match simulation engine

### How a match works under the hood

The engine is pure JavaScript with no UI dependencies. It runs before any animation.

```
simulateMap(teamA, teamB, map, strategy)
→ returns { frames: [], score: {a, b}, roundLog: [] }
```

The frame list is then fed to the canvas renderer for animation.

### Duel resolution formula

Every round is a series of duels. Each duel resolves as:

```
duel score = (aim stat × aim weight modifier)
           + (positioning stat × positioning weight modifier)
           + map zone control bonus
           + RNG variance (±10%)
vs same for opponent → higher score wins
```

### The five player stats (1–99 scale)

| Stat | Label | What it represents |
|---|---|---|
| Aim | AIM | Raw mechanical skill, gunfight win rate |
| Positioning | POS | Game sense, angle quality, map movement |
| Ability usage | ABIL | Value extracted from agent kit |
| Mentality | MNT | Clutch factor, consistency under pressure, tilt resistance |
| Synergy | SYN | How well the player elevates teammates |

Overall rating (OVR) = average of all five stats, shown on card face.

### Strategy system (Option A — modifier stack)

Strategy sets a tradeoff across the 5 players. You're not picking "good strategy," you're picking which players get buffed and which get disadvantaged.

Examples:
- "Aggressive default" → entry fragger gets positioning bonus on attack, supports more exposed
- "Slow default" → everyone gets positioning bonus on defense, attack first-duel rate reduced
- "Eco aggression" → positioning tanks, IGL ability to reset improved

### Map zone control

Each map has zones (A site, B site, C site, Mid, Spawn). Your strategy distributes control tokens across zones per round. More control in a zone = higher win probability for duels there. Timeout lets you redistribute.

Visualised as a top-down map with zones lighting up.

---

## 5. 2D map visualisation

The match renders as a top-down broadcast-style overlay, similar to VCT analyst graphics. Not a pixel-perfect game render.

**What renders:**
- Player dots moving along dashed attack paths per strategy
- Duel zones flashing where engagements happen
- Win/loss indicators resolving per duel
- Round score counter ticking
- Player names on dots

**Implementation:** HTML Canvas element inside a React page. The engine pre-computes the full frame list; the canvas animates it using `requestAnimationFrame`. Map zone polygons are simplified top-down shapes, not pixel-perfect Valorant maps.

**Phase 1 map:** Haven only.

---

## 6. Player card system

### Tier hierarchy

```
Silver < Gold < Legendary < Prestige < Iconic
```

| Tier | Who | Obtained via | Notes |
|---|---|---|---|
| Silver | Rookies, bench players, lesser-known pros | Standard packs (common) | Always in pool |
| Gold | Established starters, regional standouts | Standard packs (rare) | Always in pool |
| Legendary | Top fraggers, global stars | Standard packs (very rare) | Always in pool |
| Prestige | Event-specific: MVP, Champs roster, special achievements | Time-limited drops, tied to real VCT events | May return as archive packs |
| Iconic | All-time legends, retired greats, fan favorites | Special means only — never in packs | One per account, no duplicates, permanent flex |

Tiers are dynamic and configured in data. New tiers can be added by defining a name, palette, stat ceiling, and power slot count. Nothing is hardcoded.

### Card data schema

```json
{
  "id": "prx-forsaken-gold-001",
  "player": "forsakeN",
  "org": "PRX",
  "region": "Pacific",
  "nationality": "SG",
  "tier": "gold",
  "edition": null,
  "palette": "gold",
  "rating": 92,
  "role": "Duelist",
  "agents": ["Jett", "Chamber"],
  "photo": "/assets/players/forsaken.png",
  "org_logo": "/assets/orgs/prx.png",
  "stats": {
    "aim": 94,
    "positioning": 91,
    "ability": 85,
    "mentality": 90,
    "synergy": 87
  },
  "power": {
    "name": "Big Tiger",
    "description": "Positioning ×2 for the next 3 duels",
    "effect": "positioning_multiplier",
    "value": 2,
    "duration": 3
  }
}
```

### The edition + palette system

- `tier` — drives mechanical rarity (pack odds, stat ceiling, power slots)
- `edition` — human-readable event label shown on the card face (Prestige and Iconic only)
- `palette` — drives which PNG asset files are loaded

```
Silver / Gold / Legendary   → edition: null,  palette: "silver" / "gold" / "legendary"
Prestige (event)            → edition: "Champs 2023 MVP",            palette: "prestige-champs23"
Prestige (roster drop)      → edition: "2025 Masters Toronto Winner", palette: "prestige-toronto25"
Iconic                      → edition: "Pacific Legend",              palette: "iconic-default"
```

Asset paths resolve as:
```
/assets/card-bg/{palette}-bg.png
/assets/stat-bg/{palette}-stat-bg.png
```

Adding a new Prestige edition = design two new PNGs + one new JSON entry. Zero code changes.

### Prestige drop types

- **Single card drops** (MVP, individual achievement): released quietly right after the event, like a news announcement
- **Full roster drops** (Champs winner, Masters winner): big seasonal event with a trailer and countdown, whole 5-card set releases simultaneously

Both are time-limited but can return as "archive packs" in future seasons.

### Iconic acquisition (never in packs)

- Campaign reward — complete story mode
- Ranked milestone — season-end reward for top rank
- Legacy event — limited time unlock
- One per account, no trading, no duplicates

### Player power design language

Every power modifies one or more of the five stats. Powers are tied to the player's real reputation in the scene so VCT fans immediately get the reference.

| Player | Power name | Effect |
|---|---|---|
| forsakeN | Big Tiger | Positioning ×2 for 3 duels |
| aspas | The GOAT | Aim only, Positioning ignored for 2 duels |
| Derke | Mechanical Monster | Aim ×2 on CT side for 3 duels |
| Chronicle | The Wall | Team Positioning +15 on defense for 4 duels |
| Boaster | Believe | Team Mentality +20 for 3 duels |
| FNS | IGL Brain | Team Mentality +15 and Synergy +10 for 3 duels |

Power categories:
- **Individual buffs** — boost the card holder's own stats
- **Team buffs** — boost the whole team's stats
- **Enemy debuffs** — reduce opponent stats
- **Conditional** — only trigger in specific circumstances (CT side, when team is down 3+, etc.)

### Pay-to-win mitigation

- Rarity affects stat ceiling, not which stats exist
- Matchmaking brackets lock by total team power rating in ranked
- Skill expression comes from strategy decisions and timeout timing, not just card stats
- Higher rarity cards have more power options, not necessarily higher flat numbers

### Stat ranges by tier

- Silver: 65–82
- Gold: 83–94
- Legendary: 93–99
- Prestige: same ceiling as Legendary but all stats elevated, unique dual power slots
- Iconic: capped at the player's historical peak stats

---

## 7. Card art and asset system

### Design philosophy

You (the designer) own the art layer. The code owns the data layer. They never touch each other.

### Asset structure

```
public/assets/
  card-bg/          ← one PNG per palette key (full card size, 400×560px at 1×)
  stat-bg/          ← one PNG per palette key (bottom panel, same canvas size)
  players/          ← one PNG per player (photo with transparent/black bg)
  orgs/             ← one PNG per org (logo, 32×32px)
```

### Card layer stack (code renders in this order)

```
Layer 0 (z-index 0) — card-bg PNG           → your Figma background
Layer 1 (z-index 1) — player photo PNG      → sourced from VCT broadcasts/social
Layer 2 (z-index 2) — stat-bg PNG           → your Figma bottom panel
Layer 3 (z-index 3) — all text and dynamic elements → code only, reads from cards.json
```

### What code renders (Layer 3)

- Rating number (large, top left)
- Role abbreviation (DLT / INI / CTL / SEN)
- Country flag (flag-icons library, ISO 3166-1 alpha-2 code)
- Region text
- Player name (uppercase, centered)
- Stat row: AIM / POS / ABL / MNT / SYN
- Org logo image (bottom right, dynamic per org)
- Edition text (top right, Prestige and Iconic only — replaces org name in that position)

### Card dimensions in code

```
Normal: 240px wide × 336px tall
Small:  160px wide × 224px tall  (used in deck builder slots)
```

No border-radius, no overflow:hidden on the container. Card shape is defined entirely by the PNG.

### Photo sourcing

- Source from official VCT broadcast screenshots, team social media (Twitter/X, Instagram), VCT Flickr
- Export at minimum 200×200px
- Prestige cards use actual event photos (e.g. forsakeN lifting the trophy at Champs 2023)
- No circular crop needed in Figma — code does not apply border-radius to photos

### Flag library

`flag-icons` npm package. Clean rectangular SVG flags, consistent sizing, no emoji.

```jsx
<span className={`fi fi-${card.nationality.toLowerCase()}`} />
```

---

## 8. Pack and collection economy

### Pack structure (phase 1)

One pack type. Earn packs by winning AI matches. No purchasing in the fan project.

Every new player gets a starter deck of fixed Silver cards on first login.

### Pull rates (to be tuned in phase 2)

- Silver: ~70%
- Gold: ~25%
- Legendary: ~5%
- Prestige: time-limited drop only, not in standard packs
- Iconic: never in packs

### Trading (phase 3 — what-if feature)

The full trading ecosystem (player-to-player card trading, market pricing) is deferred to phase 3. The economy needs to be stable before introducing player-to-player variables.

---

## 9. Retention and progression

- **Campaign** — single player story matches vs scripted AI teams (phase 2)
- **Ranked ladder** — seasonal resets, matchmaking by team power rating (phase 3)
- **New card drops** — tied to real VCT event calendar
- **Seasonal meta shifts** — map pool follows real VCT rotations, agent balance is independent from Valorant patches unless a major rework occurs

---

## 10. Tech stack

| Layer | Technology |
|---|---|
| Frontend framework | React (Vite) |
| Routing | React Router v6 |
| Map simulation | HTML Canvas inside MapCanvas.jsx |
| Database + auth | Supabase |
| Card data pipeline | Google Sheets → JSON via script |
| Deployment | Vercel |
| Flags | flag-icons npm package |
| Fonts | DM Sans (Google Fonts) |
| UI style | Custom CSS Modules, no component libraries |

### Folder structure

```
src/
  pages/
    Collection.jsx
    PreMatch.jsx
    Match.jsx
    PackOpening.jsx
  components/
    PlayerCard.jsx
    DeckBuilder.jsx
    MapCanvas.jsx
    TimeoutPanel.jsx
  engine/
    matchSimulator.js    ← pure JS, no React
    duelResolver.js      ← pure JS, no React
    mapRenderer.js       ← pure JS canvas drawing
  data/
    cards.json
    maps.json
  lib/
    supabase.js
    utils.js             ← roleAbbr(), cardTextColor(), TEXT_COLOR
```

### Key utility functions (src/lib/utils.js)

```js
roleAbbr(role)          // "Duelist" → "DLT"
cardTextColor(palette)  // palette key → hex color for text
TEXT_COLOR              // tier → hex color map
```

### Supabase tables

```sql
profiles (id, username, created_at)
collection (id, user_id, card_id, obtained_at)
packs (id, user_id, count)
```

### Card data pipeline

Google Sheet (one row per card) → `npm run sync-cards` → `src/data/cards.json`

Column order: `id, player, org, region, nationality, tier, edition, rating, role, agents, photo, org_logo, aim, positioning, ability, mentality, synergy, power_name, power_description, power_effect, power_value, power_duration, palette`

---

## 11. Phase plan

### Phase 1 — Proof of loop (current)

**In scope:**
- 30 cards (Silver and Gold, Pacific + Americas + EMEA)
- 1 map (Haven)
- AI opponent only
- Pre-match flow: pick 5, assign agents, set strategy
- Match loop: fast-forward simulation, economy calls, 2 timeouts per map
- Duel resolution formula
- 2D map visualisation
- Starter deck on first login
- Pack opening (earn by winning)

**Out of scope:**
- PvP matchmaking
- Legendary / Prestige / Iconic tiers
- Multiple maps
- Campaign / ranked ladder
- Coach card
- Trading

### Phase 2 — Full single player

- All 5 maps with unique zone layouts
- All 4 regions, full card roster (~100 cards)
- Legendary tier, pity system on packs
- Single player campaign
- Best of 3 map format
- Coach card slot
- Agent ban/pick phase per map

### Phase 3 — Live game (show Riot)

- PvP matchmaking
- Ranked ladder with seasonal resets
- Prestige and Iconic tiers
- Real VCT event drops tied to live tournament results
- Trading ecosystem (if greenlit)

---

## 12. Phase 1 card roster (30 cards)

| # | Player | Org | Region | Tier | Role | OVR | AIM | POS | ABIL | MNT | SYN | Power |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | forsakeN | PRX | Pacific | Gold | Duelist | 92 | 94 | 91 | 85 | 90 | 87 | Big Tiger |
| 2 | Jinggg | PRX | Pacific | Gold | Duelist | 89 | 91 | 86 | 88 | 85 | 90 | Full Send |
| 3 | something | PRX | Pacific | Silver | Initiator | 81 | 80 | 83 | 86 | 79 | 88 | Info Pull |
| 4 | d4v41 | PRX | Pacific | Silver | Controller | 78 | 75 | 85 | 84 | 76 | 86 | Smoke Wall |
| 5 | mindfreak | PRX | Pacific | Silver | Sentinel | 76 | 74 | 82 | 85 | 74 | 84 | Anchor |
| 6 | aspas | LOUD | Americas | Gold | Duelist | 95 | 98 | 88 | 87 | 93 | 84 | The GOAT |
| 7 | Less | LOUD | Americas | Silver | Initiator | 80 | 78 | 82 | 87 | 80 | 91 | Spark |
| 8 | pANcada | LOUD | Americas | Silver | Controller | 79 | 77 | 84 | 88 | 78 | 85 | Star Control |
| 9 | Sacy | LOUD | Americas | Silver | Initiator | 78 | 76 | 86 | 85 | 77 | 87 | Arrow IGL |
| 10 | cauanzin | LOUD | Americas | Silver | Duelist | 77 | 82 | 74 | 80 | 76 | 79 | Future Star |
| 11 | s0m | NRG | Americas | Gold | Controller | 88 | 85 | 87 | 92 | 86 | 88 | Harbor God |
| 12 | FNS | NRG | Americas | Silver | Controller | 75 | 68 | 88 | 82 | 84 | 93 | IGL Brain |
| 13 | Ethan | NRG | Americas | Silver | Initiator | 80 | 83 | 80 | 79 | 78 | 84 | Clutch Up |
| 14 | jawgemo | NRG | Americas | Silver | Duelist | 79 | 84 | 75 | 76 | 77 | 80 | Mid Diff |
| 15 | Demon1 | LEV | Americas | Gold | Duelist | 91 | 95 | 82 | 84 | 88 | 81 | Demon Mode |
| 16 | Derke | Fnatic | EMEA | Gold | Duelist | 93 | 96 | 85 | 82 | 89 | 83 | Mechanical Monster |
| 17 | Chronicle | Fnatic | EMEA | Gold | Sentinel | 88 | 82 | 93 | 90 | 88 | 91 | The Wall |
| 18 | Alfajer | Fnatic | EMEA | Gold | Duelist | 90 | 93 | 87 | 83 | 90 | 84 | Dawn |
| 19 | Leo | Fnatic | EMEA | Silver | Initiator | 82 | 80 | 86 | 88 | 82 | 89 | Info King |
| 20 | Boaster | Fnatic | EMEA | Silver | Controller | 76 | 70 | 84 | 85 | 92 | 94 | Believe |
| 21 | stax | T1 | Pacific | Gold | Controller | 87 | 80 | 90 | 88 | 91 | 93 | Composed IGL |
| 22 | BuZz | T1 | Pacific | Silver | Duelist | 82 | 86 | 80 | 79 | 81 | 82 | Dash |
| 23 | Meteor | T1 | Pacific | Silver | Initiator | 80 | 79 | 83 | 87 | 79 | 86 | Recon Arrow |
| 24 | Sylvan | T1 | Pacific | Silver | Sentinel | 77 | 76 | 84 | 83 | 76 | 83 | Lockdown |
| 25 | iZu | T1 | Pacific | Silver | Duelist | 76 | 80 | 74 | 78 | 75 | 80 | Rookie Rush |
| 26 | t3xture | Gen.G | Pacific | Gold | Duelist | 89 | 92 | 84 | 83 | 87 | 85 | Texture Pack |
| 27 | Munchkin | Gen.G | Pacific | Silver | Controller | 80 | 76 | 85 | 87 | 80 | 88 | Gravity Well |
| 28 | Foxy9 | Gen.G | Pacific | Silver | Duelist | 79 | 83 | 76 | 78 | 78 | 80 | Trigger Happy |
| 29 | MaKo | DRX | Pacific | Gold | Initiator | 87 | 82 | 89 | 91 | 87 | 92 | Recon King |
| 30 | Flashback | DRX | Pacific | Silver | Duelist | 78 | 82 | 76 | 77 | 77 | 79 | Flash Forward |

---

## 13. Open questions (not yet decided)

- Exact duel formula weights (aim %, positioning %, ability %, mentality %, synergy %, RNG range)
- What "strategy" looks like as a concrete dropdown option in the UI (names and exact modifiers)
- Whether Prestige cards are tradeable or soulbound
- Whether there is a pity system on Legendary pulls in phase 1 or phase 2
- Coach card design: what stats does it have, what does its power affect
- Haven map zone polygon coordinates for the canvas renderer
- Exact pixel positions of text elements on the card face (to be measured from Figma)

---

*Last updated: Sprint 1 + Card System Adjustment complete. Dev server running clean. Supabase connected.*
