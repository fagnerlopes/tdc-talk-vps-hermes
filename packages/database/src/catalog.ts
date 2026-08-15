// Catalogo canonico da demo.
//
// ZERO import de Prisma aqui, de proposito: o `apps/web` importa este arquivo
// via `@hermes/database/catalog` e nao pode arrastar o @prisma/client para
// dentro do bundle do Next. Constantes puras, so isso.

export interface CatalogProduct {
  id: string;
  name: string;
  price: number;
  stock: number;
}

export interface CatalogUser {
  id: string;
  email: string;
  name: string;
}

export const PRODUCTS: CatalogProduct[] = [
  { id: 'MONITOR-240HZ', name: 'Monitor 240Hz IPS', price: 1299.0, stock: 100 },
  { id: 'RTX-4060', name: 'Placa de Video RTX 4060', price: 1899.0, stock: 100 },
  { id: 'HEADSET-GAMER', name: 'Headset Gamer Wireless', price: 449.0, stock: 100 },
  { id: 'TECLADO-RGB', name: 'Teclado Mecanico RGB', price: 599.0, stock: 100 },
  { id: 'MOUSEPAD-XL', name: 'Mousepad Extra Grande', price: 149.0, stock: 100 },
];

export const USERS: CatalogUser[] = [
  { id: 'user-1', email: 'gamer-pro@example.com', name: 'Gamer Pro' },
  { id: 'user-2', email: 'tech-enthusiast@test.com', name: 'Tech Enthusiast' },
];

export const DEFAULT_USER_ID = 'user-1';
