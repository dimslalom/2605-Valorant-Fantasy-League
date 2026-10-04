// Bingo square pool. `rate` = share of finished maps (or Bo3 series, scope 'match') that hit it,
// measured on 257 maps / 104 matches across 7 events (Oct 2026). Re-measure as the feed grows.
// Cards bind a square to a whole series, so it hits if ANY map of the match does: `seriesRate` is that
// share of Bo3 finals (100 matches, 2.4 maps each) and drives points = -2*log2(seriesRate), min 1:
// 80% pays 1, 50% pays 2, 25% pays 4, 12% pays 6.
//
// Clusters are squares that hit and miss together (measured lift/phi). A line may hold at most one
// square per cluster, or one close map lights the whole line. 'chaos' and 'agent' squares are close
// to independent of each other, so they are the free-choice squares; 'close' and 'stomp' never
// co-occur (0 shared maps), so mixing them in one card is the hedge.
//
// `bestOf` limits a square to series of that length (map 3 is only a coin flip in a Bo3: it is free in a Bo5
// and impossible in a Bo1). Series rates are measured on Bo3 finals, so Bo1 and Bo5 pay a little off.
//
// Map record = feed_maps columns + `players` = feed_player_maps rows (k, d, acs, fk, mk5, cl3.., side, agent).
// side 1 = team1. Dropped on purpose: any 3k/4k (82-98%), 1v2 clutch (67%), 40%+ HS (77%), 1v5 (0.4%),
// and "exactly a 2-round win" (identical to 24+ rounds).

const top = (m, key) => m.players.reduce((a, p) => (p[key] > a[key] ? p : a), m.players[0]);
const max = (m, f) => Math.max(...m.players.map(f));
const topAgentIn = roles => m => roles.includes(top(m, 'acs')?.agent);
const rounds = m => m.score1 + m.score2;
const gap = m => Math.abs(m.score1 - m.score2);

const DUELISTS = ['jett', 'raze', 'neon', 'yoru', 'phoenix', 'reyna', 'iso', 'waylay'];
const CONTROLLERS = ['omen', 'viper', 'astra', 'brimstone', 'harbor', 'clove'];
const INITIATORS = ['sova', 'fade', 'skye', 'breach', 'kayo', 'gekko', 'tejo'];
const SENTINELS = ['cypher', 'killjoy', 'sage', 'chamber', 'deadlock', 'vyse'];

const SERIES_RATE = {ot: 0.16, long24: 0.45, k25: 0.48, map3: 0.42, stomp8: 0.58, short20: 0.77, plus15: 0.26, acs350: 0.27, k30: 0.12, two20k: 0.71, mvpLoser: 0.49, ace: 0.41, c3: 0.49, c4: 0.15, minus12: 0.28, fk6: 0.67, fk8: 0.21, duelistTop: 0.82, controllerTop: 0.43, initiatorTop: 0.28, sentinelTop: 0.24, yoruTop: 0.28, def9: 0.36, atk9: 0.34};

const SQUARES = [
  // close: tight maps, overtime, long games
  { id: 'ot',        cluster: 'close', rate: 0.066, label: 'Map goes to overtime',            test: m => rounds(m) >= 25 },
  { id: 'long24',    cluster: 'close', rate: 0.214, label: 'Map lasts 24+ rounds',            test: m => rounds(m) >= 24 },
  { id: 'k25',       cluster: 'close', rate: 0.253, label: 'Someone drops 25+ kills',         test: m => max(m, p => p.k) >= 25 },
  { id: 'map3',      cluster: 'close', rate: 0.42,  label: 'Series goes to map 3', scope: 'match', bestOf: 3, test: s => s.maps.length >= 3 },

  // stomp: lopsided, short maps
  { id: 'stomp8',    cluster: 'stomp', rate: 0.272, label: 'Map ends 13-5 or worse',          test: m => gap(m) >= 8 },
  { id: 'short20',   cluster: 'stomp', rate: 0.459, label: 'Map over in 20 rounds or fewer',  test: m => rounds(m) <= 20 },
  { id: 'plus15',    cluster: 'stomp', rate: 0.125, label: 'Someone finishes +15 K/D',        test: m => max(m, p => p.k - p.d) >= 15 },

  // star: one player carries
  { id: 'acs350',    cluster: 'star',  rate: 0.121, label: 'Someone posts 350+ ACS',          test: m => max(m, p => p.acs) >= 350 },
  { id: 'k30',       cluster: 'star',  rate: 0.054, label: 'Someone drops 30+ kills',         test: m => max(m, p => p.k) >= 30 },
  { id: 'two20k',    cluster: 'star',  rate: 0.412, label: 'Two players hit 20+ kills',       test: m => m.players.filter(p => p.k >= 20).length >= 2 },
  { id: 'mvpLoser',  cluster: 'star',  rate: 0.253, label: 'Top ACS is on the losing team',   test: m => top(m, 'acs') != null && (top(m, 'acs').side === 1) !== (m.score1 > m.score2) },

  // chaos: roughly independent of everything else
  { id: 'ace',       cluster: 'chaos', rate: 0.195, label: 'An ace',                          test: m => max(m, p => p.mk5) > 0 },
  { id: 'c3',        cluster: 'chaos', rate: 0.226, label: 'A 1v3 or bigger clutch',         test: m => max(m, p => p.cl3 + p.cl4 + p.cl5) > 0 },
  { id: 'c4',        cluster: 'chaos', rate: 0.058, label: 'A 1v4 or bigger clutch',         test: m => max(m, p => p.cl4 + p.cl5) > 0 },
  { id: 'minus12',   cluster: 'chaos', rate: 0.132, label: 'Someone finishes -12 K/D',        test: m => max(m, p => p.d - p.k) >= 12 },
  { id: 'fk6',       cluster: 'chaos', rate: 0.374, label: 'Someone gets 6+ first kills',     test: m => max(m, p => p.fk) >= 6 },
  { id: 'fk8',       cluster: 'chaos', rate: 0.089, label: 'Someone gets 8+ first kills',     test: m => max(m, p => p.fk) >= 8 },

  // agent: who tops ACS on the map
  { id: 'duelistTop',    cluster: 'agent', rate: 0.533, label: 'A duelist tops ACS',          test: topAgentIn(DUELISTS) },
  { id: 'controllerTop', cluster: 'agent', rate: 0.21,  label: 'A controller tops ACS',       test: topAgentIn(CONTROLLERS) },
  { id: 'initiatorTop',  cluster: 'agent', rate: 0.144, label: 'An initiator tops ACS',       test: topAgentIn(INITIATORS) },
  { id: 'sentinelTop',   cluster: 'agent', rate: 0.101, label: 'A sentinel tops ACS',         test: topAgentIn(SENTINELS) },
  { id: 'yoruTop',       cluster: 'agent', rate: 0.14,  label: 'Yoru tops ACS',               test: m => top(m, 'acs')?.agent === 'yoru' },

  // side: one side runs away with a half
  { id: 'def9',      cluster: 'side',  rate: 0.175, label: 'A team wins 9+ rounds on defense', test: m => Math.max(m.t1_def, m.t2_def) >= 9 },
  { id: 'atk9',      cluster: 'side',  rate: 0.167, label: 'A team wins 9+ rounds on attack',  test: m => Math.max(m.t1_atk, m.t2_atk) >= 9 },
].map(s => ({ scope: 'map', ...s, seriesRate: SERIES_RATE[s.id], points: Math.max(1, Math.round(-2 * Math.log2(SERIES_RATE[s.id]))) }));

export default SQUARES;
export const byId = Object.fromEntries(SQUARES.map(s => [s.id, s]));
