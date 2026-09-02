'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

/** `sessionStorage` flag gating the first-visit-only pulse + auto-tooltip (DESIGN.md's
 * "Launcher": "First-visit-only ... then settles to icon-only permanently for that session").
 * Deliberately not the conversation-persistence Story 5.2 owns -- this is a one-bit
 * "has this session's discoverability moment already happened" flag, nothing more. */
const TOOLTIP_SESSION_KEY = 'quill-tooltip-shown';

/**
 * The collapsed, floating quill launcher (DESIGN.md's "Launcher (quill)"): a 56px circle, docked
 * bottom-right 16px from both edges, `launcher-fill` background with a permanent idle gold halo.
 * On the first visit this session it also pulses once and auto-opens a tooltip, both suppressed
 * for the rest of the session via `TOOLTIP_SESSION_KEY` -- checked/set in an effect (not during
 * render) since `sessionStorage` is only ever available client-side.
 */
export function QuillLauncher({ onOpen }: { onOpen: () => void }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [pulseOnce, setPulseOnce] = useState(false);

  useEffect(() => {
    // `sessionStorage` access can throw (e.g. Safari private-mode, or any environment where
    // storage is disabled/blocked) -- default to showing the tooltip in that case rather than
    // letting the throw break the launcher's first render.
    let alreadyShown = false;
    try {
      alreadyShown = window.sessionStorage.getItem(TOOLTIP_SESSION_KEY) !== null;
    } catch {
      alreadyShown = false;
    }

    if (!alreadyShown) {
      setShowTooltip(true);
      setPulseOnce(true);
      try {
        window.sessionStorage.setItem(TOOLTIP_SESSION_KEY, 'true');
      } catch {
        // Storage inaccessible -- nothing to persist. The tooltip may simply show again on a
        // future mount within the same session, an acceptable degradation over crashing.
      }
    }
  }, []);

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
      {showTooltip && (
        <div
          role="status"
          className="max-w-[220px] rounded-md bg-quill-inverse-surface px-3 py-2 font-serif text-xs text-quill-inverse-on-surface shadow-md"
        >
          Ask me about the Federalist Papers →
        </div>
      )}
      <button
        type="button"
        onClick={() => {
          setShowTooltip(false);
          onOpen();
        }}
        aria-label="Ask the Archive"
        className={cn(
          'flex h-14 w-14 items-center justify-center rounded-full bg-quill-launcher-fill text-2xl shadow-[0_0_0_6px_rgba(201,162,39,0.25)] transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-quill-accent-gold focus-visible:ring-offset-2',
          pulseOnce && 'quill-pulse-once',
        )}
      >
        <span aria-hidden="true" style={{ display: 'inline-block', transform: 'rotate(-40deg)' }}>
          🪶
        </span>
      </button>
    </div>
  );
}
