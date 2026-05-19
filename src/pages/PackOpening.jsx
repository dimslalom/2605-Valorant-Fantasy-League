import styles from './PackOpening.module.css';

export default function PackOpening() {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Pack Opening</h1>
      <p className={styles.stub}>Pack opening coming soon</p>
      <button
        className={styles.openBtn}
        onClick={() => console.log('Open Pack clicked')}
      >
        Open Pack
      </button>
    </div>
  );
}
