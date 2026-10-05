import { useEffect, useState } from 'react';
import { nextEditableWeek } from './weeklyBingo';

export default function useBingoUpdate(username, pathname) {
  const [bingo, setBingo] = useState(null);
  useEffect(() => {
    if (!username) return;
    const controller = new AbortController();
    const load = async () => {
      try {
        const week = nextEditableWeek(Math.floor(Date.now() / 1000));
        const response = await fetch(`/api/weekly-bingo?week=${week}`, { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('Unavailable');
        const data = await response.json();
        if (!controller.signal.aborted) setBingo({ ...data, username, ended: data.ended || data.endsAt <= Date.now() / 1000 });
      } catch (error) {
        if (error.name !== 'AbortError') setBingo(null);
      }
    };
    load();
    const refresh = () => { if (document.visibilityState === 'visible') load(); };
    const timer = setInterval(refresh, 60000);
    window.addEventListener('opval-wallet-changed', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener('opval-wallet-changed', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [username, pathname]);
  const current = bingo?.username === username ? bingo : null;
  return { bingo: current, needsBingo: Boolean(current && !current.ended && current.cards.length === 0) };
}

