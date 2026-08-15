import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',

  // Sem isto o layout standalone vira `server.js` na raiz em vez de
  // `apps/web/server.js`, e o container morre com "Cannot find module".
  outputFileTracingRoot: path.join(currentDir, '../../'),

  transpilePackages: ['@hermes/database'],

  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
