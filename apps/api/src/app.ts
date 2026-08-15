import { randomBytes } from 'node:crypto';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';

import { logger } from './logger';
import { registerVersion } from './routes/demo-routes';
import { VERSIONS } from './state';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    // O cast existe porque o FastifyBaseLogger do fastify 5 ainda nao declara
    // `msgPrefix`, que o pino 9.14 tornou obrigatorio no BaseLogger. Em runtime
    // um pino.Logger e exatamente o que o Fastify espera.
    loggerInstance: logger as unknown as FastifyBaseLogger,

    // Essencial: os logs automaticos do Fastify carregam objetos req/res e NAO
    // tem `endpoint` nem `correlationId`. Poluiriam `{job="api"} | json` com
    // linhas que o Hermes nao sabe interpretar. Todo log e explicito via emit().
    disableRequestLogging: true,

    genReqId: () => `req-${randomBytes(4).toString('hex')}`,
  });

  await app.register(cors, { origin: true });

  app.get('/', async () => ({
    service: 'checkout-api',
    versions: VERSIONS,
    endpoints: VERSIONS.flatMap((version) => [
      `GET  /${version}/health`,
      `GET  /${version}/status`,
      `GET  /${version}/products`,
      `GET  /${version}/logs?limit=10`,
      `POST /${version}/checkout`,
      `POST /${version}/simulate-crash`,
      `POST /${version}/config`,
    ]),
  }));

  for (const version of VERSIONS) {
    registerVersion(app, version);
  }

  return app;
}
