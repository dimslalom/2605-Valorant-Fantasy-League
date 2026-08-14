// Simple line/solid icons for the three specialties, drawn on a 20x20 grid so
// they read cleanly at any size and inherit color via currentColor.
const INNER = {
  // Flex — a two-arc cycle: adaptable, swaps into another role.
  flex: (
    <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.4 8A6 6 0 0 1 15.6 6.6" />
      <path d="M15.6 3.2v3.6H12" />
      <path d="M15.6 12A6 6 0 0 1 4.4 13.4" />
      <path d="M4.4 16.8v-3.6H8" />
    </g>
  ),
  // Flick — a crosshair reticle: pure aim.
  flick: (
    <g>
      <circle cx="10" cy="10" r="5.4" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M10 1.2v3.2M10 15.6v3.2M1.2 10h3.2M15.6 10h3.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="10" cy="10" r="1.2" fill="currentColor" />
    </g>
  ),
  // One Trick — a bolt: single-agent mastery, all-in power.
  one_trick: (
    <path d="M11.4 1.6 4.4 11h4.3l-1.3 7.4 8-9.9h-4.7z" fill="currentColor" />
  ),
  // Mastermind — a crown: the strategic leader.
  mastermind: (
    <path d="M2.6 6.4 6 9.6l4-5.8 4 5.8 3.4-3.2-1.2 9.4H3.8zM3.4 17.4h13.2" fill="currentColor" stroke="currentColor" strokeWidth="0.6" strokeLinejoin="round" />
  ),
  // Aura — radiating presence pressing outward.
  aura: (
    <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <circle cx="10" cy="10" r="1.9" fill="currentColor" stroke="none" />
      <path d="M5 14a6 6 0 0 1 0-8" />
      <path d="M15 6a6 6 0 0 1 0 8" />
      <path d="M2.6 16.4a10 10 0 0 1 0-12.8" />
      <path d="M17.4 3.6a10 10 0 0 1 0 12.8" />
    </g>
  ),
};

export default function SpecialtyIcon({ spec, size = '58%' }) {
  const inner = INNER[spec];
  if (!inner) return null;
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} style={{ display: 'block' }} aria-hidden="true">
      {inner}
    </svg>
  );
}
