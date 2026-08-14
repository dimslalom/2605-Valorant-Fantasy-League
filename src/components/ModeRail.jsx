import { NavLink } from 'react-router-dom';
import BrandLogo from './BrandLogo';
import styles from './ModeRail.module.css';

// The Broadcast-frame's left edge: a slim icon rail that replaces the top text
// nav on data-forward screens (Library, Multiplayer). Card Table screens (the
// Perfect Run home) keep their own centered chrome, per the wireframe system.

const ICON = {
  library: (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="2.5" y="2.5" width="6" height="6" /><rect x="11.5" y="2.5" width="6" height="6" />
      <rect x="2.5" y="11.5" width="6" height="6" /><rect x="11.5" y="11.5" width="6" height="6" />
    </svg>
  ),
  run: (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square">
      <path d="M6 3h8v3.5a4 4 0 0 1-8 0V3Z" /><path d="M10 10.5V14" /><path d="M6.5 17h7" />
      <path d="M6 3.5H3.5v2a3 3 0 0 0 2.7 3" /><path d="M14 3.5h2.5v2a3 3 0 0 1-2.7 3" />
    </svg>
  ),
  multiplayer: (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="7" cy="6.5" r="2.6" /><circle cx="14" cy="7.5" r="2" />
      <path d="M2.5 16.5c0-2.6 2-4.3 4.5-4.3s4.5 1.7 4.5 4.3" /><path d="M12.8 15.5c.2-1.9 1.5-3.1 3.2-3.1 1.5 0 2.7 1 3 2.6" />
    </svg>
  ),
};

const RAIL = [
  { to: '/collection', key: 'library', label: 'Player Library' },
  { to: '/run', key: 'run', label: 'Perfect Run' },
  { to: '/multiplayer', key: 'multiplayer', label: 'Multiplayer' },
];

export default function ModeRail() {
  return (
    <nav className={styles.rail} aria-label="Modes">
      <BrandLogo className={styles.mark} />
      <div className={styles.items}>
        {RAIL.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            // The label lives in a span that is visually hidden at the
            // narrowest widths, so the link needs its own accessible name —
            // without it the mobile nav is three unnamed glyphs.
            aria-label={item.label}
            className={({ isActive }) => [styles.item, isActive ? styles.active : ''].join(' ')}
          >
            {ICON[item.key]}
            <span className={styles.tip} aria-hidden="true">{item.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
