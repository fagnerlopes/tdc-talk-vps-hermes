'use client';

import { useCallback, useEffect, useState } from 'react';
import { DEMO_VERSION, formatTime, proxy, REFRESH_EVENT, type LogEntry } from '../lib/api';
import { CorrelationChip } from './CorrelationChip';

// O erro precisa ser inconfundivel do fundo da sala: regua vermelha, fundo
// tingido e mensagem em corpo maior. info e warn ficam deliberadamente quietos.
const LEVEL_STYLES: Record<LogEntry['level'], { badge: string; row: string; text: string }> = {
  error: {
    badge: 'bg-red-500/20 text-red-200 border-red-500/50',
    row: 'border-l-red-500 bg-red-950/40',
    text: 'text-base font-medium text-red-100',
  },
  warn: {
    badge: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
    row: 'border-l-amber-500 bg-slate-900/50',
    text: 'text-sm text-slate-200',
  },
  info: {
    badge: 'bg-slate-700/50 text-slate-300 border-slate-600',
    row: 'border-l-slate-700 bg-slate-900/50',
    text: 'text-sm text-slate-300',
  },
};

export function RecentLogsPanel() {
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const load = useCallback(async () => {
    try {
      const response = await fetch(proxy(`/${DEMO_VERSION}/logs?limit=10`), { cache: 'no-store' });
      if (!response.ok) return;
      const payload = (await response.json()) as { logs: LogEntry[] };
      setLogs(payload.logs);
    } catch {
      // silencioso: nao vale poluir a tela projetada com erro de polling
    }
  }, []);

  useEffect(() => {
    void load();
    // Polling de 2s em vez de SSE: se auto-cura, atende o "< 2 segundos" do
    // checklist e e debugavel na aba Network na frente da plateia.
    const timer = window.setInterval(load, 2000);
    const onRefresh = () => void load();
    window.addEventListener(REFRESH_EVENT, onRefresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(REFRESH_EVENT, onRefresh);
    };
  }, [load]);

  return (
    <section className="min-w-0">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-xl font-semibold tracking-tight text-slate-100">Logs recentes</h2>
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate-500">
          atualiza a cada 2s
        </p>
      </div>

      <ol className="flex flex-col gap-2 rounded-lg border border-slate-800 bg-[#131c2e] p-3">
        {logs.length === 0 ? (
          <li className="px-2 py-8 text-center text-sm text-slate-500">
            Nenhuma atividade ainda. Clique em Comprar para gerar a primeira linha.
          </li>
        ) : null}

        {logs.map((log, index) => {
          const style = LEVEL_STYLES[log.level] ?? LEVEL_STYLES.info;
          return (
            <li
              key={`${log.correlationId ?? 'x'}-${log.timestamp}-${index}`}
              className={`log-enter rounded border-l-2 px-3 py-2.5 ${style.row}`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase ${style.badge}`}
                >
                  {log.level}
                </span>
                <span className="font-mono text-xs text-slate-500 tabular-nums">
                  {formatTime(log.timestamp)}
                </span>
                {log.endpoint ? (
                  <span className="truncate font-mono text-xs text-slate-500">{log.endpoint}</span>
                ) : null}
              </div>

              <p className={`mt-1.5 leading-snug ${style.text}`}>{log.message}</p>

              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                {log.productId ? (
                  <span className="font-mono text-xs text-slate-400">{log.productId}</span>
                ) : null}
                {log.reason ? (
                  <span className="font-mono text-xs text-red-300">{log.reason}</span>
                ) : null}
                {log.correlationId ? (
                  <CorrelationChip id={log.correlationId} tone={log.level === 'error' ? 'error' : 'neutral'} />
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
