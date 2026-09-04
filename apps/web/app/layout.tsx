import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

/**
 * The typeface docs/Design.md has specified since Phase 1 and nothing ever loaded.
 *
 * `tailwind.config.ts` named `'Inter'` in its font stack from the start, so the token
 * table looked right while every screen actually rendered in Segoe UI. Self-hosted by
 * `next/font`, so there is no request to Google at runtime and no layout shift - and
 * exposed as a CSS variable because next/font generates its own family name that a
 * hardcoded `'Inter'` in Tailwind could never match.
 *
 * `swap` so a slow connection gets the fallback face rather than invisible text: a
 * receptionist working a queue must never wait on a font.
 */
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'OPD Console', template: '%s · OPD Console' },
  description: 'Doctor, staff and admin console for the OPD queue platform',
  // The console holds patient names. It has no business in a search index.
  robots: { index: false, follow: false },
};

/**
 * The colour a phone paints its own chrome with, so the browser bar matches the
 * console's rail instead of defaulting to white above a `canvas` page - the seam
 * that makes a web app on a tablet read as a web page.
 */
export const viewport: Viewport = {
  themeColor: '#F7FAFC',
  colorScheme: 'light',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
