'use client';

import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from 'react';
import Link from 'next/link';
import {
  parseAskStreamEventLine,
  type AskStreamEvent,
} from '@/lib/ask-stream';
import { cn } from '@/lib/utils';
import type { QuillMessage } from './quill-widget';

type PanelProps = {
  messages: QuillMessage[];
  setMessages: Dispatch<SetStateAction<QuillMessage[]>>;
  onCollapse: () => void;
};

let messageIdCounter = 0;
function nextMessageId(prefix: string): string {
  messageIdCounter += 1;
  return `${prefix}-${messageIdCounter}`;
}

function appendToken(
  answerId: string,
  text: string,
  setMessages: Dispatch<SetStateAction<QuillMessage[]>>,
) {
  setMessages((prev) =>
    prev.map((message) =>
      message.id === answerId && message.role === 'answer'
        ? { ...message, text: message.text + text }
        : message,
    ),
  );
}

function finalizeAnswer(
  answerId: string,
  event: Extract<AskStreamEvent, { type: 'done' }>,
  setMessages: Dispatch<SetStateAction<QuillMessage[]>>,
) {
  setMessages((prev) =>
    prev.map((message) =>
      message.id === answerId && message.role === 'answer'
        ? {
            ...message,
            status: 'done' as const,
            // The full, already-verified answer text from the `done` event is authoritative --
            // overwrites whatever was accumulated from `token` events so a dropped/duplicated
            // token chunk can never leave the final render subtly wrong.
            text: event.answer,
            citations: event.citations,
            confidence: event.confidence,
            insufficientEvidence: event.insufficientEvidence,
          }
        : message,
    ),
  );
}

function markConnectionLost(
  answerId: string,
  setMessages: Dispatch<SetStateAction<QuillMessage[]>>,
) {
  setMessages((prev) =>
    prev.map((message) =>
      message.id === answerId && message.role === 'answer'
        ? { ...message, status: 'connection-lost' as const }
        : message,
    ),
  );
}

/**
 * The open quill panel (DESIGN.md's "Chat panel"): dog-eared chrome, header band, question input
 * (focused on open), the message list, and the streaming fetch of `/api/ask`. `messages` state is
 * owned by `quill-widget.tsx` (lifted so it survives this component unmounting on collapse) --
 * this component only owns its own input value and in-flight send status, both of which are fine
 * to reset every time the panel reopens.
 */
export function QuillPanel({ messages, setMessages, onCollapse }: PanelProps) {
  const [question, setQuestion] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  // Deliberately *not* local state: this component unmounts on collapse (quill-widget.tsx), and
  // local state would reset on remount, silently defeating the double-submit guard for "collapse
  // the panel mid-stream, then reopen it before the response finishes." Deriving from the lifted
  // `messages` prop instead means the flag is exactly as durable as the conversation itself.
  const isStreaming = messages.some(
    (message) => message.role === 'answer' && message.status === 'streaming',
  );
  const abortControllerRef = useRef<AbortController | null>(null);

  // Focus moves into the question input every time the panel opens (this story's AC) -- this
  // component only ever mounts while the panel is open (quill-widget.tsx unmounts it on
  // collapse), so a mount-time effect is exactly "on open".
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Aborts any in-flight `/api/ask` request when the panel closes/unmounts -- without this, the
  // server-side per-word delay loop (route.ts) keeps running with nothing left to consume it,
  // and the fetch's own reader would otherwise just be abandoned rather than actually cancelled.
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Belt-and-suspenders against a second in-flight request: the send control is already
    // `disabled` while streaming, but pressing Enter in the input still triggers native form
    // submission regardless of the button's disabled state (I/O matrix, "Double submit while
    // streaming").
    if (isStreaming) {
      return;
    }
    const trimmedQuestion = question.trim();
    if (trimmedQuestion.length === 0) {
      return;
    }

    // Defensive: aborts any stale previous request before starting a new one (the isStreaming
    // guard above should already make this a no-op in practice).
    abortControllerRef.current?.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const answerId = nextMessageId('answer');
    setMessages((prev) => [
      ...prev,
      { id: nextMessageId('question'), role: 'question', text: trimmedQuestion },
      {
        id: answerId,
        role: 'answer',
        status: 'streaming',
        text: '',
        citations: [],
        confidence: null,
        insufficientEvidence: false,
      },
    ]);
    setQuestion('');

    try {
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: trimmedQuestion }),
        signal: abortController.signal,
      });

      if (!response.ok || !response.body) {
        markConnectionLost(answerId, setMessages);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let receivedDone = false;

      for (;;) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // The last split segment may be an incomplete line straddling this chunk and the next --
        // held back in `buffer` rather than parsed early.
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const parsedEvent = parseAskStreamEventLine(line);
          if (!parsedEvent) {
            continue;
          }
          if (parsedEvent.type === 'token') {
            appendToken(answerId, parsedEvent.text, setMessages);
          } else {
            receivedDone = true;
            finalizeAnswer(answerId, parsedEvent, setMessages);
          }
        }
      }

      if (!receivedDone) {
        // The stream closed (or, below, errored) before a `done` line ever arrived -- a dropped
        // connection detected in this reader loop, not a thrown/unhandled rejection (I/O matrix).
        markConnectionLost(answerId, setMessages);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // An intentional cancellation (panel closed/unmounted, or a new question started) --
        // not a dropped connection, so no error state and no console noise.
        return;
      }
      console.error('Quill ask stream failed:', err);
      markConnectionLost(answerId, setMessages);
    }
  }

  return (
    <div
      className={cn(
        // Mobile (< md): full-screen sheet, square corners, no dog-ear (DESIGN.md's "Chat
        // panel": "it now owns the whole viewport"). Desktop (>= md): 340px popup docked
        // bottom-right with the dog-eared asymmetric corner.
        'fixed inset-0 z-50 flex flex-col bg-quill-surface-panel font-serif shadow-[0_8px_30px_rgba(58,47,36,0.35)]',
        'md:inset-auto md:bottom-4 md:right-4 md:h-[480px] md:w-[340px] md:border md:border-quill-accent-gold',
        // Dog-eared asymmetric corner (DESIGN.md's "Shapes"), desktop only -- per-corner
        // arbitrary values rather than the `quill-panel-shape` utility class so the `md:` variant
        // applies cleanly through Tailwind's built-in corner-radius utilities.
        'md:rounded-tl-[10px] md:rounded-tr-[10px] md:rounded-br-[4px] md:rounded-bl-[10px]',
      )}
    >
      <header className="flex items-center justify-between bg-quill-inverse-surface px-4 py-3 text-quill-inverse-on-surface">
        <h2 className="text-base">🪶 Ask the Archive</h2>
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Collapse Ask the Archive panel"
          className="flex h-11 w-11 items-center justify-center rounded-full text-lg hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-quill-accent-gold"
        >
          ✕
        </button>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {messages.length === 0 && (
          <p className="text-sm text-quill-ink-muted">
            Ask a question about the Federalist Papers.
          </p>
        )}
        {messages.map((message) =>
          message.role === 'question' ? (
            <QuestionBubble key={message.id} text={message.text} />
          ) : (
            <AnswerBubble key={message.id} message={message} onCitationClick={onCollapse} />
          ),
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2 border-t border-quill-border-hairline p-3">
        <label htmlFor="quill-question-input" className="sr-only">
          Ask a question about the Federalist Papers
        </label>
        <input
          id="quill-question-input"
          ref={inputRef}
          type="text"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask a question…"
          className="h-11 w-full rounded-md border border-quill-border-default bg-quill-surface-raised px-3 text-sm text-quill-ink-primary placeholder:text-quill-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-quill-accent-gold"
        />
        <button
          type="submit"
          disabled={isStreaming}
          aria-label="Send question"
          className="flex h-11 min-w-11 items-center justify-center rounded-md bg-quill-accent px-3 text-sm font-medium text-quill-surface disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-quill-accent-gold"
        >
          Send
        </button>
      </form>
    </div>
  );
}

function QuestionBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <p className="quill-question-bubble-shape max-w-[85%] bg-quill-surface-user-bubble px-3 py-2 text-sm text-quill-ink-primary">
        {text}
      </p>
    </div>
  );
}

function AnswerBubble({
  message,
  onCitationClick,
}: {
  message: Extract<QuillMessage, { role: 'answer' }>;
  onCitationClick: () => void;
}) {
  const isStreaming = message.status === 'streaming';

  return (
    <div className="flex justify-start">
      <div
        role="group"
        aria-live="polite"
        className="quill-answer-bubble-shape max-w-[90%] border border-quill-border-hairline bg-quill-surface-raised px-3 py-2 text-sm text-quill-ink-primary"
      >
        <p>
          {message.text}
          {isStreaming && (
            <span aria-hidden="true" className="ml-0.5 inline-block animate-pulse">
              ▍
            </span>
          )}
        </p>

        {isStreaming && (
          <p className="mt-1 text-xs italic text-quill-ink-muted">streaming…</p>
        )}

        {message.status === 'connection-lost' && (
          <p role="alert" className="mt-1 text-xs text-quill-accent">
            Connection lost — try asking again.
          </p>
        )}

        {message.status === 'done' && message.citations.length > 0 && (
          <ul className="mt-2 space-y-1">
            {message.citations.map((citation, index) => (
              <li key={`${citation.chunkId}-${index}`}>
                <Link
                  href={
                    citation.quotedPassage
                      ? `/papers/${citation.paperNumber}?highlight=${encodeURIComponent(citation.quotedPassage)}#cited-passage`
                      : `/papers/${citation.paperNumber}`
                  }
                  onClick={onCitationClick}
                  aria-label={`View citation from paper No. ${citation.paperNumber}, ${citation.paperTitle}`}
                  className="rounded bg-quill-surface-highlight px-1 text-quill-accent underline decoration-dotted"
                >
                  No. {citation.paperNumber} — {citation.paperTitle}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
