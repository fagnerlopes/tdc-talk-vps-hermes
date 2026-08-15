import { prisma } from '@hermes/database';

import { UserAdmin, type AdminRow } from '../../../components/UserAdmin';
import { requireSession } from '../../../lib/session';

export const dynamic = 'force-dynamic';

export default async function Usuarios() {
  // O layout do /dashboard ja chama requireSession(), mas repetir aqui custa uma
  // query e devolve o `id` do usuario atual, que a tabela precisa para marcar
  // "voce" e desabilitar o proprio botao de remover.
  const session = await requireSession();

  const rows = await prisma.adminUser.findMany({
    orderBy: { createdAt: 'asc' },
    select: { id: true, email: true, name: true, createdAt: true, lastLoginAt: true },
  });

  const admins: AdminRow[] = rows.map((row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
  }));

  return <UserAdmin admins={admins} currentId={session.id} />;
}
