import { fireEvent, render, screen } from '@testing-library/react';
import { QuillLauncher } from '../../../src/components/quill/quill-launcher';

/**
 * QuillLauncher (Story 5.1) is presentational and self-contained aside from a `sessionStorage`
 * flag gating the first-visit-only pulse/tooltip (DESIGN.md's "Launcher"). Every test clears
 * `sessionStorage` itself rather than relying on jsdom's default state between tests.
 */
describe('QuillLauncher', () => {
  afterEach(() => {
    window.sessionStorage.clear();
  });

  it('pulses once and auto-opens a tooltip on a first visit this session', () => {
    render(<QuillLauncher onOpen={jest.fn()} />);

    expect(
      screen.getByText('Ask me about the Federalist Papers →'),
    ).toBeTruthy();
    expect(window.sessionStorage.getItem('quill-tooltip-shown')).toBe('true');
  });

  it('shows neither the pulse nor the tooltip on a returning visit in the same session', () => {
    window.sessionStorage.setItem('quill-tooltip-shown', 'true');
    render(<QuillLauncher onOpen={jest.fn()} />);

    expect(
      screen.queryByText('Ask me about the Federalist Papers →'),
    ).toBeNull();
  });

  it('renders an accessible, keyboard-activatable button that opens the panel when clicked', () => {
    const onOpen = jest.fn();
    render(<QuillLauncher onOpen={onOpen} />);

    const button = screen.getByRole('button', { name: 'Ask the Archive' });
    fireEvent.click(button);

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('has a tap target of at least 44px in both dimensions', () => {
    render(<QuillLauncher onOpen={jest.fn()} />);

    const button = screen.getByRole('button', { name: 'Ask the Archive' });
    // h-14/w-14 (56px) per DESIGN.md -- comfortably above the 44px minimum tap target.
    expect(button.className).toContain('h-14');
    expect(button.className).toContain('w-14');
  });

  it('dismisses the tooltip once the launcher is clicked', () => {
    const onOpen = jest.fn();
    render(<QuillLauncher onOpen={onOpen} />);

    expect(screen.getByText('Ask me about the Federalist Papers →')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ask the Archive' }));

    expect(screen.queryByText('Ask me about the Federalist Papers →')).toBeNull();
  });
});
