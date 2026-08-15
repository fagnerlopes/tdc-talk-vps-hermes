// scrypt do node:crypto — nao bcrypt nem argon2.
//
// Os dois exigem compilacao nativa, e o build roda numa VPS pequena; scrypt e
// built-in e nao acrescenta dependencia nenhuma. Salt aleatorio de 16 bytes por
// senha, formato `salt:hash` em hex, comparacao com timingSafeEqual.
//
// CRITICO: este arquivo NAO pode importar Prisma. O seed (que roda no container
// da API) e o Next precisam usar exatamente a mesma funcao, e o web nao deve
// carregar o client gerado so para conferir uma senha.

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

const SALT_BYTES = 16;
const KEY_BYTES = 64;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(plain, salt, KEY_BYTES);
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const separator = stored.indexOf(':');
  if (separator <= 0) return false;

  const saltHex = stored.slice(0, separator);
  const hashHex = stored.slice(separator + 1);

  // Buffer.from(hex) nao lanca em hex invalido: ele trunca no primeiro par
  // invalido. A checagem de tamanho abaixo e o que rejeita entrada malformada.
  const expected = Buffer.from(hashHex, 'hex');
  const salt = Buffer.from(saltHex, 'hex');
  if (expected.length !== KEY_BYTES || salt.length !== SALT_BYTES) return false;

  const derived = await scrypt(plain, salt, KEY_BYTES);
  return timingSafeEqual(derived, expected);
}

// Alfabeto sem 0/O/1/l/I: a senha do primeiro admin pode acabar sendo lida de um
// `docker compose logs` e digitada a mao.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export function generatePassword(length = 24): string {
  const bytes = randomBytes(length);
  let out = '';
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return out;
}
