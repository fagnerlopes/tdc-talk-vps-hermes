// O browser SEMPRE fala com o proxy same-origin do proprio Next.
// Nada de NEXT_PUBLIC_API_URL: variavel NEXT_PUBLIC_* e inlined em build time,
// e uma URL errada no Coolify custaria um rebuild de 3-5 min no dia da talk.

export const DEMO_VERSION = 'v2' as const;

export function proxy(path: string): string {
  return `/api/proxy${path}`;
}

export const REFRESH_EVENT = 'hostmaster:refresh';

/** Dispara um re-poll imediato dos paineis (stats + logs) apos um clique. */
export function requestRefresh(): void {
  window.dispatchEvent(new Event(REFRESH_EVENT));
}

export interface LogEntry {
  level: 'info' | 'warn' | 'error';
  timestamp: string;
  correlationId?: string;
  endpoint?: string;
  productId?: string;
  reason?: string;
  message: string;
}

export interface StatusPayload {
  version: string;
  uptime: number;
  checkouts: number;
  failures: number;
  failureRate: number;
  observedFailureRate: number;
  crashed: boolean;
}

export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--:--:--';
  return date.toLocaleTimeString('pt-BR', { hour12: false });
}

export function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
