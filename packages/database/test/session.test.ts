import { describe, expect, it } from 'vitest';
import {
  isSessionExpired,
  newSessionId,
  SESSION_TTL_HOURS_DEFAULT,
  sessionExpiresAt,
  sessionTtlHours,
} from '../src/session';

describe('sessao', () => {
  it('gera id opaco de 64 chars hex e nunca repete', () => {
    const a = newSessionId();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(newSessionId());
  });

  it('rejeita sessao inexistente', () => {
    expect(isSessionExpired(null)).toBe(true);
  });

  it('rejeita sessao expirada', () => {
    const now = new Date('2026-08-17T22:00:00Z');
    const passado = new Date('2026-08-17T21:59:59Z');
    expect(isSessionExpired({ expiresAt: passado }, now)).toBe(true);
  });

  it('aceita sessao dentro da validade', () => {
    const now = new Date('2026-08-17T22:00:00Z');
    const futuro = new Date('2026-08-17T22:00:01Z');
    expect(isSessionExpired({ expiresAt: futuro }, now)).toBe(false);
  });

  it('trata o instante exato da expiracao como expirado', () => {
    const now = new Date('2026-08-17T22:00:00Z');
    expect(isSessionExpired({ expiresAt: now }, now)).toBe(true);
  });

  it('sessionExpiresAt soma as horas ao agora', () => {
    const now = new Date('2026-08-17T22:00:00Z');
    expect(sessionExpiresAt(12, now).toISOString()).toBe('2026-08-18T10:00:00.000Z');
  });

  it('sessionTtlHours cai no default para valor ausente ou invalido', () => {
    expect(SESSION_TTL_HOURS_DEFAULT).toBe(12);
    expect(sessionTtlHours(undefined)).toBe(12);
    expect(sessionTtlHours('')).toBe(12);
    expect(sessionTtlHours('   ')).toBe(12);
    expect(sessionTtlHours('nao-e-numero')).toBe(12);
    expect(sessionTtlHours('0')).toBe(12);
    expect(sessionTtlHours('-3')).toBe(12);
    expect(sessionTtlHours('6')).toBe(6);
  });
});
