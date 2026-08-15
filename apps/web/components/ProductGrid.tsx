'use client';

import { useState } from 'react';
import type { CatalogProduct } from '@hermes/database/catalog';
import { DEMO_VERSION, formatBRL, proxy, requestRefresh } from '../lib/api';
import { CorrelationChip } from './CorrelationChip';

interface Toast {
  key: number;
  kind: 'success' | 'error';
  title: string;
  detail: string;
  correlationId?: string;
}

let toastSeq = 0;

export function ProductGrid({ products }: { products: CatalogProduct[] }) {
  const [pending, setPending] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  function addToast(toast: Omit<Toast, 'key'>) {
    const key = ++toastSeq;
    setToasts((current) => [{ ...toast, key }, ...current].slice(0, 4));
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.key !== key));
    }, 9000);
  }

  async function buy(product: CatalogProduct) {
    setPending(product.id);
    try {
      const response = await fetch(proxy(`/${DEMO_VERSION}/checkout`), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ productId: product.id, userId: 'user-1' }),
      });
      const payload = (await response.json()) as Record<string, string>;

      if (response.ok) {
        addToast({
          kind: 'success',
          title: `Pedido ${payload.orderId} confirmado`,
          detail: `${product.name} · ${formatBRL(product.price)}`,
          correlationId: payload.correlationId,
        });
      } else {
        addToast({
          kind: 'error',
          title: 'Pagamento nao concluido',
          detail: `${product.name} · ${payload.error ?? 'erro desconhecido'}`,
          correlationId: payload.correlationId,
        });
      }
    } catch (error) {
      addToast({
        kind: 'error',
        title: 'Nao foi possivel falar com a API',
        detail: String(error),
      });
    } finally {
      setPending(null);
      requestRefresh();
    }
  }

  return (
    <section className="min-w-0">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-xl font-semibold tracking-tight text-slate-100">Produtos</h2>
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate-500">
          POST /{DEMO_VERSION}/checkout
        </p>
      </div>

      <ul className="grid gap-4 sm:grid-cols-2">
        {products.map((product) => (
          <li
            key={product.id}
            className="flex flex-col justify-between rounded-lg border border-slate-800 bg-[#131c2e] p-5"
          >
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate-500">
                {product.id}
              </p>
              <h3 className="mt-1.5 text-lg leading-snug font-medium text-slate-100">
                {product.name}
              </h3>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-50">
                {formatBRL(product.price)}
              </p>
            </div>

            <button
              type="button"
              onClick={() => void buy(product)}
              disabled={pending !== null}
              className="mt-5 w-full rounded bg-amber-500 px-4 py-3 text-base font-semibold text-slate-950 transition hover:bg-amber-400 focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#131c2e] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending === product.id ? 'Processando...' : `Comprar ${product.name}`}
            </button>
          </li>
        ))}
      </ul>

      <div
        aria-live="polite"
        className="pointer-events-none fixed right-6 bottom-6 z-50 flex w-[min(28rem,calc(100vw-3rem))] flex-col gap-3"
      >
        {toasts.map((toast) => (
          <div
            key={toast.key}
            className={
              toast.kind === 'success'
                ? 'log-enter pointer-events-auto rounded-lg border border-emerald-500/40 bg-emerald-950/90 p-4 shadow-xl backdrop-blur'
                : 'log-enter pointer-events-auto rounded-lg border border-red-500/50 bg-red-950/90 p-4 shadow-xl backdrop-blur'
            }
          >
            <p
              className={
                toast.kind === 'success'
                  ? 'text-base font-semibold text-emerald-200'
                  : 'text-base font-semibold text-red-200'
              }
            >
              {toast.title}
            </p>
            <p className="mt-0.5 text-sm text-slate-300">{toast.detail}</p>
            {toast.correlationId ? (
              <p className="mt-2.5 flex items-center gap-2">
                <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate-400">
                  correlationId
                </span>
                <CorrelationChip
                  id={toast.correlationId}
                  tone={toast.kind === 'error' ? 'error' : 'neutral'}
                />
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
