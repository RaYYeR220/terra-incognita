import type { Metadata, Viewport } from 'next';
import { Atkinson_Hyperlegible, Bowlby_One } from 'next/font/google';

import './globals.css';

const display = Bowlby_One({ weight: '400', subsets: ['latin'], variable: '--font-display', display: 'swap' });
const text = Atkinson_Hyperlegible({ weight: ['400', '700'], subsets: ['latin'], variable: '--font-text', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Terra Incognita', template: '%s · Terra Incognita' },
  description:
    'A treasure hunt on Solana where nobody knows where the treasure is. Its coordinates sit in a hardware enclave; first strike within 50 km takes the pot.',
};

export const viewport: Viewport = {
  themeColor: '#1B4F52',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${text.variable}`}>
      <body>
        {children}
        <div className="grain" aria-hidden="true" />
      </body>
    </html>
  );
}
