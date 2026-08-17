'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { DEMO_VERSION, proxy } from '../lib/api';

type Health = 'ok' | 'down' | 'unknown';

export function StoreHeader() {
  const [health, setHealth] = useState<Health>('unknown');

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const r = await fetch(proxy(`/${DEMO_VERSION}/health`), { cache: 'no-store' });
        if (!cancelled) setHealth(r.ok ? 'ok' : 'down');
      } catch {
        if (!cancelled) setHealth('down');
      }
    }
    void check();
    const t = window.setInterval(check, 5000);
    return () => { cancelled = true; window.clearInterval(t); };
  }, []);

  const dot = health === 'ok' ? 'bg-emerald-400' : health === 'down' ? 'bg-red-500' : 'bg-slate-500';
  const label = health === 'ok' ? 'Operacional' : health === 'down' ? 'Indisponivel' : '...';

  return (
    <header className="sticky top-0 z-40 border-b border-slate-800 bg-[#0b1120]/95 backdrop-blur">
      {/* Top utility bar */}
      <div className="border-b border-slate-800/60 bg-[#060d1b]">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-1.5 text-xs text-slate-400">
          <span>Frete gratis acima de R$ 299 para todo o Brasil</span>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
              {label}
            </span>
            <span className="hidden text-slate-600 sm:inline">|</span>
            <Link href="/dashboard" className="hidden text-slate-400 transition hover:text-amber-400 sm:inline">
              Painel Admin
            </Link>
          </div>
        </div>
      </div>

      {/* Main header */}
      <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-4">
        <Link href="/" className="flex items-center gap-2.5 shrink-0">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-amber-500 font-mono text-xl font-black text-slate-950">
            H
          </span>
          <div className="hidden sm:block">
            <span className="text-xl font-bold tracking-tight text-white">Hermes Informática</span>
            <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Gaming & Informatica</p>
          </div>
        </Link>

        {/* Search bar (decorative) */}
        <div className="relative flex-1 max-w-2xl">
          <input
            type="text"
            placeholder="Buscar produtos, marcas e categorias..."
            readOnly
            className="w-full rounded-lg border border-slate-700 bg-slate-900/80 py-2.5 pl-4 pr-12 text-sm text-slate-300 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
          />
          <div className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md bg-amber-500 p-1.5">
            <svg className="h-4 w-4 text-slate-950" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
          </div>
        </div>

        {/* Right icons */}
        <div className="flex items-center gap-4">
          <button type="button" className="relative hidden text-slate-400 transition hover:text-white sm:block" title="Carrinho">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
            </svg>
            <span className="absolute -top-1.5 -right-1.5 grid h-4 w-4 place-items-center rounded-full bg-amber-500 text-[10px] font-bold text-slate-950">
              0
            </span>
          </button>
          <button type="button" className="hidden text-slate-400 transition hover:text-white sm:block" title="Minha conta">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Category bar */}
      <div className="border-t border-slate-800/60">
        <div className="mx-auto flex max-w-7xl items-center gap-1 px-4 py-2 overflow-x-auto">
          {['Todos', 'Monitores', 'Placas de Video', 'Perifericos', 'Audio', 'Acessorios'].map((cat, i) => (
            <span
              key={cat}
              className={
                i === 0
                  ? 'shrink-0 rounded-full bg-amber-500/15 border border-amber-500/30 px-4 py-1.5 text-sm font-medium text-amber-400 cursor-default'
                  : 'shrink-0 rounded-full border border-transparent px-4 py-1.5 text-sm text-slate-400 cursor-default hover:text-slate-200 transition'
              }
            >
              {cat}
            </span>
          ))}
        </div>
      </div>
    </header>
  );
}
