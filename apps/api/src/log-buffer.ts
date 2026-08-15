// Ring buffer em memoria que alimenta o painel "Logs Recentes" do dashboard.
//
// Isto NAO substitui o Loki — e so uma conveniencia de UI para a plateia ver a
// linha aparecer na tela. A fonte de verdade da investigacao do Hermes e o Loki.

import type { Version } from './state';

export interface BufferedLog {
  level: 'info' | 'warn' | 'error';
  timestamp: string;
  version: Version | 'system';
  correlationId?: string;
  endpoint?: string;
  productId?: string;
  reason?: string;
  message: string;
}

const CAPACITY = 200;
const buffer: BufferedLog[] = [];

export function pushLog(entry: BufferedLog): void {
  buffer.push(entry);
  if (buffer.length > CAPACITY) {
    buffer.splice(0, buffer.length - CAPACITY);
  }
}

export function recentLogs(version: Version, limit: number): BufferedLog[] {
  const filtered = buffer.filter((entry) => entry.version === version);
  return filtered.slice(-limit).reverse();
}
