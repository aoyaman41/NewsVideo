import { useEffect, useRef } from 'react';
/** One focus scope for confirmation and media dialogs; Tab cannot escape to the page. */
export function useModalFocus(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open || !ref.current) return;
    const container = ref.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const elements = () => [...container.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')].filter((element) => element.getClientRects().length > 0);
    (elements()[0] ?? container).focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); }
      if (event.key !== 'Tab') return;
      const items = elements(); const first = items[0] ?? container; const last = items.at(-1) ?? container;
      if (event.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !container.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    const focusin = (event: FocusEvent) => { if (!container.contains(event.target as Node)) (elements()[0] ?? container).focus(); };
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('focusin', focusin);
    return () => { document.removeEventListener('keydown', keydown, true); document.removeEventListener('focusin', focusin); previous?.focus(); };
  }, [open]);
  return ref;
}
