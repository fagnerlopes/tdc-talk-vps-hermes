import { PrismaClient } from '../generated/client';

export * from './catalog';
export * from './password';
export * from './session';
export { PrismaClient };
export type { Product, User, Order } from '../generated/client';

// Singleton — evita esgotar o pool de conexoes em hot reload / multiplos imports.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
