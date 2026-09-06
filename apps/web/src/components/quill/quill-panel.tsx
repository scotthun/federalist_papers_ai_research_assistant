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
import { truncateCitationSnippet } from '@/lib/citation-snippet';
import { CHAT_HISTORY_SESSION_KEY, type QuillMessage } from './quill-widget';

type PanelProps = {
  messages: QuillMessage[];
  setMessages: Dispatch<SetStateAction<QuillMessage[]>>;
  onCollapse: () => void;
  /** Non-null only when the panel was opened while a Paper Reader page announced itself as
   *  current (Story 5.2) -- drives both the removable context chip and the `paperNumber`
   *  retrieval filter sent with the next ask request. `null` means "search the whole archive"
   *  (Homepage/Browse Papers, or the chip was dismissed). */
  paperContext: { paperNumber: number; title: string } | null;
  onDismissPaperContext: () => void;
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
 * Resets an existing answer message back to a fresh `streaming` state in place (same `id`, no new
 * question/answer pair appended) -- used only by a retry (spec-chat-error-recovery-polish.md),
 * which resends a question that already failed once rather than treating it as a brand-new turn.
 */
function resetToStreaming(
  answerId: string,
  setMessages: Dispatch<SetStateAction<QuillMessage[]>>,
) {
  setMessages((prev) =>
    prev.map((message) =>
      message.id === answerId && message.role === 'answer'
        ? {
            ...message,
            status: 'streaming' as const,
            text: '',
            citations: [],
            confidence: null,
            insufficientEvidence: false,
          }
        : message,
    ),
  );
}

/**
 * Shared by both a fresh submit and a retry (spec-chat-error-recovery-polish.md) -- the only
 * difference between the two call sites is how `answerId`/`questionText`/`history` were derived,
 * never how the request itself is sent, read, or how failures are reported. Extracted so a retry
 * can never silently drift out of sync with a first attempt's behavior.
 */
async function sendAskRequest({
  answerId,
  questionText,
  history,
  paperContext,
  abortController,
  setMessages,
}: {
  answerId: string;
  questionText: string;
  history: Array<{ question: string; answer: string }>;
  paperContext: { paperNumber: number; title: string } | null;
  abortController: AbortController;
  setMessages: Dispatch<SetStateAction<QuillMessage[]>>;
}) {
  try {
    const response = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: questionText,
        ...(paperContext
          ? { paperNumber: paperContext.paperNumber, paperTitle: paperContext.title }
          : {}),
        ...(history.length > 0 ? { history } : {}),
      }),
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

/**
 * Builds the `history` array sent with the next `/api/ask` call (spec-conversation-history-
 * context.md): every prior `role: 'question'` turn immediately followed by a `role: 'answer'`
 * turn whose `status` is `'done'` AND whose `insufficientEvidence` is `false`, oldest first.
 * Messages are always appended in question-then-answer pairs (`handleSubmit` below), so a simple
 * adjacent-pair scan is sufficient -- no need to track ids separately. A `streaming`/
 * `connection-lost` answer's pair is skipped entirely (its text may be incomplete or absent and
 * must never be sent as if it were a finished turn) -- the conversation just resumes from
 * whatever earlier qualifying turns exist, or sends none at all if there aren't any yet.
 *
 * `insufficientEvidence: true` (refuse tier, clarify tier, and -- critically -- the fail-safe-to-
 * refuse outcome used for `CONTEXT_LENGTH_EXCEEDED_MESSAGE` and every other provider-failure
 * message) is likewise excluded even though `status` is `'done'`: none of those are a genuine,
 * evidence-grounded answer, so feeding them back as if they were would be actively harmful --
 * most importantly for the context-length case, where re-sending the very refusal that said "this
 * conversation has grown too long" would only grow the next request further and reproduce the
 * same failure, defeating the point of that safety message entirely (bug found in review,
 * 2026-09-05). Only a genuine confident-tier answer should ever populate history.
 */
function buildHistory(messages: QuillMessage[]): Array<{ question: string; answer: string }> {
  const turns: Array<{ question: string; answer: string }> = [];
  for (let i = 0; i < messages.length - 1; i += 1) {
    const question = messages[i];
    const answer = messages[i + 1];
    if (
      question.role === 'question' &&
      answer.role === 'answer' &&
      answer.status === 'done' &&
      !answer.insufficientEvidence
    ) {
      turns.push({ question: question.text, answer: answer.text });
    }
  }
  return turns;
}

/**
 * The open quill panel (DESIGN.md's "Chat panel"): dog-eared chrome, header band, question input
 * (focused on open), the message list, and the streaming fetch of `/api/ask`. `messages` state is
 * owned by `quill-widget.tsx` (lifted so it survives this component unmounting on collapse) --
 * this component only owns its own input value and in-flight send status, both of which are fine
 * to reset every time the panel reopens.
 */
export function QuillPanel({
  messages,
  setMessages,
  onCollapse,
  paperContext,
  onDismissPaperContext,
}: PanelProps) {
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

    // Built from `messages` as it stands *before* this turn's own question/answer are appended
    // below -- exactly "all prior done-status question/answer pairs" (this story's Code Map),
    // never including the in-flight turn itself.
    const history = buildHistory(messages);

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

    // paperContext (if present) is the same boolean/value that drove the chip's visibility when
    // this question was submitted (Story 5.2's Boundaries) -- included only when non-null, so a
    // dismissed/absent context never sends a stray paperNumber/paperTitle. apps/api threads this
    // into the LLM's prompt as framing only (product-corrected 2026-09-02) -- it is never applied
    // as a retrieval filter. `history` (spec-conversation-history-context.md) is included only
    // when non-empty, so a first question's request body is byte-for-byte unchanged from before
    // that story.
    await sendAskRequest({
      answerId,
      questionText: trimmedQuestion,
      history,
      paperContext,
      abortController,
      setMessages,
    });
  }

  /**
   * Resends a question whose answer ended in `connection-lost` (spec-chat-error-recovery-
   * polish.md) -- in place, reusing the same answer message id rather than appending a new
   * question/answer pair, so the conversation doesn't show the same question twice just because
   * its first attempt failed. Guarded by `isStreaming` exactly like `handleSubmit` (this story's
   * Boundaries: never a second in-flight request, retry included). Uses the *current* paper
   * context, not whatever was active when the original question was first asked -- consistent
   * with how a brand-new send always uses the current context, and simpler than threading a
   * second, historical context through every retry.
   */
  function handleRetry(answerId: string) {
    if (isStreaming) {
      return;
    }
    const answerIndex = messages.findIndex((message) => message.id === answerId);
    if (answerIndex <= 0) {
      return;
    }
    const questionMessage = messages[answerIndex - 1];
    if (questionMessage.role !== 'question') {
      return;
    }

    abortControllerRef.current?.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    // Only turns strictly before the original question -- mirrors handleSubmit's own "history is
    // everything prior to this turn" contract exactly, never including the turn being retried.
    const history = buildHistory(messages.slice(0, answerIndex - 1));

    resetToStreaming(answerId, setMessages);

    void sendAskRequest({
      answerId,
      questionText: questionMessage.text,
      history,
      paperContext,
      abortController,
      setMessages,
    });
  }

  /**
   * Resets both the in-memory conversation and its `sessionStorage` persistence in one action
   * (spec-conversation-history-context.md's first safety addition) -- never one without the
   * other, since a UI reset that left stale data in `sessionStorage` would silently reappear on
   * the next reload. Works correctly even mid-stream: aborting the in-flight request first means
   * no late token/done event can resurrect anything (its `answerId` no longer matches any message
   * once `messages` is cleared), and clearing `messages` here also makes `quill-widget.tsx`'s own
   * write-through effect persist the now-empty conversation -- the explicit `removeItem` below is
   * belt-and-suspenders against that effect's async timing, not the only thing doing the reset.
   */
  function handleClearChat() {
    abortControllerRef.current?.abort();
    setMessages([]);
    try {
      window.sessionStorage.removeItem(CHAT_HISTORY_SESSION_KEY);
    } catch {
      // Storage inaccessible (e.g. Safari private mode) -- messages state is still cleared, which
      // is the part the user actually sees; nothing further to do.
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
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleClearChat}
            aria-label="Clear chat"
            className="rounded-full px-2 py-1 text-xs hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-quill-accent-gold"
          >
            Clear chat
          </button>
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Collapse Ask the Archive panel"
            className="flex h-11 w-11 items-center justify-center rounded-full text-lg hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-quill-accent-gold"
          >
            ✕
          </button>
        </div>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {paperContext && (
          <div className="flex justify-start">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-quill-accent-gold bg-quill-surface-chip px-3 py-1 text-xs text-quill-ink-secondary">
              <span aria-hidden="true">📄</span> Federalist No. {paperContext.paperNumber} —{' '}
              {paperContext.title}
              <button
                type="button"
                onClick={onDismissPaperContext}
                aria-label="Remove paper context"
                className="ml-0.5 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-quill-accent-gold"
              >
                ✕
              </button>
            </span>
          </div>
        )}
        {messages.length === 0 && (
          <p className="text-sm text-quill-ink-muted">
            Ask a question about the Federalist Papers.
          </p>
        )}
        {messages.map((message) =>
          message.role === 'question' ? (
            <QuestionBubble key={message.id} text={message.text} />
          ) : (
            <AnswerBubble
              key={message.id}
              message={message}
              onCitationClick={onCollapse}
              onClearChat={handleClearChat}
              onRetry={handleRetry}
              retryDisabled={isStreaming}
            />
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

/**
 * Renders `text` as plain text, except any literal occurrence of `"Clear chat"` becomes a real
 * clickable trigger for `onClearChat` (spec-chat-nice-to-haves.md) -- apps/api's
 * `CONTEXT_LENGTH_EXCEEDED_MESSAGE` is the only answer text that ever contains this exact phrase,
 * telling the user to `use "Clear chat" to start a new conversation`; without this, that
 * instruction only works if the user separately spots and clicks the header's own "Clear chat"
 * button, rather than the one place the app is actually telling them what to do. Matched by the
 * literal phrase rather than by comparing the whole message against that constant (which apps/web
 * can't import from apps/api across the app boundary) -- robust to that message's exact wording
 * changing elsewhere as long as it still names this same phrase.
 */
function renderAnswerText(text: string, onClearChat: () => void) {
  const marker = '"Clear chat"';
  const markerIndex = text.indexOf(marker);
  if (markerIndex === -1) {
    return text;
  }
  const before = text.slice(0, markerIndex);
  const after = text.slice(markerIndex + marker.length);
  return (
    <>
      {before}
      <button
        type="button"
        onClick={onClearChat}
        className="rounded px-0.5 font-medium text-quill-accent underline decoration-dotted hover:bg-quill-surface-highlight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-quill-accent-gold"
      >
        {marker}
      </button>
      {after}
    </>
  );
}

/** How long a message stays `streaming` before its caption switches from "streaming…" to a
 *  longer-wait notice (spec-chat-error-recovery-polish.md) -- the confident tier's whole answer is
 *  already fully generated *before* the first token ever streams (ask-stream.ts's own doc
 *  comment), so almost this entire window is really "waiting on the upstream LLM call to finish,"
 *  not the token-by-token reveal itself. Exported so the spec's test can reference the same
 *  literal instead of re-declaring it. */
export const LONG_WAIT_NOTICE_DELAY_MS = 15_000;

function AnswerBubble({
  message,
  onCitationClick,
  onClearChat,
  onRetry,
  retryDisabled,
}: {
  message: Extract<QuillMessage, { role: 'answer' }>;
  onCitationClick: () => void;
  onClearChat: () => void;
  onRetry: (answerId: string) => void;
  /** True while any request (a fresh send, or another message's retry) is already in flight --
   *  mirrors the main send control's own disabled state, so Retry can never itself trigger the
   *  double-submit `handleRetry` already guards against server-side; this is purely about not
   *  presenting a clickable-looking control that would silently no-op. */
  retryDisabled: boolean;
}) {
  const isStreaming = message.status === 'streaming';
  // A one-way flip past LONG_WAIT_NOTICE_DELAY_MS, not a live countdown -- the wait's actual
  // duration is unknowable up front (it depends on the upstream provider), so this only ever
  // needs to answer "has it been unusually long yet?", never "how much longer?". Reset to `false`
  // whenever streaming starts fresh (message.id changes on retry -- resetToStreaming reuses the
  // same id, so message.id alone wouldn't re-arm the timer on a retry of the *same* message,
  // hence keying on `isStreaming` transitioning true->true is intentionally avoided below by also
  // depending on message.id, which is stable across a retry -- the dependency that actually
  // re-arms it is `isStreaming` itself flipping from `false` back to `true`).
  const [isLongWait, setIsLongWait] = useState(false);

  useEffect(() => {
    if (!isStreaming) {
      setIsLongWait(false);
      return;
    }
    const timer = setTimeout(() => setIsLongWait(true), LONG_WAIT_NOTICE_DELAY_MS);
    return () => clearTimeout(timer);
    // message.id intentionally not a dependency: resetToStreaming reuses the same id on retry,
    // and isStreaming alone already captures every transition that should (re)arm or clear this
    // timer.
  }, [isStreaming]);

  return (
    <div className="flex justify-start">
      <div
        role="group"
        aria-live="polite"
        className="quill-answer-bubble-shape max-w-[90%] border border-quill-border-hairline bg-quill-surface-raised px-3 py-2 text-sm text-quill-ink-primary"
      >
        <p>
          {message.status === 'done' ? renderAnswerText(message.text, onClearChat) : message.text}
          {isStreaming && (
            <span aria-hidden="true" className="ml-0.5 inline-block animate-pulse">
              ▍
            </span>
          )}
        </p>

        {isStreaming && (
          <p className="mt-1 text-xs italic text-quill-ink-muted">
            {isLongWait
              ? 'Still working — this is taking longer than usual…'
              : 'streaming…'}
          </p>
        )}

        {message.status === 'connection-lost' && (
          <div className="mt-1 flex items-center gap-2">
            <p role="alert" className="text-xs text-quill-accent">
              Connection lost — try asking again.
            </p>
            <button
              type="button"
              onClick={() => onRetry(message.id)}
              disabled={retryDisabled}
              className="rounded px-1.5 py-0.5 text-xs font-medium text-quill-accent underline decoration-dotted hover:bg-quill-surface-highlight disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-quill-accent-gold"
            >
              Retry
            </button>
          </div>
        )}

        {message.status === 'done' && message.citations.length > 0 && (
          <ul className="quill-citations-fade-in mt-2 space-y-1">
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
                {citation.quotedPassage && (
                  <p className="mt-0.5 pl-1 text-xs italic text-quill-ink-muted">
                    {truncateCitationSnippet(citation.quotedPassage)}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
