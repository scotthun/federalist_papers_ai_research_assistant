'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/** The paper currently being read, as announced by `AnnouncePaperContext` from whichever Paper
 *  Reader page is mounted inside `{children}` -- `null` when no such page is current (Homepage,
 *  Browse Papers, or no page has announced yet). */
export interface CurrentPaper {
  paperNumber: number;
  title: string;
}

interface PaperContextValue {
  currentPaper: CurrentPaper | null;
  setCurrentPaper: (paper: CurrentPaper | null) => void;
}

/** Default value (a no-op setter, `currentPaper: null`) makes this safe to read with no
 *  `PaperContextProvider` ancestor -- e.g. a test that renders `QuillWidget` in isolation, per
 *  this story's Code Map. */
const noop = () => {
  // Intentionally does nothing -- see the doc comment above.
};

export const PaperContext = createContext<PaperContextValue>({
  currentPaper: null,
  setCurrentPaper: noop,
});

/**
 * Wraps `{children}` + `<QuillWidget />` together in `RootLayout` (Story 5.2's Boundaries) so a
 * page rendered inside `children` (via `AnnouncePaperContext`) can tell the layout-level
 * `QuillWidget` sibling which paper, if any, is currently being read -- without prop-drilling
 * through `{children}` or a second client-side fetch for data the Server Component page already
 * has.
 */
export function PaperContextProvider({ children }: { children: ReactNode }) {
  const [currentPaper, setCurrentPaper] = useState<CurrentPaper | null>(null);

  const value = useMemo(() => ({ currentPaper, setCurrentPaper }), [currentPaper]);

  return <PaperContext.Provider value={value}>{children}</PaperContext.Provider>;
}

export function usePaperContext(): PaperContextValue {
  return useContext(PaperContext);
}
