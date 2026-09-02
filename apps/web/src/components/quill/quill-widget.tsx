'use client';

import { useState } from 'react';
import type { Answer } from '@federalist-research/shared';
import { QuillLauncher } from './quill-launcher';
import { QuillPanel } from './quill-panel';

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

/**
 * Mounted once as a sibling of `{children}` inside `RootLayout`'s `<body>` (Story 5.1's
 * Boundaries) so it's available on every page and its React state -- `isOpen` plus the full
 * `messages` list -- survives Next.js client-side `<Link>` navigations (e.g. a citation click
 * that collapses the panel and navigates to a Paper Reader) without needing any storage. Story
 * 5.2 owns cross-tab/sessionStorage persistence of the conversation itself; this story only needs
 * the state to outlive a client-side navigation, which mounting at the layout level already gives
 * for free.
 *
 * Deliberately the *only* owner of `isOpen`/`messages` -- `QuillLauncher`/`QuillPanel` are both
 * presentational, so closing and reopening the panel (e.g. via a citation click) never loses the
 * conversation.
 */
export function QuillWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<QuillMessage[]>([]);

  if (!isOpen) {
    return <QuillLauncher onOpen={() => setIsOpen(true)} />;
  }

  return (
    <QuillPanel
      messages={messages}
      setMessages={setMessages}
      onCollapse={() => setIsOpen(false)}
    />
  );
}
