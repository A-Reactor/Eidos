export const IMAGE_MIME_EXTENSIONS = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
} as const;
export const IMAGE_FILE_EXTENSION = /\.(png|jpe?g|webp|gif)$/i;
export function isImageMimeType(value: string): value is keyof typeof IMAGE_MIME_EXTENSIONS {
  return Object.hasOwn(IMAGE_MIME_EXTENSIONS, value);
}

/** Check the declared format without decoding/re-encoding away animation frames. */
export function matchesImageType(bytes: Uint8Array, type: string): boolean {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (type === 'image/png') return [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
  if (type === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (type === 'image/webp') return bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
  if (type === 'image/gif') return bytes.length >= 13 && ['GIF87a', 'GIF89a'].includes(ascii(0, 6));
  return false;
}
