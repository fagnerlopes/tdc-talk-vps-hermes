'use client';

import { useEffect, useState } from 'react';
import { DEMO_VERSION, proxy } from '../lib/api';

type Health = 'ok' | 'down' | 'unknown';

export function TopBar({ eyebrow, title }: { eyebrow: string; title: string }) {
  const [health, setHealth] = useState<Health>('unknown');

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const response = await fetch(proxy(`/${DEMO_VERSION}/health`), { cache: 'no-store' });
        if (!cancelled) setHealth(response.ok ? 'ok' : 'down');
      } catch {
        if (!cancelled) setHealth('down');
      }
    }

    void check();
    const timer = window.setInterval(check, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const label = health === 'ok' ? 'Operacional' : health === 'down' ? 'Indisponivel' : 'Verificando';
  const dot =
    health === 'ok' ? 'bg-emerald-400' : health === 'down' ? 'bg-red-500' : 'bg-slate-500';

  return (
    <header className="flex h-20 shrink-0 items-center justify-between border-b border-slate-800 bg-[#0d1526] px-6 lg:px-8">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate-500">
          {eyebrow}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50 lg:text-3xl">{title}</h1>
      </div>

      <div className="flex items-center gap-4">
        <span className="hidden rounded border border-slate-700 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-slate-400 sm:inline">
          producao · {DEMO_VERSION}
        </span>
        <span className="flex items-center gap-2 rounded border border-slate-700 bg-slate-900/60 px-3 py-1.5">
          <span className={`h-2.5 w-2.5 rounded-full ${dot}`} aria-hidden />
          <span className="text-sm font-medium text-slate-200">{label}</span>
        </span>
      </div>
    </header>
  );
}
