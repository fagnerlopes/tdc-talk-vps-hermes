const NAV = [
  { label: 'Home', active: true },
  { label: 'Produtos', active: false },
  { label: 'Pedidos', active: false },
  { label: 'Analytics', active: false },
  { label: 'Settings', active: false },
];

export function Sidebar() {
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-800 bg-[#0d1526] lg:flex">
      <div className="flex h-20 items-center gap-3 border-b border-slate-800 px-6">
        <span className="grid h-9 w-9 place-items-center rounded bg-amber-500 font-mono text-lg font-bold text-slate-950">
          H
        </span>
        <span className="text-lg font-semibold tracking-tight text-slate-100">HOSTMASTER</span>
      </div>

      <nav className="flex flex-col gap-1 p-4">
        <p className="px-3 pb-2 font-mono text-[11px] uppercase tracking-[0.18em] text-slate-500">
          Painel
        </p>
        {NAV.map((item) => (
          <a
            key={item.label}
            href="#"
            aria-current={item.active ? 'page' : undefined}
            className={
              item.active
                ? 'rounded border-l-2 border-amber-500 bg-slate-800/60 px-3 py-2.5 text-base font-medium text-slate-100'
                : 'rounded border-l-2 border-transparent px-3 py-2.5 text-base text-slate-400 transition hover:bg-slate-800/40 hover:text-slate-200 focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:outline-none'
            }
          >
            {item.label}
          </a>
        ))}
      </nav>

      <div className="mt-auto border-t border-slate-800 p-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate-500">Regiao</p>
        <p className="mt-1 text-sm text-slate-300">br-south-1 · vps</p>
      </div>
    </aside>
  );
}
