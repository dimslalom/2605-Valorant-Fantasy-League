import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppFrame from '../components/AppFrame';
import StatusStrip from '../components/StatusStrip';
import DeckBuilder from '../components/DeckBuilder';
import allCards from '../data/cards.json';
import styles from './PreMatch.module.css';

export default function PreMatch() {
  const navigate = useNavigate();

  // Initial starter squad (first 5 cards in pool)
  const [squad, setSquad] = useState(() => allCards.slice(0, 5));
  const [iglId, setIglId] = useState(() => allCards[0]?.id ?? null);
  const [strategy, setStrategy] = useState('aggressive');

  const ready = squad.filter(Boolean).length === 5;

  const handleStartMatch = () => {
    if (!ready) return;
    navigate('/match', {
      state: {
        playerSquad: squad.filter(Boolean),
        iglId,
        strategy,
        isImportant: true,
      },
    });
  };

  return (
    <AppFrame>
      <StatusStrip crumb="Pre-Match Setup" count="Lock-In" />

      <div className={styles.content}>
        <div className={styles.headerBar}>
          <div>
            <span className={styles.kicker}>Card table setup</span>
            <h2 className={styles.title}>Pre-Match Roster &amp; Strategy</h2>
          </div>
          <button
            className={styles.startBtn}
            disabled={!ready}
            onClick={handleStartMatch}
          >
            {ready ? 'Lock in & start match →' : `Fill ${5 - squad.filter(Boolean).length} more slots`}
          </button>
        </div>

        <DeckBuilder
          squad={squad}
          onUpdateSquad={setSquad}
          iglId={iglId}
          onSelectIgl={setIglId}
          strategy={strategy}
          onSelectStrategy={setStrategy}
        />
      </div>
    </AppFrame>
  );
}
