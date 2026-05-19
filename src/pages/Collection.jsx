import { useState } from 'react';
import PlayerCard from '../components/PlayerCard';
import allCards from '../data/cards.json';
import styles from './Collection.module.css';

const TIERS = ['All', 'silver', 'gold', 'legendary', 'prestige', 'iconic'];
const REGIONS = ['All', 'Americas', 'EMEA', 'Pacific'];
const ROLES = ['All', 'Duelist', 'Sentinel', 'Controller', 'Initiator', 'Flex'];

export default function Collection() {
  const [tierFilter, setTierFilter] = useState('All');
  const [regionFilter, setRegionFilter] = useState('All');
  const [roleFilter, setRoleFilter] = useState('All');

  const filtered = allCards.filter((card) => {
    if (tierFilter !== 'All' && card.tier !== tierFilter) return false;
    if (regionFilter !== 'All' && card.region !== regionFilter) return false;
    if (roleFilter !== 'All' && card.role !== roleFilter) return false;
    return true;
  });

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>My Collection</h1>
        <div className={styles.filters}>
          <FilterGroup label="Tier" options={TIERS} value={tierFilter} onChange={setTierFilter} />
          <FilterGroup label="Region" options={REGIONS} value={regionFilter} onChange={setRegionFilter} />
          <FilterGroup label="Role" options={ROLES} value={roleFilter} onChange={setRoleFilter} />
        </div>
      </header>

      <main className={styles.grid}>
        {filtered.length === 0 ? (
          <p className={styles.empty}>No cards match the selected filters.</p>
        ) : (
          filtered.map((card) => (
            <PlayerCard
              key={card.id}
              card={card}
              onClick={() => console.log('Card clicked:', card)}
            />
          ))
        )}
      </main>
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
