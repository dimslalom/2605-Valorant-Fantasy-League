import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useGame } from '../lib/gameContext';
import { longDay, todayKey } from '../lib/time';
import HowTo from './HowTo';
import Sheet from './Sheet';

// The game frame, laid out like NYT Games: a title screen first, then one task per screen
// under one ruby glass HUD (menu, the two screens, score, credits, help). Everything that is not
// playing (rules, legal, data credit, reset) lives behind the menu.

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
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 3.6-7 8-7s8 3 8 7',
  reset: 'M4 12a8 8 0 1 0 2.3-5.7M4 3v4h4',
};

const TABS = [
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

function RecoveryCode({ code, onDone }) {
  const { account } = useGame();
  const [copied, setCopied] = useState(false);
  const copy = () => navigator.clipboard?.writeText(code).then(() => setCopied(true), () => {});
  return (
    <div className="account">
      <p className="note">This is your recovery code. If you forget your password, it is the <strong>only</strong> way back into your account. Save it somewhere safe. It is shown once.</p>
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
        <p className="note">Enter your username, the recovery code you saved at signup, and a new password.</p>
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
      <p className="note">{signingUp ? 'Create an account to keep your game across devices. Your current progress comes with you.' : 'Sign in to load your saved game.'}</p>
      <label>Username<input name="username" autoComplete="username" autoCapitalize="none" spellCheck="false" required minLength={3} maxLength={20} pattern="[A-Za-z0-9_]+" /></label>
      <label>Password<input name="password" type="password" autoComplete={signingUp ? 'new-password' : 'current-password'} required minLength={signingUp ? 8 : 1} maxLength={128} /></label>
      {error}
      <button className="primary" disabled={busy}>{signingUp ? 'Create account' : 'Sign in'}</button>
      <button type="button" className="ghost" onClick={() => go(signingUp ? 'login' : 'signup')}>{signingUp ? 'Have an account? Sign in' : 'New here? Create an account'}</button>
      {!signingUp && <button type="button" className="ghost" onClick={() => go('forgot')}>Forgot password?</button>}
    </form>
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
  const { state, score, resetProgress, devCredits, account } = useGame();
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
  const reset = () => {
    if (window.confirm(account.user ? 'Start over? Your cards, calls and points are wiped, including the copy saved to your account.' : 'Start over? Your cards, calls and points on this device are wiped.')) { resetProgress(); close(); }
  };

  return (
    <div className="shell">
      {splash ? <Splash onPlay={play} onHelp={() => setSheet('help')} /> : (
        <>
          <header className="hud">
            <button className="icon" aria-label="Menu" onClick={() => setSheet('menu')}><Icon d={ICONS.menu} /></button>
            <span className="wordmark"><img src="/opval-logo.svg" alt="OpVAL" /></span>
            <nav className="hud-tabs" aria-label="Screens">
              {TABS.map(t => (
                <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `hud-tab${isActive ? ' on' : ''}`}>
                  <Icon d={ICONS[t.icon]} size={18} />
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
              <button className="icon" aria-label="How to play" onClick={() => setSheet('help')}><Icon d={ICONS.help} /></button>
            </div>
          </header>
          <main className="page"><Outlet /></main>
        </>
      )}

      {account.notice && <button className="toast" role="status" onClick={account.clearNotice}>{account.notice}</button>}
      <Sheet open={sheet === 'menu'} onClose={close} title="Menu" side="left">
        <nav className="menu">
          <button onClick={() => setSheet('account')}><Icon d={ICONS.user} />{account.user ? account.user.username : 'Sign in'}</button>
          <button onClick={() => setSheet('help')}><Icon d={ICONS.help} />How to play</button>
          <button onClick={() => setSheet('stats')}><Icon d={ICONS.stats} />Statistics</button>
          <Link to="/legal" onClick={close}><Icon d={ICONS.legal} />Legal</Link>
          <a href="https://www.vlr.gg" target="_blank" rel="noreferrer"><Icon d={ICONS.link} />Match data: vlr.gg</a>
          {import.meta.env.DEV && <button onClick={() => { devCredits(1000); close(); }}><Icon d={ICONS.stats} />Dev: +1000 credits</button>}
          <button className="danger" onClick={reset}><Icon d={ICONS.reset} />Reset progress</button>
        </nav>
        <p className="menu-foot">Free fan game. No betting and no real money. Not endorsed by Riot Games.</p>
      </Sheet>
      <Sheet open={sheet === 'account'} onClose={close} title={account.recoveryCode ? 'Recovery code' : account.user ? 'Account' : 'Sign in'}><AccountForm onDone={close} /></Sheet>
      <Sheet open={sheet === 'help'} onClose={close} title="How to play" size="guide"><HowTo onDone={close} /></Sheet>
      <Sheet open={sheet === 'stats'} onClose={close} title="Statistics"><Stats /></Sheet>
    </div>
  );
}
