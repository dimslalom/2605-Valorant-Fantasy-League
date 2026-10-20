import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  IconArrowsExchange,
  IconCalendarEvent,
  IconCards,
  IconGridDots,
  IconChartBar,
  IconExternalLink,
  IconFileText,
  IconHelp,
  IconLogout,
  IconMenu2,
  IconTrophy,
  IconUser,
} from '@tabler/icons-react';
import { useGame } from '../lib/gameContext';
import { longDay, todayKey } from '../lib/time';
import HowTo from './HowTo';
import Sheet from './Sheet';
import AccountForm from './AccountForm';
import MatchDashboard from './MatchDashboard';
import useBingoUpdate from '../lib/useBingoUpdate';

// The game frame, laid out like NYT Games: a title screen first, then one task per screen
// under one ruby glass HUD (menu, the two screens, score, credits, help). Everything that is not
// playing (rules, legal, data credit, account) lives behind the menu.

const ICONS = {
  menu: IconMenu2,
  help: IconHelp,
  stats: IconChartBar,
  matches: IconCalendarEvent,
  rosters: IconArrowsExchange,
  bingo: IconGridDots,
  cards: IconCards,
  ranks: IconTrophy,
  legal: IconFileText,
  link: IconExternalLink,
  user: IconUser,
  out: IconLogout,
};
const Icon = ({ name, size = 22 }) => {
  const Component = ICONS[name];
  return <Component size={size} stroke={2} aria-hidden="true" />;
};

const TABS = [
  { to: '/', label: 'Matches', icon: 'matches', end: true },
  { to: '/collection', label: 'Cards', icon: 'cards' },
  { to: '/roster', label: 'Rosters', icon: 'rosters' },
];

const store = (kind, key, value) => {
  try {
    const s = kind === 'session' ? sessionStorage : localStorage;
    if (value === undefined) return s.getItem(key);
    s.setItem(key, value);
  } catch { /* storage blocked: the title screen and rules just show again */ }
  return null;
};

function Stats({ onDone }) {
  const { state, score, record, account } = useGame();
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
      {account.user && <Link className="secondary profile-link" to={`/u/${account.user.username}`} onClick={onDone}>Profile and past guesses</Link>}
    </>
  );
}


// Nothing in the game works without an account, so signed-out visitors get this instead of the app.
function Gate() {
  return (
    <div className="splash">
      <h1 className="splash-title gate-title"><img src="/opval-logo.svg" alt="OpVAL" /></h1>
      <div className="gate"><AccountForm onDone={() => {}} /></div>
      <Link className="ghost" to="/legal">Legal</Link>
    </div>
  );
}

function Splash({ onPlay, onHelp }) {
  return (
    <div className="splash">
      <h1 className="splash-title"><img src="/opval-logo.svg" alt="OpVAL" /></h1>
      <p className="splash-tag">Pick who wins each VCT series, and score when the players you track play well.</p>
      <button className="primary big" onClick={onPlay}>Play</button>
      <button className="ghost" onClick={onHelp}>How to play</button>
      <p className="splash-date">{longDay(todayKey())}</p>
    </div>
  );
}

export default function Shell() {
  const { pathname } = useLocation();
  const { state, score, devCredits, account } = useGame();
  const [splash, setSplash] = useState(() => !store('session', 'opval-played'));
  const [sheet, setSheet] = useState(null); // 'menu' | 'help' | 'stats' | 'account'

  const { bingo, needsBingo } = useBingoUpdate(account.user?.username, pathname);
  const updates = { '/collection': state?.freePacks ?? 0, '/bingo': needsBingo ? 1 : 0 };

  // Every screen starts at the top, not wherever the last one was scrolled.
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);

  const play = () => {
    store('session', 'opval-played', '1');
    setSplash(false);
    if (!store('local', 'opval-rules-seen')) { store('local', 'opval-rules-seen', '1'); setSheet('help'); }
  };
  const close = () => setSheet(null);

  const locked = pathname !== '/legal' && (!account.user || account.recoveryCode);
  if (!account.checked) return <div className="shell"><p className="loading">Loading</p></div>;
  if (locked) return <div className="shell"><Gate /></div>;

  return (
    <div className="shell">
      {splash ? <Splash onPlay={play} onHelp={() => setSheet('help')} /> : (
        <>
          <header className="hud">
            <button className="icon" aria-label="Menu" onClick={() => setSheet('menu')}><Icon name="menu" /></button>
            <nav className="hud-tabs" aria-label="Screens">
              {TABS.map(t => (
                <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `hud-tab${isActive ? ' on' : ''}`}>
                  <Icon name={t.icon} size={18} />
                  <span>{t.label}</span>
                  {updates[t.to] > 0 && <span className="tab-update" aria-label={t.to === '/collection' ? `${updates[t.to]} free packs available` : 'Weekly bingo selection needed'}>{updates[t.to] > 99 ? '99+' : updates[t.to]}</span>}
                </NavLink>
              ))}
            </nav>
            <div className="hud-right">
              {state && (
                <button className="chip" aria-label={`${score} points, ${state.credits} credits. Open stats`} onClick={() => setSheet('stats')}>
                  <span><b>{score}</b> PTS</span>
                  <span className="chip-cr"><b>{state.credits}</b> CR</span>
                </button>
              )}
              <button className="icon" aria-label="How to play" onClick={() => setSheet('help')}><Icon name="help" /></button>
            </div>
          </header>
          {import.meta.env.DEV && sessionStorage.getItem('opval-offline-preview') === '1' && <div className="offline-banner" role="status">Offline test account · Sample matches and standings · Reload to reset</div>}
          <main className={`page${pathname === '/' ? ' page-dashboard' : ''}`}><Outlet />{pathname === '/' && <MatchDashboard bingo={bingo} needsBingo={needsBingo} />}</main>
        </>
      )}

      {account.notice && <button className="toast" role="status" onClick={account.clearNotice}>{account.notice}</button>}
      <Sheet open={sheet === 'menu'} onClose={close} title="Menu" side="left" head={<img className="menu-brand" src="/opval-logo.svg" alt="OpVAL" />}>
        <nav className="menu">
          <Link to="/leaderboard" onClick={close}><Icon name="ranks" />Leaderboard</Link>
          {account.user
            ? <Link to={`/u/${account.user.username}`} onClick={close}><Icon name="user" />Profile</Link>
            : <button onClick={() => setSheet('account')}><Icon name="user" />Sign in</button>}
          <Link to="/bingo" onClick={close}><Icon name="bingo" />Bingo</Link>
          <button onClick={() => setSheet('help')}><Icon name="help" />How to play</button>
          <button onClick={() => setSheet('stats')}><Icon name="stats" />Statistics</button>
          {import.meta.env.DEV && <button onClick={() => { devCredits(1000); close(); }}><Icon name="stats" />Dev: +1000 credits</button>}
        </nav>
        <nav className="menu menu-minor" aria-label="About">
          <Link to="/legal" onClick={close}><Icon name="legal" />Legal</Link>
          <a href="https://www.vlr.gg" target="_blank" rel="noreferrer"><Icon name="link" />Match data: vlr.gg</a>
        </nav>
        {account.user && <button className="secondary menu-out" onClick={async () => { await account.logout(); close(); }}>Sign out</button>}
        <p className="menu-foot">Free fan game. No betting and no real money. Not endorsed by Riot Games.</p>
      </Sheet>
      <Sheet open={sheet === 'account'} onClose={close} title={account.user ? 'Account' : 'Sign in'}><AccountForm onDone={close} /></Sheet>
      <Sheet open={sheet === 'help'} onClose={close} title="How to play" size="guide"><HowTo onDone={close} /></Sheet>
      <Sheet open={sheet === 'stats'} onClose={close} title="Statistics"><Stats onDone={close} /></Sheet>
    </div>
  );
}
