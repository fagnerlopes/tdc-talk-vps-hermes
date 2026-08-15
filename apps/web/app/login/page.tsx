import Link from 'next/link';

import { LoginForm } from '../../components/LoginForm';

export const dynamic = 'force-dynamic';

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;

  // So aceitamos destino interno: `next=https://outro.site` viraria um open
  // redirect de graca.
  const raw = params.next ?? '/dashboard';
  const next = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/dashboard';

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded bg-amber-500 font-mono text-lg font-bold text-slate-950">
            H
          </span>
          <span className="text-lg font-semibold tracking-tight text-slate-100">HOSTMASTER</span>
        </div>

        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Acesso ao painel</h1>
        <p className="mt-1.5 mb-6 text-sm text-slate-400">
          Area restrita a operadores. Clientes usam a{' '}
          <Link href="/" className="text-amber-400 underline underline-offset-2">
            loja
          </Link>
          .
        </p>

        <LoginForm next={next} />
      </div>
    </div>
  );
}
