/** A copy of a record without one key (draft decisions stay plain JSON). */
export const omit = <T>(record: Record<string, T>, key: string): Record<string, T> =>
  Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));
