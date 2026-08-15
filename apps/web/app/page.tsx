import { PRODUCTS, type CatalogProduct } from '@hermes/database/catalog';

import { ProductGrid } from '../components/ProductGrid';
import { RecentLogsPanel } from '../components/RecentLogsPanel';
import { Sidebar } from '../components/Sidebar';
import { StatsStrip } from '../components/StatsStrip';
import { TopBar } from '../components/TopBar';

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

export default async function Home() {
  const products = await getProducts();

  return (
    <div className="flex min-h-screen">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />

        <main className="flex flex-1 flex-col gap-6 p-6 lg:p-8">
          <StatsStrip />

          <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
            <ProductGrid products={products} />
            <RecentLogsPanel />
          </div>
        </main>
      </div>
    </div>
  );
}
