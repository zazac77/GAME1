export const clamp = (x: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, x));

export const sum = (values: readonly number[]): number => values.reduce((s, v) => s + v, 0);

/** Pads a number with zeros: idNumber(3) === '003'. */
export const idNumber = (n: number, width = 3): string => String(n).padStart(width, '0');
