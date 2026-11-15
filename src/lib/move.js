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
