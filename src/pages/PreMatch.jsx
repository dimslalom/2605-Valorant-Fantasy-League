import { useNavigate } from 'react-router-dom';
import DeckBuilder from '../components/DeckBuilder';
import styles from './PreMatch.module.css';

export default function PreMatch() {
  const navigate = useNavigate();

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Pre-Match Setup</h1>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Pick your squad</h2>
        <DeckBuilder />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Assign agents</h2>
        <p className={styles.stub}>Agent assignment — coming in sprint 2</p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Choose strategy</h2>
        <p className={styles.stub}>Strategy selection — coming in sprint 2</p>
      </section>

      <button
        className={styles.startBtn}
        onClick={() => navigate('/match')}
      >
        Start Match
      </button>
    </div>
  );
}
