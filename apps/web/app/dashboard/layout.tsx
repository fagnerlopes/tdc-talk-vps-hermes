import { AppShell } from '../../components/AppShell';

// A Task 8 insere `requireSession()` aqui. ESTE layout e a barreira de
// autenticacao — toda rota sob /dashboard/* passa por ele. O middleware.ts fara
// so o atalho barato (cookie ausente -> /login) e NAO protege nada, porque roda
// no Edge e nao alcanca o Prisma.
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell eyebrow="Operacao · producao" title="Painel administrativo">
      {children}
    </AppShell>
  );
}
