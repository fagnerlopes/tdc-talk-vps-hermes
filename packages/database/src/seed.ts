// Seed idempotente — roda a cada boot do container sem quebrar (upsert).
// Executar:  docker compose exec -T api node packages/database/dist/seed.js
//            (ou `npm run seed` na raiz, que faz exatamente isso)

import { prisma } from './index';
import { PRODUCTS, USERS } from './catalog';

async function main(): Promise<void> {
  for (const product of PRODUCTS) {
    await prisma.product.upsert({
      where: { id: product.id },
      update: { name: product.name, price: product.price },
      create: product,
    });
  }

  for (const user of USERS) {
    await prisma.user.upsert({
      where: { id: user.id },
      update: { email: user.email, name: user.name },
      create: user,
    });
  }

  const products = await prisma.product.count();
  const users = await prisma.user.count();

  console.log(`Seed completed: ${products} produtos, ${users} usuarios`);
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
