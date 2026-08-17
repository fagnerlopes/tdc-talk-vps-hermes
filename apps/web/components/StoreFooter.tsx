export function StoreFooter() {
  return (
    <footer className="border-t border-[var(--store-border)] bg-[var(--store-bg-utility)] transition-colors duration-300">
      <div className="mx-auto max-w-7xl px-4 py-8">
        {/* Trust badges */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 mb-8">
          {[
            { icon: '🚚', title: 'Frete Gratis', sub: 'Acima de R$ 299' },
            { icon: '🔒', title: 'Compra Segura', sub: 'Ambiente protegido' },
            { icon: '↩️', title: 'Troca Garantida', sub: 'Ate 7 dias' },
            { icon: '💳', title: 'Parcele em 12x', sub: 'Sem juros' },
          ].map((b) => (
            <div key={b.title} className="flex items-center gap-3 rounded-lg border border-[var(--store-border-subtle)] bg-[var(--store-bg-card)] p-3 transition-colors duration-300">
              <span className="text-2xl">{b.icon}</span>
              <div>
                <p className="text-xs font-semibold text-[var(--store-text-secondary)]">{b.title}</p>
                <p className="text-[10px] text-[var(--store-text-muted)]">{b.sub}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-col items-center gap-3 border-t border-[var(--store-border-subtle)] pt-6">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded bg-amber-500 font-mono text-sm font-black text-slate-950">
              H
            </span>
            <span className="text-sm font-semibold text-[var(--store-text-muted)]">Hermes Informática</span>
          </div>
          <p className="text-center text-xs text-[var(--store-text-muted)] leading-relaxed">
            Loja ficticia para demonstracao — TDC 2026
            <br />
            Monitoramento com Hermes Agent · Observabilidade com Loki · Deploy com Coolify
          </p>
        </div>
      </div>
    </footer>
  );
}
