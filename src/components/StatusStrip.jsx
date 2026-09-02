import styles from './StatusStrip.module.css';

// The page's identity row: mark, title, and an optional count or controls.
//
// `crumb` renders as the page's <h1>. Every page previously carried its title
// in a decorative <span>, so no page had a heading at all - screen-reader users
// got a document outline with nothing in it.
export default function StatusStrip({ crumb, count, children }) {
  return (
    <div className={styles.strip}>
      <div className={styles.left}>
        <h1 className={styles.crumb}>{crumb}</h1>
        {count != null && <span className={styles.count}>{count}</span>}
      </div>

      {children && <div className={styles.right}>{children}</div>}
    </div>
  );
}
