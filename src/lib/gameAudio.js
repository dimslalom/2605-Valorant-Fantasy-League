let context = null;
let scaleStep = 0;
let scaleReset = 0;

function audioContext(create = true) {
  if (typeof window === 'undefined') return null;
  const AudioContext = window.AudioContext ?? window.webkitAudioContext;
  if (!AudioContext) return null;
  if (!context && !create) return null;
  context ??= new AudioContext();
  if (context.state === 'suspended') context.resume().catch(() => {});
  return context;
}

function tone(frequency, duration, { endFrequency = frequency, gain = 0.012, type = 'sine', create = true } = {}) {
  const ctx = audioContext(create);
  if (!ctx) return;
  const now = ctx.currentTime;
  const oscillator = ctx.createOscillator();
  const volume = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, now);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), now + duration);
  volume.gain.setValueAtTime(0.0001, now);
  volume.gain.exponentialRampToValueAtTime(gain, now + Math.min(0.006, duration / 3));
  volume.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  oscillator.connect(volume).connect(ctx.destination);
  oscillator.start(now);
  oscillator.stop(now + duration + 0.01);
}

// `step` climbs a pentatonic scale, so a run of reveals rises in pitch (Balatro's scoring trick).
export function playUiSound(kind, step = 0) {
  switch (kind) {
    case 'reveal': {
      const scale = [392, 440, 523.25, 587.33, 659.25, 784, 880];
      tone(scale[step % scale.length], 0.12, { gain: 0.012, type: 'triangle' });
      break;
    }
    case 'rattle':
      tone(140, 0.05, { gain: 0.012, type: 'square' });
      break;
    case 'jackpot':
      tone(70, 0.3, { endFrequency: 45, gain: 0.03, type: 'sine' });
      tone(1046.5, 0.18, { gain: 0.01, type: 'triangle' });
      tone(1568, 0.26, { gain: 0.007, type: 'triangle' });
      break;
    case 'hover':
      // Browsers only allow audio after user activation. Do not create a
      // suspended context on the first hover; once a click/press has armed
      // audio, later hover ticks play normally.
      tone(3800, 0.015, { gain: 0.004, type: 'square', create: false });
      break;
    case 'lift':
      tone(1200, 0.06, { endFrequency: 2400, gain: 0.006, type: 'triangle' });
      break;
    case 'drop':
      tone(180, 0.08, { gain: 0.018, type: 'triangle' });
      tone(1200, 0.035, { gain: 0.006, type: 'square' });
      break;
    case 'flip':
      tone(900, 0.11, { endFrequency: 1800, gain: 0.008, type: 'triangle' });
      break;
    case 'igl':
      tone(160, 0.16, { endFrequency: 110, gain: 0.022, type: 'triangle' });
      tone(980, 0.06, { gain: 0.008, type: 'square' });
      break;
    case 'specialty':
      tone(760, 0.075, { endFrequency: 1140, gain: 0.007, type: 'triangle' });
      break;
    case 'score':
      tone(520, 0.045, { gain: 0.006, type: 'square' });
      break;
    case 'impact':
      tone(76, 0.18, { endFrequency: 52, gain: 0.024, type: 'sine' });
      tone(880, 0.055, { endFrequency: 440, gain: 0.006, type: 'triangle' });
      break;
    case 'select': {
      const scale = [220, 261.63, 293.66, 329.63, 392];
      tone(scale[scaleStep % scale.length], 0.09, { gain: 0.012, type: 'triangle' });
      scaleStep += 1;
      clearTimeout(scaleReset);
      scaleReset = setTimeout(() => { scaleStep = 0; }, 800);
      break;
    }
    default:
      break;
  }
}
