import ModeRail from './ModeRail';
import styles from './AppFrame.module.css';

// Mounts the mode rail and reserves space for it, once. Pages used to render
// <ModeRail /> themselves and re-declare `.frame { margin-left: 56px }` in
// their own stylesheet — five copies of a number that had to match the rail's
// width by hand.
//
// The iOS viewport fixes (100dvh, safe-area insets) live here too, so a page
// gets them by being a page rather than by remembering to opt in.
//
// `bare` skips the inner content wrapper for pages that manage their own
// flex/scroll structure and only want the rail and the frame reservation.
export default function AppFrame({ children, bare = false }) {
  return (
    <div className={styles.shell}>
      <ModeRail />
      <div className={styles.frame}>
        {bare ? children : <div className={styles.content}>{children}</div>}
      </div>
    </div>
  );
}
