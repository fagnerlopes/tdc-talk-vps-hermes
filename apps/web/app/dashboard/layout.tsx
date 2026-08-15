import { AppShell } from '../../components/AppShell';
import { LogoutButton } from '../../components/LogoutButton';
import { requireSession } from '../../lib/session';

// ESTE LAYOUT E A BARREIRA. Toda rota sob /dashboard/* passa por ele, e o
// requireSession() valida o cookie contra o banco a cada request.
//
// O middleware.ts faz so o atalho barato (cookie ausente -> /login) e NAO
// protege nada, porque roda no Edge e nao alcanca o Prisma. Quem mexer depois
// nao pode assumir o contrario.
export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSession();

  return (
    <AppShell eyebrow="Operacao · producao" title="Painel administrativo">
      <div className="flex justify-end">
        <LogoutButton email={user.email} />
      </div>
      {children}
    </AppShell>
  );
}
