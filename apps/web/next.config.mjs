import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
};
export default nextConfig;
