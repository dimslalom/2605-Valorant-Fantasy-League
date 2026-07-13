import { useState } from 'react';
import { flushSync } from 'react-dom';
import { Link } from 'react-router-dom';
import PlayerCard from '../components/PlayerCard';
import CardFocusOverlay from '../components/CardFocusOverlay';
import allCards from '../data/cards.json';
import styles from './Collection.module.css';

const TIERS = ['All', 'bronze', 'silver', 'gold', 'legendary', 'prestige', 'iconic'];
const REGIONS = ['All', 'Americas', 'EMEA', 'Pacific', 'China'];
const ROLES = ['All', 'Duelist', 'Sentinel', 'Controller', 'Initiator', 'Flex'];
const LEAGUES = ['All', 'VCT', 'Challengers'];

export default function Collection() {
  const [tierFilter, setTierFilter] = useState('All');
  const [regionFilter, setRegionFilter] = useState('All');
  const [roleFilter, setRoleFilter] = useState('All');
  const [leagueFilter, setLeagueFilter] = useState('All');
  const [focusedCard, setFocusedCard] = useState(null);

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
      // cards synced before the league field existed count as VCT
      const league = card.league ?? 'vct';
      if (league !== (leagueFilter === 'VCT' ? 'vct' : 't2')) return false;
    }
    return true;
  });

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <h1 className={styles.title}>My Collection</h1>
          <Link
            to="/run"
            style={{
              color: '#ff4655',
              textDecoration: 'none',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              borderBottom: '1px solid #ff4655',
              paddingBottom: 2,
            }}
          >
            Perfect Run
          </Link>
        </div>
        <div className={styles.filters}>
          <FilterGroup label="Tier" options={TIERS} value={tierFilter} onChange={setTierFilter} />
          <FilterGroup label="Region" options={REGIONS} value={regionFilter} onChange={setRegionFilter} />
          <FilterGroup label="Role" options={ROLES} value={roleFilter} onChange={setRoleFilter} />
          <FilterGroup label="League" options={LEAGUES} value={leagueFilter} onChange={setLeagueFilter} />
        </div>
      </header>

      <main className={styles.grid}>
        {filtered.length === 0 ? (
          <p className={styles.empty}>No cards match the selected filters.</p>
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {label}
      </span>
      <div style={{ display: 'flex', gap: 4 }}>
        {options.map((opt) => (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            style={{
              padding: '4px 10px',
              borderRadius: 5,
              border: '1px solid',
              borderColor: value === opt ? 'rgba(232,224,255,0.6)' : 'rgba(232,224,255,0.15)',
              background: value === opt ? 'rgba(232,224,255,0.12)' : 'transparent',
              color: value === opt ? '#e8e0ff' : 'rgba(232,224,255,0.45)',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              textTransform: opt === 'All' ? 'none' : 'capitalize',
              transition: 'all 0.1s',
            }}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}
