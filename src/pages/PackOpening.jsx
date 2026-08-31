import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import AppFrame from '../components/AppFrame';
import StatusStrip from '../components/StatusStrip';
import PackRip from '../components/PackRip';
import TacticalButton from '../components/TacticalButton';
import { mulberry32, samplePack } from '../engine/perfectRun';
import allCards from '../data/cards.json';
import styles from './PackOpening.module.css';

// A standalone preview of the pack-open moment shared by every mode (Perfect
// Run's draft/pack-swap, Multiplayer's draft/consolation) — this page just
// deals a throwaway five-card pack through the same PackRip/PackTear that
// gameplay uses, non-interactively, so there's something to look at with no
// run or lobby behind it.
export default function PackOpening() {
  const [packId, setPackId] = useState(0);
  const cards = useMemo(() => {
    const rng = mulberry32(0x6a1cd35 ^ packId);
    return samplePack(rng, allCards, new Set());
  }, [packId]);

  return (
    <AppFrame>
      <StatusStrip crumb="Pack Opening" count="Preview" />

      <div className={styles.content}>
        <PackRip
          ripId={packId + 1}
          choices={cards}
          interactive={false}
          displayScale={0.5}
        />

        <div className={styles.actions}>
          <TacticalButton className={styles.openBtn} onClick={() => setPackId(id => id + 1)}>
            Open another pack
          </TacticalButton>
          <Link className={styles.secondaryBtn} to="/run">Start a run</Link>
        </div>
      </div>
    </AppFrame>
  );
}
