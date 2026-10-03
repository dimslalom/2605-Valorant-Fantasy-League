import { CALL } from './rules.js';

// Scoring for one called series. `series` is a finished feed match (teams with
// tags and map scores, `winner` as 1 or 2, maps with player rows). `points` is
// Map<pid, { total }> from scoring.scoreSeries(series). Pure.

export const streakMultiplier = streak => Math.min(CALL.streakCap, 1 + CALL.streakStep * streak);

export function seriesFacts(series, points) {
  const winnerIdx = (series.winner ?? 0) - 1;
  const winnerTag = series.teams[winnerIdx]?.tag ?? null;
  const score = series.teams.map(t => t.score);
  const ranked = [...points.entries()].sort((a, b) => b[1].total - a[1].total);
  const top = ranked[0]?.[1].total;
  return {
    winnerTag,
    score,
    star: ranked.filter(([, p]) => p.total === top).map(([pid]) => pid),
    top3: ranked.slice(0, 3).map(([pid]) => pid),
  };
}

// call: { winner: teamTag, score?: [a, b] in the order of series.teams, star?: pid }
// tracked: array of pids; teamOf: pid -> team tag; streak: consecutive rights before this call.
export function resolveCall(call, series, points, { tracked, teamOf, streak = 0 }) {
  const facts = seriesFacts(series, points);
  const lines = { winner: 0, exactScore: 0, star: 0, backing: 0, againstGrain: 0 };
  const winnerRight = call.winner != null && call.winner === facts.winnerTag;

  if (winnerRight) {
    lines.winner = CALL.winner;
    if (Array.isArray(call.score) && call.score[0] === facts.score[0] && call.score[1] === facts.score[1]) lines.exactScore = CALL.exactScore;
    const mine = tracked.filter(pid => teamOf(pid) === call.winner).length;
    lines.backing = Math.min(CALL.backingCap, mine * CALL.backing);
    const other = series.teams.map(t => t.tag).find(tag => tag !== call.winner);
    if (tracked.some(pid => teamOf(pid) === other)) lines.againstGrain = CALL.againstGrain;
  }
  // Naming the star pays even if the winner was wrong: it is a separate read.
  if (call.star != null) {
    if (facts.star.includes(call.star)) lines.star = CALL.star;
    else if (facts.top3.includes(call.star)) lines.star = CALL.starTop3;
  }

  const multiplier = winnerRight ? streakMultiplier(streak) : 1;
  const base = Object.values(lines).reduce((a, b) => a + b, 0);
  const total = Math.round(base * multiplier);
  return {
    winnerRight,
    scoreRight: lines.exactScore > 0,
    starRight: lines.star === CALL.star,
    lines,
    multiplier,
    total,
    facts,
  };
}
