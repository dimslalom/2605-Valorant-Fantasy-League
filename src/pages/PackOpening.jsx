import { Link } from 'react-router-dom';
import AppFrame from '../components/AppFrame';
import StatusStrip from '../components/StatusStrip';
import styles from './PackOpening.module.css';

export default function PackOpening() {
  return (
    <AppFrame>
      <StatusStrip crumb="Pack Opening" count="Card Unboxing" />

      <div className={styles.content}>
        <p className={styles.kicker}>Not built yet</p>
        <h2 className={styles.title}>Pack Opening</h2>
        <p className={styles.stub}>
          Standalone pack opening is still to come. Packs are dealt inside a run
          today — start a Perfect Run or join a lobby to open one.
        </p>
        <div className={styles.actions}>
          <Link className={styles.openBtn} to="/run">Start a run</Link>
          <Link className={styles.secondaryBtn} to="/collection">Browse the library</Link>
        </div>
      </div>
    </AppFrame>
  );
}
