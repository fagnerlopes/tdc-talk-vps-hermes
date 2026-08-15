import { NextResponse } from 'next/server';
import { prisma } from '@hermes/database';

import { getSession } from '../../../../../lib/session';

export const dynamic = 'force-dynamic';

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await getSession();
  if (session === null) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await context.params;

  // Duas travas contra ficar trancado para fora do proprio painel na vespera da
  // talk. A segunda cobre o caso de dois operadores removerem um ao outro.
  if (id === session.id) {
    return NextResponse.json(
      { error: 'cannot_delete_self', message: 'Voce nao pode remover a propria conta.' },
      { status: 409 },
    );
  }

  const total = await prisma.adminUser.count();
  if (total <= 1) {
    return NextResponse.json(
      { error: 'last_admin', message: 'Nao da para remover o unico admin.' },
      { status: 409 },
    );
  }

  // onDelete: Cascade no schema derruba as sessions junto — quem foi removido
  // perde o acesso na hora, sem esperar o TTL.
  await prisma.adminUser.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
