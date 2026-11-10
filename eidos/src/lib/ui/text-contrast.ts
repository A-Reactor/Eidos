/** Opaque text tokens avoid compounded opacity on nested cards and custom palettes. */
export function relativeLuminance(color: string): number {
  const channels = color.slice(1).match(/.{2}/g)!.map(channel => Number.parseInt(channel, 16) / 255)
    .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

export function contrastRatio(first: string, second: string): number {
  const a = relativeLuminance(first), b = relativeLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function mixTextColor(first: string, second: string, firstWeight: number): string {
  return '#' + [1, 3, 5].map(index => Math.round(Number.parseInt(first.slice(index, index + 2), 16) * firstWeight +
    Number.parseInt(second.slice(index, index + 2), 16) * (1 - firstWeight)).toString(16).padStart(2, '0')).join('');
}

export function readableInk(background: string, requested: string, fallback = '#181a1d'): string {
  for (const ink of [requested, fallback]) if (contrastRatio(background, ink) >= 4.5) return ink;
  return contrastRatio(background, '#000000') > contrastRatio(background, '#ffffff') ? '#000000' : '#ffffff';
}

/** Preserve hue where possible; move only as far toward black/white as contrast requires. */
export function readableColor(requested: string, background: string, minimum = 4.6): string {
  if (contrastRatio(requested, background) >= minimum) return requested;
  const endpoint = readableInk(background, '#000000', '#ffffff');
  let low = 0, high = 1;
  for (let step = 0; step < 24; step++) {
    const weight = (low + high) / 2;
    if (contrastRatio(mixTextColor(endpoint, requested, weight), background) >= minimum) high = weight;
    else low = weight;
  }
  return mixTextColor(endpoint, requested, high);
}

export function resolveTextColors(background: string, preferredInk: string, accent: string) {
  const ink = readableInk(background, preferredInk);
  const accentText = readableColor(accent, background);
  return { ink, muted: readableColor(mixTextColor(ink, background, 0.65), background), accentText,
    onAccent: readableInk(accentText, '#ffffff', '#000000') };
}
