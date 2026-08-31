import { useEffect, useState } from 'react';

// True for anything that wants its own Tab/keystrokes — an <input>, a
// <textarea>, a contenteditable node, or an ARIA textbox. Duck-typed against
// the DOM element shape (tagName / isContentEditable / getAttribute) rather
// than `instanceof HTMLElement`, so it's testable with a plain object.
export function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  if (el.isContentEditable) return true;
  return el.getAttribute?.('role') === 'textbox';
}

// Hold-Tab-to-peek: `true` for as long as Tab is held, `false` the instant
// it's released — the VALORANT/CS scoreboard gesture. Tab is fully consumed
// (preventDefault) so it never traverses focus, EXCEPT:
//   - Shift+Tab, left alone so keyboard users can still traverse backward
//   - inside a text input/textarea/contenteditable, where Tab should type or
//     move between fields like normal
// Also drops the peek on blur/tab-hidden, so alt-tabbing away or switching
// browser tabs while Tab is held can never leave it stuck open.
//
// Escape isn't handled here — closing a pinned sheet on Esc is the sheet's
// own concern (it knows whether the current action allows dismissal), not a
// property of the key that opens it.
export default function usePeekKey({ enabled = true } = {}) {
  const [peeking, setPeeking] = useState(false);

  useEffect(() => {
    if (!enabled) return undefined;

    function onKeyDown(e) {
      if (e.key !== 'Tab' || e.shiftKey) return;
      if (isTypingTarget(document.activeElement)) return;
      e.preventDefault();
      if (!e.repeat) setPeeking(true);
    }
    function onKeyUp(e) {
      if (e.key === 'Tab') setPeeking(false);
    }
    function onDrop() { setPeeking(false); }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onDrop);
    document.addEventListener('visibilitychange', onDrop);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onDrop);
      document.removeEventListener('visibilitychange', onDrop);
    };
  }, [enabled]);

  // Masked rather than reset via a second effect: `enabled` flipping false
  // doesn't need to force internal state, it just needs the outside world to
  // stop seeing a stale `true` — and this reads correctly the instant it
  // changes, no extra render in between.
  return enabled && peeking;
}
