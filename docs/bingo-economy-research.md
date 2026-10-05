# OpVAL bingo economy: research and recommendation

5 October 2026 · Research note · No game rules changed

## Updated direction

The follow-up design discussion replaces the practice-card proposal with **one active card and editable inactive drafts**. The active card freezes before its outcome window begins. See [`bingo-active-card-design.md`](bingo-active-card-design.md) for the proposed lifecycle and delayed-feed lock rule. This is a design proposal; no game rules have changed.

## What the game actually does today

| Mechanic | Current rule | Source |
|---|---|---|
| Card size | 2 × 2: four picked squares | [`bingoCard.js`](../apps/call/src/lib/bingoCard.js) |
| Square values | 1–6 points, based on historical series hit rate | [`bingoSquares.js`](../apps/call/src/lib/bingoSquares.js) |
| Line bonus | Each completed pair scores the hit values again, with same-match/cluster deduplication | [`bingoCard.js`](../apps/call/src/lib/bingoCard.js) |
| Blackout bonus | If all four cells hit or are void/free, add the hit-cell total again | [`bingoCard.js`](../apps/call/src/lib/bingoCard.js) |
| Daily cards | First free, up to four more at 100 credits each | [`rules.js`](../src/engine/collect/rules.js) |
| Daily leaderboard | Uses each player's **best** card; other card scores are discarded for ranking | [`bingo.js`](../apps/call/worker/bingo.js) |
| Credit source | Match calls and tracked-player scores; one credit per point in that separate mode | [`game.js`](../src/engine/collect/game.js), [`rules.js`](../src/engine/collect/rules.js) |
| Bingo payout | Bingo points are **not converted into credits** | [`bingo.js`](../apps/call/worker/bingo.js), [`game.js`](../src/engine/collect/game.js) |
| Other credit uses | A pack costs 500; paid tracked-player swaps start at 50 and rise by tier | [`rules.js`](../src/engine/collect/rules.js) |

The phrase “4–7 points per card” understates the possible card score: the displayed small number is **per square**, and a card can earn multiple line and blackout bonuses. For example, four 2-point hits on four different matches score **40**: 8 from cells, 24 from six completed pairs, and 8 from blackout. The mathematical ceiling is **120** if four 6-point squares on distinct matches all hit. Neither score returns any credits under the current rules.

The bigger problem is therefore not a simple 100-credit-to-7-point exchange rate. The credits buy another chance at the **best-of-five leaderboard**, with no direct return and with a competing use in packs or swaps. A user cannot infer that trade from the card UI.

## Expected score and marginal attempt value

As a transparent illustration, fill four cells with “Map ends 13–5 or worse” (`stomp8`) on four different best-of-three matches. The code estimates a **58%** series hit rate and awards **2 points** per hit. Assuming those matches are independent and the historical rate remains valid:

| Number of hits | Card score | Approximate probability |
|---:|---:|---:|
| 0 | 0 | 3.1% |
| 1 | 2 | 17.2% |
| 2 | 8 | 35.6% |
| 3 | 18 | 32.8% |
| 4 | 40 | 11.3% |

Expected card score in this particular model is **13.62**. This is an illustration, not a prediction for a real slate: four eligible matches may not exist, match outcomes can correlate, best-of-one and best-of-five rates differ, and the rate estimates came from only about 100 historical best-of-three finals. A useful production balance study should replay real slates with the actual card choices and full scoring code.

The *marginal* value of buying a card is not its expected score. It is the improvement in **the maximum of all cards owned**. If a card independently has a 10% chance of crossing a target score, one card gives a 10% chance and five give `1 − 0.9^5 = 40.95%`. Real cards share match outcomes, so this formula is an illustration rather than a measured OpVAL advantage. Even with correlation, an extra distinct card cannot lower a player's best-card score and can increase it. The 100-credit price gates that advantage by wealth accumulated in another mode.

## Game theory and economy implications

1. **Contest incentives differ from average-score incentives.** Because only the best card ranks, a rational player can diversify into long-shot cards to maximize the chance of a standout result. A higher number of entries lets wealthier players cover more scenarios. Research on forecasting competitions shows that winner-take-all ranking changes strategy compared with simply maximizing expected score. This is an analogy; OpVAL asks for event picks, not full probability forecasts. [Witkowski et al., *Incentive-Compatible Forecasting Competitions* (2022)](https://pubsonline.informs.org/doi/10.1287/mnsc.2022.4410).
2. **A points formula is not a credit exchange rate.** The current `round(-2 log2(seriesRate))` rewards surprise when a square hits. It is not a proper scoring rule for eliciting calibrated probabilities because players choose yes-only events and never report a probability or incur a miss penalty. Do not use that formula alone to set a card price. Proper scoring rules are useful if a future mode asks players to report probabilities. [Gneiting and Raftery, *Strictly Proper Scoring Rules, Prediction, and Estimation* (2007)](https://doi.org/10.1198/016214506000001437).
3. **A currency sink still needs a player-valued purchase.** Credits are earned through calls/tracked players and removed by packs, swaps, and extra bingo cards. A 100-credit bingo card is one fifth of a pack, but has no credit payback and an opaque competitive payoff. Virtual-economy research treats sinks as deliberate interventions whose effects need measurement, not as automatically beneficial drains. [*Market Interventions in a Large-Scale Virtual Economy* (2022)](https://arxiv.org/abs/2210.07970).
4. **Competition fairness is more visible than price precision.** Lowering 100 to 10 credits would reduce friction but would still sell extra ranked attempts. Raising bingo payouts enough to make a 100-credit card feel self-funding risks creating a new credit faucet, especially if paid attempts can also earn the payout. Equal ranked-entry counts solve the main contest issue directly.

## Options

| Option | Effect | Trade-off |
|---|---|---|
| A. One free ranked card; free practice cards | Equal ranked attempts, simple messaging, no bingo credit gamble | Superseded by the active/inactive card proposal |
| B. Five free ranked cards for everyone | Equal access to the current best-of-five game | More filling work per day; best-of-five favors hedging over a single considered card |
| C. Keep paid ranked cards but lower the price | Less expensive participation | Still sells leaderboard advantage; no principled price without observed player value |
| D. Pay credits for bingo scores and retain paid cards | Creates an explicit return loop | Requires payout and inflation modeling, abuse-resistant accounting, and a clear policy on whether paid cards can earn credits |

## Implementation implications for a single ranked card

- Enforce one ranked entry per player per outcome window in the server. The active/inactive lifecycle replaces the paid-slot rule; inactive drafts never score.
- Remove the paid-card cost and client-side credit deduction if the active-card design is adopted.
- Preserve already saved cards. A rule change should state how historical days are displayed; apply the new leaderboard rule from a published effective UTC date rather than silently rewriting past standings.
- If credits remain a meaningful server-side economy, move purchases into an atomic server transaction before introducing any new paid competitive feature. Right now the bingo card is saved on the server first and the credits are deducted from client save afterward; the server does not verify payment. That is a separate integrity gap, not a pricing issue.

## Measurement before and after release

For each slate, measure: eligible match count and format, number of players with a saved card, number of cards per player, score distribution for slot 1 versus best of up to five, incremental rank gained by slots 2–5, card completion time, and fraction of cards with all results resolved rather than void. Segment by new/returning player and by number of available matches. For the credit economy, measure credits earned per active player, credits spent by category, and median days needed to earn a pack. Do not tune a new bingo price from square values alone.

### References

- [Witkowski et al., *Incentive-Compatible Forecasting Competitions*, Management Science (2022)](https://pubsonline.informs.org/doi/10.1287/mnsc.2022.4410) — ranking changes forecaster incentives.
- [Gneiting and Raftery, *Strictly Proper Scoring Rules, Prediction, and Estimation*, JASA (2007)](https://doi.org/10.1198/016214506000001437) — formal distinction between prediction scoring and calibrated probability scoring.
- [Market Interventions in a Large-Scale Virtual Economy (2022)](https://arxiv.org/abs/2210.07970) — empirical study of sinks and economic intervention in Old School RuneScape.
