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
      {/*
        `suppressHydrationWarning` is here for the browser, not for us.

        Extensions inject attributes into <body> before React hydrates - ColorZilla
        adds `cz-shortcut-listen="true"`, password managers and dark-mode add-ons do
        the same - and React reports the resulting mismatch as an application error.
        It is not one: nothing in this tree writes to <body>, and there is no server
        or client branch above it.

        **It suppresses exactly one level: this element's own attributes and text.**
        Children still hydrate under the normal rules, so a genuine mismatch anywhere
        inside the console is still reported. That is what makes this safe here and
        wrong almost anywhere else - it is the narrowest possible answer to something
        we do not control, not a way to quiet a real bug.
      */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
