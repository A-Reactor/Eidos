import { expect, it } from 'vitest';
import { fitStageCopy, segmentRailLayout } from '@/lib/ui/stage-layout';
it('keeps short prose at its original position and moves longer prose only as far as the node center', () => {
  const layout = { top: 240, bottom: 620, labelCenterOffset: 10, nodeCenter: 110, textOffset: 140, lineHeight: 32 };
  expect(fitStageCopy({ ...layout, textHeight: 96 })).toEqual({ rise: 0, lines: 7 });
  const fit = fitStageCopy({ ...layout, textHeight: 2000 });
  expect(fit).toEqual({ rise: 140, lines: 11 });
  expect(layout.top - fit.rise + layout.labelCenterOffset).toBe(layout.nodeCenter);
  expect(layout.top - fit.rise + layout.textOffset + fit.lines * layout.lineHeight).toBeLessThanOrEqual(layout.bottom);
  expect(fitStageCopy({ ...layout, bottom: 420, textHeight: 2000 }).lines).toBe(5);
});
it('switches only overflowing segment meters to a rail and keeps endpoint padding and thumb height', () => {
  expect(segmentRailLayout(300, 5, true).continuous).toBe(false);
  expect(segmentRailLayout(300, 50, true)).toEqual({ continuous: true, thumb: 43.2, padding: 24 });
  expect(segmentRailLayout(2000, 50, true).continuous).toBe(false);
  expect(segmentRailLayout(300, 10, true, 24).continuous).toBe(true);
});
