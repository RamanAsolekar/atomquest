export const env = {
  // In the browser, use '' (same-origin) so every fetch('/api/...') is
  // proxied by nginx — no hardcoded host baked into the bundle.
  // During SSR (Node.js), we still need the internal absolute URL.
  apiUrl:
    typeof window !== 'undefined'
      ? ''
      : (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'),
  // Socket.IO / WS — also relative to origin in the browser.
  wsUrl:
    typeof window !== 'undefined'
      ? ''
      : (process.env.NEXT_PUBLIC_WS_URL ?? 'http://localhost:4000'),
  mediaWsUrl:
    typeof window !== 'undefined'
      ? ''
      : (process.env.NEXT_PUBLIC_MEDIA_WS_URL ?? 'http://localhost:5000'),
  appName: process.env.NEXT_PUBLIC_APP_NAME ?? 'Atom Support Vision',
};
