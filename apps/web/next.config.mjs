import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Internal service URLs for same-origin proxying. In docker-compose these are
// the service DNS names; for bare-metal dev they default to localhost ports.
const BACKEND = process.env.BACKEND_INTERNAL_URL ?? 'http://localhost:4000';
const MEDIA = process.env.MEDIA_INTERNAL_URL ?? 'http://localhost:5000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // Trace from the monorepo root so the standalone bundle includes workspace deps.
  outputFileTracingRoot: path.join(__dirname, '../../'),
  transpilePackages: ['@atom/shared'],
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'api.dicebear.com' }],
  },
  // Same-origin proxying so the app works whether opened via nginx (:80) or the
  // Next.js server directly (:3000). The browser always talks to its own origin:
  //   /api/*           → backend REST + SSE
  //   /socket.io/*     → backend realtime (/rt namespace)
  //   /rtc/*           → media SFU signaling (socket.io engine path; /sfu namespace)
  // socket.io-client uses `path` as the whole engine endpoint, so the browser
  // requests /rtc/?EIO=4&… — we map the entire /rtc/ path to the media server's
  // /socket.io/ path.
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${BACKEND}/api/:path*` },
      { source: '/socket.io/:path*', destination: `${BACKEND}/socket.io/:path*` },
      { source: '/rtc/:path*', destination: `${MEDIA}/socket.io/:path*` },
    ];
  },
  // Force the browser to revalidate the HTML document every load so a rebuilt
  // app is never served stale (the cache trap that kept masking fixes during
  // debugging). Hashed static chunks remain immutable/cacheable.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }],
      },
    ];
  },
};
export default nextConfig;
