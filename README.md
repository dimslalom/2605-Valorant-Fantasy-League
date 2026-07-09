# Valorant Fantasy League

A VCT fantasy card game. React + Vite SPA with a match engine, card collection,
and pack opening. Supabase stores user accounts and card ownership; card
definitions themselves are static data in `src/data/cards.json`.

## Getting started

```sh
npm install
npm run dev        # http://localhost:5173
```

Copy `.env.example` to `.env.local` and fill in the Supabase URL + anon key.

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

- `src/pages/` — Collection, PreMatch, Match, PackOpening
- `src/engine/` — match simulator, duel resolver, map renderer
- `src/data/cards.json` — generated card definitions (do not hand-edit; use overrides)
- `scripts/` — data sync + image pipeline
- `supabase/schema.sql` — profiles / collection / packs tables
- `VCT_GAME_KNOWLEDGE_BASE.md` — game design doc
