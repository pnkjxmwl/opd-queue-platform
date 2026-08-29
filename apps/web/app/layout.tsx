import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'OPD Console',
  description: 'Doctor, staff and admin console for the OPD queue platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
