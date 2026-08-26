import { fireEvent, render, screen } from '@testing-library/react';
import { QuickFindSearch } from '../../src/components/quick-find-search';

/**
 * QuickFindSearch (Story 2.1) is a self-contained 'use client' component with no props and no
 * global store -- its own useState is the only client-side state, and submission is a plain HTML
 * form GET (no next/navigation router hook), so this renders and asserts on it directly with
 * plain @testing-library/react, same approach as the page specs, with no router/context harness
 * required.
 */
describe('QuickFindSearch', () => {
  it('renders an accessible, initially-empty search input', () => {
    render(<QuickFindSearch />);

    const input = screen.getByLabelText('Search by number, author, title, or keyword');
    expect(input).toBeTruthy();
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('updates the input value as the user types (own local state, not a global store)', () => {
    render(<QuickFindSearch />);

    const input = screen.getByLabelText(
      'Search by number, author, title, or keyword',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Madison' } });

    expect(input.value).toBe('Madison');
  });

  it('submits via a plain GET form to "/", carrying the term in the "q" query param', () => {
    render(<QuickFindSearch />);

    const form = screen.getByRole('search');
    expect(form.tagName).toBe('FORM');
    expect(form.getAttribute('method')).toBe('get');
    expect(form.getAttribute('action')).toBe('/');

    const input = screen.getByLabelText('Search by number, author, title, or keyword');
    expect(input.getAttribute('name')).toBe('q');
  });

  it('renders a submit button labeled "Search"', () => {
    render(<QuickFindSearch />);

    const button = screen.getByRole('button', { name: 'Search' });
    expect((button as HTMLButtonElement).type).toBe('submit');
  });
});
