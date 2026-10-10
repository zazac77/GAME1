// Per-browser conveniences (not game state): kept in localStorage when it is
// available, silently ignored otherwise (private window, tests, blocked storage).

const GUIDE_SEEN = 'game1.guideSeen';

export function guideSeen(): boolean {
  try {
    return globalThis.localStorage?.getItem(GUIDE_SEEN) === '1';
  } catch {
    return false;
  }
}

export function markGuideSeen(): void {
  try {
    globalThis.localStorage?.setItem(GUIDE_SEEN, '1');
  } catch {
    // Storage unavailable: the guide simply opens again with the next new game.
  }
}
