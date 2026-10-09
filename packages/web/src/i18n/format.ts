// Number formatting for display only (the engine works with raw floats).

const intFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const dec1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const dec2 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2, minimumFractionDigits: 2 });

const finite = (x: number): number => (Number.isFinite(x) ? x : 0);

export const fmtInt = (x: number): string => intFormat.format(Math.round(finite(x)));

export const fmtDec = (x: number, digits: 1 | 2 = 1): string =>
  (digits === 1 ? dec1 : dec2).format(finite(x));

/** Euros, compact above 10 000 (k€, M€, Md€). */
export function fmtMoney(x: number): string {
  const v = finite(x);
  const a = Math.abs(v);
  if (a >= 1e9) return `${dec2.format(v / 1e9)} Md€`;
  if (a >= 1e6) return `${dec2.format(v / 1e6)} M€`;
  if (a >= 1e4) return `${dec1.format(v / 1e3)} k€`;
  return `${intFormat.format(Math.round(v))} €`;
}

/** Euros with cents (unit prices, share prices). */
export const fmtPrice = (x: number): string => `${dec2.format(finite(x))} €`;

/** Share of 1 as a percentage. */
export const fmtPct = (x: number, digits: 0 | 1 = 1): string =>
  `${new Intl.NumberFormat('fr-FR', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(finite(x) * 100)} %`;

/** Signed percentage change, e.g. "+3,2 %". */
export const fmtChange = (x: number): string => `${x >= 0 ? '+' : ''}${fmtPct(x)}`;

/** Quarter 0 is Q1 of year 1. */
export const quarterLabel = (turn: number): string =>
  `T${(((turn % 4) + 4) % 4) + 1} an ${Math.floor(turn / 4) + 1}`;

/** Parses a number typed in French or English notation ("1 234,5", "1234.5"); NaN if invalid. */
export function parseNumber(text: string): number {
  const cleaned = text.replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
  if (cleaned === '' || !/^-?\d*\.?\d*(e-?\d+)?$/i.test(cleaned)) return Number.NaN;
  return Number(cleaned);
}
