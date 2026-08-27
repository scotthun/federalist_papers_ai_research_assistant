'use client';

import { useState, type FormEvent } from 'react';
import { AnswerSchema, type Answer } from '@federalist-research/shared';
import { ApiUnreachableNotice } from '@/components/api-unreachable-notice';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/** ui-design.md, "Ask the Archive": example prompts shown to the user. Clicking one fills the
 *  input rather than submitting immediately -- the researcher can still edit it first. */
const EXAMPLE_PROMPTS = [
  'What arguments does Madison make about factions?',
  'What does Hamilton argue about the executive?',
  'How does Federalist No. 51 describe checks and balances?',
  'Which papers discuss the judiciary?',
];

type AskState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'answered'; answer: Answer }
  | { status: 'error' };

/** Narrows an unknown response body to `Answer` before it's ever rendered -- a malformed 2xx
 *  body (e.g. a proxy issue, or a well-formed top level with a malformed citation element) must
 *  fail the same way an unreachable API does, not throw further downstream once rendering has
 *  already started (mirrors the Browse Papers/Paper Reader pages' identical `isPaperDetail`-style
 *  guards). Reuses the real `AnswerSchema`/`CitationSchema` Zod schemas from
 *  `@federalist-research/shared` -- the source of truth for this shape -- rather than a
 *  hand-rolled duck-type check that only validates the top level and never each citation
 *  element. */
function isAnswer(body: unknown): body is Answer {
  return AnswerSchema.safeParse(body).success;
}

const CONFIDENCE_LABEL: Record<Answer['confidence'], string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

/**
 * "Ask the Archive" (Story 3.1/3.2) -- a question input plus an Answer section (answer text,
 * confidence indicator, `insufficientEvidence` messaging, and a plain, not-yet-clickable citation
 * list), rendered together as one self-contained functional unit (this story's Boundaries). The
 * two-column layout and citation-click-to-navigate behavior are explicitly Story 3.3's scope, not
 * this one's.
 *
 * Self-contained client-side state (`useState`), same pattern `QuickFindSearch` (Story 2.1)
 * established -- no props, no global store. Unlike that component, submitting here can't be a
 * plain HTML form GET: asking a question calls a real LLM (variable latency, a loading state
 * worth showing) and needs to render a structured `Answer` response, not just navigate to a new
 * URL. It POSTs through `apps/web`'s own `/api/ask` route handler (never apps/api directly), same
 * "apps/web never accesses the database/AI provider directly" boundary every other page in this
 * app already follows.
 */
export function AskQuestion() {
  const [question, setQuestion] = useState('');
  const [state, setState] = useState<AskState>({ status: 'idle' });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // The submit *button* is disabled while loading, but pressing Enter in the text input still
    // triggers native form submission regardless of the button's disabled state -- without this
    // guard, a second in-flight request could resolve after (and overwrite) a slower first one,
    // or vice versa.
    if (state.status === 'loading') {
      return;
    }
    const trimmedQuestion = question.trim();
    // Submitting blank behaves like nothing happened, rather than sending a request the API
    // would reject as a 400 anyway -- there is no useful "empty question" outcome to show.
    if (trimmedQuestion.length === 0) {
      return;
    }

    setState({ status: 'loading' });
    try {
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: trimmedQuestion }),
      });

      if (!response.ok) {
        setState({ status: 'error' });
        return;
      }

      const body: unknown = await response.json();
      if (!isAnswer(body)) {
        setState({ status: 'error' });
        return;
      }

      setState({ status: 'answered', answer: body });
    } catch (err) {
      console.error('Failed to ask the archive:', err);
      setState({ status: 'error' });
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Ask the Archive</CardTitle>
          <CardDescription>
            Ask a question in your own words and get a source-grounded, cited answer.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <label htmlFor="ask-question-input" className="sr-only">
              Ask a question about the Federalist Papers
            </label>
            <input
              id="ask-question-input"
              type="text"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="e.g. What arguments does Madison make about factions?"
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
            <Button type="submit" disabled={state.status === 'loading'}>
              {state.status === 'loading' ? 'Asking…' : 'Ask'}
            </Button>
          </form>
          <div className="flex flex-wrap gap-2">
            {EXAMPLE_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => setQuestion(prompt)}
                className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                {prompt}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {state.status === 'error' && (
        <Card>
          <CardContent className="pt-6">
            <ApiUnreachableNotice />
          </CardContent>
        </Card>
      )}

      {state.status === 'answered' && <AnswerSection answer={state.answer} />}
    </div>
  );
}

/** The Answer section (ui-design.md: "displays: answer text, confidence indicator ..., citations,
 *  source passages") -- answer text, confidence, `insufficientEvidence` messaging, and a plain
 *  citation list. Deliberately not the two-column layout, and citations are plain text, not
 *  links -- both explicitly Story 3.3's scope. */
function AnswerSection({ answer }: { answer: Answer }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Answer</CardTitle>
        <CardDescription>Confidence: {CONFIDENCE_LABEL[answer.confidence]}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="font-serif text-base leading-relaxed text-foreground">{answer.answer}</p>

        {answer.insufficientEvidence && (
          <p role="status" className="text-sm italic text-muted-foreground">
            Insufficient evidence: this answer could not be fully confirmed against the
            Federalist Papers.
          </p>
        )}

        <div>
          <h3 className="text-sm font-medium text-foreground">Citations</h3>
          {answer.citations.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">No citations.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {answer.citations.map((citation, index) => (
                // Index is included alongside chunkId: if the LLM ever cites the same chunkId
                // twice (e.g. backing two different claims), chunkId alone would collide.
                <li
                  key={`${citation.chunkId}-${index}`}
                  className="text-sm text-muted-foreground"
                >
                  <span className="font-medium text-foreground">No. {citation.paperNumber}</span>
                  {' -- '}
                  {citation.paperTitle}
                  {citation.quotedPassage && (
                    <blockquote className="mt-1 border-l-2 border-border pl-3 italic">
                      &ldquo;{citation.quotedPassage}&rdquo;
                    </blockquote>
                  )}
                  {citation.relevanceExplanation && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {citation.relevanceExplanation}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
