'use client';

import { useEffect, useState } from 'react';

/**
 * Tracks `window.visualViewport`'s current height (spec-mobile-keyboard-panel-clipping.md) -- the
 * *actual visible* viewport, separate from the layout viewport, which shrinks when an on-screen
 * keyboard opens and grows back when it closes. Feature-detected: `jsdom` (this repo's test
 * environment) doesn't implement `visualViewport` at all, and some older/unusual browsers lack it
 * too, so this returns `undefined` whenever the API isn't present rather than throwing -- callers
 * fall back to their own pre-existing sizing in that case (this spec's Boundaries: "no worse than
 * the current state").
 *
 * Takes `targetWindow` as a parameter (defaulting to the real `window`) rather than reading the
 * global directly, matching this codebase's pure-function/injectable-dependency convention so a
 * test can pass a stub `Window`-shaped object without needing to monkey-patch the global.
 */
export function useVisualViewportHeight(targetWindow: Window | undefined = typeof window === 'undefined' ? undefined : window): number | undefined {
  const [height, setHeight] = useState<number | undefined>(
    () => targetWindow?.visualViewport?.height,
  );

  useEffect(() => {
    const visualViewport = targetWindow?.visualViewport;
    if (!visualViewport) {
      // No visualViewport support (or no window at all, e.g. server render) -- nothing to
      // subscribe to; `height` stays `undefined` so callers know to fall back.
      setHeight(undefined);
      return;
    }

    // Sync immediately on mount/target change too, not just on the next resize/scroll -- covers
    // the case where the keyboard is already open (or the target window changed) before this
    // effect first runs.
    setHeight(visualViewport.height);

    function handleViewportChange() {
      setHeight(visualViewport?.height);
    }

    visualViewport.addEventListener('resize', handleViewportChange);
    visualViewport.addEventListener('scroll', handleViewportChange);
    return () => {
      visualViewport.removeEventListener('resize', handleViewportChange);
      visualViewport.removeEventListener('scroll', handleViewportChange);
    };
  }, [targetWindow]);

  return height;
}
