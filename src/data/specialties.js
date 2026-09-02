// Player specialties - up to five per card, though only three exist today.
// A specialty is a signature trait that grants a situational bonus in the sim.
// Assignments are curated from VLR player reputations; One Trick additionally
// picks up any player whose synced agent pool is a single agent.

export const SPECIALTIES = {
  flex: {
    key: 'flex',
    name: 'Flex',
    short: 'Fills an extra role',
    desc: 'Counts as one additional role class for coverage. No role-stacking chemistry penalty.',
  },
  flick: {
    key: 'flick',
    name: 'Flick',
    short: 'Aim over positioning',
    desc: 'Bonus aim when dueling opponents who out-position them. Raw reactions beat setup.',
  },
  one_trick: {
    key: 'one_trick',
    name: 'One Trick',
    short: 'Single-agent master',
    desc: 'Mastered a single agent. Bonus ability and synergy when no teammate shares that agent pool.',
  },
  mastermind: {
    key: 'mastermind',
    name: 'Mastermind',
    short: 'Elevates as IGL',
    desc: 'When named IGL, a mid-round read spikes their positioning and mentality by +2 to +10.',
  },
  aura: {
    key: 'aura',
    name: 'Aura',
    short: 'Rattles opponents',
    desc: 'Sheer presence drags down the opposing squad’s mentality every map.',
  },
};

export const SPECIALTY_ORDER = ['flex', 'flick', 'one_trick', 'mastermind', 'aura'];

// Curated from VLR player reputations. Keys are lowercased player names; the
// card's synced agent pool decides One Trick on top of this.
const ASSIGN = {
  // Flex - genuine multi-role players
  f0rsaken: ['flex', 'flick'],
  chronicle: ['flex'],
  nats: ['flex'],
  sacy: ['flex'],
  d4v41: ['flex'],
  ethan: ['flex'],
  victor: ['flex', 'flick'],
  leo: ['flex'],
  trent: ['flex'],
  // Flick - flick-heavy aimers who thrive against set opponents
  something: ['flick'],
  aspas: ['flick'],
  derke: ['flick'],
  zekken: ['flick', 'flex'],
  tenz: ['flick'],
  yay: ['flick'],
  scream: ['flick'],
  cned: ['flick'],
  wardell: ['flick'],
  cryocells: ['flick'],
  sayaplayer: ['flick'],
  purp0: ['flick'],
  zmjjkk: ['flick', 'aura'],
  mazino: ['flick'],
  // One Trick - single-agent masters
  jinggg: ['one_trick', 'flick'],
  kingg: ['one_trick'],
  // Mastermind - elite in-game leaders
  boaster: ['mastermind'],
  fns: ['mastermind'],
  saadhak: ['mastermind'],
  runner: ['mastermind'],
  sscary: ['mastermind'],
  // Aura - presence that rattles the other side
  koalanoob: ['aura'],
};

// Up to five specialty objects for a card, in canonical order.
export function getCardSpecialties(card) {
  if (!card) return [];
  const keys = new Set(
    Array.isArray(card.specialties) && card.specialties.length
      ? card.specialties
      : ASSIGN[card.player?.toLowerCase()] ?? [],
  );
  // Data-driven: a single-agent pool (from the VLR sync) is a One Trick.
  if ((card.agents?.length ?? 0) === 1) keys.add('one_trick');

  return SPECIALTY_ORDER
    .filter(k => keys.has(k))
    .slice(0, 5)
    .map(k => SPECIALTIES[k]);
}
