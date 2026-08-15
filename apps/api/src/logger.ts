// O arquivo mais importante do projeto.
//
// Todo campo obrigatorio do contrato de log (AGENTE.md) nasce aqui. Se um campo
// sumir daqui, a query LogQL do Hermes para de funcionar e a talk cai.
//
// Contrato (linha-alvo):
// {"level":"error","timestamp":"2026-08-17T22:08:23.456Z","service":"checkout-api",
//  "correlationId":"req-a1b2c3d4","endpoint":"/v2/checkout","productId":"MONITOR-240HZ",
//  "userId":"user-1","reason":"payment_gateway_timeout","stack":"Error: ...",
//  "httpStatus":500,"durationMs":1843,"message":"Falha ao processar pagamento"}

import pino from 'pino';
import { pushLog } from './log-buffer';
import type { Version } from './state';

const SERVICE_NAME = 'checkout-api';
const LOG_FILE = process.env.LOG_FILE ?? '/var/log/app/api.log';
const LOG_LEVEL = (process.env.LOG_LEVEL ?? 'info') as pino.Level;

function buildStreams(): pino.StreamEntry[] {
  // stdout continua util para `docker compose logs api`
  const streams: pino.StreamEntry[] = [{ level: LOG_LEVEL, stream: process.stdout }];

  try {
    streams.push({
      level: LOG_LEVEL,
      // sync: true — a linha chega ao disco antes da resposta HTTP retornar.
      // No volume desta demo o custo e irrelevante e garante o "log em Loki < 5s".
      stream: pino.destination({ dest: LOG_FILE, sync: true, mkdir: true }),
    });
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({
        level: 'error',
        timestamp: new Date().toISOString(),
        service: SERVICE_NAME,
        message: `NAO consegui abrir ${LOG_FILE} — Promtail nao vera nada: ${String(error)}`,
      })}\n`,
    );
  }

  return streams;
}

export const logger = pino(
  {
    level: LOG_LEVEL,
    base: { service: SERVICE_NAME }, // remove pid/hostname, adiciona service
    messageKey: 'message', // "message", nao "msg"
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`, // "timestamp", nao "time"
    formatters: {
      level: (label) => ({ level: label }), // "error", nao 50
    },
  },
  // multistream, nao transport: transport roda em worker thread e pode perder
  // linhas em buffer se o processo morrer abruptamente (docker compose restart).
  pino.multistream(buildStreams()),
);

export interface LogFields {
  version: Version;
  correlationId: string;
  endpoint: string;
  productId?: string;
  userId?: string;
  reason?: string;
  orderId?: string;
  stack?: string;
  httpStatus?: number;
  durationMs?: number;
  amount?: number;
}

/**
 * Loga no Pino (=> stdout + arquivo => Promtail => Loki) E empurra no ring
 * buffer do painel, numa chamada so.
 *
 * `version` fica de fora da linha JSON de proposito: o AGENTE.md distingue v1/v2
 * pelo campo `endpoint`, e um campo a mais so serviria para confundir o Hermes.
 */
export function emit(
  level: 'info' | 'warn' | 'error',
  fields: LogFields,
  message: string,
): void {
  const { version, ...logged } = fields;

  logger[level](logged, message);

  pushLog({
    level,
    timestamp: new Date().toISOString(),
    version,
    correlationId: fields.correlationId,
    endpoint: fields.endpoint,
    productId: fields.productId,
    reason: fields.reason,
    message,
  });
}
