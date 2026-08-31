// Backdrop imagery for the immersive match view, grouped by tournament kind
// (see the `kind` field on season entries in src/engine/perfectRun.js:
// 'masters' | 'champions' | 'enc') so bigger events can show their own art.
// `crowd` is generic filler with no event-specific branding, eligible for
// every kind, including ones with no dedicated pool yet.
//
// Add files to public/assets/backdrops/ and list their public path (e.g.
// '/assets/backdrops/masters-01.jpg') in the matching array below. Every
// category is independently empty-safe: MatchBackdrop renders scrim-only
// with no image if a category, or the whole manifest, is empty.
const backdrops = {
  masters: ['/assets/backdrops/Valorant_Masters.webp'],
  champions: ['/assets/backdrops/Valorant_Champions.webp'],
  crowd: ['/assets/backdrops/Valorant_Crowd.jpg'],
};

export default backdrops;
