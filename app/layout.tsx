import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import '@/styles/tokens.css';
import '@/styles/globals.css';
import { publicEnv } from '@/lib/env/public';

/**
 * Root layout — html/body/fonts/tokens ONLY (ADR-0002 C5, 02 RP-09). No UI, no providers.
 * Fonts: self-hosted WOFF2 in public/fonts via next/font/local (01 INV-63, DESIGN.md §2).
 */
const bungee = localFont({
  src: [{ path: '../public/fonts/bungee-400.woff2', weight: '400', style: 'normal' }],
  variable: '--font-display',
  display: 'swap',
  fallback: ['Impact', 'Arial Black', 'sans-serif'],
});

const spaceGrotesk = localFont({
  src: [
    { path: '../public/fonts/space-grotesk-400.woff2', weight: '400', style: 'normal' },
    { path: '../public/fonts/space-grotesk-500.woff2', weight: '500', style: 'normal' },
    { path: '../public/fonts/space-grotesk-700.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-body',
  display: 'swap',
  fallback: ['Arial', 'Helvetica', 'sans-serif'],
});

const silkscreen = localFont({
  src: [
    { path: '../public/fonts/silkscreen-400.woff2', weight: '400', style: 'normal' },
    { path: '../public/fonts/silkscreen-700.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-pixel',
  display: 'swap',
  preload: false, // small eyebrow labels only — keep the first-paint preload budget for Bungee + Space Grotesk
  fallback: ['monospace'],
});

const description = 'Mods and other odd things, made by OddSense.';

export const metadata: Metadata = {
  metadataBase: new URL(publicEnv.NEXT_PUBLIC_SITE_URL),
  title: { template: '%s — odsens', default: 'odsens' },
  description,
  // No `title`/`description` here: Next fills og:title / og:description from each page's resolved
  // metadata, so `/projects` emits "Projects — odsens" (02 RP-06) while `/` keeps the absolute title.
  openGraph: {
    siteName: 'odsens',
    images: ['/brand/og-default.png'],
    type: 'website',
  },
  twitter: { card: 'summary_large_image' },
};

export const viewport: Viewport = {
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${bungee.variable} ${spaceGrotesk.variable} ${silkscreen.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
