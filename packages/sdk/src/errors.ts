import { PROGRAM_INTERFACE } from './program-interface.js';

export type ProgramErrorName = (typeof PROGRAM_INTERFACE.errors)[number]['name'];

const BY_CODE = new Map<number, { name: ProgramErrorName; msg: string }>(
  PROGRAM_INTERFACE.errors.map((entry) => [entry.code, { name: entry.name, msg: entry.msg }]),
);

export function programErrorName(code: number): ProgramErrorName | null {
  return BY_CODE.get(code)?.name ?? null;
}

function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === 'string') return cause;
  try {
    return JSON.stringify(cause);
  } catch {
    return String(cause);
  }
}

/** Custom error number in a transaction error, a preflight message or the logs. */
export function customErrorCode(cause: unknown, logs: readonly string[] = []): number | null {
  const text = `${describe(cause)} ${logs.join(' ')}`;
  const custom = /"Custom":\s*(\d+)|custom program error: (0x[0-9a-f]+)|Error Number: (\d+)/i.exec(text);
  if (!custom) return null;
  return Number(custom[1] ?? custom[2] ?? custom[3]);
}

/** A transaction that was rejected in preflight or failed on chain. */
export class TerraTxError extends Error {
  /** Program error name such as `Cooldown`, or null for errors outside the program. */
  readonly code: ProgramErrorName | null;
  readonly number: number | null;

  constructor(
    readonly layer: 'solana' | 'rollup',
    readonly signature: string | null,
    override readonly cause: unknown,
    readonly logs: readonly string[] = [],
  ) {
    const number = customErrorCode(cause, logs);
    const code = number === null ? null : programErrorName(number);
    const detail = code ? `${code}: ${BY_CODE.get(number as number)?.msg}` : describe(cause);
    super(`${layer} transaction failed${signature ? ` (${signature})` : ''}: ${detail}`);
    this.name = 'TerraTxError';
    this.number = number;
    this.code = code;
  }

  is(...names: ProgramErrorName[]): boolean {
    return this.code !== null && names.includes(this.code);
  }
}

export function isTxError(error: unknown, ...names: ProgramErrorName[]): error is TerraTxError {
  return error instanceof TerraTxError && (names.length === 0 || error.is(...names));
}

/** Raised by client-side checks before anything is sent. */
export class TerraError extends Error {
  constructor(
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'TerraError';
  }
}
