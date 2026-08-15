'use client';

export function LogoutButton({ email }: { email: string }) {
  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.replace('/login');
  }

  return (
    <div className="flex items-center gap-3">
      <span className="hidden font-mono text-xs text-slate-500 sm:inline">{email}</span>
      <button
        type="button"
        onClick={() => void logout()}
        className="rounded border border-slate-700 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-slate-400 transition hover:border-slate-500 hover:text-slate-200 focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:outline-none"
      >
        Sair
      </button>
    </div>
  );
}
