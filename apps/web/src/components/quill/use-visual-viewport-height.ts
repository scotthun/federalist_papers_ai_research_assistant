'use client';

import { useEffect, useState } from 'react';

export type VisualViewportMetrics = {
  height: number;
  /** How far the visual viewport's origin has shifted down within the layout viewport
   *  (spec-mobile-keyboard-panel-offset.md) -- non-zero once the browser scrolls the layout
   *  viewport to reveal a focused input while the keyboard is open (observed across browsers, not
   *  just iOS Safari). A `position: fixed` element anchored at a static `top: 0` doesn't track
   *  this shift on its own, so callers must apply it explicitly. */
  offsetTop: number;
};

/**
 * Tracks `window.visualViewport`'s current `height` and `offsetTop`
 * (spec-mobile-keyboard-panel-clipping.md, extended by spec-mobile-keyboard-panel-offset.md) -- the
 * *actual visible* viewport, separate from the layout viewport, which shrinks (and whose origin
 * shifts down) when an on-screen keyboard opens, and returns to its original size/position when it
 * closes. Feature-detected: `jsdom` (this repo's test environment) doesn't implement
 * `visualViewport` at all, and some older/unusual browsers lack it too, so this returns `undefined`
 * whenever the API isn't present rather than throwing -- callers fall back to their own
 * pre-existing sizing in that case (this spec's Boundaries: "no worse than the current state").
 *
 * Takes `targetWindow` as a parameter (defaulting to the real `window`) rather than reading the
 * global directly, matching this codebase's pure-function/injectable-dependency convention so a
 * test can pass a stub `Window`-shaped object without needing to monkey-patch the global.
 */
export function useVisualViewportHeight(targetWindow: Window | undefined = typeof window === 'undefined' ? undefined : window): VisualViewportMetrics | undefined {
  const [metrics, setMetrics] = useState<VisualViewportMetrics | undefined>(() => {
    const visualViewport = targetWindow?.visualViewport;
    return visualViewport
      ? { height: visualViewport.height, offsetTop: visualViewport.offsetTop }
      : undefined;
  });

  useEffect(() => {
    const visualViewport = targetWindow?.visualViewport;
    if (!visualViewport) {
      // No visualViewport support (or no window at all, e.g. server render) -- nothing to
      // subscribe to; `metrics` stays `undefined` so callers know to fall back.
      setMetrics(undefined);
      return;
    }

    // Sync immediately on mount/target change too, not just on the next resize/scroll -- covers
    // the case where the keyboard is already open (or the target window changed) before this
    // effect first runs.
    setMetrics({ height: visualViewport.height, offsetTop: visualViewport.offsetTop });

    function handleViewportChange() {
      // Re-checks `visualViewport` here (rather than relying on the outer `if (!visualViewport)`
      // guard's narrowing, which TypeScript doesn't retain across a nested function's closure) so
      // this can read `.height`/`.offsetTop` directly with no `?? 0` fallback and no non-null
      // assertion: per the Visual Viewport API spec, they're always defined numbers whenever
      // `visualViewport` itself exists, so this guard is trivially true in practice.
      if (!visualViewport) {
        return;
      }
      setMetrics({ height: visualViewport.height, offsetTop: visualViewport.offsetTop });
    }

    visualViewport.addEventListener('resize', handleViewportChange);
    visualViewport.addEventListener('scroll', handleViewportChange);
    return () => {
      visualViewport.removeEventListener('resize', handleViewportChange);
      visualViewport.removeEventListener('scroll', handleViewportChange);
    };
  }, [targetWindow]);

  return metrics;
}
