import { fireEvent, render, screen } from '@testing-library/react';
import RootLayout from '../../src/app/layout';
import { AnnouncePaperContext } from '../../src/components/quill/announce-paper-context';

/**
 * Every other Story 5.2 spec (quill-widget.spec.tsx, paper-context.spec.tsx,
 * papers/paper-number/page.spec.tsx) builds its own local `<PaperContextProvider>` tree rather
 * than rendering the real `RootLayout` -- useful for isolating the pieces under test, but none of
 * them would notice a regression that moved `<QuillWidget />` back outside
 * `<PaperContextProvider>` in `layout.tsx` itself (both files still compile; every other test
 * still passes with its own hand-built provider). This spec renders the actual `RootLayout`
 * export, with a stand-in child calling `AnnouncePaperContext` the same way
 * `PaperReaderPage` does, and proves the announced paper actually reaches the sibling
 * `QuillWidget` through the one real `PaperContextProvider` instance `layout.tsx` assembles --
 * not a test-local substitute.
 */
describe('RootLayout wiring (Story 5.2)', () => {
  it('wires PaperContextProvider around both children and QuillWidget, so an announced paper reaches the widget', () => {
    render(
      <RootLayout>
        <AnnouncePaperContext paperNumber={51} title="The Structure of the Government" />
      </RootLayout>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Ask the Archive' }));

    expect(
      screen.getByText(/Federalist No\. 51 — The Structure of the Government/),
    ).toBeTruthy();
    expect(screen.getByLabelText('Remove paper context')).toBeTruthy();
  });

  it('shows no chip when no page-level child announces a paper (Homepage/Browse Papers)', () => {
    render(
      <RootLayout>
        <p>Homepage content</p>
      </RootLayout>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Ask the Archive' }));

    expect(screen.queryByLabelText('Remove paper context')).toBeNull();
  });
});
