'use client';

import { useEffect } from 'react';
import { usePaperContext } from './paper-context';

/**
 * Rendered by `PaperReaderPage` (an async Server Component, so it can't itself carry a
 * `'use client'` directive) alongside `<PaperReader>` to tell the layout-level `QuillWidget`
 * which paper is currently being read (Story 5.2's Boundaries/Design Notes). Announces on
 * mount and whenever `paperNumber`/`title` change, and clears (`setCurrentPaper(null)`) on
 * unmount -- e.g. navigating away to Browse Papers -- so a stale paper never lingers as "current"
 * once its page is no longer rendered.
 */
export function AnnouncePaperContext({
  paperNumber,
  title,
}: {
  paperNumber: number;
  title: string;
}) {
  const { setCurrentPaper } = usePaperContext();

  useEffect(() => {
    setCurrentPaper({ paperNumber, title });
    return () => setCurrentPaper(null);
    // `setCurrentPaper` is the raw `useState` setter (stable identity across renders, per
    // `PaperContextProvider`), so omitting it from the dependency array doesn't risk a stale
    // closure -- including it would be redundant, not incorrect.
  }, [paperNumber, title, setCurrentPaper]);

  return null;
}
