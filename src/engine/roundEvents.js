export const DEFAULT_ROUND_DELAY = 150;

export function describeRound(rounds, index) {
  if (!Array.isArray(rounds) || index < 0 || index >= rounds.length) return null;

  const played = rounds.slice(0, index + 1);
  const winner = played[index];
  const a = played.filter(result => result === 'A').length;
  const b = played.length - a;

  let streak = 1;
  for (let cursor = index - 1; cursor >= 0 && rounds[cursor] === winner; cursor -= 1) streak += 1;

  let previousStreak = 0;
  if (index > 0 && rounds[index - 1] !== winner) {
    const previousWinner = rounds[index - 1];
    for (let cursor = index - 1; cursor >= 0 && rounds[cursor] === previousWinner; cursor -= 1) previousStreak += 1;
  }

  const mapIsOver = (a >= 13 || b >= 13) && (Math.abs(a - b) >= 2 || a >= 19 || b >= 19);
  // A side is one round from ending the map either by reaching 13 with a
  // 2-round lead, or by hitting the 19-round hard cap regardless of margin
  // (simMap breaks the loop at 19 even at a one-round lead, e.g. 19-18).
  const nextRoundCanEndMap = !mapIsOver && (
    (a >= 12 && (a > b || a >= 18)) ||
    (b >= 12 && (b > a || b >= 18))
  );

  return {
    round: index + 1,
    winner,
    a,
    b,
    isMatchPoint: nextRoundCanEndMap,
    isMapPoint: mapIsOver,
    isOvertime: index + 1 > 24,
    streak,
    isStreakBreak: previousStreak >= 3,
  };
}

export function roundPacing(desc, opts = {}) {
  const base = Number.isFinite(opts.defaultDelay) ? opts.defaultDelay : DEFAULT_ROUND_DELAY;
  if (!desc) return base;
  if (typeof opts.delayFor === 'function') return opts.delayFor(desc, base);
  return base;
}

export function roundSignificance(desc) {
  return desc && (desc.isMatchPoint || desc.isMapPoint || desc.isOvertime || desc.isStreakBreak)
    ? 'significant'
    : 'normal';
}
