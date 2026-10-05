# Weekly bingo rollout

This replaces the playable daily bingo page. Historical `bingo_cards` rows remain readable through the legacy GET routes; writes to those routes are disabled.

## Release order

1. Apply D1 migration `0010_weekly_bingo_roster_wallet.sql` (and any later pending migrations) to the shared database before deploying either Worker.
2. Deploy the feed Worker, the OpVAL Worker and static app. Keep the existing feed ingest token in the GitHub Actions workflow. The scheduled workflow now polls the VLR transfer log and all four published Riot GCD region sheets after its match poll.
3. Watch `/api/roster/status` for fresh reads and unresolved identities. The first valid Riot snapshot only establishes a baseline. A changed row produces a ranked event only after the next successful identical read.
4. Launch with one free card per Monday-to-Monday UTC week. It earns credits when all scheduled matches and Riot source coverage settle. The weekly leaderboard sums a player's cards.
5. Cron records four or more settled weeks, replays four legal extra cards per submitted free card, calibrates a points-to-credits rate on three weeks and validates it on the fourth. Paid slots are enabled only when the held-out mean gross payout is 90–110 credits and the replay sample minimum is met. Inspect `/api/weekly-bingo/calibration` for progress. Future weekly rows inherit the approved rate.

## Source and timing rules

- VLR transfers are discovery and browsing data. They never settle ranked roster squares.
- Riot GCD is the settlement source. `first_seen_at` means OpVAL's first successful observation, not a public announcement time. The source is a live sheet and has no guaranteed timestamped change log.
- A Riot read gap longer than three hours keeps an affected week pending. A missed transient sheet change cannot be reconstructed from the current published sheet; restore source history or reconcile the gap before closing such a week.
- The eligible match schedule is frozen at Monday 00:00 UTC. A match moved outside the week is neutral; later added matches do not enter the frozen slate.
- Each distinct official snapshot retains its contract rows and every successful read retains a timestamp. `/api/roster/snapshots` and `/api/roster/snapshots/:id` expose the audit trail.
- Credit balances and card ownership are authoritative on the server after a one-time opening balance from the last save. Existing signed-in browser state refreshes from the server on tab visibility and after a bingo purchase.

## Operational checks

- The roster job fails loudly when VLR markup or a Riot region's table structure changes. Its parser fixture tests run in the workflow before each poll. The roster hub shows source freshness and unresolved identities.
- Weekly settlement is idempotent. A repeated cron run cannot pay a card or match result twice.
- Paid cards remain disabled unless calibration explicitly passes; the feature cannot be enabled by a client request.
