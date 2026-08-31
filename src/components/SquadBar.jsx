import styles from './SquadBar.module.css';

// The persistent bottom bar shell: the squad dock (always legible, never a
// mode you can enter or lose) on the left, the current phase's own action
// buttons — unchanged, page-owned markup — on the right. Replaces the old
// fan/ActionBar pairing, which spent an open/close state and a hover-intent
// guard just to make five cards readable.
export default function SquadBar({ dock, children }) {
  return (
    <div className={styles.bar}>
      <div className={styles.inner}>
        <div className={styles.dockSlot} data-squad-dock="true">{dock}</div>
        <div className={styles.actions}>{children}</div>
      </div>
    </div>
  );
}
