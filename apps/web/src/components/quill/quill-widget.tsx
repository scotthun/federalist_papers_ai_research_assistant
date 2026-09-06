'use client';

import { useEffect, useState } from 'react';
import type { Answer } from '@federalist-research/shared';
import { QuillLauncher } from './quill-launcher';
import { QuillPanel } from './quill-panel';
import { usePaperContext } from './paper-context';

/** One turn of the conversation. An `answer` message starts as `status: 'streaming'` (text fills
 * in token-by-token for the confident tier, or arrives all at once for clarify/refuse) and ends
 * as either `done` (citations attach only now, per this story's Boundaries) or `connection-lost`
 * (the stream ended without a `done` event -- partial text stays visible alongside an inline
 * error, per the I/O matrix). */
export type QuillMessage =
  | { id: string; role: 'question'; text: string }
  | {
      id: string;
      role: 'answer';
      status: 'streaming' | 'done' | 'connection-lost';
      text: string;
      citations: Answer['citations'];
      confidence: Answer['confidence'] | null;
      insufficientEvidence: boolean;
    };

/** `sessionStorage` key the conversation is written to/restored from -- tab-scoped only (NFR10):
 *  a hard reload in the same tab restores it, and closing a tab then opening a genuinely new one
 *  never inherits it (native `sessionStorage` scoping, no code needed for that half). Most
 *  browsers *do* copy `sessionStorage` when a tab is explicitly duplicated or a crashed session is
 *  restored -- that's outside this story's "closes the tab, reopens the app in a new tab"
 *  scenario, not a guarantee this key relies on. Exported so the spec can assert against the same
 *  literal instead of re-declaring it. */
export const CHAT_HISTORY_SESSION_KEY = 'quill-chat-history';

/** Downgrades any restored `answer` message still carrying `status: 'streaming'` to
 *  `connection-lost` -- a real reload has no fetch/reader left to resume it, so leaving it
 *  `streaming` would show a permanent cursor with nothing behind it (Story 5.2's Boundaries). */
function sanitizeRestoredMessages(messages: QuillMessage[]): QuillMessage[] {
  return messages.map((message) =>
    message.role === 'answer' && message.status === 'streaming'
      ? { ...message, status: 'connection-lost' as const }
      : message,
  );
}

/** Per-element shape guard for a restored `sessionStorage` payload -- mirrors this codebase's
 *  existing `isPaperDetail`-style validation convention (`app/papers/[paperNumber]/page.tsx`).
 *  Guards against a stale/version-skewed payload (e.g. from a future `QuillMessage` shape change)
 *  passing through unsanitized and crashing or misrendering -- checked field-by-field rather than
 *  just trusting `Array.isArray` on the outer value. */
function isValidQuillMessage(value: unknown): value is QuillMessage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== 'string') {
    return false;
  }
  if (candidate.role === 'question') {
    return typeof candidate.text === 'string';
  }
  if (candidate.role === 'answer') {
    return (
      (candidate.status === 'streaming' ||
        candidate.status === 'done' ||
        candidate.status === 'connection-lost') &&
      typeof candidate.text === 'string' &&
      Array.isArray(candidate.citations) &&
      (candidate.confidence === null ||
        candidate.confidence === 'low' ||
        candidate.confidence === 'high') &&
      typeof candidate.insufficientEvidence === 'boolean'
    );
  }
  return false;
}

/** Lazy `useState` initializer: reads and parses any previously-persisted conversation from
 *  `sessionStorage`. Guarded the same way `quill-launcher.tsx` guards its own `sessionStorage`
 *  access (try/catch around access, e.g. Safari private-mode) -- any failure (inaccessible
 *  storage, missing/corrupt JSON, unexpected shape) degrades to an empty conversation rather than
 *  throwing and breaking the widget's first render. */
function restoreMessages(): QuillMessage[] {
  // `QuillWidget` is a client component, but Next.js still renders it once server-side for the
  // initial HTML -- `window` doesn't exist there, so this must degrade to "no history" rather
  // than throw during that server render pass (same reasoning as quill-launcher.tsx's own
  // sessionStorage guard, just needed at initializer-time here instead of only in an effect).
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const raw = window.sessionStorage.getItem(CHAT_HISTORY_SESSION_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    // Malformed individual elements (e.g. a version-skewed shape) are dropped rather than
    // rejecting the whole restore -- a single bad entry shouldn't cost the rest of a real
    // conversation.
    const validMessages = parsed.filter(isValidQuillMessage);
    return sanitizeRestoredMessages(validMessages);
  } catch {
    return [];
  }
}

/**
 * Mounted once as a sibling of `{children}` inside `RootLayout`'s `<body>` (Story 5.1's
 * Boundaries) so it's available on every page and its React state -- `isOpen` plus the full
 * `messages` list -- survives Next.js client-side `<Link>` navigations (e.g. a citation click
 * that collapses the panel and navigates to a Paper Reader) without needing any storage. Story
 * 5.2 additionally persists the conversation to `sessionStorage` (write-through on settle, never
 * mid-stream) so it also survives a hard reload/direct URL navigation within the same tab, and
 * consumes `usePaperContext()` to learn which paper (if any) is currently being read, threading
 * that into the ask request as a retrieval filter.
 *
 * Deliberately the *only* owner of `isOpen`/`messages` -- `QuillLauncher`/`QuillPanel` are both
 * presentational, so closing and reopening the panel (e.g. via a citation click) never loses the
 * conversation.
 */
export function QuillWidget() {
  const [isOpen, setIsOpen] = useState(false);
  // Lazy initializer -- runs once, on first mount, never on every render (React's own
  // `useState(initializer)` contract) -- exactly "restore on initial mount only" (Boundaries).
  const [messages, setMessages] = useState<QuillMessage[]>(() => restoreMessages());
  const { currentPaper } = usePaperContext();

  // Write-through persistence: skipped entirely while any message is still `streaming` (Story
  // 5.2's Boundaries) so a token-by-token reveal never triggers a synchronous `sessionStorage`
  // write per token -- only a settled state (a new question appended, or an answer reaching
  // `done`/`connection-lost`) persists.
  useEffect(() => {
    const isStreaming = messages.some(
      (message) => message.role === 'answer' && message.status === 'streaming',
    );
    if (isStreaming) {
      return;
    }
    try {
      window.sessionStorage.setItem(CHAT_HISTORY_SESSION_KEY, JSON.stringify(messages));
    } catch {
      // Storage inaccessible/full -- nothing to persist. The conversation still works for the
      // rest of this tab session; it just won't survive a reload, an acceptable degradation over
      // crashing (mirrors quill-launcher.tsx's own guarded sessionStorage access).
    }
  }, [messages]);

  // The chip's dismissal is ephemeral "while I keep looking at this specific paper" UI state
  // (Boundaries) -- reset to `false` on every change of the announced paper's `paperNumber`,
  // including transitions through "no paper" (see Design Notes: every fresh arrival at a paper,
  // even a repeat visit, is treated as a new "remaining on this page" episode).
  //
  // Deliberately *not* a `useEffect` keyed on `currentPaper?.paperNumber`: that pattern commits
  // and paints one render with the *stale* `chipDismissed` value before the passive effect runs
  // and corrects it, a visible one-frame "flash" of the wrong chip state. Instead this follows
  // React's own documented "adjusting state when a prop changes" recipe -- track the last-seen
  // paperNumber in state and compare it during render; a mismatch calls `setState` for both
  // values in the same render pass (React explicitly supports this), so the corrected
  // `chipDismissed` is what actually gets painted, never the stale one.
  const [chipDismissed, setChipDismissed] = useState(false);
  const [lastSeenPaperNumber, setLastSeenPaperNumber] = useState<number | undefined>(
    currentPaper?.paperNumber,
  );
  if (lastSeenPaperNumber !== currentPaper?.paperNumber) {
    setLastSeenPaperNumber(currentPaper?.paperNumber);
    setChipDismissed(false);
  }

  // The chip's visibility and the ask request's paperNumber filter are the same boolean, driven
  // by the same piece of state (Boundaries) -- never two independently-tracked flags.
  const activePaperContext = chipDismissed ? null : currentPaper;

  if (!isOpen) {
    return <QuillLauncher onOpen={() => setIsOpen(true)} />;
  }

  return (
    <QuillPanel
      messages={messages}
      setMessages={setMessages}
      onCollapse={() => setIsOpen(false)}
      paperContext={activePaperContext}
      onDismissPaperContext={() => setChipDismissed(true)}
    />
  );
}
