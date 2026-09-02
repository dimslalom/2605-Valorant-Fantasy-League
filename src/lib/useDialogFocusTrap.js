import { useEffect, useRef } from 'react';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function useDialogFocusTrap(active, rootRef, preferredRef) {
  const returnFocusRef = useRef(null);

  useEffect(() => {
    if (!active) return undefined;
    returnFocusRef.current = document.activeElement;
    const root = rootRef.current;
    const initial = preferredRef?.current ?? root?.querySelector(FOCUSABLE) ?? root;
    initial?.focus?.();

    function trapTab(event) {
      if (event.key !== 'Tab' || !rootRef.current) return;
      const items = [...rootRef.current.querySelectorAll(FOCUSABLE)]
        .filter(element => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
      if (!items.length) {
        event.preventDefault();
        rootRef.current.focus();
        return;
      }
      const first = items[0];
      const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', trapTab);
    return () => {
      document.removeEventListener('keydown', trapTab);
      returnFocusRef.current?.focus?.();
    };
  }, [active, preferredRef, rootRef]);
}
