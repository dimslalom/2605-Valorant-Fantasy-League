import { NavLink } from 'react-router-dom';
import styles from './NavHeader.module.css';

// The one site-wide header. Same links in the same order on every page; the
// current page is highlighted, the others are muted links. `right` fills the
// accent-colored slot on the far right (player count, match stage, etc).
const NAV = [
  { to: '/collection', label: 'Player Library' },
  { to: '/run',        label: 'Perfect Run' },
];

export default function NavHeader({ right }) {
  return (
    <header className={styles.header}>
      <nav className={styles.nav}>
        {NAV.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => [styles.link, isActive ? styles.active : ''].join(' ')}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
      {right != null && <span className={styles.right}>{right}</span>}
    </header>
  );
}
