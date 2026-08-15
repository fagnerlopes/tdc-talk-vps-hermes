import { NextResponse, type NextRequest } from 'next/server';

import { SESSION_COOKIE } from './lib/session-cookie';

/**
 * ATENCAO A QUEM MEXER DEPOIS: este middleware NAO e a barreira de autenticacao.
 *
 * Ele roda no Edge Runtime, onde o Prisma nao existe — logo nao tem como validar
 * o cookie contra o banco. Tudo o que ele faz e o atalho barato: cookie ausente
 * -> redireciona sem tocar no banco. Um cookie FORJADO passa por aqui sem
 * problema, e e barrado adiante.
 *
 * A barreira e o `requireSession()` em app/dashboard/layout.tsx, e os route
 * handlers de /api/dashboard/* revalidam por conta propria.
 */
export function middleware(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = `next=${encodeURIComponent(request.nextUrl.pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/dashboard/:path*'],
};
