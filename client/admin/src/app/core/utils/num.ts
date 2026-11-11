// -- helpers de apresentação -----------------------------------------------------

/** Decimal vem como string — parse seguro. */
export function num(v: string | number | null | undefined): number {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}
