import type { NextConfig } from 'next';

/**
 * next.config.ts — headers/CSP per docs/build/01-architecture.md §20 (INV-76/INV-77),
 * images.remotePatterns per INV-54. No `experimental.*` (ADR-0002 C1). process.env is allowed here (INV-35).
 *
 * The Supabase ORIGIN (protocol + host[:port]) is derived from NEXT_PUBLIC_SUPABASE_URL so the local
 * http stack (http://127.0.0.1:54321) works in e2e; on Vercel the URL is https and the emitted CSP /
 * remotePatterns are the same strings as before.
 */

const supabaseUrl = (() => {
  const fallback = 'https://dllbekulbimblrsrxuyv.supabase.co';
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  try {
    return new URL(raw && raw.trim() !== '' ? raw : fallback);
  } catch {
    return new URL(fallback);
  }
})();
const supabaseOrigin = supabaseUrl.origin; // https://<ref>.supabase.co | http://127.0.0.1:54321
const supabaseHost = supabaseUrl.host; // includes the port when there is one
const supabaseProtocol: 'http' | 'https' = supabaseUrl.protocol === 'http:' ? 'http' : 'https';
const supabaseWsOrigin = `${supabaseProtocol === 'http' ? 'ws' : 'wss'}://${supabaseHost}`;
/**
 * The local Supabase stack (e2e / CI) serves Storage from 127.0.0.1:54321. next/image refuses upstreams
 * that resolve to a private IP unless `images.dangerouslyAllowLocalIP` is set, so every stored-avatar
 * <img> would be a 400 locally. Enabled ONLY when the derived Supabase host is a loopback name; on
 * Vercel the host is `<ref>.supabase.co` and the flag is absent. remotePatterns stay the INV-54 list.
 */
const supabaseIsLoopback = ['127.0.0.1', 'localhost', '[::1]'].includes(supabaseUrl.hostname);

const isDev = process.env.NODE_ENV === 'development';
const isDeployed = Boolean(process.env.VERCEL_ENV); // preview or production

/** CSP baseline — 01 §20 table, one directive per row, in order. */
const csp = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: blob: ${supabaseOrigin} https://cdn.modrinth.com https://cdn-raw.modrinth.com https://i.ytimg.com https://yt3.ggpht.com`,
  `font-src 'self'`,
  `connect-src 'self' ${supabaseOrigin} ${supabaseWsOrigin} https://vitals.vercel-insights.com https://va.vercel-scripts.com`,
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
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

const noindex = { key: 'X-Robots-Tag', value: 'noindex, nofollow' };

const nextConfig: NextConfig = {
  // Next 16.3 `next dev` upserts a managed `nextjs-agent-rules` block into CLAUDE.md whenever it
  // detects a coding agent; CLAUDE.md is this repo's hand-written orientation file (docs), so the
  // rewrite is disabled — every S1.4 visual check had to revert it (recorded in questions.md).
  agentRules: false,
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    remotePatterns: [
      {
        protocol: supabaseProtocol,
        hostname: supabaseUrl.hostname,
        ...(supabaseUrl.port ? { port: supabaseUrl.port } : {}),
      },
      { protocol: 'https', hostname: 'cdn.modrinth.com' },
      { protocol: 'https', hostname: 'cdn-raw.modrinth.com' },
      { protocol: 'https', hostname: 'i.ytimg.com' },
      { protocol: 'https', hostname: 'yt3.ggpht.com' },
    ],
    ...(supabaseIsLoopback ? { dangerouslyAllowLocalIP: true } : {}),
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      { source: '/admin', headers: [noindex] },
      { source: '/admin/:path*', headers: [noindex] },
      { source: '/welcome', headers: [noindex] },
      { source: '/profile', headers: [noindex] },
      { source: '/api/:path*', headers: [noindex] },
      // 04 §2.3 D6: the download 302 must carry `Referrer-Policy: no-referrer` — configured
      // headers overwrite handler-set ones per key, so the global strict-origin value above
      // would clobber the route's; this later, more specific rule wins for the one route (S1.3).
      {
        source: '/api/download/:path*',
        headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }],
      },
    ];
  },
};

export default nextConfig;
