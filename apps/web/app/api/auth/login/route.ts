import { NextResponse, type NextRequest } from 'next/server';
import { prisma, verifyPassword } from '@hermes/database';

import { createSession } from '../../../../lib/session';
import { SESSION_COOKIE } from '../../../../lib/session-cookie';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  let email = '';
  let password = '';

  try {
    const body = (await request.json()) as { email?: unknown; password?: unknown };
    if (typeof body.email === 'string') email = body.email.trim().toLowerCase();
    if (typeof body.password === 'string') password = body.password;
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  if (email === '' || password === '') {
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
  }

  const user = await prisma.adminUser.findUnique({ where: { email } });

  // Mesma resposta para "usuario nao existe" e "senha errada": nao entregamos
  // quais e-mails estao cadastrados.
  const ok = user !== null && (await verifyPassword(password, user.passwordHash));
  if (!ok || user === null) {
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
  }

  const session = await createSession(user.id);
  await prisma.adminUser
    .update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
    .catch(() => undefined);

  const response = NextResponse.json({ ok: true, email: user.email });

  // `secure` derivado do protocolo real, nao de env var: atras do Traefik o Next
  // ve http, e o x-forwarded-proto e quem sabe a verdade. Assim o cookie e
  // secure em producao (TLS) e continua funcionando no docker compose local, que
  // e http puro — sem ninguem precisar lembrar de trocar uma variavel.
  const proto =
    request.headers.get('x-forwarded-proto') ?? request.nextUrl.protocol.replace(':', '');

  response.cookies.set(SESSION_COOKIE, session.id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: proto === 'https',
    path: '/',
    expires: session.expiresAt,
  });

  return response;
}
