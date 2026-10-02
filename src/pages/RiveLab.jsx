import { useState } from 'react';
import SlotPlate from '../rive/SlotPlate';

// Dev-only spike surface (not routed in production builds).
const SAMPLES = [
  { handle: 'aspas', roleLabel: 'DUELIST', valueText: '5.58M', statusText: 'PLAYS TODAY', form: 60 },
  { handle: 'Lightningfast', roleLabel: 'SENTINEL', valueText: '12.04M', statusText: 'NOT PLAYING', form: 100 },
  { handle: 'Brädi', roleLabel: 'FLEX', valueText: '2.56M', statusText: 'PLAYS TODAY', form: 0 },
];

export default function RiveLab() {
  const [i, setI] = useState(0);
  const [loaded, setLoaded] = useState(false);
  return (
    <main style={{ padding: 24, color: 'var(--ink)', background: 'var(--bg)', minHeight: '100vh' }}>
      <h1>Rive lab</h1>
      <p data-testid="status">{loaded ? 'rive loaded' : 'loading'}</p>
      <SlotPlate {...SAMPLES[i]} onReady={() => setLoaded(true)} />
      <p>
        {SAMPLES.map((_, n) => <button key={n} onClick={() => setI(n)} style={{ marginRight: 8 }}>sample {n + 1}</button>)}
      </p>
    </main>
  );
}
