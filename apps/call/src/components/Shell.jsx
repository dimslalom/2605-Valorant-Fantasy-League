import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import {
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

// The game frame, laid out like NYT Games: a title screen first, then one task per screen
// under one ruby glass HUD (menu, the two screens, score, credits, help). Everything that is not
// playing (rules, legal, data credit, account) lives behind the menu.

const ICONS = {
  menu: IconMenu2,
  help: IconHelp,
  stats: IconChartBar,
  matches: IconCalendarEvent,
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
  { to: '/bingo', label: 'Bingo', icon: 'bingo' },
];

const store = (kind, key, value) => {
  try {
    const s = kind === 'session' ? sessionStorage : localStorage;
    if (value === undefined) return s.getItem(key);
    s.setItem(key, value);
  } catch { /* storage blocked: the title screen and rules just show again */ }
  return null;
};

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

// The title of a signed-out screen, with an optional line under it that belongs to the title.
const Head = ({ title, children }) => (
  <header className="account-head">
    <h2>{title}</h2>
    {children && <p>{children}</p>}
  </header>
);

function RecoveryCode({ code, onDone }) {
  const { account } = useGame();
  const [copied, setCopied] = useState(false);
  const copy = () => navigator.clipboard?.writeText(code).then(() => setCopied(true), () => {});
  return (
    <div className="account">
      <Head title="Save your recovery code">If you forget your password, this is the <strong>only</strong> way back into your account. It is shown once.</Head>
      <p className="code" aria-label="Recovery code">{code}</p>
      <button className="secondary" onClick={copy}>{copied ? 'Copied' : 'Copy code'}</button>
      <button className="primary" onClick={() => { account.ackRecoveryCode(); onDone(); }}>I saved it</button>
    </div>
  );
}

function AccountForm({ onDone }) {
  const { account } = useGame();
  const { user, login, signup, reset, newCode, logout } = account;
  const [mode, setMode] = useState('login'); // login | signup | forgot
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const run = fn => async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true); setErr('');
    try { await fn(f); } catch (x) { setErr(x.message); }
    setBusy(false);
  };
  const go = m => { setMode(m); setErr(''); };
  const error = err && <p className="form-error" role="alert">{err}</p>;

  if (account.recoveryCode) return <RecoveryCode code={account.recoveryCode} onDone={onDone} />;

  if (user) {
    return (
      <>
        <p className="note">Signed in as <strong>{user.username}</strong>. Your cards, calls and points save to your account, so any device you sign in on picks up where you left off.</p>
        <form className="account" onSubmit={run(f => newCode(f.password))}>
          <p className="note">Lost your recovery code, or never got one? Make a new one. The old one stops working.</p>
          <label>Password<input name="password" type="password" autoComplete="current-password" required maxLength={128} /></label>
          {error}
          <button className="secondary" disabled={busy}>New recovery code</button>
        </form>
        <button className="secondary" onClick={async () => { await logout(); onDone(); }}>Sign out</button>
      </>
    );
  }

  if (mode === 'forgot') {
    return (
      <form className="account" onSubmit={run(async f => { await reset({ username: f.username, code: f.code, password: f.password }); })}>
        <Head title="Reset password">Enter your username, the recovery code you saved at signup, and a new password.</Head>
        <label>Username<input name="username" autoComplete="username" autoCapitalize="none" spellCheck="false" required maxLength={20} /></label>
        <label>Recovery code<input name="code" autoComplete="off" autoCapitalize="characters" spellCheck="false" required maxLength={24} placeholder="XXXX-XXXX-XXXX-XXXX" /></label>
        <label>New password<input name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} /></label>
        {error}
        <button className="primary" disabled={busy}>Set new password</button>
        <button type="button" className="ghost" onClick={() => go('login')}>Back to sign in</button>
      </form>
    );
  }

  const signingUp = mode === 'signup';
  return (
    <form className="account" onSubmit={run(async f => { await (signingUp ? signup : login)({ username: f.username, password: f.password }); if (!signingUp) onDone(); })}>
      <Head title={signingUp ? 'Create account' : 'Sign in'} />
      <label>Username<input name="username" autoComplete="username" autoCapitalize="none" spellCheck="false" required minLength={3} maxLength={20} pattern="[A-Za-z0-9_]+" /></label>
      <label>Password<input name="password" type="password" autoComplete={signingUp ? 'new-password' : 'current-password'} required minLength={signingUp ? 8 : 1} maxLength={128} /></label>
      {error}
      <button className="primary" disabled={busy}>{signingUp ? 'Create account' : 'Sign in'}</button>
      <button type="button" className="ghost" onClick={() => go(signingUp ? 'login' : 'signup')}>{signingUp ? 'Have an account? Sign in' : 'New here? Create an account'}</button>
      {!signingUp && <button type="button" className="ghost" onClick={() => go('forgot')}>Forgot password?</button>}
    </form>
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
          <main className="page"><Outlet /></main>
        </>
      )}

      {account.notice && <button className="toast" role="status" onClick={account.clearNotice}>{account.notice}</button>}
      <Sheet open={sheet === 'menu'} onClose={close} title="Menu" side="left" head={<img className="menu-brand" src="/opval-logo.svg" alt="OpVAL" />}>
        <nav className="menu">
          <Link to="/leaderboard" onClick={close}><Icon name="ranks" />Leaderboard</Link>
          <Link to="/roster" onClick={close}><Icon name="matches" />Rosters</Link>
          <button onClick={() => setSheet('account')}><Icon name="user" />Account</button>
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
      <Sheet open={sheet === 'account'} onClose={close} title="Account"><AccountForm onDone={close} /></Sheet>
      <Sheet open={sheet === 'help'} onClose={close} title="How to play" size="guide"><HowTo onDone={close} /></Sheet>
      <Sheet open={sheet === 'stats'} onClose={close} title="Statistics"><Stats /></Sheet>
    </div>
  );
}
