'use client';

import { useState } from 'react';
import { proxy, requestRefresh } from '../lib/api';

type Target = 'v2' | 'v1';

/**
 * Controles de palco. Deliberadamente discretos.
 *
 * RISCO ASSUMIDO: um botao "forcar erro" visivel na tela projetada conta para a
 * plateia que a falha e encenada. Por isso: <details> FECHADO por padrao, cinza,
 * sem destaque. NAO ABRA DURANTE O ATO 2.
 *
 * Nenhum endpoint novo — tudo passa por /vN/config, /vN/simulate-crash e
 * /vN/checkout, pelo proxy que ja existia. E nada aqui marca a falha como
 * forcada: a linha de log sai byte-identica a de uma falha natural.
 *
 * Estes botoes tem um plano B: a pasta 3 da collection do Postman cobre as
 * mesmas operacoes. Ao mexer aqui, atualize la.
 */
export function DemoControls() {
  const [target, setTarget] = useState<Target>('v2');
  const [feedback, setFeedback] = useState<string>('');
  const [busy, setBusy] = useState(false);

  async function send(path: string, body: Record<string, unknown> | null, label: string) {
    setBusy(true);
    try {
      const response = await fetch(proxy(`/${target}${path}`), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      const payload = (await response.json()) as Record<string, unknown>;
      setFeedback(`${label} · ${target} · HTTP ${response.status} · ${JSON.stringify(payload)}`);
    } catch (error) {
      setFeedback(`${label} · falhou: ${String(error)}`);
    } finally {
      setBusy(false);
      requestRefresh();
    }
  }

  const button =
    'rounded border border-slate-700 bg-slate-800/60 px-3 py-2 text-left text-sm text-slate-300 transition hover:border-slate-500 hover:text-slate-100 focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <details className="rounded-lg border border-slate-800 bg-[#101828]">
      <summary className="cursor-pointer px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-slate-500 select-none">
        Controles de demo
      </summary>

      <div className="flex flex-col gap-4 border-t border-slate-800 p-4">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate-500">
            Alvo
          </span>
          {(['v2', 'v1'] as Target[]).map((version) => (
            <button
              key={version}
              type="button"
              onClick={() => setTarget(version)}
              className={
                target === version
                  ? 'rounded border border-slate-500 bg-slate-700 px-2.5 py-1 font-mono text-xs text-slate-100'
                  : 'rounded border border-slate-700 px-2.5 py-1 font-mono text-xs text-slate-400 hover:text-slate-200'
              }
            >
              {version}
            </button>
          ))}
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            disabled={busy}
            className={button}
            onClick={() => void send('/config', { forceNextOutcome: 'fail' }, 'Forcar falha')}
          >
            Forcar falha no proximo clique
          </button>

          <button
            type="button"
            disabled={busy}
            className={button}
            onClick={() => void send('/config', { forceNextOutcome: 'success' }, 'Forcar sucesso')}
          >
            Forcar sucesso no proximo clique
          </button>

          <button
            type="button"
            disabled={busy}
            className={button}
            onClick={() =>
              void send(
                '/checkout',
                { productId: 'MONITOR-240HZ', userId: 'user-1', forceFailure: true },
                'Checkout com falha',
              )
            }
          >
            Disparar checkout com falha agora
          </button>

          <button
            type="button"
            disabled={busy}
            className={button}
            onClick={() => void send('/simulate-crash', null, 'Alternar disponibilidade')}
          >
            Derrubar / restabelecer servico
          </button>

          <button
            type="button"
            disabled={busy}
            className={button}
            onClick={() => void send('/config', { failureRate: 0 }, 'Taxa 0%')}
          >
            Taxa de falha 0%
          </button>

          <button
            type="button"
            disabled={busy}
            className={button}
            onClick={() => void send('/config', { failureRate: 0.5 }, 'Taxa 50%')}
          >
            Taxa de falha 50%
          </button>

          <button
            type="button"
            disabled={busy}
            className={button}
            onClick={() => void send('/config', { failureRate: 1 }, 'Taxa 100%')}
          >
            Taxa de falha 100%
          </button>

          <button
            type="button"
            disabled={busy}
            className={button}
            onClick={() => void send('/config', { reset: true }, 'Reset')}
          >
            Resetar baseline
          </button>
        </div>

        {feedback ? (
          <p className="rounded border border-slate-800 bg-slate-900/60 p-2 font-mono text-xs break-all text-slate-400">
            {feedback}
          </p>
        ) : null}
      </div>
    </details>
  );
}
