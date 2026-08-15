// Decisao de falha + catalogo de reasons.
//
// CRITICO: nada aqui marca uma falha como "forcada". O caminho forcado
// (forceNextOutcome / forceFailure / corte de streak) produz uma linha de log
// byte-identica a uma falha natural. A investigacao do Hermes no palco precisa
// ser genuina — se houvesse um campo `forced:true`, a demo seria teatro.

import { randomBytes } from 'node:crypto';
import type { DemoState } from './state';

export type FailureReason =
  | 'payment_gateway_timeout'
  | 'payment_processing_failed'
  | 'insufficient_inventory';

const REASON_WEIGHTS: ReadonlyArray<{ reason: FailureReason; weight: number }> = [
  { reason: 'payment_gateway_timeout', weight: 70 },
  { reason: 'payment_processing_failed', weight: 20 },
  { reason: 'insufficient_inventory', weight: 10 },
];

const TOTAL_WEIGHT = REASON_WEIGHTS.reduce((sum, item) => sum + item.weight, 0);

export function pickReason(): FailureReason {
  let roll = Math.random() * TOTAL_WEIGHT;
  for (const item of REASON_WEIGHTS) {
    roll -= item.weight;
    if (roll <= 0) return item.reason;
  }
  return 'payment_gateway_timeout';
}

export function buildFailureError(reason: FailureReason, productId: string): Error {
  switch (reason) {
    case 'payment_gateway_timeout':
      return new Error('Payment gateway did not respond within 30000ms');
    case 'payment_processing_failed':
      return new Error('Payment processing failed at provider (code: PROV-502)');
    case 'insufficient_inventory':
      return new Error(`Insufficient inventory reserved for product ${productId}`);
  }
}

/**
 * Decide se este checkout falha. Retorna so um booleano — quem loga nao sabe
 * (nem pode saber) qual dos caminhos abaixo tomou a decisao.
 *
 * Ordem de precedencia:
 *   1. forceNextOutcome (botao de panico do palco, consumido na hora)
 *   2. forceFailure no body (curl deterministico, sem mexer no estado global)
 *   3. corte de streak (apos N sucessos seguidos, forca falha — mata o risco de cauda)
 *   4. sorteio por failureRate
 */
export function shouldFail(state: DemoState, forceFailure: boolean): boolean {
  const forced = state.forceNextOutcome;
  if (forced !== null) {
    state.forceNextOutcome = null;
    return forced === 'fail';
  }

  if (forceFailure) return true;

  if (state.maxSuccessStreak > 0 && state.successStreak >= state.maxSuccessStreak) {
    return true;
  }

  return Math.random() < state.failureRate;
}

export function newOrderId(): string {
  return `ORD-${randomBytes(3).toString('hex').toUpperCase()}`;
}

/** Latencia sintetica: torna o log plausivel sem travar o palco. */
export function simulatedLatencyMs(willFail: boolean): number {
  return willFail ? 150 + Math.floor(Math.random() * 250) : 40 + Math.floor(Math.random() * 90);
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
