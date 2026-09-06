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

/** Two sequential streamed responses -- `mockAskFetchStream` shares one already-consumed body
 *  across every call, which breaks a second real ask in the same test; this instead resolves a
 *  fresh `buildAskStreamBody` fixture per call, in order. */
function mockAskFetchStreamSequence(
  responses: Array<Parameters<typeof buildAskStreamBody>[0]>,
) {
  const fetchMock = jest.fn();
  for (const events of responses) {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, body: buildAskStreamBody(events) });
  }
  global.fetch = fetchMock as unknown as typeof fetch;
}

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
            quotedPassage: 'The great security against a gradual concentration of power.',
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
    // spec-citation-display-differentiation.md: the citation's quotedPassage renders as a visible
    // snippet under the link.
    expect(
      screen.getByText('The great security against a gradual concentration of power.'),
    ).toBeTruthy();
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
            quotedPassage: 'The great security against a gradual concentration of power.',
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
      `/papers/51?highlight=${encodeURIComponent('The great security against a gradual concentration of power.')}#cited-passage`,
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
    // spec-citation-display-differentiation.md: no quotedPassage -> the list item is link-only,
    // no snippet line, no empty/broken paragraph.
    expect(citationLink.closest('li')?.querySelectorAll('p')).toHaveLength(0);
  });

  // spec-citation-display-differentiation.md: multiple citations from the same paper (a common,
  // correct outcome) previously rendered as identical "No. N — Title" lines with nothing
  // distinguishing them; each citation's quotedPassage now renders as its own snippet so same-
  // paper citations read as distinct grounded quotes rather than a duplication bug.
  describe('citation snippet differentiation (spec-citation-display-differentiation.md)', () => {
    it('shows each citation its own distinct snippet when multiple citations cite the same paper', async () => {
      mockAskFetchStream([
        {
          type: 'done',
          answer: 'No. 4 discusses several distinct dangers from foreign force and influence.',
          citations: [
            {
              paperNumber: 4,
              paperTitle: 'The Same Subject Continued',
              chunkId: 'chunk-a',
              quotedPassage: 'Absolute monarchs will often make war when their nations are to gain.',
            },
            {
              paperNumber: 4,
              paperTitle: 'The Same Subject Continued',
              chunkId: 'chunk-b',
              quotedPassage: 'The safety of the people doth require it.',
            },
            {
              paperNumber: 4,
              paperTitle: 'The Same Subject Continued',
              chunkId: 'chunk-c',
              quotedPassage: 'Nations in general will make war whenever they have a prospect of getting anything.',
            },
            {
              paperNumber: 4,
              paperTitle: 'The Same Subject Continued',
              chunkId: 'chunk-d',
              quotedPassage: 'Men of this class have hurried out into wars.',
            },
          ],
          confidence: 'high',
          insufficientEvidence: false,
        },
      ]);

      await openPanel();
      await askQuestion('What dangers does No. 4 discuss?');

      let links: HTMLElement[] = [];
      await waitFor(() => {
        links = screen.getAllByRole('link', { name: /No\. 4, The Same Subject Continued/ });
        expect(links).toHaveLength(4);
      });

      // Scoped to each citation's own <li> (not just "exists somewhere on the page") -- proves
      // snippet i is actually paired with citation i's link, not merely that all four snippet
      // strings are present anywhere in the document (spec-citation-display-differentiation.md;
      // this scoping mirrors the sibling "no quotedPassage" test's `closest('li')` pattern, which
      // the original version of this test didn't reuse).
      const expectedSnippetsInOrder = [
        'Absolute monarchs will often make war when their nations are to gain.',
        'The safety of the people doth require it.',
        'Nations in general will make war whenever they have a prospect of getting anything.',
        'Men of this class have hurried out into wars.',
      ];
      links.forEach((link, i) => {
        const li = link.closest('li');
        expect(li?.textContent).toContain(expectedSnippetsInOrder[i]);
      });
    });

    it('renders a quotedPassage shorter than the truncation cap in full, with no ellipsis', async () => {
      mockAskFetchStream([
        {
          type: 'done',
          answer: 'A short answer.',
          citations: [
            {
              paperNumber: 10,
              paperTitle: 'The Same Subject Continued',
              chunkId: 'chunk-1',
              quotedPassage: 'A short quote.',
            },
          ],
          confidence: 'high',
          insufficientEvidence: false,
        },
      ]);

      await openPanel();
      await askQuestion('Why factions?');

      expect(await screen.findByText('A short quote.')).toBeTruthy();
    });

    it('truncates a quotedPassage longer than the cap with an ellipsis', async () => {
      const longPassage =
        'This is a very long quoted passage that goes on and on well past the truncation ' +
        'cap so that the rendered snippet must be cut short with a trailing ellipsis mark.';
      mockAskFetchStream([
        {
          type: 'done',
          answer: 'A long answer.',
          citations: [
            {
              paperNumber: 10,
              paperTitle: 'The Same Subject Continued',
              chunkId: 'chunk-1',
              quotedPassage: longPassage,
            },
          ],
          confidence: 'high',
          insufficientEvidence: false,
        },
      ]);

      await openPanel();
      await askQuestion('Why factions?');

      await screen.findByRole('link', { name: /No\. 10/ });
      expect(screen.queryByText(longPassage)).toBeNull();
      const truncated = screen.getByText(/…$/);
      const truncatedText = truncated.textContent ?? '';
      expect(truncatedText.length).toBeLessThan(longPassage.length);
      expect(longPassage.startsWith(truncatedText.slice(0, -1))).toBe(true);
    });

    it('shows each paper its own heading and its own snippet across citations from different papers', async () => {
      mockAskFetchStream([
        {
          type: 'done',
          answer: 'Both papers touch on this.',
          citations: [
            {
              paperNumber: 10,
              paperTitle: 'The Same Subject Continued',
              chunkId: 'chunk-1',
              quotedPassage: 'The influence of factious leaders may kindle a flame.',
            },
            {
              paperNumber: 51,
              paperTitle:
                'The Structure of the Government Must Furnish the Proper Checks and Balances',
              chunkId: 'chunk-2',
              quotedPassage: 'Ambition must be made to counteract ambition.',
            },
          ],
          confidence: 'high',
          insufficientEvidence: false,
        },
      ]);

      await openPanel();
      await askQuestion('Compare No. 10 and No. 51.');

      const link10 = await screen.findByRole('link', { name: /No\. 10/ });
      const link51 = screen.getByRole('link', { name: /No\. 51/ });
      // Scoped to each citation's own <li>, not just "exists somewhere on the page" -- see the
      // same-paper test above for why this matters (spec-citation-display-differentiation.md).
      expect(link10.closest('li')?.textContent).toContain(
        'The influence of factious leaders may kindle a flame.',
      );
      expect(link51.closest('li')?.textContent).toContain(
        'Ambition must be made to counteract ambition.',
      );
    });
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

  // spec-conversation-history-context.md: the panel sends the entire prior conversation with
  // every ask so a follow-up ("compare and contrast these two papers") can be understood in
  // context, and provides a "Clear chat" control resetting both the in-memory conversation and
  // its sessionStorage persistence.
  describe('conversation history (spec-conversation-history-context.md)', () => {
    it('sends no history field on the first question of a session', async () => {
      mockAskFetchStream([
        {
          type: 'done',
          answer: 'No. 6 and No. 8 are similar.',
          citations: [],
          confidence: 'high',
          insufficientEvidence: false,
        },
      ]);

      await openPanel();
      await askQuestion('Which paper is most similar to No. 6?');

      await waitFor(() => {
        expect(screen.getByText('No. 6 and No. 8 are similar.')).toBeTruthy();
      });
      const [, requestInit] = (global.fetch as jest.Mock).mock.calls[0];
      expect(JSON.parse(requestInit.body)).toEqual({
        question: 'Which paper is most similar to No. 6?',
      });
    });

    it('sends the entire prior settled conversation, oldest first, on a follow-up question', async () => {
      mockAskFetchStreamSequence([
        [
          {
            type: 'done',
            answer: 'No. 6 and No. 8 are similar.',
            citations: [],
            confidence: 'high',
            insufficientEvidence: false,
          },
        ],
        [
          {
            type: 'done',
            answer: 'They both discuss the dangers of disunion.',
            citations: [],
            confidence: 'high',
            insufficientEvidence: false,
          },
        ],
      ]);

      await openPanel();
      await askQuestion('Which paper is most similar to No. 6?');
      await waitFor(() => {
        expect(screen.getByText('No. 6 and No. 8 are similar.')).toBeTruthy();
      });

      await askQuestion('Can you compare and contrast these two papers?');
      await waitFor(() => {
        expect(screen.getByText('They both discuss the dangers of disunion.')).toBeTruthy();
      });

      const [, secondRequestInit] = (global.fetch as jest.Mock).mock.calls[1];
      const secondBody = JSON.parse(secondRequestInit.body);
      expect(secondBody.question).toBe('Can you compare and contrast these two papers?');
      expect(secondBody.history).toEqual([
        { question: 'Which paper is most similar to No. 6?', answer: 'No. 6 and No. 8 are similar.' },
      ]);
    });

    it('excludes a connection-lost turn from the history sent with the next question', async () => {
      mockAskFetchStreamSequence([
        // No `done` event -- the reader loop exhausts and the panel marks this turn
        // connection-lost.
        [{ type: 'token', text: 'Ambition ' }],
        [
          {
            type: 'done',
            answer: 'A fresh answer with no prior context.',
            citations: [],
            confidence: 'high',
            insufficientEvidence: false,
          },
        ],
      ]);

      await openPanel();
      await askQuestion('Why checks and balances?');
      await waitFor(() => {
        expect(screen.getByText('Connection lost — try asking again.')).toBeTruthy();
      });

      await askQuestion('A second question.');
      await waitFor(() => {
        expect(screen.getByText('A fresh answer with no prior context.')).toBeTruthy();
      });

      const [, secondRequestInit] = (global.fetch as jest.Mock).mock.calls[1];
      const secondBody = JSON.parse(secondRequestInit.body);
      expect(secondBody.history ?? []).toEqual([]);
    });

    // Bug found in review (2026-09-05): a `done` answer with `insufficientEvidence: true` (refuse
    // tier, clarify tier, or the fail-safe-to-refuse outcome behind CONTEXT_LENGTH_EXCEEDED_MESSAGE)
    // is not a genuine grounded answer -- feeding it back into the next request's history would be
    // actively harmful, especially for the context-length case (re-sending the very refusal that
    // said "this conversation has grown too long" would only grow the next request further and
    // reproduce the same failure).
    it('excludes a done-but-insufficient-evidence turn from the history sent with the next question', async () => {
      mockAskFetchStreamSequence([
        [
          {
            type: 'done',
            answer:
              "I couldn't find sufficient evidence in the Federalist Papers to answer that confidently.",
            citations: [],
            confidence: 'low',
            insufficientEvidence: true,
          },
        ],
        [
          {
            type: 'done',
            answer: 'A fresh answer with no prior context.',
            citations: [],
            confidence: 'high',
            insufficientEvidence: false,
          },
        ],
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

      await askQuestion('A second question.');
      await waitFor(() => {
        expect(screen.getByText('A fresh answer with no prior context.')).toBeTruthy();
      });

      const [, secondRequestInit] = (global.fetch as jest.Mock).mock.calls[1];
      const secondBody = JSON.parse(secondRequestInit.body);
      expect(secondBody.history ?? []).toEqual([]);
    });

    it('includes both paperNumber/paperTitle and history together when both apply', async () => {
      mockAskFetchStreamSequence([
        [
          {
            type: 'done',
            answer: 'No. 6 and No. 8 are similar.',
            citations: [],
            confidence: 'high',
            insufficientEvidence: false,
          },
        ],
        [
          {
            type: 'done',
            answer: 'They compare favorably.',
            citations: [],
            confidence: 'high',
            insufficientEvidence: false,
          },
        ],
      ]);

      renderWithPaperHelper();
      fireEvent.click(screen.getByRole('button', { name: 'Ask the Archive' }));
      await askQuestion('Which paper is most similar to No. 6?');
      await waitFor(() => {
        expect(screen.getByText('No. 6 and No. 8 are similar.')).toBeTruthy();
      });

      await askQuestion('Can you compare and contrast these two papers?');
      await waitFor(() => {
        expect(screen.getByText('They compare favorably.')).toBeTruthy();
      });

      const [, secondRequestInit] = (global.fetch as jest.Mock).mock.calls[1];
      const secondBody = JSON.parse(secondRequestInit.body);
      expect(secondBody.paperNumber).toBe(51);
      expect(secondBody.paperTitle).toBe('The Structure of the Government');
      expect(secondBody.history).toEqual([
        { question: 'Which paper is most similar to No. 6?', answer: 'No. 6 and No. 8 are similar.' },
      ]);
    });

    function renderWithPaperHelper() {
      return render(
        <PaperContextProvider>
          <AnnouncePaperContext paperNumber={51} title="The Structure of the Government" />
          <QuillWidget />
        </PaperContextProvider>,
      );
    }
  });

  describe('"Clear chat" control (spec-conversation-history-context.md)', () => {
    it('is visible whenever the panel is open', async () => {
      await openPanel();

      expect(screen.getByRole('button', { name: 'Clear chat' })).toBeTruthy();
    });

    it('resets both the visible conversation and sessionStorage in one action, even mid-stream', async () => {
      mockAskFetchStream([{ type: 'token', text: 'Ambition ' }]);

      await openPanel();
      await askQuestion('Why checks and balances?');
      await waitFor(() => {
        expect(screen.getByText('streaming…')).toBeTruthy();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Clear chat' }));

      expect(screen.queryByText('Why checks and balances?')).toBeNull();
      expect(
        screen.getByText('Ask a question about the Federalist Papers.'),
      ).toBeTruthy();
      await waitFor(() => {
        expect(window.sessionStorage.getItem(CHAT_HISTORY_SESSION_KEY)).not.toContain(
          'Why checks and balances?',
        );
      });
    });

    it('conversation does not reappear after a simulated reload once cleared', async () => {
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

      fireEvent.click(screen.getByRole('button', { name: 'Clear chat' }));
      unmount();

      render(<QuillWidget />);
      fireEvent.click(screen.getByRole('button', { name: 'Ask the Archive' }));

      expect(screen.queryByText('Why checks and balances?')).toBeNull();
      expect(
        screen.getByText('Ask a question about the Federalist Papers.'),
      ).toBeTruthy();
    });

    // spec-chat-nice-to-haves.md
    it('turns the "Clear chat" phrase inside a refuse-tier answer into a real clickable trigger for the same action', async () => {
      mockAskFetchStream([
        {
          type: 'done',
          answer:
            'This conversation has grown too long for the AI model to process in one request -- ' +
            'please use "Clear chat" to start a new conversation and try asking again.',
          citations: [],
          confidence: 'low',
          insufficientEvidence: true,
        },
      ]);

      await openPanel();
      await askQuestion('Why checks and balances?');

      const inlineTrigger = await screen.findByRole('button', { name: '"Clear chat"' });
      fireEvent.click(inlineTrigger);

      expect(screen.queryByText('Why checks and balances?')).toBeNull();
      expect(
        screen.getByText('Ask a question about the Federalist Papers.'),
      ).toBeTruthy();
    });
  });

  // spec-chat-nice-to-haves.md
  it('applies an entrance-animation class to a newly-attached citations list', async () => {
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
            quotedPassage: 'The great security against a gradual concentration of power.',
          },
        ],
        confidence: 'high',
        insufficientEvidence: false,
      },
    ]);

    const { container } = render(<QuillWidget />);
    fireEvent.click(screen.getByRole('button', { name: 'Ask the Archive' }));
    await askQuestion('Why checks and balances?');

    await waitFor(() => {
      expect(container.querySelector('ul.quill-citations-fade-in')).not.toBeNull();
    });
  });
});
