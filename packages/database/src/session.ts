// Politica de sessao — funcoes puras, sem Prisma e sem nada do Next.
//
// Sessao no banco em vez de JWT: da logout de verdade e revogacao imediata, sem
// gerenciar segredo compartilhado. O cookie carrega so o id opaco gerado aqui.
//
// O NOME do cookie nao mora aqui, e sim em apps/web/lib/session-cookie.ts — o
// middleware do Next roda no Edge Runtime, onde `node:crypto` nao existe, e nao
// pode importar este modulo.

import { randomBytes } from 'node:crypto';

export const SESSION_TTL_HOURS_DEFAULT = 12;

/** 32 bytes aleatorios em hex — e o proprio valor do cookie. */
export function newSessionId(): string {
  return randomBytes(32).toString('hex');
}

export function sessionTtlHours(
  raw: string | undefined = process.env.SESSION_TTL_HOURS,
): number {
  if (raw === undefined || raw.trim() === '') return SESSION_TTL_HOURS_DEFAULT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return SESSION_TTL_HOURS_DEFAULT;
  return parsed;
}

export function sessionExpiresAt(ttlHours: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + ttlHours * 3_600_000);
}

/** Sessao ausente conta como expirada — quem chama nao precisa tratar null. */
export function isSessionExpired(
  session: { expiresAt: Date } | null,
  now: Date = new Date(),
): boolean {
  if (session === null) return true;
  return session.expiresAt.getTime() <= now.getTime();
}
