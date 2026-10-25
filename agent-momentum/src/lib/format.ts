/** R1 650 000 — South African grouping with a space, no decimals. */
export function rand(cents: number | undefined | null): string {
  if (cents == null || Number.isNaN(cents)) return '—';
  const whole = Math.round(cents / 100);
  const sign = whole < 0 ? '-' : '';
  const grouped = Math.abs(whole)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${sign}R${grouped}`;
}

/** Compact rand for chart axes and chips: R1.65m, R850k. */
export function randShort(cents: number | undefined | null): string {
  if (cents == null) return '—';
  const r = cents / 100;
  if (Math.abs(r) >= 1_000_000) return `R${trim(r / 1_000_000)}m`;
  if (Math.abs(r) >= 1_000) return `R${trim(r / 1_000)}k`;
  return `R${Math.round(r)}`;
}

function trim(n: number): string {
  return n.toFixed(2).replace(/\.?0+$/, '');
}

/**
 * Reads what people actually type: "1650000", "1 650 000", "R1,65m",
 * "1.65m", "850k". Returns cents, or undefined when it isn't a number.
 */
export function parseRand(input: string): number | undefined {
  const s = input.trim().toLowerCase().replace(/^r/, '').replace(/\s/g, '').replace(',', '.');
  if (!s) return undefined;
  const m = s.match(/^(\d+(?:\.\d+)?)([mk])?$/);
  if (!m) {
    const digits = s.replace(/[^\d]/g, '');
    return digits ? Number(digits) * 100 : undefined;
  }
  const mult = m[2] === 'm' ? 1_000_000 : m[2] === 'k' ? 1_000 : 1;
  return Math.round(Number(m[1]) * mult * 100);
}

export function pct(ratio: number | null | undefined, digits = 0): string {
  if (ratio == null || !Number.isFinite(ratio)) return '—';
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
