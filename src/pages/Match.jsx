import MapCanvas from '../components/MapCanvas';
import TimeoutPanel from '../components/TimeoutPanel';
import styles from './Match.module.css';

const STUB_TEAM = ['forsakeN', 'Aspas', 'nAts', 'Derke', 'Chronicle'];

export default function Match() {
  return (
    <div className={styles.page}>
      {/* Left sidebar */}
      <aside className={styles.sidebar}>
        <h2 className={styles.sidebarTitle}>Your Team</h2>
        <ul className={styles.playerList}>
          {STUB_TEAM.map((name) => (
            <li key={name} className={styles.playerItem}>{name}</li>
          ))}
        </ul>
      </aside>

      {/* Center canvas */}
      <main className={styles.center}>
        <MapCanvas />
      </main>

      {/* Right sidebar */}
      <aside className={styles.sidebar}>
        <TimeoutPanel onTimeout={() => console.log('Timeout called')} />
      </aside>
    </div>
  );
}
