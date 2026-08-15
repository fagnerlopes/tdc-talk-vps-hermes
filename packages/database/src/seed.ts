// Seed idempotente — roda a cada boot do container sem quebrar (upsert).
// Executar:  docker compose exec -T api node packages/database/dist/seed.js
//            (ou `npm run seed` na raiz, que faz exatamente isso)

import { prisma } from './index';
import { PRODUCTS, USERS } from './catalog';
import { generatePassword, hashPassword } from './password';

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

  await seedFirstAdmin();

  const products = await prisma.product.count();
  const users = await prisma.user.count();

  console.log(`Seed completed: ${products} produtos, ${users} usuarios`);
}

/**
 * Cria o primeiro admin se nao houver nenhum. Idempotente: numa base que ja tem
 * admin nao faz nada — nem sequer reseta senha.
 *
 * Se ADMIN_PASSWORD nao vier definida, gera 24 caracteres e imprime UMA UNICA
 * VEZ no stdout do container (recuperavel com `docker compose logs api`). Nada
 * vai para o repositorio, que e publico.
 */
async function seedFirstAdmin(): Promise<void> {
  const existing = await prisma.adminUser.count();
  if (existing > 0) {
    console.log(`Seed: ${existing} admin(s) ja cadastrados, nada a fazer`);
    return;
  }

  const email = (process.env.ADMIN_EMAIL ?? 'admin@hostmaster.local').trim().toLowerCase();
  const provided = process.env.ADMIN_PASSWORD;
  const useProvided = typeof provided === 'string' && provided.length > 0;
  const password = useProvided ? provided : generatePassword(24);

  await prisma.adminUser.create({
    data: {
      email,
      name: 'Administrador',
      passwordHash: await hashPassword(password),
    },
  });

  if (useProvided) {
    console.log(`Seed: admin ${email} criado (senha vinda de ADMIN_PASSWORD)`);
    return;
  }

  console.log('');
  console.log('==========================================================');
  console.log('  PRIMEIRO ADMIN CRIADO — esta senha aparece UMA SO VEZ');
  console.log(`  email: ${email}`);
  console.log(`  senha: ${password}`);
  console.log('  Guarde agora. Para reler depois: docker compose logs api');
  console.log('==========================================================');
  console.log('');
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
