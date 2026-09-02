import { getCardSpecialties } from '../data/specialties.js';

const COPY = {
  flick: { label: '+1.2 DUEL POWER', detail: 'FLICK' },
  aura: { label: '+1.0 PRESSURE', detail: 'AURA' },
  mastermind: { label: 'MID-ROUND READ', detail: 'MASTERMIND' },
};

function average(roster, key) {
  if (!roster?.length) return 0;
  return roster.reduce((sum, card) => sum + (card.stats?.[key] ?? 0), 0) / roster.length;
}

// Presentation-only trace of the same three traits used by
// specialtyDuelBonus(). It exposes no new roll and changes no simulation
// input; it merely tells the match UI which cards are contributing to the
// already-computed map probability.
export function activeDuelSpecialties(roster, opponent, iglId, side) {
  const outPositioned = average(opponent, 'positioning') > average(roster, 'positioning');
  const triggers = [];

  for (const card of roster ?? []) {
    for (const specialty of getCardSpecialties(card)) {
      const active = specialty.key === 'aura'
        || (specialty.key === 'flick' && outPositioned)
        || (specialty.key === 'mastermind' && card.id === iglId);
      if (!active || !COPY[specialty.key]) continue;
      triggers.push({
        cardId: card.id,
        player: card.player,
        side,
        specialty: specialty.key,
        ...COPY[specialty.key],
      });
    }
  }

  return triggers;
}

export function buildRoundCascade({ rosterA, rosterB, iglA, iglB, winner }) {
  const sideA = activeDuelSpecialties(rosterA, rosterB, iglA, 'A');
  const sideB = activeDuelSpecialties(rosterB, rosterA, iglB, 'B');
  return winner === 'B' ? [...sideB, ...sideA] : [...sideA, ...sideB];
}
