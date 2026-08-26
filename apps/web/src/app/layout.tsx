import './global.css';

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
      <body>{children}</body>
    </html>
  );
}
