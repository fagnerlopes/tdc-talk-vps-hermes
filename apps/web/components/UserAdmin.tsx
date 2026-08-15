'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export interface AdminRow {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  lastLoginAt: string | null;
}

function formatDate(iso: string | null): string {
  if (iso === null) return 'nunca';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString('pt-BR', { hour12: false });
}

export function UserAdmin({ admins, currentId }: { admins: AdminRow[]; currentId: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');

    try {
      const response = await fetch('/api/dashboard/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, name, password }),
      });
      const payload = (await response.json()) as { message?: string; error?: string };

      if (response.ok) {
        setMessage(`Admin ${email} criado.`);
        setEmail('');
        setName('');
        setPassword('');
        router.refresh();
      } else {
        setMessage(
          payload.message ?? `Nao foi possivel criar (${payload.error ?? response.status}).`,
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: AdminRow) {
    if (!window.confirm(`Remover ${row.email}?`)) return;
    setBusy(true);
    setMessage('');

    try {
      const response = await fetch(`/api/dashboard/users/${row.id}`, { method: 'DELETE' });
      const payload = (await response.json()) as { message?: string; error?: string };

      if (response.ok) {
        setMessage(`Admin ${row.email} removido.`);
        router.refresh();
      } else {
        setMessage(
          payload.message ?? `Nao foi possivel remover (${payload.error ?? response.status}).`,
        );
      }
    } finally {
      setBusy(false);
    }
  }

  const field =
    'w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus-visible:border-amber-500 focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:outline-none';

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="mb-4 text-xl font-semibold tracking-tight text-slate-100">
          Administradores
        </h2>

        <div className="overflow-x-auto rounded-lg border border-slate-800 bg-[#131c2e]">
          <table className="w-full min-w-160 text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 font-mono text-[11px] uppercase tracking-[0.18em] text-slate-500">
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3">E-mail</th>
                <th className="px-4 py-3">Ultimo login</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {admins.map((row) => (
                <tr key={row.id} className="border-b border-slate-800/60 last:border-0">
                  <td className="px-4 py-3 text-slate-200">
                    {row.name}
                    {row.id === currentId ? (
                      <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.18em] text-amber-400">
                        voce
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-400">{row.email}</td>
                  <td className="px-4 py-3 text-slate-400">{formatDate(row.lastLoginAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      disabled={busy || row.id === currentId}
                      onClick={() => void remove(row)}
                      className="rounded border border-slate-700 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-slate-400 transition hover:border-red-500/60 hover:text-red-300 focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      Remover
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-slate-800 bg-[#131c2e] p-5">
        <h3 className="mb-4 text-base font-medium text-slate-100">Novo administrador</h3>

        <form onSubmit={create} className="grid gap-3 sm:grid-cols-3">
          <input
            aria-label="Nome"
            placeholder="Nome"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={field}
          />
          <input
            aria-label="E-mail"
            type="email"
            placeholder="email@exemplo.com"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={field}
          />
          <input
            aria-label="Senha"
            type="password"
            placeholder="senha (min. 12 caracteres)"
            minLength={12}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={field}
          />

          <button
            type="submit"
            disabled={busy}
            className="rounded bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-amber-400 focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 sm:col-span-3 sm:justify-self-start sm:px-6"
          >
            {busy ? 'Salvando...' : 'Criar administrador'}
          </button>
        </form>

        {message ? (
          <p
            role="status"
            className="mt-3 rounded border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-300"
          >
            {message}
          </p>
        ) : null}
      </section>
    </div>
  );
}
