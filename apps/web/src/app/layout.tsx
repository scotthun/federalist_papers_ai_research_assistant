import './global.css';
import { QuillWidget } from '@/components/quill/quill-widget';

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
        {children}
        {/* Mounted once at the layout level (Story 5.1's Boundaries) so its React state
            (open/closed + conversation) survives client-side <Link> navigations, and so it's
            available on every page, not just the homepage. */}
        <QuillWidget />
      </body>
    </html>
  );
}
