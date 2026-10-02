import { useEffect } from 'react';
import { useRive, useViewModelInstanceNumber, useViewModelInstanceString } from '@rive-app/react-canvas';
import src from './bin/fantasy.riv?url';
import './runtime';

// One lineup slot drawn by Rive. The data contract is SlotPlateVM in
// rive/fantasy/data.rml; every value is set by name from the app.
export default function SlotPlate({ handle, roleLabel, valueText, statusText, form, onReady }) {
  const { rive, RiveComponent } = useRive({
    src,
    artboard: 'SlotPlate',
    stateMachines: 'Main',
    autoplay: true,
    autoBind: true,
    onLoad: () => onReady?.(),
  });
  const vmi = rive?.viewModelInstance ?? null;
  const { setValue: setHandle } = useViewModelInstanceString('handle', vmi);
  const { setValue: setRole } = useViewModelInstanceString('roleLabel', vmi);
  const { setValue: setValueText } = useViewModelInstanceString('valueText', vmi);
  const { setValue: setStatus } = useViewModelInstanceString('statusText', vmi);
  const { setValue: setForm } = useViewModelInstanceNumber('form', vmi);

  useEffect(() => { setHandle?.(handle); }, [setHandle, handle]);
  useEffect(() => { setRole?.(roleLabel); }, [setRole, roleLabel]);
  useEffect(() => { setValueText?.(valueText); }, [setValueText, valueText]);
  useEffect(() => { setStatus?.(statusText); }, [setStatus, statusText]);
  useEffect(() => { setForm?.(form); }, [setForm, form]);

  return <RiveComponent aria-hidden="true" style={{ width: 343, height: 72 }} />;
}
