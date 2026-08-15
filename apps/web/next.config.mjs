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

  // O `output: standalone` rastreia so o que consegue ver nos imports. Os engines
  // binarios do Prisma sao carregados em runtime POR CAMINHO, entao o tracer nao
  // os encontra, o container sobe e morre no primeiro acesso ao banco — ou seja,
  // no primeiro login. E uma falha que NAO aparece em `next dev`.
  outputFileTracingIncludes: {
    '/**': ['../../packages/database/generated/**'],
  },

  // Terceira camada do noindex: metadata cobre HTML, app/robots.ts cobre quem le
  // robots.txt, e este header cobre o resto (JSON dos route handlers, assets).
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
    ];
  },

  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
