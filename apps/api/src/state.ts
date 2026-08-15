// Estado em memoria, ISOLADO por versao.
// O teste das 18h em /v1 nao pode contaminar os contadores da live das 19h em /v2.

export type Version = 'v1' | 'v2';
export const VERSIONS: Version[] = ['v1', 'v2'];

export type ForcedOutcome = 'fail' | 'success';

export interface DemoState {
  startedAt: number;
  checkouts: number;
  failures: number;
  crashed: boolean;
  failureRate: number;
  maxSuccessStreak: number;
  successStreak: number;
  forceNextOutcome: ForcedOutcome | null;
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const DEFAULT_FAILURE_RATE = envNumber('CHECKOUT_FAILURE_RATE', 0.5);
export const DEFAULT_MAX_SUCCESS_STREAK = envNumber('CHECKOUT_MAX_SUCCESS_STREAK', 3);

function createState(): DemoState {
  return {
    startedAt: Date.now(),
    checkouts: 0,
    failures: 0,
    crashed: false,
    failureRate: DEFAULT_FAILURE_RATE,
    maxSuccessStreak: DEFAULT_MAX_SUCCESS_STREAK,
    successStreak: 0,
    forceNextOutcome: null,
  };
}

const states: Record<Version, DemoState> = {
  v1: createState(),
  v2: createState(),
};

export function getState(version: Version): DemoState {
  return states[version];
}

/** Volta ao baseline de palco: failureRate default, sem crash, sem forcado. */
export function resetState(version: Version): DemoState {
  const state = states[version];
  state.crashed = false;
  state.failureRate = DEFAULT_FAILURE_RATE;
  state.maxSuccessStreak = DEFAULT_MAX_SUCCESS_STREAK;
  state.successStreak = 0;
  state.forceNextOutcome = null;
  return state;
}
