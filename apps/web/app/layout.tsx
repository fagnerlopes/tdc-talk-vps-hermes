import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Hermes Informática — Loja e Painel',
  description: 'Loja Hermes Informática e painel administrativo',
  // Aplicado ao app INTEIRO, nao so a loja: o /dashboard tambem nao pode ser
  // indexado. Esta e a camada das respostas HTML; app/robots.ts cobre quem
  // consulta robots.txt, e o header em next.config.mjs cobre o resto.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
