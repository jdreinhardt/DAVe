import { useEffect, useRef } from 'react';

function isEditable(el: Element | null): boolean {
  if (!el) return false;
  const tag = (el as HTMLElement).tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return (el as HTMLElement).isContentEditable;
}

interface HotkeyOptions {
  // When true (default), the handler is suppressed if focus is inside an editable element.
  // Set to false for actions like Escape that should work even while typing.
  skipWhenEditable?: boolean;
}

export function useHotkey(
  key: string,
  handler: (e: KeyboardEvent) => void,
  options: HotkeyOptions = {},
) {
  const { skipWhenEditable = true } = options;
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== key) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (skipWhenEditable && isEditable(document.activeElement)) return;
      handlerRef.current(e);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [key, skipWhenEditable]);
}
