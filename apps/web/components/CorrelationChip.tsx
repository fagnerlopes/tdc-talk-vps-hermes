'use client';

import { useState } from 'react';

/**
 * O elemento-assinatura do painel.
 *
 * A demo inteira gira em torno de correlacao: o dev le este id na tela e dita
 * para o Hermes, que o encontra no Loki. Por isso ele aparece grande, em mono,
 * e em dois lugares (toast e linha de log) — e da para copiar com um clique.
 */
export function CorrelationChip({ id, tone = 'neutral' }: { id: string; tone?: 'neutral' | 'error' }) {
  const [copied, setCopied] = useState(false);

  async function copy(event: React.MouseEvent<HTMLButtonElement>) {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // clipboard exige contexto seguro (https/localhost); no http da VPS,
      // selecionar o texto ainda deixa o dev copiar na mao.
      const range = document.createRange();
      range.selectNodeContents(event.currentTarget);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title="Copiar correlationId"
      className={
        tone === 'error'
          ? 'rounded border border-red-500/40 bg-red-500/10 px-2 py-0.5 font-mono text-sm tracking-tight text-red-700 dark:text-red-200 transition hover:border-red-400 focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:outline-none'
          : 'rounded border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-800/70 px-2 py-0.5 font-mono text-sm tracking-tight text-slate-700 dark:text-slate-200 transition hover:border-amber-500 focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:outline-none'
      }
    >
      {copied ? 'copiado' : id}
    </button>
  );
}
