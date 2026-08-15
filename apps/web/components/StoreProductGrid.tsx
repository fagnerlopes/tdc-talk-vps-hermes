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

const PRODUCT_ICONS: Record<string, string> = {
  'MONITOR-240HZ': '🖥️',
  'RTX-4060': '🎮',
  'HEADSET-GAMER': '🎧',
  'TECLADO-RGB': '⌨️',
  'MOUSEPAD-XL': '🖱️',
};

const PRODUCT_COLORS: Record<string, string> = {
  'MONITOR-240HZ': 'from-blue-600/20 to-cyan-600/10',
  'RTX-4060': 'from-emerald-600/20 to-teal-600/10',
  'HEADSET-GAMER': 'from-purple-600/20 to-pink-600/10',
  'TECLADO-RGB': 'from-amber-600/20 to-orange-600/10',
  'MOUSEPAD-XL': 'from-rose-600/20 to-red-600/10',
};

function Stars({ count = 5 }: { count?: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <svg
          key={i}
          className={`h-3.5 w-3.5 ${i < count ? 'text-amber-400' : 'text-slate-700'}`}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      ))}
      <span className="ml-1.5 text-xs text-slate-500">(127)</span>
    </div>
  );
}

export function StoreProductGrid({ products }: { products: CatalogProduct[] }) {
  const [pending, setPending] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  function addToast(toast: Omit<Toast, 'key'>) {
    const key = ++toastSeq;
    setToasts((c) => [{ ...toast, key }, ...c].slice(0, 4));
    window.setTimeout(() => {
      setToasts((c) => c.filter((t) => t.key !== key));
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
          title: `Pedido ${payload.orderId} confirmado!`,
          detail: `${product.name} · ${formatBRL(product.price)}`,
          correlationId: payload.correlationId,
        });
      } else {
        addToast({
          kind: 'error',
          title: 'Nao foi possivel concluir o pagamento',
          detail: `${product.name} · tente novamente em alguns instantes`,
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
    <>
      {/* Hero banner */}
      <section className="mx-auto max-w-7xl px-4 pt-8 pb-2">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-amber-500/10 via-amber-600/5 to-transparent border border-amber-500/20 px-8 py-10 md:px-12">
          <div className="relative z-10">
            <span className="inline-block rounded-full bg-amber-500/20 border border-amber-500/30 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-amber-400">
              TDC 2026 · Demonstracao ao vivo
            </span>
            <h2 className="mt-4 text-2xl font-bold text-white md:text-3xl">
              Setup Gamer Completo
            </h2>
            <p className="mt-2 max-w-lg text-sm text-slate-400 leading-relaxed">
              Monitore esta loja com o Hermes Agent. Compre qualquer produto e acompanhe 
              os logs, metricas e alertas em tempo real.
            </p>
          </div>
          <div className="absolute -right-4 -bottom-4 text-[120px] opacity-10 select-none" aria-hidden>
            🎮
          </div>
        </div>
      </section>

      {/* Products */}
      <section className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-6 flex items-baseline justify-between">
          <div>
            <h2 className="text-xl font-bold text-white">Produtos em destaque</h2>
            <p className="mt-1 text-sm text-slate-500">{products.length} produtos encontrados</p>
          </div>
          <span className="text-xs text-slate-500 uppercase tracking-wider">
            Ordenar: Relevancia
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {products.map((product) => {
            const icon = PRODUCT_ICONS[product.id] ?? '📦';
            const gradient = PRODUCT_COLORS[product.id] ?? 'from-slate-600/20 to-slate-700/10';
            const installment = product.price / 12;

            return (
              <div
                key={product.id}
                className="group flex flex-col rounded-xl border border-slate-800 bg-[#0f1729] transition hover:border-slate-700 hover:shadow-lg hover:shadow-amber-500/5"
              >
                {/* Product image area */}
                <div className={`relative flex h-44 items-center justify-center rounded-t-xl bg-gradient-to-br ${gradient}`}>
                  <span className="text-6xl select-none transition-transform group-hover:scale-110" aria-hidden>
                    {icon}
                  </span>
                  <span className="absolute top-3 left-3 rounded bg-emerald-500/20 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                    Em estoque
                  </span>
                </div>

                {/* Product info */}
                <div className="flex flex-1 flex-col p-4">
                  <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-slate-600">
                    {product.id}
                  </p>
                  <h3 className="mt-1 text-sm font-semibold leading-snug text-slate-200 line-clamp-2">
                    {product.name}
                  </h3>

                  <Stars count={4 + Math.floor(Math.random() * 2)} />

                  <div className="mt-3">
                    <p className="text-2xl font-bold tabular-nums text-white">
                      {formatBRL(product.price)}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      ou 12x de{' '}
                      <span className="text-slate-400">{formatBRL(installment)}</span>{' '}
                      sem juros
                    </p>
                    <p className="mt-1 flex items-center gap-1 text-xs text-emerald-500">
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 0 1-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0H6.375c-.621 0-1.125-.504-1.125-1.125V14.25m0 0h13.5m-13.5 0V6.375c0-.621.504-1.125 1.125-1.125h6.75c.621 0 1.125.504 1.125 1.125V14.25" />
                      </svg>
                      Frete gratis
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => void buy(product)}
                    disabled={pending !== null}
                    className="mt-4 w-full rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-bold uppercase tracking-wide text-slate-950 transition hover:bg-amber-400 focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f1729] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98]"
                  >
                    {pending === product.id ? (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                          <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" fill="currentColor" className="opacity-75" />
                        </svg>
                        Processando...
                      </span>
                    ) : (
                      'Comprar'
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Toasts */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed right-6 bottom-6 z-50 flex w-[min(28rem,calc(100vw-3rem))] flex-col gap-3"
      >
        {toasts.map((toast) => (
          <div
            key={toast.key}
            className={
              toast.kind === 'success'
                ? 'log-enter pointer-events-auto rounded-xl border border-emerald-500/40 bg-emerald-950/90 p-4 shadow-2xl backdrop-blur'
                : 'log-enter pointer-events-auto rounded-xl border border-red-500/50 bg-red-950/90 p-4 shadow-2xl backdrop-blur'
            }
          >
            <div className="flex items-start gap-3">
              <span className="text-xl" aria-hidden>
                {toast.kind === 'success' ? '✅' : '❌'}
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={
                    toast.kind === 'success'
                      ? 'text-sm font-semibold text-emerald-200'
                      : 'text-sm font-semibold text-red-200'
                  }
                >
                  {toast.title}
                </p>
                <p className="mt-0.5 text-xs text-slate-400">{toast.detail}</p>
                {toast.correlationId ? (
                  <p className="mt-2 flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-[0.15em] text-slate-500">
                      ref
                    </span>
                    <CorrelationChip
                      id={toast.correlationId}
                      tone={toast.kind === 'error' ? 'error' : 'neutral'}
                    />
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
