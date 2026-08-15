import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

/**
 * Chrome compartilhado entre a loja e o painel.
 *
 * A separacao entre as duas telas e de CONTEUDO, nao de moldura: a sidebar com
 * os links "Loja" e "Painel" e o que permite ir de uma cena a outra no palco.
 * A loja nao tem stats, logs nem controles; o painel nao tem cards de produto.
 */
export function AppShell({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar eyebrow={eyebrow} title={title} />

        <main className="flex flex-1 flex-col gap-6 p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
