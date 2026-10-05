# Active bingo card: lifecycle and fair locking

5 October 2026 · Design proposal · No gameplay or database changes made

## The product rule

Each player has **one active card for a shared outcome window**. Inactive cards are drafts: players can arrange their squares but they score nothing. Activating a draft submits an immutable snapshot to the server for the *next* window. The active card stays active until its window settles; deactivating it early cannot stop losses, preserve a hit, or make another card eligible for the same window. After settlement it becomes an archive, and the player can activate a different draft for a later window.

This removes paid attempts and unused practice cards. Every eligible player gets one ranked entry for the same window. The inactive card has a real job: it is the candidate for the next activation.

## Recommended timeline

**Decision: use the same weekly window for everyone.** A concrete schedule is **Monday 00:00 through the following Monday 00:00 UTC**. Publish the available square pool and eligible match/event scope ahead of time. The activation deadline is the **start of that window**, measured by the server clock. Any activation or edit received after the deadline enters the *following* window. If there is no active entry when the window starts, the player sits out that window.

The weekly window is a new design decision, not a discovered existing rule. It avoids comparing a player who covered one match with a player whose rolling card covered a busy tournament weekend.

```text
INACTIVE DRAFT ── edit freely ── activate before window opens ──► ACTIVE / FROZEN
                                                              │
                                 authoritative events occur ──┤
                                 feed arrives later ───────────┤
                                                              ▼
                                                       SETTLED / ARCHIVED
                                                              │
                                           next draft may activate next window
```

“Active” is a **server-recorded commitment**, not a local toggle. Store the card's exact cells, rules version, window ID, server submission time, and immutable activation time. A unique `(user, window)` ranked-entry constraint and an idempotent activation request prevent duplicate entries. The client should display the server's committed state and deadline.

## Why late data does not reopen the card

The game must distinguish **event time** from **ingestion time**:

| Time | Meaning | Used for |
|---|---|---|
| `activation_at` | Server accepted the frozen card | Proof of commitment |
| `window_start` / `window_end` | Prepublished eligible outcome interval | Whether an occurrence can score |
| `occurred_at` or `published_at` | Authoritative real-world event timestamp | Whether the event happened within the interval |
| `ingested_at` | Our scraper/database learned the result | Operational freshness only |
| `settled_at` | Our scoring calculation finalized | Display and audit |

A match can finish at 19:00 and be ingested at 19:40. It still scores if it belongs to the card's frozen eligible-match set. A match that starts near the end of the week can finish after the window closes and still count; its **eligible start**, rather than every in-game moment, determines its window. Ingestion at 19:40 never becomes a new opportunity to edit at 19:20. The backend already locks match-bound bingo cells by scheduled start, while waiting for complete final stats before scoring; the active-card design moves the lock to the entire card and window. See [`bingoSlate.js`](../apps/call/src/lib/bingoSlate.js).

The feed currently polls via a 30-minute GitHub schedule, with a 15-minute Worker dispatch trigger; the workflow explicitly notes possible delays. Final match stats are accepted only when complete. This makes the separation between lock time and settlement time essential. See [`.github/workflows/feed.yml`](../.github/workflows/feed.yml), [`apps/call/wrangler.jsonc`](../apps/call/wrangler.jsonc), and [`worker/feed/validate.js`](../worker/feed/validate.js).

## Match-event squares first

Start with squares about events in a **predeclared set of eligible matches**, without binding each square to a single match. A square might be “An ace occurs in any eligible match” or “At least two eligible matches go to map three.” The complete eligible match list must be snapshotted before activation or governed by a published deterministic rule. Otherwise a late-added match quietly changes a card's odds after players commit.

The present per-series probabilities and 1–6 point values cannot be copied unchanged. “An ace in any of six matches” is far likelier than “An ace in one match.” Recalculate rates and points from historical **windows with the same exposure** (number, format, and type of matches), or use a fixed number of eligible matches per window. Preserve the current correlation check for overlapping events; line bonuses can magnify a group of squares that all follow one match.

For schedule changes, publish the rule in advance. A sensible first rule is: a postponed match outside the window is **void for this card**, and an eligible match added after activation does **not** enter the card's scope. Void squares should have a clear scoring rule so a feed outage or schedule shift cannot create a surprise bonus.

## Transfers and contracts: a later card family

Transfers and contract outcomes can use the same active/inactive lifecycle, but they need a different resolution source and window. A transfer may become public at an unscheduled time, while the scraper may discover it later. Count an outcome only when its **first authoritative public announcement** occurred after the window opened and before it closed. Store the source URL, publication timestamp, retrieval timestamp, and the exact criterion. If the announcement time cannot be verified, mark the square unresolved or void; do not infer occurrence from the database update time.

Avoid a square whose answer is already mechanically known at activation, such as “Player X's contract reaches its listed end date.” A useful prediction is instead “Player X signs an extension by [date]” or “Team Y announces a new player during this window,” with a precise definition of what announcement counts. Rumors remain information players may use, but an already official announcement cannot be counted merely because OpVAL has not ingested it.

The repository has schema placeholders for transfers and contract end dates, but the feed currently returns **501** for transfer/contract ingest kinds. Match-event bingo is therefore implementable with the existing result pipeline; ranked transfer/contract bingo needs a trustworthy ingest and audit trail first. See [`migrations/0002_feed.sql`](../migrations/0002_feed.sql) and [`worker/feed/routes.js`](../worker/feed/routes.js).

Keep **Match Bingo** and **Roster Bingo** as separate card families/leaderboards initially. Their number of opportunities and settlement delays differ, so one mixed score would be hard to calibrate fairly. They can share the visual card language and activation rules.

## Server decision rules

1. On activation, use server time and a prepublished window ID; reject a late request for the current window.
2. Atomically accept at most one ranked card for `(user, window)`. Store an immutable snapshot and rules version. Draft edits never mutate that snapshot.
3. Accept activation only for future outcomes: match scope is fixed ahead of the window; transfer/contract occurrences require an authoritative `published_at` after `window_start`.
4. Resolve only from authoritative source records. If a result arrives late, settle it late without changing the lock.
5. Freeze or void ambiguous source corrections under a documented rule. Keep an audit record so a revised result can be explained.
6. Let users prepare future inactive drafts while one card is active, but do not let them switch the active card within its window.

The current paid-card flow saves on the server before credits are deducted in client state. Dropping the paid-slot mechanic removes that particular mismatch. Any future paid competitive feature would need a single server transaction for commitment and payment.

## Reference pattern

[Metaculus's question lifecycle](https://www.metaculus.com/faq/) separates a **close date**, after which forecasts cannot be updated, from a **resolution date**, when the answer is known. Its guidance also addresses outcomes that become known before a scheduled close. OpVAL should use the same separation: close/activate from a server clock before the outcome window, then settle whenever reliable data arrives. This is a design analogy, not a claim that Metaculus uses bingo cards or the same scoring rules.
