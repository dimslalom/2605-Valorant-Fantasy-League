// Pure sizing math for SquadSheet's hover/tap card preview, split out of the
// JSX component so it's importable from a plain node:test file (no JSX
// loader is configured for `npm test`) - same split as usePeekKey.js's
// isTypingTarget export.
const SHEET_RESERVE_DESKTOP = 300 + 132 + 90; // band + bottom pad + prompt/stats
const SHEET_RESERVE_MOBILE = 190 + 112 + 90;
const PREVIEW_MIN_SCALE = 0.28;
const PREVIEW_MAX_SCALE = 0.46;
const CARD_NATIVE_H = 580;

export function previewScale(viewportHeight, mobile) {
  const reserve = mobile ? SHEET_RESERVE_MOBILE : SHEET_RESERVE_DESKTOP;
  const available = viewportHeight - reserve;
  if (available <= 0) return 0;
  return Math.min(PREVIEW_MAX_SCALE, Math.max(PREVIEW_MIN_SCALE, available / CARD_NATIVE_H));
}
