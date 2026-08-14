import { useState, useMemo } from 'react';
import PlayerCard from './PlayerCard';
import allCards from '../data/cards.json';
import { roleAbbr, countryName } from '../lib/utils';
import styles from './DeckBuilder.module.css';

const STRATEGIES = [
  { id: 'aggressive', name: 'Aggressive Default', desc: 'Entry fraggers get positioning bonus on attack, supports more exposed.' },
  { id: 'slow', name: 'Slow Default', desc: 'Higher positioning bonus on defense, lower first-duel rate.' },
  { id: 'eco_rush', name: 'Eco Aggression', desc: 'High risk first-duel push, IGL reset ability improved.' },
  { id: 'defense_stack', name: 'Defense Anchor', desc: 'Site anchors gain ability & mentality boost.' },
];

const ROLES = ['Duelist', 'Initiator', 'Controller', 'Sentinel'];

export default function DeckBuilder({
  squad = [],
  onUpdateSquad,
  iglId = null,
  onSelectIgl,
  strategy = 'aggressive',
  onSelectStrategy,
}) {
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('All');

  // Filter pool for card picker drawer
  const pool = useMemo(() => {
    return allCards.filter(c => {
      const isPicked = squad.some(p => p && p.id === c.id);
      if (isPicked) return false;
      if (roleFilter !== 'All' && c.role !== roleFilter) return false;
      if (searchTerm) {
        const q = searchTerm.toLowerCase();
        const text = `${c.player} ${c.org} ${c.role} ${countryName(c.nationality)}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
  }, [squad, roleFilter, searchTerm]);

  const handleSlotClick = (index) => {
    setSelectedSlot(index);
  };

  const handlePickCard = (card) => {
    if (selectedSlot !== null) {
      const next = [...squad];
      next[selectedSlot] = card;
      onUpdateSquad?.(next);
      // Auto assign IGL if first card
      if (!iglId && next.filter(Boolean).length === 1) {
        onSelectIgl?.(card.id);
      }
      setSelectedSlot(null);
    } else {
      // Pick into first empty slot
      const emptyIdx = squad.findIndex(s => !s);
      const targetIdx = emptyIdx >= 0 ? emptyIdx : 0;
      const next = [...squad];
      next[targetIdx] = card;
      onUpdateSquad?.(next);
      if (!iglId) onSelectIgl?.(card.id);
    }
  };

  const handleRemoveCard = (index) => {
    const card = squad[index];
    const next = [...squad];
    next[index] = null;
    onUpdateSquad?.(next);
    if (card && iglId === card.id) {
      const remaining = next.filter(Boolean);
      onSelectIgl?.(remaining[0]?.id ?? null);
    }
  };

  // Ensure 5 slots
  const filledSquad = Array.from({ length: 5 }, (_, i) => squad[i] ?? null);

  const teamOvr = useMemo(() => {
    const active = filledSquad.filter(Boolean);
    if (!active.length) return 0;
    return Math.round(active.reduce((acc, c) => acc + c.rating, 0) / active.length);
  }, [filledSquad]);

  return (
    <div className={styles.deckBuilder}>
      {/* Table Header / Roster Summary */}
      <div className={styles.tableHeader}>
        <div className={styles.tableMeta}>
          <span className={styles.tableTitle}>
            <span className={styles.feltDot} /> CARD TABLE ROSTER SETUP
          </span>
          <span className={styles.ovrBadge}>
            Team OVR <strong>{teamOvr}</strong>
          </span>
        </div>
        <div className={styles.strategyPicker}>
          <label htmlFor="strategy-select" className={styles.stratLabel}>Strategy:</label>
          <select
            id="strategy-select"
            className={styles.stratSelect}
            value={strategy}
            onChange={(e) => onSelectStrategy?.(e.target.value)}
          >
            {STRATEGIES.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Felt Card Table Surface with 2c Flex Empty Slots */}
      <div className={styles.feltTable}>
        <div className={styles.slotFlexContainer}>
          {filledSquad.map((card, idx) => {
            const isSelected = selectedSlot === idx;
            const isIgl = card && iglId === card.id;

            return (
              <div
                key={idx}
                className={[
                  styles.cardSlot,
                  card ? styles.filledSlot : styles.emptyFlexSlot,
                  isSelected ? styles.slotActive : '',
                ].join(' ')}
                onClick={() => handleSlotClick(idx)}
              >
                {card ? (
                  <div className={styles.cardWrapper}>
                    <PlayerCard card={card} displayScale={0.42} />
                    <div className={styles.slotControls}>
                      <button
                        className={[styles.iglBtn, isIgl ? styles.iglActive : ''].join(' ')}
                        title={isIgl ? 'In-Game Leader' : 'Set as IGL'}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectIgl?.(card.id);
                        }}
                      >
                        {isIgl ? '★ IGL' : 'Make IGL'}
                      </button>
                      <button
                        className={styles.removeBtn}
                        title="Remove Player"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveCard(idx);
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className={styles.emptyContent}>
                    <div className={styles.emptyIcon}>+</div>
                    <span className={styles.emptyLabel}>Slot {idx + 1}</span>
                    <span className={styles.emptySub}>Flex Player</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Card Pool Drawer / Selection Library */}
      <div className={styles.poolDrawer}>
        <div className={styles.drawerHeader}>
          <span className={styles.drawerTitle}>
            {selectedSlot !== null ? `Select Player for Slot ${selectedSlot + 1}` : 'Player Pool Drawer'}
          </span>
          <div className={styles.drawerFilters}>
            <input
              type="search"
              className={styles.searchInput}
              placeholder="Search pool..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <div className={styles.roleChips}>
              {['All', ...ROLES].map(r => (
                <button
                  key={r}
                  className={[styles.roleChip, roleFilter === r ? styles.roleActive : ''].join(' ')}
                  onClick={() => setRoleFilter(r)}
                >
                  {r === 'All' ? 'All' : roleAbbr(r)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className={styles.cardGrid}>
          {pool.map(card => (
            <div
              key={card.id}
              className={styles.poolCardItem}
              onClick={() => handlePickCard(card)}
            >
              <PlayerCard card={card} displayScale={0.36} />
              <button className={styles.addOverlayBtn}>+ Pick</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
