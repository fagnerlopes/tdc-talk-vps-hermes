import { PRODUCTS, type CatalogProduct } from '@hermes/database/catalog';

import { StoreHeader } from '../components/StoreHeader';
import { StoreProductGrid } from '../components/StoreProductGrid';
import { StoreFooter } from '../components/StoreFooter';

// Obrigatorio: sem isto o Next tenta buscar /v2/products em build time, quando
// o container da API nem existe, e o build do Docker morre com ECONNREFUSED.
export const dynamic = 'force-dynamic';

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://api:3001';

async function getProducts(): Promise<CatalogProduct[]> {
  try {
    const response = await fetch(`${API_INTERNAL_URL}/v2/products`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = (await response.json()) as { products: CatalogProduct[] };
    if (Array.isArray(payload.products) && payload.products.length > 0) return payload.products;
  } catch {
    // A pagina precisa renderizar mesmo com a API fora do ar no meio da demo.
  }
  return PRODUCTS;
}

/**
 * A LOJA — o que um cliente veria.
 *
 * Sem stats, sem logs, sem controles: tudo isso mora no /dashboard. E essa
 * separacao que faz o Ato 1 ("loja de cliente falhando") e o Ato 2 ("dev
 * investigando") serem cenas distintas no palco.
 */
export default async function Loja() {
  const products = await getProducts();

  return (
    <div className="flex min-h-screen flex-col bg-[var(--store-bg)] transition-colors duration-300">
      <StoreHeader />
      <main className="flex-1">
        <StoreProductGrid products={products} />
      </main>
      <StoreFooter />
    </div>
  );
}
