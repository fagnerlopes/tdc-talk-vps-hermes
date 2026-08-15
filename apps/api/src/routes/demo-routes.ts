// Factory de rotas registrada 2x: /v1 (teste previo das 18h) e /v2 (live das 19h).
// Estado isolado por versao — ver state.ts.

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { prisma, PRODUCTS, DEFAULT_USER_ID, type CatalogProduct } from '@hermes/database';

import { emit } from '../logger';
import { recentLogs } from '../log-buffer';
import {
  buildFailureError,
  delay,
  newOrderId,
  pickReason,
  shouldFail,
  simulatedLatencyMs,
} from '../checkout';
import { getState, resetState, type Version } from '../state';

interface CheckoutBody {
  productId?: string;
  userId?: string;
  forceFailure?: boolean;
}

interface ConfigBody {
  failureRate?: number;
  maxSuccessStreak?: number;
  forceNextOutcome?: 'fail' | 'success' | null;
  reset?: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

async function findProduct(productId: string): Promise<CatalogProduct | null> {
  try {
    const row = await prisma.product.findUnique({ where: { id: productId } });
    if (row) return row;
  } catch {
    // Banco fora do ar nao pode derrubar a demo — cai para o catalogo estatico.
  }
  return PRODUCTS.find((product) => product.id === productId) ?? null;
}

export function registerVersion(app: FastifyInstance, version: Version): void {
  const plugin: FastifyPluginAsync = async (scoped) => {
    const state = getState(version);

    // ---------------------------------------------------------------- health
    scoped.get('/health', async (_request, reply) => {
      if (state.crashed) {
        return reply.status(500).send({
          status: 'error',
          error: 'crashed',
          version,
          timestamp: new Date().toISOString(),
        });
      }
      return {
        status: 'ok',
        version,
        timestamp: new Date().toISOString(),
      };
    });

    // ---------------------------------------------------------------- status
    scoped.get('/status', async () => {
      const observedRate = state.checkouts > 0 ? state.failures / state.checkouts : 0;
      return {
        version,
        uptime: Math.floor((Date.now() - state.startedAt) / 1000),
        checkouts: state.checkouts,
        failures: state.failures,
        failureRate: state.failureRate,
        observedFailureRate: Number(observedRate.toFixed(3)),
        maxSuccessStreak: state.maxSuccessStreak,
        crashed: state.crashed,
        timestamp: new Date().toISOString(),
      };
    });

    // -------------------------------------------------------------- products
    scoped.get('/products', async () => {
      try {
        const rows = await prisma.product.findMany({ orderBy: { price: 'desc' } });
        if (rows.length > 0) return { products: rows };
      } catch {
        // idem findProduct: fallback estatico mantem o dashboard de pe
      }
      return { products: PRODUCTS };
    });

    // ------------------------------------------------------------------ logs
    scoped.get('/logs', async (request) => {
      const raw = (request.query as { limit?: string }).limit;
      const limit = clamp(Number(raw ?? 10) || 10, 1, 100);
      return { logs: recentLogs(version, limit) };
    });

    // -------------------------------------------------------------- checkout
    scoped.post('/checkout', async (request, reply) => {
      const endpoint = `/${version}/checkout`;
      const correlationId = request.id;
      const startedAt = Date.now();

      const body = (request.body ?? {}) as CheckoutBody;
      const productId = typeof body.productId === 'string' ? body.productId : '';
      const userId = typeof body.userId === 'string' ? body.userId : DEFAULT_USER_ID;

      const product = await findProduct(productId);

      if (product === null) {
        emit(
          'warn',
          {
            version,
            correlationId,
            endpoint,
            productId,
            userId,
            reason: 'product_not_found',
            httpStatus: 400,
            durationMs: Date.now() - startedAt,
          },
          'Produto desconhecido no checkout',
        );
        return reply.status(400).send({ error: 'product_not_found', productId, correlationId });
      }

      state.checkouts += 1;

      emit(
        'info',
        { version, correlationId, endpoint, productId, userId, amount: product.price },
        'Checkout iniciado',
      );

      const willFail = shouldFail(state, body.forceFailure === true);
      await delay(simulatedLatencyMs(willFail));

      const orderId = newOrderId();

      if (willFail) {
        state.failures += 1;
        state.successStreak = 0;

        const reason = pickReason();
        const error = buildFailureError(reason, productId);
        const durationMs = Date.now() - startedAt;

        await persistOrder(
          { orderId, productId, userId, amount: product.price, status: 'FAILED', correlationId },
          { version, endpoint },
        );

        emit(
          'error',
          {
            version,
            correlationId,
            endpoint,
            productId,
            userId,
            reason,
            stack: error.stack,
            httpStatus: 500,
            durationMs,
            amount: product.price,
          },
          'Falha ao processar pagamento',
        );

        return reply.status(500).send({
          error: reason,
          message: error.message,
          productId,
          correlationId,
        });
      }

      state.successStreak += 1;
      const durationMs = Date.now() - startedAt;

      await persistOrder(
        { orderId, productId, userId, amount: product.price, status: 'PAID', correlationId },
        { version, endpoint },
      );

      emit(
        'info',
        {
          version,
          correlationId,
          endpoint,
          productId,
          userId,
          orderId,
          httpStatus: 200,
          durationMs,
          amount: product.price,
        },
        'Checkout concluido com sucesso',
      );

      return reply.status(200).send({
        status: 'PAID',
        orderId,
        productId,
        amount: product.price,
        correlationId,
      });
    });

    // -------------------------------------------------------- simulate-crash
    scoped.post('/simulate-crash', async (request) => {
      state.crashed = !state.crashed;

      emit(
        state.crashed ? 'error' : 'info',
        {
          version,
          correlationId: request.id,
          endpoint: `/${version}/simulate-crash`,
          reason: state.crashed ? 'manual_crash_enabled' : 'manual_crash_cleared',
          httpStatus: 200,
        },
        state.crashed
          ? 'Servico marcado como indisponivel'
          : 'Servico restabelecido',
      );

      return { crashed: state.crashed, version };
    });

    // ---------------------------------------------------------------- config
    // Controles de determinismo de palco. Mesma natureza do /simulate-crash que
    // ja estava na spec: mutacao de estado em memoria. Nenhum alerta/webhook/cron.
    scoped.post('/config', async (request) => {
      const body = (request.body ?? {}) as ConfigBody;

      if (body.reset === true) {
        resetState(version);
      }

      if (typeof body.failureRate === 'number' && Number.isFinite(body.failureRate)) {
        state.failureRate = clamp(body.failureRate, 0, 1);
      }

      if (typeof body.maxSuccessStreak === 'number' && Number.isFinite(body.maxSuccessStreak)) {
        state.maxSuccessStreak = Math.max(0, Math.floor(body.maxSuccessStreak));
      }

      if (body.forceNextOutcome === 'fail' || body.forceNextOutcome === 'success') {
        state.forceNextOutcome = body.forceNextOutcome;
      } else if (body.forceNextOutcome === null) {
        state.forceNextOutcome = null;
      }

      return {
        version,
        failureRate: state.failureRate,
        maxSuccessStreak: state.maxSuccessStreak,
        forceNextOutcome: state.forceNextOutcome,
        crashed: state.crashed,
      };
    });
  };

  void app.register(plugin, { prefix: `/${version}` });
}

interface OrderInput {
  orderId: string;
  productId: string;
  userId: string;
  amount: number;
  status: 'PAID' | 'FAILED';
  correlationId: string;
}

/**
 * Persistencia best-effort: o registro no banco da ao Hermes um segundo angulo
 * de investigacao (cruzar correlationId do Loki com a tabela orders), mas se o
 * banco falhar a demo continua — a linha no Loki e que nao pode faltar.
 */
async function persistOrder(
  input: OrderInput,
  context: { version: Version; endpoint: string },
): Promise<void> {
  try {
    await prisma.order.create({
      data: {
        id: input.orderId,
        productId: input.productId,
        userId: input.userId,
        amount: input.amount,
        status: input.status,
        correlationId: input.correlationId,
      },
    });
  } catch (error) {
    emit(
      'warn',
      {
        version: context.version,
        correlationId: input.correlationId,
        endpoint: context.endpoint,
        productId: input.productId,
        userId: input.userId,
        reason: 'order_persistence_failed',
        stack: error instanceof Error ? error.stack : String(error),
      },
      'Nao foi possivel gravar o pedido no banco',
    );
  }
}
