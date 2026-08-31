import { useEffect, useState } from 'react';

// One matchMedia subscription, shared by anything that needs to react to a
// media query in JS rather than CSS (e.g. PlayerCard's displayScale, which is
// a prop CSS can't reach). SSR-safe: matches nothing until mounted.
export default function useMediaQuery(query) {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}
