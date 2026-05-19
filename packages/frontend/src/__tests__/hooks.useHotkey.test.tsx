import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { useHotkey } from '../hooks/useHotkey.js';

function pressKey(key: string, opts?: Partial<KeyboardEventInit>) {
  fireEvent.keyDown(document, { key, ...opts });
}

describe('useHotkey', () => {
  it('calls handler when the registered key is pressed', () => {
    const handler = vi.fn();
    renderHook(() => useHotkey('n', handler));
    pressKey('n');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not fire for a different key', () => {
    const handler = vi.fn();
    renderHook(() => useHotkey('n', handler));
    pressKey('m');
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not fire when Meta key is held', () => {
    const handler = vi.fn();
    renderHook(() => useHotkey('n', handler));
    pressKey('n', { metaKey: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not fire when Ctrl key is held', () => {
    const handler = vi.fn();
    renderHook(() => useHotkey('n', handler));
    pressKey('n', { ctrlKey: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not fire when Alt key is held', () => {
    const handler = vi.fn();
    renderHook(() => useHotkey('n', handler));
    pressKey('n', { altKey: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not fire when focus is inside an input (skipWhenEditable: true by default)', () => {
    const handler = vi.fn();
    renderHook(() => useHotkey('n', handler));

    // Create and focus an input element
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    pressKey('n');
    expect(handler).not.toHaveBeenCalled();

    document.body.removeChild(input);
  });

  it('fires when focus is in input and skipWhenEditable is false', () => {
    const handler = vi.fn();
    renderHook(() => useHotkey('Escape', handler, { skipWhenEditable: false }));

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    pressKey('Escape');
    expect(handler).toHaveBeenCalledTimes(1);

    document.body.removeChild(input);
  });

  it('does not fire after the component unmounts', () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() => useHotkey('n', handler));
    unmount();
    pressKey('n');
    expect(handler).not.toHaveBeenCalled();
  });

  it('always uses the latest handler (ref update)', () => {
    let counter = 0;
    const { rerender } = renderHook(({ count }: { count: number }) =>
      useHotkey('n', () => { counter = count; }), {
      initialProps: { count: 1 },
    });
    rerender({ count: 2 });
    pressKey('n');
    expect(counter).toBe(2);
  });
});
