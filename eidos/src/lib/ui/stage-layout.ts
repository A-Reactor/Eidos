/** Move prose only as far as the node's center line, then clamp to whole visible lines. */
export function fitStageCopy(input: { top: number; bottom: number; labelCenterOffset: number; nodeCenter: number; textOffset: number; textHeight: number; lineHeight: number }) {
  const maxRise = Math.max(0, input.top + input.labelCenterOffset - input.nodeCenter);
  const rise = Math.min(maxRise, Math.max(0, input.top + input.textOffset + input.textHeight - input.bottom));
  const lines = Math.max(1, Math.floor((input.bottom - input.top + rise - input.textOffset) / Math.max(1, input.lineHeight)));
  return { rise, lines };
}
export function segmentRailLayout(height: number, count: number, showing: boolean, rem = 16) {
  const block = .84 * rem, thumb = 2.7 * rem, gap = .56 * rem, padding = 1.5 * rem;
  return { continuous: count * block + Math.max(0, count - 1) * gap + (showing ? thumb - block : 0) + 2 * padding > height,
    thumb, padding };
}
