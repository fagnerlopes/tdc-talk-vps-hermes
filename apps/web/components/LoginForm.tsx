'use client';

import { useState } from 'react';

export function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (response.ok) {
        // replace, nao push: o /login nao volta no botao voltar do navegador.
        window.location.replace(next);
        return;
      }

      setError('E-mail ou senha invalidos.');
    } catch {
      setError('Nao foi possivel falar com o servidor.');
    } finally {
      setBusy(false);
    }
  }

  const field =
    'w-full rounded border border-slate-700 bg-slate-900 px-3 py-2.5 text-base text-slate-100 focus-visible:border-amber-500 focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:outline-none';

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <label htmlFor="email" className="mb-1.5 block text-sm text-slate-400">
          E-mail
        </label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={field}
        />
      </div>

      <div>
        <label htmlFor="password" className="mb-1.5 block text-sm text-slate-400">
          Senha
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className={field}
        />
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded border border-red-500/50 bg-red-950/60 px-3 py-2 text-sm text-red-200"
        >
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="mt-1 rounded bg-amber-500 px-4 py-3 text-base font-semibold text-slate-950 transition hover:bg-amber-400 focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? 'Entrando...' : 'Entrar'}
      </button>
    </form>
  );
}
