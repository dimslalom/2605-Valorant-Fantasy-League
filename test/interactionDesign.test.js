import test from 'node:test';
import assert from 'node:assert/strict';
import { seededRestAngle } from '../src/lib/cardPhysics.js';
import { activeDuelSpecialties, buildRoundCascade } from '../src/lib/matchCascade.js';

function card(id, player, specialties, positioning = 70) {
  return {
    id,
    player,
    specialties,
    agents: ['jett', 'raze'],
    stats: { aim: 75, positioning, ability: 75, mentality: 75, synergy: 75 },
  };
}

test('resting card jitter is deterministic and stays inside the authored range', () => {
  const first = Number(seededRestAngle('player-17'));
  assert.equal(first, Number(seededRestAngle('player-17')));
  assert.ok(Math.abs(first) >= 1.2 && Math.abs(first) <= 2);
  assert.notEqual(seededRestAngle('player-17'), seededRestAngle('player-18'));
});

test('the match cascade mirrors only active duel specialties', () => {
  const roster = [
    card('igl', 'Caller', ['mastermind'], 60),
    card('flick', 'Aimer', ['flick'], 60),
    card('aura', 'Star', ['aura'], 60),
    card('bench-caller', 'Second Caller', ['mastermind'], 60),
  ];
  const opponent = [card('opp', 'Opponent', [], 90)];
  const triggers = activeDuelSpecialties(roster, opponent, 'igl', 'A');

  assert.deepEqual(triggers.map(item => item.specialty), ['mastermind', 'flick', 'aura']);
  assert.ok(triggers.every(item => item.side === 'A'));
});

test('round cascade presents the winning side first without changing either trace', () => {
  const rosterA = [card('a', 'Aura A', ['aura'])];
  const rosterB = [card('b', 'Aura B', ['aura'])];
  const cascade = buildRoundCascade({ rosterA, rosterB, iglA: null, iglB: null, winner: 'B' });
  assert.deepEqual(cascade.map(item => item.side), ['B', 'A']);
});
