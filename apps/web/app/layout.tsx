import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'HOSTMASTER — Painel Administrativo',
  description: 'Dashboard administrativo HOSTMASTER',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
