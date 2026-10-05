// An inextensible cylindrical bend: arc length stays constant as the edge curls.
// x is in card-width units (-.5.. .5); side selects the edge being lifted.
export function curlPoint(x, progress, side = 1) {
  const p = Math.max(0, Math.min(1, progress));
  const start = 0.5 - 0.56 * p;
  const distance = x * side - start;
  if (p < 0.0001 || distance <= 0) return [x, 0];
  const radius = (0.56 * p) / (p * 3.05);
  const angle = distance / radius;
  return [side * (start + radius * Math.sin(angle)), radius * (1 - Math.cos(angle))];
}

export function peekDrag(dx, dy, width) {
  const moved = Math.hypot(dx, dy) > 6;
  return { moved, progress: Math.min(1, Math.abs(dx) / Math.max(1, width * 0.52)), side: dx < 0 ? 1 : -1 };
}
