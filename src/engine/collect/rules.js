// Collect-and-call rules. One place so numbers are tuned in one edit.
// No real money, no wagering: credits are only earned by playing, calls score
// points and never cost anything, and nothing is ever lost on a wrong call.
export const TRACKED_MAX = 10;

export const CALL = {
  winner: 10,          // the right team won
  exactScore: 10,      // ...and you had the exact map score (e.g. 2-1)
  star: 15,            // the player you named scored the most in the series
  starTop3: 5,         // ...or finished in the series' top three
  backing: 2,          // per Tracked player on the team you called, when you are right
  backingCap: 10,
  againstGrain: 5,     // right while Tracking players on the OTHER team (a hedge pays a little)
  streakStep: 0.1,     // multiplier +10% per consecutive right winner call
  streakCap: 1.5,
};

export const ECONOMY = {
  creditsPerPoint: 1,
  packCost: 500,
  packSize: 5,
  swapBase: 50,
  swapByTier: { bronze: 0, silver: 50, gold: 150, icon: 300 },
  duplicateRefund: 100,
  freeStarterPacks: 2,
  starterCards: 10,
};

// Bingo: one card a day is free, extras cost credits, and the cap keeps a day's cards bounded.
export const BINGO = { freeCards: 1, cardCost: 100, maxCards: 5 };

// Pack odds by card tier (a gold card is about 13% of the pool, so this is generous).
export const PACK_ODDS = { gold: 0.14, silver: 0.38, bronze: 0.48 };

// Starter collection: a fixed mix so everyone starts with a real chance.
export const STARTER_MIX = { gold: 2, silver: 4, bronze: 4 };
