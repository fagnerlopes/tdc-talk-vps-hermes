'use client';

import { useCallback, useEffect, useState } from 'react';
import { DEMO_VERSION, proxy, REFRESH_EVENT, type StatusPayload } from '../lib/api';

function formatUptime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes === 0) return `${rest}s`;
  return `${minutes}m ${String(rest).padStart(2, '0')}s`;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-[#131c2e] px-5 py-4">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-1.5 text-4xl font-semibold tabular-nums tracking-tight text-slate-50">
        {value}
      </p>
      {hint ? <p className="mt-1 text-sm text-slate-400">{hint}</p> : null}
    </div>
  );
}

export function StatsStrip() {
  const [status, setStatus] = useState<StatusPayload | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(proxy(`/${DEMO_VERSION}/status`), { cache: 'no-store' });
      if (!response.ok) return;
      setStatus((await response.json()) as StatusPayload);
    } catch {
      // silencioso: o dot de status da TopBar ja comunica indisponibilidade
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(load, 3000);
    const onRefresh = () => void load();
    window.addEventListener(REFRESH_EVENT, onRefresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(REFRESH_EVENT, onRefresh);
    };
  }, [load]);

  const failures = status?.failures ?? 0;
  const checkouts = status?.checkouts ?? 0;
  const observed = checkouts > 0 ? Math.round((failures / checkouts) * 100) : 0;

  return (
    <section className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <Stat label="Uptime" value={status ? formatUptime(status.uptime) : '--'} />
      <Stat label="Checkouts" value={String(checkouts)} hint="desde o ultimo deploy" />
      <Stat
        label="Falhas"
        value={String(failures)}
        hint={checkouts > 0 ? `${observed}% das tentativas` : 'nenhuma tentativa ainda'}
      />
      <Stat
        label="Servico"
        value={status?.crashed ? 'Fora' : 'No ar'}
        hint={status?.crashed ? 'health respondendo 500' : 'health respondendo 200'}
      />
    </section>
  );
}
