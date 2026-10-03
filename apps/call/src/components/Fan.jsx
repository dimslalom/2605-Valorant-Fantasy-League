import CardThumb from './CardThumb';

// A hand of cards on an arc, dealt in one by one. Pass pids best first: the best card lands in
// the middle and on top, the rest alternate outwards. Overlap is worked out in CSS from the
// count and the row width, so any hand size fits. `tagOf(pid)` puts a label under a card.
export default function Fan({ pids, cardOf, scale, picked, onPick, tagOf, delay = 0, arc = 2.5 }) {
  const row = pids.reduce((out, pid, k) => (k % 2 ? [...out, pid] : [pid, ...out]), []);
  return (
    <div className="hand" style={{ '--n': row.length, '--w': `${400 * scale}px` }}>
      {row.map((pid, i) => {
        const off = i - (row.length - 1) / 2;
        const tag = tagOf?.(pid);
        return (
          <div key={pid} className="hand-card" data-picked={picked === pid} style={{ '--r': `${off * 3.5}deg`, '--y': `${off * off * arc}px`, '--d': `${delay + i * 50}ms`, zIndex: 10 - Math.round(Math.abs(off) * 2) }}>
            <CardThumb card={cardOf(pid)} scale={scale} selected={picked === pid} onClick={onPick && (() => onPick(pid))} />
            {tag && <span className="tracked-tag" data-star={tag.star || undefined}>{tag.label}</span>}
          </div>
        );
      })}
    </div>
  );
}
