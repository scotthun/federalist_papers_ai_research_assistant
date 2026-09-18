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
  offsetTop: number;
  listeners: Record<string, Array<() => void>>;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
  fire: (type: string) => void;
};

function createStubVisualViewport(initialHeight: number, initialOffsetTop = 0): StubVisualViewport {
  const listeners: Record<string, Array<() => void>> = { resize: [], scroll: [] };
  return {
    height: initialHeight,
    offsetTop: initialOffsetTop,
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

  it('returns the current visualViewport height and offsetTop when supported', () => {
    const visualViewport = createStubVisualViewport(600, 0);
    const stubWindow = createStubWindow(visualViewport);

    const { result } = renderHook(() => useVisualViewportHeight(stubWindow));

    expect(result.current).toEqual({ height: 600, offsetTop: 0 });
  });

  it('updates the returned height when a resize event fires (e.g. the on-screen keyboard opens)', () => {
    const visualViewport = createStubVisualViewport(844);
    const stubWindow = createStubWindow(visualViewport);

    const { result } = renderHook(() => useVisualViewportHeight(stubWindow));
    expect(result.current).toEqual({ height: 844, offsetTop: 0 });

    act(() => {
      visualViewport.height = 400;
      visualViewport.fire('resize');
    });

    expect(result.current).toEqual({ height: 400, offsetTop: 0 });
  });

  it('updates the returned height when a scroll event fires', () => {
    const visualViewport = createStubVisualViewport(844);
    const stubWindow = createStubWindow(visualViewport);

    const { result } = renderHook(() => useVisualViewportHeight(stubWindow));

    act(() => {
      visualViewport.height = 500;
      visualViewport.fire('scroll');
    });

    expect(result.current).toEqual({ height: 500, offsetTop: 0 });
  });

  it('updates the returned offsetTop independently on a scroll event (e.g. iOS scrolling the layout viewport to reveal a focused input), distinct from a resize-driven height change', () => {
    const visualViewport = createStubVisualViewport(844, 0);
    const stubWindow = createStubWindow(visualViewport);

    const { result } = renderHook(() => useVisualViewportHeight(stubWindow));
    expect(result.current).toEqual({ height: 844, offsetTop: 0 });

    // Height shrinks via a resize event (keyboard opening)...
    act(() => {
      visualViewport.height = 400;
      visualViewport.fire('resize');
    });
    expect(result.current).toEqual({ height: 400, offsetTop: 0 });

    // ...then the visual viewport's origin shifts down via a separate scroll event, with height
    // unchanged -- the two properties must be tracked independently, not conflated into a single
    // "resize implies both changed" assumption.
    act(() => {
      visualViewport.offsetTop = 120;
      visualViewport.fire('scroll');
    });
    expect(result.current).toEqual({ height: 400, offsetTop: 120 });
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
