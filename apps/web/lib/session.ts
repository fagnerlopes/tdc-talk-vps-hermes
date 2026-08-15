import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  isSessionExpired,
  newSessionId,
  prisma,
  sessionExpiresAt,
  sessionTtlHours,
} from '@hermes/database';

import { SESSION_COOKIE } from './session-cookie';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export async function createSession(userId: string): Promise<{ id: string; expiresAt: Date }> {
  const id = newSessionId();
  const expiresAt = sessionExpiresAt(sessionTtlHours());
  await prisma.session.create({ data: { id, userId, expiresAt } });
  return { id, expiresAt };
}

/** Devolve o usuario da sessao, ou null. Sessao expirada e apagada de passagem. */
export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token === undefined || token === '') return null;

  const session = await prisma.session.findUnique({
    where: { id: token },
    include: { user: true },
  });

  if (session === null || isSessionExpired(session)) {
    if (session !== null) {
      // Limpeza best-effort: falhar aqui nao pode impedir o redirect para /login.
      await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    }
    return null;
  }

  return { id: session.user.id, email: session.user.email, name: session.user.name };
}

/**
 * A BARREIRA. Chamada por app/dashboard/layout.tsx, por onde toda rota sob
 * /dashboard/* passa. O middleware.ts NAO protege nada — ver o comentario la.
 */
export async function requireSession(): Promise<SessionUser> {
  const user = await getSession();
  if (user === null) redirect('/login');
  return user;
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token === undefined || token === '') return;
  await prisma.session.delete({ where: { id: token } }).catch(() => undefined);
}
