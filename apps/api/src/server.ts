import { buildApp } from './app';
import { logger } from './logger';

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? '0.0.0.0';

async function start(): Promise<void> {
  const app = await buildApp();

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'Encerrando checkout-api');
    void app.close().then(() => process.exit(0));
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await app.listen({ port: PORT, host: HOST });
  logger.info({ port: PORT, host: HOST }, 'checkout-api ouvindo');
}

start().catch((error: unknown) => {
  logger.error(
    { stack: error instanceof Error ? error.stack : String(error) },
    'Falha ao subir a checkout-api',
  );
  process.exit(1);
});
