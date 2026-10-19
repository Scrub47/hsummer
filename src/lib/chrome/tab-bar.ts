/**
 * Where the tab bar's top edge sits so its bottom meets the visual viewport.
 *
 * iOS standalone can scroll the layout viewport during momentum scroll.
 * `position: fixed; bottom: 0` then lands in the middle of the screen.
 * Pinning to `visualViewport` keeps the bar on the true bottom.
 */
export function tabBarTopPx(input: {
  offsetTop: number;
  viewportHeight: number;
  barHeight: number;
}): number {
  const top = input.offsetTop + input.viewportHeight - input.barHeight;
  if (!Number.isFinite(top)) return 0;
  return Math.max(0, Math.round(top));
}
