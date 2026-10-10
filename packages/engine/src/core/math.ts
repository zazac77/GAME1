export const clamp = (x: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, x));

export const sum = (values: readonly number[]): number => values.reduce((s, v) => s + v, 0);

/** Pads a number with zeros: idNumber(3) === '003'. */
export const idNumber = (n: number, width = 3): string => String(n).padStart(width, '0');

/** Standard normal cumulative distribution (Abramowitz–Stegun 7.1.26, |error| < 1.5e-7). */
export function normalCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const poly =
    t *
    (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-z * z);
  return 0.5 * (1 + (x >= 0 ? erf : -erf));
}

/** Inverse of normalCdf on (0, 1), by bisection (|error| < 1e-9). */
export function normalQuantile(p: number): number {
  let lo = -10;
  let hi = 10;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (normalCdf(mid) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
