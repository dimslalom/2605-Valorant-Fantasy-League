import { NavLink, Outlet } from 'react-router-dom';

const TABS = [
  { to: '/', label: 'Today', end: true },
  { to: '/collection', label: 'Collection' },
  { to: '/table', label: 'Table' },
];

// The frame every screen sits in: wordmark, three tabs, and the legal line.
// The structure follows valorantesports.com (schedule-first, a few flat tabs).
export default function Shell() {
  return (
    <div className="shell">
      <header className="bar">
        <span className="wordmark">VALCON</span>
        <nav className="tabs" aria-label="Sections">
          {TABS.map(t => (
            <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `tab${isActive ? ' on' : ''}`}>
              {t.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="page">
        <Outlet />
      </main>
      <footer className="legal">
        <span>Free fan game. No betting and no real money.</span>
        <span className="rule" aria-hidden="true" />
        <span>Data: vlr.gg</span>
        <span className="rule" aria-hidden="true" />
        <a href="/legal.html">Legal</a>
      </footer>
    </div>
  );
}
