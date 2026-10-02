import { useEffect } from 'react';
import { useRive, useViewModelInstanceNumber, useViewModelInstanceString } from '@rive-app/react-canvas';
import src from './bin/fantasy.riv?url';
import './runtime';

// The broadcast's running total. Setting `total` makes the number count up inside
// Rive; `deltaText` + `deltaShown` flash the latest map's points beside it.
// Contract: PointsTickerVM in rive/fantasy/data.rml.
export default function PointsTicker({ total, deltaText = '', deltaShown = false, label = 'YOUR POINTS TODAY' }) {
  const { rive, RiveComponent } = useRive({ src, artboard: 'PointsTicker', stateMachines: 'Main', autoplay: true, autoBind: true });
  const vmi = rive?.viewModelInstance ?? null;
  const { setValue: setTotal } = useViewModelInstanceNumber('total', vmi);
  const { setValue: setDelta } = useViewModelInstanceString('deltaText', vmi);
  const { setValue: setShown } = useViewModelInstanceNumber('deltaShown', vmi);
  const { setValue: setLabel } = useViewModelInstanceString('label', vmi);

  useEffect(() => { setTotal?.(total); }, [setTotal, total]);
  useEffect(() => { setDelta?.(deltaText); }, [setDelta, deltaText]);
  useEffect(() => { setShown?.(deltaShown ? 1 : 0); }, [setShown, deltaShown]);
  useEffect(() => { setLabel?.(label); }, [setLabel, label]);

  return (
    <div style={{ width: 343, height: 112 }}>
      <RiveComponent aria-hidden="true" />
    </div>
  );
}
