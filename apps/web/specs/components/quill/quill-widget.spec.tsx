import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CHAT_HISTORY_SESSION_KEY, QuillWidget } from '../../../src/components/quill/quill-widget';
import { AnnouncePaperContext } from '../../../src/components/quill/announce-paper-context';
import { PaperContextProvider } from '../../../src/components/quill/paper-context';
import {
  buildAskStreamBody,
  mockAskFetchRejects,
  mockAskFetchStream,
  readAllAskStreamEvents,
} from './ask-stream-test-helpers';

/**
 * QuillWidget (Story 5.1) owns `isOpen`/`messages` and renders QuillLauncher/QuillPanel --
 * exercised together here (rather than QuillPanel in isolation) since the panel's `messages` prop
 * only exists lifted in the widget, matching how the real app composes them. Only `global.fetch`
 * (apps/web's own `/api/ask` route, from the browser's perspective) is faked -- never a real
 * network call.
 */
const originalFetch = global.fetch;

async function openPanel() {
  render(<QuillWidget />);
  fireEvent.click(screen.getByRole('button', { name: 'Ask the Archive' }));
}

async function askQuestion(question: string) {
  const input = screen.getByLabelText('Ask a question about the Federalist Papers');
  fireEvent.change(input, { target: { value: question } });
  const form = input.closest('form');
  if (!form) throw new Error('expected the input to be inside a form');
  fireEvent.submit(form);
}

describe('QuillWidget', () => {
  afterEach(() => {
    global.fetch = originalFetch;
    window.sessionStorage.clear();
    jest.resetAllMocks();
  });

  // A fixture sanity check, not a component test: proves the shared `buildAskStreamBody` fixture
  // itself is well-formed (tokens in order, then one done event) using the same
  // `readAllAskStreamEvents` reader `ask-route.spec.ts` uses on the real route handler --
  // guarding against a future edit to the fixture silently breaking every test built on top of it
  // for a reason unrelated to the widget's own behavior.
  it('the confident-tier stream fixture reproduces token text then one done event when read directly', async () => {
    const events: Parameters<typeof buildAskStreamBody>[0] = [
      { type: 'token', text: 'Ambition ' },
      { type: 'token', text: 'must ' },
      { type: 'token', text: 'counteract ' },
      { type: 'token', text: 'ambition.' },
      {
        type: 'done',
        answer: 'Ambition must counteract ambition.',
        citations: [],
        confidence: 'high',
        insufficientEvidence: false,
      },
    ];

    const readEvents = await readAllAskStreamEvents({ body: buildAskStreamBody(events) });

    expect(readEvents).toEqual(events);
  });

  it('moves focus into the question input when the panel opens', async () => {
    await openPanel();

    const input = screen.getByLabelText('Ask a question about the Federalist Papers');
    expect(document.activeElement).toBe(input);
  });

  it('streams a confident-tier answer token-by-token with a trailing cursor and aria-live, then attaches citations only once done', async () => {
    mockAskFetchStream([
      { type: 'token', text: 'Ambition ' },
      { type: 'token', text: 'must ' },
      { type: 'token', text: 'counteract ' },
      { type: 'token', text: 'ambition.' },
      {
        type: 'done',
        answer: 'Ambition must counteract ambition.',
        citations: [
          {
            paperNumber: 51,
            paperTitle:
              'The Structure of the Government Must Furnish the Proper Checks and Balances',
            chunkId: 'chunk-1',
            quotedPassage: 'Ambition must counteract ambition.',
          },
        ],
        confidence: 'high',
        insufficientEvidence: false,
      },
    ]);

    await openPanel();
    await askQuestion('Why checks and balances?');

    // Mid-stream: some but not necessarily all text has arrived, a cursor and "streaming…"
    // caption are visible, and the answer bubble is `aria-live="polite"`.
    await waitFor(() => {
      expect(screen.getByText('streaming…')).toBeTruthy();
    });
    const answerGroup = screen.getByText('streaming…').closest('[role="group"]');
    expect(answerGroup?.getAttribute('aria-live')).toBe('polite');

    // Once fully streamed: exact final text, no cursor/caption, and the citation now attached.
    await waitFor(() => {
      expect(screen.queryByText('streaming…')).toBeNull();
    });
    expect(screen.getByText('Ambition must counteract ambition.')).toBeTruthy();
    const citationLink = screen.getByRole('link', {
      name: /No\. 51/,
    });
    expect(citationLink).toBeTruthy();
  });

  it('renders a clarify/refuse-tier answer instantly with no cursor', async () => {
    mockAskFetchStream([
      {
        type: 'done',
        answer: "I couldn't find sufficient evidence in the Federalist Papers to answer that confidently.",
        citations: [],
        confidence: 'low',
        insufficientEvidence: true,
      },
    ]);

    await openPanel();
    await askQuestion('What is the best pizza topping?');

    await waitFor(() => {
      expect(
        screen.getByText(
          "I couldn't find sufficient evidence in the Federalist Papers to answer that confidently.",
        ),
      ).toBeTruthy();
    });
    expect(screen.queryByText('streaming…')).toBeNull();
  });

  it('navigates via a real link and collapses the panel to the launcher on a citation click, without clearing the conversation', async () => {
    mockAskFetchStream([
      {
        type: 'done',
        answer: 'Ambition must counteract ambition.',
        citations: [
          {
            paperNumber: 51,
            paperTitle:
              'The Structure of the Government Must Furnish the Proper Checks and Balances',
            chunkId: 'chunk-1',
            quotedPassage: 'Ambition must counteract ambition.',
          },
        ],
        confidence: 'high',
        insufficientEvidence: false,
      },
    ]);

    await openPanel();
    await askQuestion('Why checks and balances?');

    const citationLink = await screen.findByRole('link', { name: /No\. 51/ });
    expect(citationLink.getAttribute('href')).toBe(
      `/papers/51?highlight=${encodeURIComponent('Ambition must counteract ambition.')}#cited-passage`,
    );

    fireEvent.click(citationLink);

    // The panel collapses back to the launcher...
    expect(screen.getByRole('button', { name: 'Ask the Archive' })).toBeTruthy();
    expect(screen.queryByLabelText('Ask a question about the Federalist Papers')).toBeNull();

    // ...and the conversation is still there once the panel is reopened.
    fireEvent.click(screen.getByRole('button', { name: 'Ask the Archive' }));
    expect(screen.getByText('Why checks and balances?')).toBeTruthy();
    expect(screen.getByText('Ambition must counteract ambition.')).toBeTruthy();
  });

  it('links to the paper with no highlight param/hash when the citation has no quotedPassage', async () => {
    mockAskFetchStream([
      {
        type: 'done',
        answer: 'The judiciary is discussed in several papers.',
        citations: [
          {
            paperNumber: 78,
            paperTitle: 'The Judiciary Department',
            chunkId: 'chunk-9',
          },
        ],
        confidence: 'high',
        insufficientEvidence: false,
      },
    ]);

    await openPanel();
    await askQuestion('Which papers discuss the judiciary?');

    const citationLink = await screen.findByRole('link', { name: /No\. 78/ });
    expect(citationLink.getAttribute('href')).toBe('/papers/78');
  });

  it('shows an inline "Connection lost" message and re-enables the send control when the stream ends without a done event', async () => {
    mockAskFetchStream([{ type: 'token', text: 'Ambition ' }]);

    await openPanel();
    await askQuestion('Why checks and balances?');

    await waitFor(() => {
      expect(screen.getByText('Connection lost — try asking again.')).toBeTruthy();
    });
    // Partial text stays visible.
    expect(screen.getByText(/Ambition/)).toBeTruthy();

    const sendButton = screen.getByRole('button', { name: 'Send question' });
    expect((sendButton as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows the inline error and re-enables send when fetch itself rejects', async () => {
    mockAskFetchRejects();

    await openPanel();
    await askQuestion('Why checks and balances?');

    await waitFor(() => {
      expect(screen.getByText('Connection lost — try asking again.')).toBeTruthy();
    });
    const sendButton = screen.getByRole('button', { name: 'Send question' });
    expect((sendButton as HTMLButtonElement).disabled).toBe(false);
  });

  it('disables the send control while a response is streaming, preventing a duplicate in-flight request', async () => {
    mockAskFetchStream([
      { type: 'token', text: 'Ambition ' },
      {
        type: 'done',
        answer: 'Ambition must counteract ambition.',
        citations: [],
        confidence: 'high',
        insufficientEvidence: false,
      },
    ]);

    await openPanel();
    const input = screen.getByLabelText('Ask a question about the Federalist Papers');
    fireEvent.change(input, { target: { value: 'Why checks and balances?' } });
    const form = input.closest('form') as HTMLFormElement;

    fireEvent.submit(form);

    await waitFor(() => {
      expect((screen.getByRole('button', { name: 'Send question' }) as HTMLButtonElement).disabled).toBe(
        true,
      );
    });

    const fetchCallsDuringStream = (global.fetch as jest.Mock).mock.calls.length;
    // Submitting again (e.g. Enter in the input) while the first request is still in flight.
    fireEvent.submit(form);
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(fetchCallsDuringStream);

    await waitFor(() => {
      expect((screen.getByRole('button', { name: 'Send question' }) as HTMLButtonElement).disabled).toBe(
        false,
      );
    });
  });

  describe('sessionStorage persistence (Story 5.2)', () => {
    it('restores a settled conversation from sessionStorage on mount', async () => {
      window.sessionStorage.setItem(
        CHAT_HISTORY_SESSION_KEY,
        JSON.stringify([
          { id: 'q-1', role: 'question', text: 'Why checks and balances?' },
          {
            id: 'a-1',
            role: 'answer',
            status: 'done',
            text: 'Ambition must counteract ambition.',
            citations: [],
            confidence: 'high',
            insufficientEvidence: false,
          },
        ]),
      );

      await openPanel();

      expect(screen.getByText('Why checks and balances?')).toBeTruthy();
      expect(screen.getByText('Ambition must counteract ambition.')).toBeTruthy();
    });

    it('downgrades a restored streaming message to connection-lost, not a stuck cursor', async () => {
      window.sessionStorage.setItem(
        CHAT_HISTORY_SESSION_KEY,
        JSON.stringify([
          { id: 'q-1', role: 'question', text: 'Why checks and balances?' },
          {
            id: 'a-1',
            role: 'answer',
            status: 'streaming',
            text: 'Ambition must',
            citations: [],
            confidence: null,
            insufficientEvidence: false,
          },
        ]),
      );

      await openPanel();

      expect(screen.getByText('Connection lost — try asking again.')).toBeTruthy();
      // Partial text stays visible.
      expect(screen.getByText(/Ambition must/)).toBeTruthy();
      expect(screen.queryByText('streaming…')).toBeNull();
    });

    it('a brand-new session (nothing in sessionStorage) starts with an empty conversation', async () => {
      await openPanel();

      expect(
        screen.getByText('Ask a question about the Federalist Papers.'),
      ).toBeTruthy();
    });

    it('falls back to an empty conversation when the stored payload is not an array', async () => {
      window.sessionStorage.setItem(CHAT_HISTORY_SESSION_KEY, JSON.stringify({ foo: 1 }));

      await openPanel();

      expect(
        screen.getByText('Ask a question about the Federalist Papers.'),
      ).toBeTruthy();
    });

    it('drops individually malformed elements from a stored array rather than rejecting the whole restore', async () => {
      window.sessionStorage.setItem(
        CHAT_HISTORY_SESSION_KEY,
        JSON.stringify([
          {},
          { id: 'q-1', role: 'question', text: 'Why checks and balances?' },
        ]),
      );

      await openPanel();

      // The malformed `{}` element is silently dropped, but the well-formed question beside it
      // still restores -- a single bad entry (e.g. a future version-skewed shape) doesn't cost
      // the rest of a real conversation.
      expect(screen.getByText('Why checks and balances?')).toBeTruthy();
    });

    it('does not write to sessionStorage while an answer is still streaming, only once it settles', async () => {
      mockAskFetchStream([
        { type: 'token', text: 'Ambition ' },
        {
          type: 'done',
          answer: 'Ambition must counteract ambition.',
          citations: [],
          confidence: 'high',
          insufficientEvidence: false,
        },
      ]);

      await openPanel();
      // Captured before the question is asked -- the initial mount's own write-through effect
      // (an empty conversation) has already run by this point, so this is the real "nothing new
      // persisted yet" baseline to compare against, not an assumed `null`.
      const preQuestionRaw = window.sessionStorage.getItem(CHAT_HISTORY_SESSION_KEY);

      await askQuestion('Why checks and balances?');

      await waitFor(() => {
        expect(screen.getByText('streaming…')).toBeTruthy();
      });
      // Mid-stream: sessionStorage must be byte-for-byte unchanged from before the question was
      // asked -- the skip-while-streaming guard means the question-appended, still-streaming
      // state is never written at all, not just written without literally the word "streaming".
      const midStreamRaw = window.sessionStorage.getItem(CHAT_HISTORY_SESSION_KEY);
      expect(midStreamRaw).toBe(preQuestionRaw);

      await waitFor(() => {
        expect(screen.queryByText('streaming…')).toBeNull();
      });
      const settledRaw = window.sessionStorage.getItem(CHAT_HISTORY_SESSION_KEY);
      expect(settledRaw).toContain('"status":"done"');
      expect(settledRaw).toContain('Ambition must counteract ambition.');
    });

    it('survives a simulated reload (unmount + remount) with the settled conversation intact', async () => {
      mockAskFetchStream([
        {
          type: 'done',
          answer: 'Ambition must counteract ambition.',
          citations: [],
          confidence: 'high',
          insufficientEvidence: false,
        },
      ]);

      const { unmount } = render(<QuillWidget />);
      fireEvent.click(screen.getByRole('button', { name: 'Ask the Archive' }));
      await askQuestion('Why checks and balances?');

      await waitFor(() => {
        expect(screen.getByText('Ambition must counteract ambition.')).toBeTruthy();
      });

      unmount();

      // A fresh mount (simulating a hard reload in the same tab) reads the same sessionStorage.
      render(<QuillWidget />);
      fireEvent.click(screen.getByRole('button', { name: 'Ask the Archive' }));

      expect(screen.getByText('Why checks and balances?')).toBeTruthy();
      expect(screen.getByText('Ambition must counteract ambition.')).toBeTruthy();
    });
  });

  describe('page-aware context chip (Story 5.2)', () => {
    function renderWithPaper(paperNumber: number, title: string) {
      return render(
        <PaperContextProvider>
          <AnnouncePaperContext paperNumber={paperNumber} title={title} />
          <QuillWidget />
        </PaperContextProvider>,
      );
    }

    it('shows no chip when opened outside any Paper Reader page (e.g. Homepage/Browse Papers)', async () => {
      await openPanel();

      expect(screen.queryByLabelText('Remove paper context')).toBeNull();
    });

    it('shows a removable chip titled from the announced paper when opened on a Paper Reader page', async () => {
      renderWithPaper(51, 'The Structure of the Government');
      fireEvent.click(screen.getByRole('button', { name: 'Ask the Archive' }));

      expect(
        screen.getByText(/Federalist No\. 51 — The Structure of the Government/),
      ).toBeTruthy();
      expect(screen.getByLabelText('Remove paper context')).toBeTruthy();
    });

    it('includes paperNumber and paperTitle in the /api/ask request body while the chip is present', async () => {
      mockAskFetchStream([
        {
          type: 'done',
          answer: 'Ambition must counteract ambition.',
          citations: [],
          confidence: 'high',
          insufficientEvidence: false,
        },
      ]);

      renderWithPaper(51, 'The Structure of the Government');
      fireEvent.click(screen.getByRole('button', { name: 'Ask the Archive' }));
      await askQuestion('Why checks and balances?');

      await waitFor(() => {
        expect(screen.getByText('Ambition must counteract ambition.')).toBeTruthy();
      });
      const [, requestInit] = (global.fetch as jest.Mock).mock.calls[0];
      // Sent as prompt context for the LLM (product-corrected 2026-09-02) -- apps/api never
      // applies these as a retrieval filter; see ask.service.spec.ts for that guarantee.
      expect(JSON.parse(requestInit.body)).toEqual({
        question: 'Why checks and balances?',
        paperNumber: 51,
        paperTitle: 'The Structure of the Government',
      });
    });

    it('removes the chip on dismiss, and the next question omits paperNumber/paperTitle from the request body', async () => {
      mockAskFetchStream([
        {
          type: 'done',
          answer: 'Ambition must counteract ambition.',
          citations: [],
          confidence: 'high',
          insufficientEvidence: false,
        },
      ]);

      renderWithPaper(51, 'The Structure of the Government');
      fireEvent.click(screen.getByRole('button', { name: 'Ask the Archive' }));

      fireEvent.click(screen.getByLabelText('Remove paper context'));
      expect(screen.queryByLabelText('Remove paper context')).toBeNull();

      await askQuestion('Why checks and balances?');
      await waitFor(() => {
        expect(screen.getByText('Ambition must counteract ambition.')).toBeTruthy();
      });
      const [, requestInit] = (global.fetch as jest.Mock).mock.calls[0];
      expect(JSON.parse(requestInit.body)).toEqual({ question: 'Why checks and balances?' });
    });

    it('does not reappear while remaining on the same paper after dismissal', async () => {
      const { rerender } = render(
        <PaperContextProvider>
          <AnnouncePaperContext paperNumber={51} title="The Structure of the Government" />
          <QuillWidget />
        </PaperContextProvider>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Ask the Archive' }));
      fireEvent.click(screen.getByLabelText('Remove paper context'));
      expect(screen.queryByLabelText('Remove paper context')).toBeNull();

      // Re-rendering with the same paperNumber (e.g. some unrelated state update on the same
      // page) must not resurrect the chip.
      rerender(
        <PaperContextProvider>
          <AnnouncePaperContext paperNumber={51} title="The Structure of the Government" />
          <QuillWidget />
        </PaperContextProvider>,
      );

      expect(screen.queryByLabelText('Remove paper context')).toBeNull();
    });

    it('re-evaluates fresh and reappears when navigating from dismissed paper N to a different paper M', async () => {
      const { rerender } = render(
        <PaperContextProvider>
          <AnnouncePaperContext paperNumber={51} title="The Structure of the Government" />
          <QuillWidget />
        </PaperContextProvider>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Ask the Archive' }));
      fireEvent.click(screen.getByLabelText('Remove paper context'));
      expect(screen.queryByLabelText('Remove paper context')).toBeNull();

      rerender(
        <PaperContextProvider>
          <AnnouncePaperContext paperNumber={10} title="Federalist No. 10" />
          <QuillWidget />
        </PaperContextProvider>,
      );

      expect(screen.getByText(/Federalist No\. 10/)).toBeTruthy();
      expect(screen.getByLabelText('Remove paper context')).toBeTruthy();
    });

    it('reappears on a fresh arrival at the same paper N after navigating away and back', async () => {
      // A conditional first child (rather than omitting the element entirely) keeps QuillWidget
      // at a stable position across rerenders -- in the real app, QuillWidget is a layout-level
      // sibling of `{children}` that never remounts as pages inside `children` come and go; if
      // this test instead varied element *count* across rerenders, React would reconcile
      // QuillWidget itself as a different position and remount it, silently invalidating the
      // "does the widget's own state survive a real navigation" premise this test exists to check.
      type Scene = { paper: { paperNumber: number; title: string } | null };
      function Scene({ paper }: Scene) {
        return (
          <PaperContextProvider>
            {paper && <AnnouncePaperContext paperNumber={paper.paperNumber} title={paper.title} />}
            <QuillWidget />
          </PaperContextProvider>
        );
      }

      const { rerender } = render(
        <Scene paper={{ paperNumber: 51, title: 'The Structure of the Government' }} />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Ask the Archive' }));
      fireEvent.click(screen.getByLabelText('Remove paper context'));
      expect(screen.queryByLabelText('Remove paper context')).toBeNull();

      // Navigate away to a non-paper page (no AnnouncePaperContext rendered)...
      rerender(<Scene paper={null} />);
      expect(screen.queryByLabelText('Remove paper context')).toBeNull();

      // ...then back to the same paper N -- a fresh arrival, not "remaining on that page".
      rerender(
        <Scene paper={{ paperNumber: 51, title: 'The Structure of the Government' }} />,
      );

      expect(screen.getByLabelText('Remove paper context')).toBeTruthy();
    });
  });
});
