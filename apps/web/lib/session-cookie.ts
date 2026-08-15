// Modulo deliberadamente sem NENHUM import.
//
// O middleware.ts roda no Edge Runtime, onde nao existe `node:crypto` nem o
// client do Prisma. Se ele importasse @hermes/database so para saber o nome do
// cookie, o build quebraria. Por isso o nome mora aqui, sozinho.
export const SESSION_COOKIE = 'hostmaster_session';
