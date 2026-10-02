import { useEffect } from 'react';
import { Fit, Layout, useRive } from '@rive-app/react-canvas';
import src from './bin/fantasy.riv?url';
import './runtime';

export const CARD_W = 160;
export const CARD_GAP = 8;
export const STRIP_H = 96;

// The day's matches drawn by Rive: one FixtureCard per list item, from one canvas.
// `fixtures`: [{ id, a, b, sa, sb, fav, bestOf, mineCount }]. The contract is
// FixtureStripVM / FixtureCardVM in rive/fantasy/data.rml.
export default function FixtureStrip({ fixtures, onFail }) {
  const { rive, RiveComponent } = useRive({
    src,
    artboard: 'FixtureStrip',
    stateMachines: 'Main',
    autoplay: true,
    autoBind: true,
    layout: new Layout({ fit: Fit.Layout }),
    onLoadError: () => onFail?.(),
  });

  useEffect(() => {
    const root = rive?.viewModelInstance;
    if (!root) return;
    const list = root.list('fixtures');
    if (!list) return;
    while (list.length > 0) list.removeInstanceAt(0);
    const card = rive.viewModelByName('FixtureCardVM');
    for (const f of fixtures) {
      const item = card.instance();
      item.string('home').value = f.a;
      item.string('away').value = f.b;
      item.string('strengthText').value = `STRENGTH ${f.sa.toFixed(0)}  ${f.sb.toFixed(0)}`;
      item.string('bestOfText').value = `BO${f.bestOf}`;
      item.string('mineText').value = f.mineCount > 0 ? `${f.mineCount} OF YOURS` : '';
      item.number('homeFav').value = f.fav === f.a ? 1 : 0;
      item.number('awayFav').value = f.fav === f.b ? 1 : 0;
      item.number('mine').value = f.mineCount > 0 ? 1 : 0;
      list.addInstance(item);
    }
  }, [rive, fixtures]);

  const width = Math.max(1, fixtures.length) * (CARD_W + CARD_GAP) - CARD_GAP;
  return (
    <div style={{ width, height: STRIP_H, flexShrink: 0 }}>
      <RiveComponent aria-hidden="true" />
    </div>
  );
}
