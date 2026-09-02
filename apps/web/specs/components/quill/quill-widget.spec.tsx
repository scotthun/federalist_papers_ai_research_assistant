import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QuillWidget } from '../../../src/components/quill/quill-widget';
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
});
