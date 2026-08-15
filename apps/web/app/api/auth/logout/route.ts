import { NextResponse } from 'next/server';

import { destroySession } from '../../../../lib/session';
import { SESSION_COOKIE } from '../../../../lib/session-cookie';

export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse> {
  // Sessao no banco em vez de JWT existe justamente por isto: apagar a linha
  // revoga na hora, sem esperar TTL nenhum.
  await destroySession();

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
  return response;
}
