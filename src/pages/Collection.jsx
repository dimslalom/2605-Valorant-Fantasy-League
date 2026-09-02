import { useDeferredValue, useState } from 'react';
import { flushSync } from 'react-dom';
import PlayerCard from '../components/PlayerCard';
import CardFocusOverlay from '../components/CardFocusOverlay';
import AppFrame from '../components/AppFrame';
import StatusStrip from '../components/StatusStrip';
import SpecialtyIcon from '../components/SpecialtyIcon';
import CountryFlag from '../components/CountryFlag';
import allCards from '../data/cards.json';
import { assetPath, countryName, roleAbbr, thumbnailSrc } from '../lib/utils';
import { getCardSpecialties } from '../data/specialties';
import useReducedMotion from '../lib/useReducedMotion';
import styles from './Collection.module.css';

const TIER_ORDER = ['bronze', 'silver', 'gold', 'icon', 'legendary', 'prestige', 'iconic'];

const TIERS = ['All', ...TIER_ORDER.filter(t => allCards.some(c => c.tier === t))];
const REGIONS = ['All', ...new Set(allCards.map(c => c.region))];
const ROLES = ['All', ...new Set(allCards.map(c => c.role))];
const LEAGUES = ['All', 'VCT', 'Challengers', 'Icons'];
const LEAGUE_KEY = { VCT: 'vct', Challengers: 't2', Icons: 'icon' };
const PAGE_SIZE = 60;

const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

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
  const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'list'
  const [focusedCard, setFocusedCard] = useState(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const reducedMotion = useReducedMotion();

  const deferredQuery = fold(useDeferredValue(query).trim());

  const morphTo = (nextCard, slotId) => {
    const slot = document.getElementById(slotId);
    if (!document.startViewTransition || !slot || reducedMotion) {
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

  const anyFilter = tierFilter !== 'All' || regionFilter !== 'All'
    || roleFilter !== 'All' || leagueFilter !== 'All' || deferredQuery !== '';
  const visibleCards = filtered.slice(0, visibleCount);
  const remaining = filtered.length - visibleCards.length;

  return (
    <AppFrame>
      <StatusStrip crumb="Player Library" count={`${filtered.length} Players`}>
          <div className={styles.viewToggle} role="group" aria-label="View mode">
            <button
              className={[styles.iconToggleBtn, viewMode === 'grid' ? styles.toggleActive : ''].join(' ')}
              onClick={() => { setViewMode('grid'); setVisibleCount(PAGE_SIZE); }}
              aria-pressed={viewMode === 'grid'}
              aria-label="Grid view"
            >
              <svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor">
                <rect x="2.5" y="2.5" width="6.5" height="6.5" rx="1" />
                <rect x="11" y="2.5" width="6.5" height="6.5" rx="1" />
                <rect x="2.5" y="11" width="6.5" height="6.5" rx="1" />
                <rect x="11" y="11" width="6.5" height="6.5" rx="1" />
              </svg>
            </button>
            <button
              className={[styles.iconToggleBtn, viewMode === 'list' ? styles.toggleActive : ''].join(' ')}
              onClick={() => { setViewMode('list'); setVisibleCount(PAGE_SIZE); }}
              aria-pressed={viewMode === 'list'}
              aria-label="List view"
            >
              <svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor">
                <rect x="2.5" y="3" width="15" height="3" rx="1" />
                <rect x="2.5" y="8.5" width="15" height="3" rx="1" />
                <rect x="2.5" y="14" width="15" height="3" rx="1" />
              </svg>
            </button>
          </div>
      </StatusStrip>

        <div className={styles.controls}>
          <input
            type="search"
            className={styles.search}
            placeholder="Search players, teams, countries"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setVisibleCount(PAGE_SIZE); }}
            aria-label="Search players"
          />
          <div className={styles.filters}>
            <FilterGroup label="Tier" options={TIERS} value={tierFilter} onChange={(value) => { setTierFilter(value); setVisibleCount(PAGE_SIZE); }} />
            <FilterGroup label="Region" options={REGIONS} value={regionFilter} onChange={(value) => { setRegionFilter(value); setVisibleCount(PAGE_SIZE); }} />
            <FilterGroup label="Role" options={ROLES} value={roleFilter} onChange={(value) => { setRoleFilter(value); setVisibleCount(PAGE_SIZE); }} />
            <FilterGroup label="League" options={LEAGUES} value={leagueFilter} onChange={(value) => { setLeagueFilter(value); setVisibleCount(PAGE_SIZE); }} />
          </div>
        </div>

        {viewMode === 'grid' ? (
          <main className={styles.grid}>
            {filtered.length === 0 ? (
              <p className={styles.empty}>No players match. Try a different search or filter.</p>
            ) : (
              visibleCards.map((card) => (
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
        ) : (
          /* List View Table */
          <main className={styles.denseContainer}>
            {filtered.length === 0 ? (
              <p className={styles.empty}>No players match. Try a different search or filter.</p>
            ) : (
              <table className={styles.denseTable}>
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Org</th>
                    <th>Role</th>
                    <th>Region</th>
                    <th>Tier</th>
                    <th>Specialties</th>
                    <th>OVR</th>
                    <th>AIM</th>
                    <th>POS</th>
                    <th>ABL</th>
                    <th>MNT</th>
                    <th>SYN</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleCards.map((card) => {
                    const specs = getCardSpecialties(card);
                    return (
                      <tr
                        key={card.id}
                        id={`card-slot-${card.id}`}
                        className={styles.denseRow}
                        onClick={() => openCard(card)}
                      >
                        <td className={styles.playerCell}>
                          <img
                            src={assetPath(thumbnailSrc(card))}
                            alt={card.player}
                            className={styles.avatarImg}
                            loading="lazy"
                            onError={(e) => { e.target.style.display = 'none'; }}
                          />
                          <div className={styles.playerMeta}>
                            <span className={styles.playerName}>{card.player}</span>
                            <span className={styles.playerCountry}>
                              {card.nationality && <CountryFlag code={card.nationality} />}
                              {countryName(card.nationality)}
                            </span>
                          </div>
                        </td>
                        <td className={styles.orgCell}>
                          {card.org_logo && <img src={assetPath(card.org_logo)} alt="" className={styles.orgLogo} />}
                          <span>{card.org || 'FA'}</span>
                        </td>
                        <td>
                          <span className={`${styles.roleBadge} ${styles['role' + card.role]}`}>
                            {roleAbbr(card.role)}
                          </span>
                        </td>
                        <td>{card.region}</td>
                        <td>
                          <span className={`${styles.tierBadge} ${styles['tier' + card.tier]}`}>
                            {card.tier}
                          </span>
                        </td>
                        <td>
                          <div className={styles.specIconGroup}>
                            {specs.map(s => (
                              <span
                                key={s.key}
                                className={styles.specCutBadge}
                                title={`${s.name}: ${s.desc}`}
                              >
                                <SpecialtyIcon spec={s.key} size="66%" />
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className={styles.ovrCell}>{card.rating}</td>
                        <td className={styles.statCell}>{card.stats?.aim ?? '-'}</td>
                        <td className={styles.statCell}>{card.stats?.positioning ?? '-'}</td>
                        <td className={styles.statCell}>{card.stats?.ability ?? '-'}</td>
                        <td className={styles.statCell}>{card.stats?.mentality ?? '-'}</td>
                        <td className={styles.statCell}>{card.stats?.synergy ?? '-'}</td>
                        <td>
                          <button className={styles.inspectBtn}>Inspect</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </main>
        )}

        {remaining > 0 && (
          <div className={styles.loadMoreRow}>
            <button
              className={styles.loadMoreBtn}
              onClick={() => setVisibleCount(count => count + PAGE_SIZE)}
            >
              Load {Math.min(PAGE_SIZE, remaining)} more players
            </button>
          </div>
        )}

        {/* Announced so a filter change is perceivable without watching the
            grid - the result count is the only feedback the search gives. */}
        <div className={styles.footStrip} role="status" aria-live="polite">
          <span>{anyFilter ? 'Filters active' : 'All players'}</span>
          <span className={styles.footCount}>
            {visibleCards.length} of {filtered.length} shown ({viewMode === 'list' ? 'List View' : 'Grid View'})
          </span>
        </div>

      <CardFocusOverlay card={focusedCard} onClose={closeCard} />
    </AppFrame>
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
