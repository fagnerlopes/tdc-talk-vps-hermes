import { describe, expect, it } from 'vitest';
import { generatePassword, hashPassword, verifyPassword } from '../src/password';

describe('hashPassword / verifyPassword', () => {
  it('faz roundtrip: a senha correta e aceita', async () => {
    const stored = await hashPassword('senha-do-palco-2026');
    expect(await verifyPassword('senha-do-palco-2026', stored)).toBe(true);
  });

  it('rejeita senha errada', async () => {
    const stored = await hashPassword('senha-do-palco-2026');
    expect(await verifyPassword('senha-errada', stored)).toBe(false);
  });

  it('gera hashes diferentes para a mesma senha (salt aleatorio)', async () => {
    const a = await hashPassword('mesma-senha');
    const b = await hashPassword('mesma-senha');
    expect(a).not.toBe(b);
    expect(await verifyPassword('mesma-senha', a)).toBe(true);
    expect(await verifyPassword('mesma-senha', b)).toBe(true);
  });

  it('usa o formato salt:hash em hex', async () => {
    const stored = await hashPassword('x');
    expect(stored).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
  });

  it('rejeita hash malformado sem lancar', async () => {
    expect(await verifyPassword('x', 'sem-dois-pontos')).toBe(false);
    expect(await verifyPassword('x', 'aa:bb')).toBe(false);
    expect(await verifyPassword('x', '')).toBe(false);
    expect(await verifyPassword('x', ':')).toBe(false);
  });

  it('generatePassword devolve o tamanho pedido e varia', () => {
    expect(generatePassword(24)).toHaveLength(24);
    expect(generatePassword(24)).not.toBe(generatePassword(24));
  });
});
