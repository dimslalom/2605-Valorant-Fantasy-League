import styles from './Split.module.css';

// Two or more readouts side by side, separated by a hairline rule rather than
// a typed " · " - the separator is layout, not a character in the copy.
// Empty parts (null, false, '') are dropped, so callers can pass optional
// pieces inline without leaving a dangling rule.
export default function Split({ parts, className }) {
  const shown = parts.filter(part => part !== null && part !== undefined && part !== false && part !== '');
  return (
    <span className={className ? `${styles.split} ${className}` : styles.split}>
      {shown.map((part, index) => <span key={index} className={styles.part}>{part}</span>)}
    </span>
  );
}
