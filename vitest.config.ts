import { defineConfig } from 'vitest/config';

// Os testes cobrem o que e critico de seguranca (hash de senha e politica de
// sessao), nao a UI.
//
// Eles importam de packages/database/src/* DIRETO — nunca de src/index.ts, que
// arrasta o client gerado do Prisma e exigiria um `prisma generate` so para
// rodar teste de funcao pura.
export default defineConfig({
  test: {
    include: ['packages/**/test/**/*.test.ts'],
    environment: 'node',
  },
});
