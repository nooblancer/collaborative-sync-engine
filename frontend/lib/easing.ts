/**
 * Ease-out easing function using cubic deceleration.
 *
 * For any progress value t in [0,1], produces a monotonically increasing output
 * with decreasing rate of change (deceleration toward the final value).
 *
 * Formula: 1 - (1 - t)^3
 *
 * @param t - Progress value in the range [0, 1]. Values outside this range are clamped.
 * @returns Eased value in [0, 1] with natural deceleration.
 */
export function easeOut(t: number): number {
  // Clamp to [0, 1]
  const clamped = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - clamped, 3);
}
