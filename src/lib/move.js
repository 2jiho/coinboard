// How big a move between two shown prices is, for the colour of the flash.
// The board shows a price at most every few seconds, so this is the move
// over that time. 0: no move. 1: slight. 2: ordinary. 3: large.
export const ORDINARY = 0.0002; // 0.02 %
export const LARGE = 0.001;     // 0.1 %
export function moveStrength(previous, next) {
  if (!(previous > 0) || !Number.isFinite(next) || next === previous) return 0;
  const share = Math.abs(next - previous) / previous;
  return share >= LARGE ? 3 : share >= ORDINARY ? 2 : 1;
}

// How long the price keeps its tint before fading back, by the size of the
// move: slight 0.5 s, ordinary 1.2 s, large from 2.5 s, growing with the move
// up to 3 s at 0.5 % or more. The board shows a price at most every three
// seconds, so a very large move holds its colour until the next one.
export const HUGE = 0.005;      // 0.5 %
export function tintHoldMs(previous, next) {
  const strength = moveStrength(previous, next);
  if (strength === 0) return 0;
  if (strength === 1) return 500;
  if (strength === 2) return 1200;
  const share = Math.abs(next - previous) / previous;
  return Math.round(2500 + 500 * Math.min(1, (share - LARGE) / (HUGE - LARGE)));
}
