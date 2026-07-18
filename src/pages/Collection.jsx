import { useDeferredValue, useState } from 'react';
import { flushSync } from 'react-dom';
import PlayerCard from '../components/PlayerCard';
import CardFocusOverlay from '../components/CardFocusOverlay';
import NavHeader from '../components/NavHeader';
import allCards from '../data/cards.json';
import { countryName } from '../lib/utils';
import styles from './Collection.module.css';

const TIER_ORDER = ['bronze', 'silver', 'gold', 'icon', 'legendary', 'prestige', 'iconic'];

// Filter options derived from the data so new tiers, regions, or roles show up
// automatically after a re-sync.
const TIERS = ['All', ...TIER_ORDER.filter(t => allCards.some(c => c.tier === t))];
const REGIONS = ['All', ...new Set(allCards.map(c => c.region))];
const ROLES = ['All', ...new Set(allCards.map(c => c.role))];
const LEAGUES = ['All', 'VCT', 'Challengers', 'Icons'];
const LEAGUE_KEY = { VCT: 'vct', Challengers: 't2', Icons: 'icon' };

// Accent-fold so "leviatan" finds LEVIATÁN and "kru" finds KRÜ
const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Precomputed haystack per card: name, tag, full org name, country
const SEARCH_TEXT = new Map(allCards.map(c => [
  c.id,
  fold(`${c.player} ${c.org} ${c.org_name ?? ''} ${countryName(c.nationality)}`),
]));

export default function Collection() {
  const [tierFilter, setTierFilter] = useState('All');
  const [regionFilter, setRegionFilter] = useState('All');
  const [roleFilter, setRoleFilter] = useState('All');
  const [leagueFilter, setLeagueFilter] = useState('All');
  const [query, setQuery] = useState('');
  const [focusedCard, setFocusedCard] = useState(null);

  // keep typing snappy while hundreds of cards re-render
  const deferredQuery = fold(useDeferredValue(query).trim());

  // Shared-element morph: the grid card itself flies to the center overlay
  // (and back on close) via the View Transitions API. The grid slot is tagged
  // `focused-card` on the side of the transition where the overlay is absent,
  // the overlay carries the same name on the other side, and the browser
  // interpolates between the two rects. Falls back to a plain state change.
  const morphTo = (nextCard, slotId) => {
    const slot = document.getElementById(slotId);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!document.startViewTransition || !slot || reduced) {
      setFocusedCard(nextCard);
      return;
    }
    const opening = nextCard !== null;
    if (opening) slot.style.viewTransitionName = 'focused-card';
    const transition = document.startViewTransition(() => {
      flushSync(() => setFocusedCard(nextCard));
      slot.style.viewTransitionName = opening ? '' : 'focused-card';
    });
    transition.finished.finally(() => {
      slot.style.viewTransitionName = '';
    });
  };

  const openCard = (card) => morphTo(card, `card-slot-${card.id}`);
  const closeCard = () => focusedCard && morphTo(null, `card-slot-${focusedCard.id}`);

  const filtered = allCards.filter((card) => {
    if (tierFilter !== 'All' && card.tier !== tierFilter) return false;
    if (regionFilter !== 'All' && card.region !== regionFilter) return false;
    if (roleFilter !== 'All' && card.role !== roleFilter) return false;
    if (leagueFilter !== 'All') {
      const league = card.league ?? 'vct';
      if (league !== LEAGUE_KEY[leagueFilter]) return false;
    }
    if (deferredQuery && !SEARCH_TEXT.get(card.id).includes(deferredQuery)) return false;
    return true;
  });

  return (
    <div className={styles.page}>
      <NavHeader right={`${filtered.length} players`} />

      <div className={styles.controls}>
        <input
          type="search"
          className={styles.search}
          placeholder="Search players, teams, countries"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search players"
        />
        <FilterGroup label="Tier" options={TIERS} value={tierFilter} onChange={setTierFilter} />
        <FilterGroup label="Region" options={REGIONS} value={regionFilter} onChange={setRegionFilter} />
        <FilterGroup label="Role" options={ROLES} value={roleFilter} onChange={setRoleFilter} />
        <FilterGroup label="League" options={LEAGUES} value={leagueFilter} onChange={setLeagueFilter} />
      </div>

      <main className={styles.grid}>
        {filtered.length === 0 ? (
          <p className={styles.empty}>No players match. Try a different search or filter.</p>
        ) : (
          filtered.map((card) => (
            <div
              key={card.id}
              id={`card-slot-${card.id}`}
              style={{ visibility: focusedCard?.id === card.id ? 'hidden' : 'visible' }}
            >
              <PlayerCard card={card} onClick={() => openCard(card)} />
            </div>
          ))
        )}
      </main>

      <CardFocusOverlay card={focusedCard} onClose={closeCard} />
    </div>
  );
}

function FilterGroup({ label, options, value, onChange }) {
  return (
    <div className={styles.filterGroup}>
      <span className={styles.filterLabel}>{label}</span>
      <div className={styles.filterChips}>
        {options.map((opt) => (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            className={[styles.chip, value === opt ? styles.chipActive : ''].join(' ')}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}
