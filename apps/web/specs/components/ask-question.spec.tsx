import { act, fireEvent, render, screen } from '@testing-library/react';
import type { Answer } from '@federalist-research/shared';
import { AskQuestion } from '../../src/components/ask-question';

/**
 * AskQuestion (Story 3.1/3.2) is a self-contained 'use client' component with its own useState,
 * no props -- same self-contained-component testing approach as quick-find-search.spec.tsx, but
 * unlike that component's plain GET form, submitting here calls `global.fetch` against apps/web's
 * own `/api/ask` route handler, so every test here fakes that boundary directly (never a real
 * network call, never apps/api or apps/web's route handler itself -- that's ask-question route's
 * own concern, covered separately).
 */
const originalFetch = global.fetch;

function mockFetchResolved(init: { ok: boolean; status?: number; body: unknown }) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: init.ok,
    status: init.status ?? (init.ok ? 200 : 500),
    json: () => Promise.resolve(init.body),
  }) as unknown as typeof fetch;
}

const confidentAnswer: Answer = {
  answer: 'Because ambition must be made to counteract ambition.',
  citations: [
    {
      paperNumber: 51,
      paperTitle: 'The Structure of the Government Must Furnish the Proper Checks and Balances',
      chunkId: 'chunk-1',
      quotedPassage: 'Ambition must be made to counteract ambition.',
    },
  ],
  confidence: 'high',
  insufficientEvidence: false,
};

const refuseAnswer: Answer = {
  answer: "I couldn't find sufficient evidence in the Federalist Papers to answer that confidently.",
  citations: [],
  confidence: 'low',
  insufficientEvidence: true,
};

// The clarify tier's real shape (Story 3.2): insufficientEvidence TRUE with a NON-EMPTY citations
// array, whose one citation has no quotedPassage/relevanceExplanation (it's an unproven best
// guess, not a verified source). This deliberately does NOT correlate insufficientEvidence with
// an empty citations list, unlike both fixtures above -- a future simplification gating the
// citations list render on `!insufficientEvidence` would break this shape silently without a test
// like this one to catch it.
const clarifyAnswer: Answer = {
  answer:
    "I think you might be asking about Federalist No. 39 (The Conformity of the Plan to " +
    "Republican Principles), but I'm not confident enough to answer directly -- can you add " +
    'more detail?',
  citations: [
    {
      paperNumber: 39,
      paperTitle: 'The Conformity of the Plan to Republican Principles',
      chunkId: 'chunk-9',
    },
  ],
  confidence: 'low',
  insufficientEvidence: true,
};

async function askQuestion(question: string) {
  const input = screen.getByLabelText('Ask a question about the Federalist Papers');
  fireEvent.change(input, { target: { value: question } });
  const form = input.closest('form');
  if (!form) throw new Error('expected the input to be inside a form');
  await act(async () => {
    fireEvent.submit(form);
  });
}

describe('AskQuestion', () => {
  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetAllMocks();
  });

  it('renders an accessible, initially-empty question input and an "Ask" button', () => {
    render(<AskQuestion />);

    const input = screen.getByLabelText('Ask a question about the Federalist Papers');
    expect((input as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('button', { name: 'Ask' })).toBeTruthy();
  });

  it('shows the example prompts from ui-design.md', () => {
    render(<AskQuestion />);

    expect(
      screen.getByText('What arguments does Madison make about factions?'),
    ).toBeTruthy();
    expect(screen.getByText('Which papers discuss the judiciary?')).toBeTruthy();
  });

  it('fills the input (without submitting) when an example prompt is clicked', () => {
    mockFetchResolved({ ok: true, body: confidentAnswer });
    render(<AskQuestion />);

    fireEvent.click(screen.getByText('What does Hamilton argue about the executive?'));

    const input = screen.getByLabelText(
      'Ask a question about the Federalist Papers',
    ) as HTMLInputElement;
    expect(input.value).toBe('What does Hamilton argue about the executive?');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not call fetch when submitting a blank/whitespace question', async () => {
    mockFetchResolved({ ok: true, body: confidentAnswer });
    render(<AskQuestion />);

    await askQuestion('   ');

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('POSTs the trimmed question to /api/ask', async () => {
    mockFetchResolved({ ok: true, body: confidentAnswer });
    render(<AskQuestion />);

    await askQuestion('  Why checks and balances?  ');

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/ask',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: 'Why checks and balances?' }),
      }),
    );
  });

  it('renders the Answer section with answer text, high confidence, and citations on a confident-tier response', async () => {
    mockFetchResolved({ ok: true, body: confidentAnswer });
    render(<AskQuestion />);

    await askQuestion('Why checks and balances?');

    expect(screen.getByRole('heading', { name: 'Answer' })).toBeTruthy();
    expect(
      screen.getByText('Because ambition must be made to counteract ambition.'),
    ).toBeTruthy();
    expect(screen.getByText('Confidence: High')).toBeTruthy();
    expect(screen.getByText('No. 51')).toBeTruthy();
    expect(
      screen.getByText(
        'The Structure of the Government Must Furnish the Proper Checks and Balances',
        { exact: false },
      ),
    ).toBeTruthy();
  });

  it('does not render insufficientEvidence messaging for a confident-tier answer', async () => {
    mockFetchResolved({ ok: true, body: confidentAnswer });
    render(<AskQuestion />);

    await askQuestion('Why checks and balances?');

    expect(screen.queryByRole('status')).toBeNull();
  });

  // Finding: relevanceExplanation was defined on CitationSchema and required for Story 3.3's
  // citation navigation, but AnswerSection never actually rendered it.
  it('renders relevanceExplanation alongside the quoted passage when present', async () => {
    const answerWithRelevance: Answer = {
      ...confidentAnswer,
      citations: [
        {
          ...confidentAnswer.citations[0],
          relevanceExplanation: 'Directly answers the checks-and-balances question.',
        },
      ],
    };
    mockFetchResolved({ ok: true, body: answerWithRelevance });
    render(<AskQuestion />);

    await askQuestion('Why checks and balances?');

    expect(
      screen.getByText('Directly answers the checks-and-balances question.'),
    ).toBeTruthy();
  });

  // Finding: a duplicate chunkId (the LLM citing the same chunk twice for two different claims)
  // must not collide as a React list key -- proven here by asserting React never logs its
  // "two children with the same key" warning, which it would before the `${chunkId}-${index}` fix.
  it('renders two citations with the same chunkId without a duplicate-key warning', async () => {
    const duplicateKeyAnswer: Answer = {
      ...confidentAnswer,
      citations: [
        confidentAnswer.citations[0],
        { ...confidentAnswer.citations[0], quotedPassage: 'A second, different claim.' },
      ],
    };
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockFetchResolved({ ok: true, body: duplicateKeyAnswer });
    render(<AskQuestion />);

    await askQuestion('Why checks and balances?');

    expect(screen.getByText('A second, different claim.', { exact: false })).toBeTruthy();
    const sameKeyWarning = consoleErrorSpy.mock.calls.some((call) =>
      String(call[0]).includes('same key'),
    );
    expect(sameKeyWarning).toBe(false);
    consoleErrorSpy.mockRestore();
  });

  it('renders insufficientEvidence messaging, low confidence, and an empty-citations note for a refuse-tier response', async () => {
    mockFetchResolved({ ok: true, body: refuseAnswer });
    render(<AskQuestion />);

    await askQuestion('What is the best pizza topping?');

    expect(
      screen.getByText(
        "I couldn't find sufficient evidence in the Federalist Papers to answer that confidently.",
      ),
    ).toBeTruthy();
    expect(screen.getByText('Confidence: Low')).toBeTruthy();
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText('No citations.')).toBeTruthy();
  });

  // Finding: neither existing fixture (confident: insufficientEvidence false + citations
  // non-empty; refuse: insufficientEvidence true + citations empty) exercises the clarify tier's
  // real shape -- insufficientEvidence TRUE together with a NON-EMPTY citations array. Both the
  // insufficient-evidence message AND the citation must still render for this shape.
  it('renders both the insufficientEvidence messaging AND the citation for a clarify-tier response', async () => {
    mockFetchResolved({ ok: true, body: clarifyAnswer });
    render(<AskQuestion />);

    await askQuestion('Some vague question');

    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText('Confidence: Low')).toBeTruthy();
    // Scoped to the citation list item itself (via its unique "No. 39" span) rather than a bare
    // getByText for the paper title -- the clarify tier's own answer text also mentions "The
    // Conformity of the Plan to Republican Principles" by name, so an unscoped query would match
    // both the answer paragraph and the citation and fail on multiple matches.
    const citationItem = screen.getByText('No. 39').closest('li');
    expect(citationItem?.textContent).toContain(
      'The Conformity of the Plan to Republican Principles',
    );
    // No "No citations." note -- the clarify tier's one best-guess citation must actually render.
    expect(screen.queryByText('No citations.')).toBeNull();
  });

  it('renders an unreachable-API notice when the response is not ok', async () => {
    mockFetchResolved({ ok: false, status: 502, body: { message: 'bad gateway' } });
    render(<AskQuestion />);

    await askQuestion('Why checks and balances?');

    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('renders an unreachable-API notice when the response body is not a valid Answer shape', async () => {
    mockFetchResolved({ ok: true, body: { unexpected: 'shape' } });
    render(<AskQuestion />);

    await askQuestion('Why checks and balances?');

    expect(screen.getByRole('alert')).toBeTruthy();
  });

  // Finding: the old hand-rolled `isAnswer` check validated the top-level shape but never each
  // citation element -- a malformed citation (e.g. `{}` missing chunkId/paperNumber/paperTitle)
  // used to pass through and render "No. undefined". Replacing it with `AnswerSchema.safeParse`
  // must now reject this and route to the error state instead.
  it('renders an unreachable-API notice when the body is well-formed at the top level but has a malformed citation element', async () => {
    mockFetchResolved({
      ok: true,
      body: {
        answer: 'Because ambition must be made to counteract ambition.',
        citations: [{}],
        confidence: 'high',
        insufficientEvidence: false,
      },
    });
    render(<AskQuestion />);

    await askQuestion('Why checks and balances?');

    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('renders an unreachable-API notice when fetch itself rejects', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;
    render(<AskQuestion />);

    await askQuestion('Why checks and balances?');

    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('disables the Ask button and shows a loading label while the request is pending', async () => {
    let resolveFetch: (value: unknown) => void = () => undefined;
    global.fetch = jest.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    ) as unknown as typeof fetch;
    render(<AskQuestion />);

    const input = screen.getByLabelText('Ask a question about the Federalist Papers');
    fireEvent.change(input, { target: { value: 'Why checks and balances?' } });
    const form = input.closest('form') as HTMLFormElement;
    fireEvent.submit(form);

    expect(screen.getByRole('button', { name: 'Asking…' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Asking…' }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    await act(async () => {
      resolveFetch({ ok: true, status: 200, json: () => Promise.resolve(confidentAnswer) });
    });
  });

  // Finding: the submit *button* is disabled while loading, but pressing Enter in the text input
  // still triggers native form submission regardless of the button's disabled state -- without a
  // guard at the top of handleSubmit, a second in-flight request could fire while the first is
  // still pending.
  it('is a no-op to submit a second time (e.g. via Enter) while a request is already in flight', async () => {
    let resolveFetch: (value: unknown) => void = () => undefined;
    global.fetch = jest.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    ) as unknown as typeof fetch;
    render(<AskQuestion />);

    const input = screen.getByLabelText('Ask a question about the Federalist Papers');
    fireEvent.change(input, { target: { value: 'Why checks and balances?' } });
    const form = input.closest('form') as HTMLFormElement;

    fireEvent.submit(form);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Submitting again (e.g. Enter in the input) while the first request is still pending.
    fireEvent.submit(form);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFetch({ ok: true, status: 200, json: () => Promise.resolve(confidentAnswer) });
    });
  });
});
