# Valorant Fantasy League

A VCT fantasy card game built as a React + Vite SPA on Cloudflare Workers.
Solo and multiplayer tournament state is driven by deterministic game engines;
multiplayer lobbies use Durable Objects and daily leaderboards use D1.

## Getting started

```sh
npm install
npm run dev        # http://localhost:5173
```

The Vite server is enough for solo UI work. To exercise the Worker APIs,
WebSockets, Durable Objects, and D1 together, build once and run Wrangler:

```sh
npm run build
npx wrangler dev
```

## Production checks and deployment

Run the same release gate used by CI:

```sh
npm run check
```

This runs the full ESLint configuration, every Node test, the optimized Vite
build, and a Wrangler deployment dry-run. Production deploys are handled by
`.github/workflows/deploy.yml`; the workflow applies pending D1 migrations
before deploying the Worker. It requires `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_API_TOKEN` as GitHub environment secrets for `production`.

## Data sync (cards from vlr.gg)

Card data is generated offline by `scripts/vlr-to-json.js` from
[vlrggapi](https://github.com/axsddlr/vlrggapi), a scraper for vlr.gg.
The public instance (`vlrggapi.vercel.app`) is dead, so run your own:

```sh
# one-time setup (sibling directory)
git clone https://github.com/axsddlr/vlrggapi ../vlrggapi
cd ../vlrggapi && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt

# every sync: start the API…
.venv/bin/python main.py         # serves on :3001

# …then in this repo:
npm run sync-vlr
```

Use `VLR_API_BASE=http://host:port npm run sync-vlr` if the API runs elsewhere.

> **Note:** our vlrggapi clone carries local patches (in `api/scrapers/stats.py`
> and `players.py`) for vlr.gg's 2026 page layout — column mappings changed and
> upstream hasn't caught up. If you re-clone upstream, agent stats come back
> empty and stat columns are misaligned; re-apply those patches.

The sync:

1. Pulls the VCT events/teams/players configured in `scripts/vlr-players.config.js`.
2. Derives the 5 card stats from each player's per-agent stats, normalized
   against regional baselines (60–99 scale).
3. Assigns tier from the card rating: **>80 gold, 70–80 silver, <70 bronze**
   (bronze uses the silver palette until bronze art exists).
4. Downloads player avatars and team logos, removes avatar backgrounds
   (`scripts/process_avatars.py`, rembg) and fits them onto 400x412
   transparent canvases in `public/assets/players/`.
5. Writes `src/data/cards.json`.

Image processing needs Python deps (first run downloads the ~170 MB U²-Net model):

```sh
python3 -m venv scripts/.venv && scripts/.venv/bin/pip install -r scripts/requirements.txt
```

Existing files in `public/assets/players/` and `public/assets/orgs/` are never
overwritten — hand-made art is safe. To force-regenerate an image, delete the file
and re-run. Per-player manual tweaks (tier, palette, power, photo) go in
`PLAYER_OVERRIDES` in `scripts/vlr-players.config.js` so they survive re-syncs.

## Project layout

- `src/pages/` — collection, solo run, multiplayer, and match screens
- `src/engine/` — deterministic solo and multiplayer game engines
- `src/data/cards.json` — generated card definitions (do not hand-edit; use overrides)
- `scripts/` — data sync + image pipeline
- `worker/index.js` — Worker routing, D1 leaderboard API, and lobby Durable Object
- `migrations/` — D1 schema migrations
- `VCT_GAME_KNOWLEDGE_BASE.md` — game design doc
