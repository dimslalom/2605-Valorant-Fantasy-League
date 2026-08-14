// Geometry for the "safe triangle" hover guard (see useSafeHover). Pure math,
// no DOM — the hook feeds it client coordinates and rects.

// The two corners of `rect` with the widest angular spread as seen from `p`:
// its silhouette. `p` is outside the rect, so the spread is always under 180°
// and a plain max-difference scan is enough.
export function silhouette(rect, p) {
  const corners = [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.right, y: rect.bottom },
    { x: rect.left, y: rect.bottom },
  ];
  let best = [corners[0], corners[1]];
  let widest = -1;
  for (let i = 0; i < corners.length; i++) {
    for (let j = i + 1; j < corners.length; j++) {
      const a = Math.atan2(corners[i].y - p.y, corners[i].x - p.x);
      const b = Math.atan2(corners[j].y - p.y, corners[j].x - p.x);
      let d = Math.abs(a - b);
      if (d > Math.PI) d = 2 * Math.PI - d;
      if (d > widest) { widest = d; best = [corners[i], corners[j]]; }
    }
  }
  return best;
}

export function inTriangle(p, a, b, c) {
  const sign = (p1, p2, p3) =>
    (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
  const d1 = sign(p, a, b);
  const d2 = sign(p, b, c);
  const d3 = sign(p, c, a);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

// True while the pointer at `p` is still travelling from `exit` toward `rect`.
export function headingToward(p, exit, rect) {
  const [c1, c2] = silhouette(rect, exit);
  return inTriangle(p, exit, c1, c2);
}

export function pad(rect, n) {
  return {
    left: rect.left - n, right: rect.right + n,
    top: rect.top - n, bottom: rect.bottom + n,
  };
}

export function contains(rect, p) {
  return p.x >= rect.left && p.x <= rect.right && p.y >= rect.top && p.y <= rect.bottom;
}

// Union of DOMRect-likes, as a plain box.
export function unionRects(rects) {
  return rects.reduce((box, c) => ({
    left: Math.min(box.left, c.left),
    right: Math.max(box.right, c.right),
    top: Math.min(box.top, c.top),
    bottom: Math.max(box.bottom, c.bottom),
  }), { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity });
}
