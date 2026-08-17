import type { NextConfig } from 'next';

/**
 * next.config.ts — headers/CSP per docs/build/01-architecture.md §20 (INV-76/INV-77),
 * images.remotePatterns per INV-54. No `experimental.*` (ADR-0002 C1). process.env is allowed here (INV-35).
 */

const supabaseHost = (() => {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return 'dllbekulbimblrsrxuyv.supabase.co';
  try {
    return new URL(raw).host;
  } catch {
    return 'dllbekulbimblrsrxuyv.supabase.co';
  }
})();

const isDev = process.env.NODE_ENV === 'development';
const isDeployed = Boolean(process.env.VERCEL_ENV); // preview or production

/** CSP baseline — 01 §20 table, one directive per row, in order. */
const csp = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: blob: https://${supabaseHost} https://cdn.modrinth.com https://cdn-raw.modrinth.com https://i.ytimg.com https://yt3.ggpht.com`,
  `font-src 'self'`,
  `connect-src 'self' https://${supabaseHost} wss://${supabaseHost} https://vitals.vercel-insights.com https://va.vercel-scripts.com`,
  `frame-src https://www.youtube-nocookie.com https://ko-fi.com`,
  `media-src 'self' blob:`,
  `worker-src 'self' blob:`,
  `object-src 'none'`,
  `base-uri 'self'`,
  `form-action 'self'`,
  `frame-ancestors 'none'`,
  ...(isDeployed ? ['upgrade-insecure-requests'] : []),
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

const noindex = { key: 'X-Robots-Tag', value: 'noindex, nofollow' };

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: supabaseHost },
      { protocol: 'https', hostname: 'cdn.modrinth.com' },
      { protocol: 'https', hostname: 'cdn-raw.modrinth.com' },
      { protocol: 'https', hostname: 'i.ytimg.com' },
      { protocol: 'https', hostname: 'yt3.ggpht.com' },
    ],
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      { source: '/admin', headers: [noindex] },
      { source: '/admin/:path*', headers: [noindex] },
      { source: '/welcome', headers: [noindex] },
      { source: '/profile', headers: [noindex] },
      { source: '/api/:path*', headers: [noindex] },
    ];
  },
};

export default nextConfig;
