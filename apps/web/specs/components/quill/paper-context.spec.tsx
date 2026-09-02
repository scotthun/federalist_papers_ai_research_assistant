import { render, screen } from '@testing-library/react';
import { AnnouncePaperContext } from '../../../src/components/quill/announce-paper-context';
import {
  PaperContextProvider,
  usePaperContext,
} from '../../../src/components/quill/paper-context';

/**
 * `PaperContextProvider`/`usePaperContext()` and `AnnouncePaperContext` (Story 5.2) are tightly
 * coupled -- the announcer is the only real-world producer of context, and this spec proves the
 * two work together: default value with no provider, updates on mount/prop-change, and clearing
 * on unmount. A tiny test-only consumer renders the current value as text so it's assertable via
 * @testing-library/react without reaching into React internals.
 */
function CurrentPaperDisplay() {
  const { currentPaper } = usePaperContext();
  return (
    <p data-testid="current-paper">
      {currentPaper ? `${currentPaper.paperNumber}:${currentPaper.title}` : 'none'}
    </p>
  );
}

describe('PaperContext', () => {
  it('defaults to null with no provider ancestor, safe for tests that render in isolation', () => {
    render(<CurrentPaperDisplay />);

    expect(screen.getByTestId('current-paper').textContent).toBe('none');
  });

  it('starts as null inside a provider with nothing announced yet', () => {
    render(
      <PaperContextProvider>
        <CurrentPaperDisplay />
      </PaperContextProvider>,
    );

    expect(screen.getByTestId('current-paper').textContent).toBe('none');
  });

  it('AnnouncePaperContext sets currentPaper on mount', () => {
    render(
      <PaperContextProvider>
        <AnnouncePaperContext paperNumber={51} title="Federalist No. 51" />
        <CurrentPaperDisplay />
      </PaperContextProvider>,
    );

    expect(screen.getByTestId('current-paper').textContent).toBe('51:Federalist No. 51');
  });

  it('updates currentPaper when paperNumber/title change', () => {
    const { rerender } = render(
      <PaperContextProvider>
        <AnnouncePaperContext paperNumber={51} title="Federalist No. 51" />
        <CurrentPaperDisplay />
      </PaperContextProvider>,
    );
    expect(screen.getByTestId('current-paper').textContent).toBe('51:Federalist No. 51');

    rerender(
      <PaperContextProvider>
        <AnnouncePaperContext paperNumber={10} title="Federalist No. 10" />
        <CurrentPaperDisplay />
      </PaperContextProvider>,
    );

    expect(screen.getByTestId('current-paper').textContent).toBe('10:Federalist No. 10');
  });

  it('clears currentPaper to null on unmount (e.g. navigating away)', () => {
    function Wrapper({ mounted }: { mounted: boolean }) {
      return (
        <PaperContextProvider>
          {mounted && <AnnouncePaperContext paperNumber={51} title="Federalist No. 51" />}
          <CurrentPaperDisplay />
        </PaperContextProvider>
      );
    }

    const { rerender } = render(<Wrapper mounted={true} />);
    expect(screen.getByTestId('current-paper').textContent).toBe('51:Federalist No. 51');

    rerender(<Wrapper mounted={false} />);

    expect(screen.getByTestId('current-paper').textContent).toBe('none');
  });
});
