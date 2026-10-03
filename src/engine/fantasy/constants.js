// Fantasy scoring rules. One place, so a rule change is a one-line edit and the
// reveal screen can show exactly which lines produced a total.
export { SCORING } from '../shared/scoringRules.js';

// Role class per agent. Fantasy role comes from the agent a player used most in
// recent maps, because the card `role` is the career-long most-played agent and
// there are only 13 Sentinels among 181 VCT cards.
export const AGENT_ROLE = {
  jett: 'duelist', raze: 'duelist', reyna: 'duelist', phoenix: 'duelist', yoru: 'duelist',
  neon: 'duelist', iso: 'duelist', waylay: 'duelist',
  sova: 'initiator', skye: 'initiator', breach: 'initiator', kayo: 'initiator', fade: 'initiator',
  gekko: 'initiator', tejo: 'initiator',
  brimstone: 'controller', omen: 'controller', viper: 'controller', astra: 'controller',
  harbor: 'controller', clove: 'controller', miks: 'controller',
  sage: 'sentinel', cypher: 'sentinel', killjoy: 'sentinel', chamber: 'sentinel',
  deadlock: 'sentinel', vyse: 'sentinel', veto: 'sentinel',
};

// Lineup: any five of your players, in any roles, plus a captain. Roles are shown on
// the card but never restrict who can start. The slot names are just positions.
export const SLOTS = ['S1', 'S2', 'S3', 'S4', 'S5'];

// Value model.
export const VALUE = {
  base: 4000,          // thousands of credits at EP 30
  scale: 9,            // EP points per e-fold
  min: 500,
  max: 20000,
  shrinkK: 4,          // weight of the prior against observed maps
  decay: 0.85,         // each older map counts 15% less
  capLive: 0.06,       // max form move per daily close
  capReplay: 0.15,     // max form move per replay step
};

// Outlook multiplies the form-based value. Changes are uncapped: news moves
// values at once, which is what makes rostermania worth watching.
export const OUTLOOK = { ACTIVE: 1, WAITING: 0.85, UNCERTAIN: 0.65, OUT: 0.35 };

export const ECONOMY = {
  managers: 8,
  dealt: 5,
  startCashFactor: 0.35,   // of the mean dealt squad value
  payoutBase: 300,         // thousands per matchday
  payoutPerPoint: 1.5,
  listingsLive: 8,
  listingsReplay: 10,
  squadMin: 5,
  squadMaxCap: 7,
};

export const MANAGER_NAMES = {
  analyst: 'Analyst', whale: 'Whale', loyalist: 'Loyalist', trader: 'Trader',
  scout: 'Scout', gambler: 'Gambler', steady: 'Steady',
};
export const PERSONALITIES = ['analyst', 'whale', 'loyalist', 'trader', 'scout', 'gambler', 'steady'];
