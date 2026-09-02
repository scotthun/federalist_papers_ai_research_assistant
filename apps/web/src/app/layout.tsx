import './global.css';
import { QuillWidget } from '@/components/quill/quill-widget';
import { PaperContextProvider } from '@/components/quill/paper-context';

export const metadata = {
  title: 'Federalist Research',
  description: 'Explore the Federalist Papers with source-grounded AI.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {/* Wraps children + QuillWidget together (Story 5.2's Boundaries) so a page rendered
            inside children (via AnnouncePaperContext) can tell its sibling QuillWidget which
            paper, if any, is currently being read. */}
        <PaperContextProvider>
          {children}
          {/* Mounted once at the layout level (Story 5.1's Boundaries) so its React state
              (open/closed + conversation) survives client-side <Link> navigations, and so it's
              available on every page, not just the homepage. */}
          <QuillWidget />
        </PaperContextProvider>
      </body>
    </html>
  );
}
