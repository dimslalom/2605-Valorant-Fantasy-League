import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { CALL, ECONOMY, TRACKED_MAX } from '../../../../src/engine/collect/rules';
import { useGame } from '../lib/gameContext';
import { longDay, todayKey } from '../lib/time';
import Sheet from './Sheet';

// The game frame, laid out like NYT Games: a title screen first, then one task per screen
// under a slim HUD (menu, score, credits, stats, help) and a two-button dock. Everything that
// is not playing (rules, legal, data credit, reset) lives behind the menu.

const Icon = ({ d, size = 22 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" aria-hidden="true"><path d={d} /></svg>
);
const ICONS = {
  menu: 'M3 6h18M3 12h18M3 18h12',
  help: 'M9.2 9a3 3 0 1 1 4.2 2.8c-.9.4-1.4 1.1-1.4 2.2M12 17.5v.5',
  stats: 'M5 20V12M12 20V5M19 20v-9',
  matches: 'M4 4h16v16H4zM4 9h16M9 4v5M15 4v5',
  cards: 'M7 3h11v15H7zM4 7v14h11',
  legal: 'M6 3h9l3 3v15H6zM9 11h6M9 15h6',
  link: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  reset: 'M4 12a8 8 0 1 0 2.3-5.7M4 3v4h4',
};

const DOCK = [
  { to: '/', label: 'Matches', icon: 'matches', end: true },
  { to: '/collection', label: 'Cards', icon: 'cards' },
];

const store = (kind, key, value) => {
  try {
    const s = kind === 'session' ? sessionStorage : localStorage;
    if (value === undefined) return s.getItem(key);
    s.setItem(key, value);
  } catch { /* storage blocked: the title screen and rules just show again */ }
  return null;
};

function HowTo() {
  return (
    <ol className="howto">
      <li><strong>Call it.</strong> Pick the winner of a real VCT series before it starts. +{CALL.winner} if you are right. Nail the exact score for +{CALL.exactScore}, the star player for +{CALL.star}.</li>
      <li><strong>Track ten.</strong> Only your {TRACKED_MAX} Tracked cards score when they play. Swap them in Cards.</li>
      <li><strong>Reveal.</strong> Finished matches stay hidden until you reveal them, so nothing gets spoiled.</li>
      <li><strong>Open packs.</strong> Points become credits. {ECONOMY.packCost} credits opens a pack of {ECONOMY.packSize}.</li>
      <li className="muted">A wrong call costs nothing. Right calls in a row build a streak bonus.</li>
    </ol>
  );
}

function Stats() {
  const { state, score, record } = useGame();
  if (!state) return <p className="note">Dealing your cards</p>;
  const pct = record.made ? Math.round((record.right / record.made) * 100) : 0;
  return (
    <>
      <div className="statgrid">
        <div><strong>{score}</strong><span>Points</span></div>
        <div><strong>{record.made}</strong><span>Calls</span></div>
        <div><strong>{pct}</strong><span>Right %</span></div>
        <div><strong>{state.streak}</strong><span>Streak</span></div>
      </div>
      <div className="statgrid">
        <div><strong>{state.credits}</strong><span>Credits</span></div>
        <div><strong>{state.collection.length}</strong><span>Cards</span></div>
        <div><strong>{state.packsOpened ?? 0}</strong><span>Packs</span></div>
        <div><strong>{state.freeSwaps}</strong><span>Free swaps</span></div>
      </div>
    </>
  );
}

function Splash({ onPlay, onHelp }) {
  return (
    <div className="splash">
      <div className="splash-mark" aria-hidden="true" />
      <h1 className="splash-title">OpVAL</h1>
      <p className="splash-tag">Pick who wins each VCT series, and score when the players you track play well.</p>
      <button className="primary big" onClick={onPlay}>Play</button>
      <button className="ghost" onClick={onHelp}>How to play</button>
      <p className="splash-date">{longDay(todayKey())}</p>
    </div>
  );
}

export default function Shell() {
  const { pathname } = useLocation();
  const { state, score, resetProgress, devCredits } = useGame();
  const [splash, setSplash] = useState(() => !store('session', 'opval-played'));
  const [sheet, setSheet] = useState(null); // 'menu' | 'help' | 'stats'

  // Every screen starts at the top, not wherever the last one was scrolled.
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);

  const play = () => {
    store('session', 'opval-played', '1');
    setSplash(false);
    if (!store('local', 'opval-rules-seen')) { store('local', 'opval-rules-seen', '1'); setSheet('help'); }
  };
  const close = () => setSheet(null);
  const reset = () => {
    if (window.confirm('Start over? Your cards, calls and points on this device are wiped.')) { resetProgress(); close(); }
  };

  return (
    <div className="shell">
      {splash ? <Splash onPlay={play} onHelp={() => setSheet('help')} /> : (
        <>
          <header className="hud">
            <button className="icon" aria-label="Menu" onClick={() => setSheet('menu')}><Icon d={ICONS.menu} /></button>
            <span className="wordmark">OpVAL</span>
            <div className="hud-right">
              {state && (
                <button className="chip" aria-label={`${score} points, ${state.credits} credits. Open stats`} onClick={() => setSheet('stats')}>
                  <span><b>{score}</b> PTS</span>
                  <span className="chip-cr"><b>{state.credits}</b> CR</span>
                </button>
              )}
              <button className="icon" aria-label="How to play" onClick={() => setSheet('help')}><Icon d={ICONS.help} /></button>
            </div>
          </header>
          <main className="page"><Outlet /></main>
          <nav className="dock" aria-label="Screens">
            {DOCK.map(t => (
              <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `dock-btn${isActive ? ' on' : ''}`}>
                <Icon d={ICONS[t.icon]} size={24} />
                <span>{t.label}</span>
              </NavLink>
            ))}
          </nav>
        </>
      )}

      <Sheet open={sheet === 'menu'} onClose={close} title="Menu" side="left">
        <nav className="menu">
          <button onClick={() => setSheet('help')}><Icon d={ICONS.help} />How to play</button>
          <button onClick={() => setSheet('stats')}><Icon d={ICONS.stats} />Statistics</button>
          <Link to="/legal" onClick={close}><Icon d={ICONS.legal} />Legal</Link>
          <a href="https://www.vlr.gg" target="_blank" rel="noreferrer"><Icon d={ICONS.link} />Match data: vlr.gg</a>
          {import.meta.env.DEV && <button onClick={() => { devCredits(1000); close(); }}><Icon d={ICONS.stats} />Dev: +1000 credits</button>}
          <button className="danger" onClick={reset}><Icon d={ICONS.reset} />Reset progress</button>
        </nav>
        <p className="menu-foot">Free fan game. No betting and no real money. Not endorsed by Riot Games.</p>
      </Sheet>
      <Sheet open={sheet === 'help'} onClose={close} title="How to play"><HowTo /></Sheet>
      <Sheet open={sheet === 'stats'} onClose={close} title="Statistics"><Stats /></Sheet>
    </div>
  );
}
