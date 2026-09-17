import { act, renderHook } from '@testing-library/react';
import { useVisualViewportHeight } from '../../../src/components/quill/use-visual-viewport-height';

/**
 * `jsdom` (this repo's test environment) doesn't implement `window.visualViewport` at all
 * (spec-mobile-keyboard-panel-clipping.md's Code Map) -- every test here builds its own minimal
 * stand-in, matching the hook's injectable-`targetWindow`-arg shape rather than monkey-patching
 * the real global.
 */
type StubVisualViewport = {
  height: number;
  listeners: Record<string, Array<() => void>>;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
  fire: (type: string) => void;
};

function createStubVisualViewport(initialHeight: number): StubVisualViewport {
  const listeners: Record<string, Array<() => void>> = { resize: [], scroll: [] };
  return {
    height: initialHeight,
    listeners,
    addEventListener(type, listener) {
      listeners[type]?.push(listener);
    },
    removeEventListener(type, listener) {
      listeners[type] = (listeners[type] ?? []).filter((existing) => existing !== listener);
    },
    fire(type) {
      for (const listener of listeners[type] ?? []) {
        listener();
      }
    },
  };
}

function createStubWindow(visualViewport: StubVisualViewport | undefined): Window {
  return { visualViewport } as unknown as Window;
}

describe('useVisualViewportHeight', () => {
  it('returns undefined when visualViewport is unsupported', () => {
    const stubWindow = createStubWindow(undefined);

    const { result } = renderHook(() => useVisualViewportHeight(stubWindow));

    expect(result.current).toBeUndefined();
  });

  it('returns the current visualViewport height when supported', () => {
    const visualViewport = createStubVisualViewport(600);
    const stubWindow = createStubWindow(visualViewport);

    const { result } = renderHook(() => useVisualViewportHeight(stubWindow));

    expect(result.current).toBe(600);
  });

  it('updates the returned height when a resize event fires (e.g. the on-screen keyboard opens)', () => {
    const visualViewport = createStubVisualViewport(844);
    const stubWindow = createStubWindow(visualViewport);

    const { result } = renderHook(() => useVisualViewportHeight(stubWindow));
    expect(result.current).toBe(844);

    act(() => {
      visualViewport.height = 400;
      visualViewport.fire('resize');
    });

    expect(result.current).toBe(400);
  });

  it('updates the returned height when a scroll event fires', () => {
    const visualViewport = createStubVisualViewport(844);
    const stubWindow = createStubWindow(visualViewport);

    const { result } = renderHook(() => useVisualViewportHeight(stubWindow));

    act(() => {
      visualViewport.height = 500;
      visualViewport.fire('scroll');
    });

    expect(result.current).toBe(500);
  });

  it('cleans up its resize/scroll listeners on unmount', () => {
    const visualViewport = createStubVisualViewport(844);
    const stubWindow = createStubWindow(visualViewport);

    const { unmount } = renderHook(() => useVisualViewportHeight(stubWindow));
    expect(visualViewport.listeners.resize).toHaveLength(1);
    expect(visualViewport.listeners.scroll).toHaveLength(1);

    unmount();

    expect(visualViewport.listeners.resize).toHaveLength(0);
    expect(visualViewport.listeners.scroll).toHaveLength(0);
  });

  it('falls back to undefined when called with no window at all (e.g. server render)', () => {
    const { result } = renderHook(() => useVisualViewportHeight(undefined));

    expect(result.current).toBeUndefined();
  });
});
