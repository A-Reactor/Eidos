export type SigilPrimitiveKind = "line" | "ring" | "diamond" | "bracket";

export interface SigilPrimitive {
  kind: SigilPrimitiveKind;
  x: number;
  y: number;
  size: number;
  rotation: number;
  accent: boolean;
}

const KINDS: readonly SigilPrimitiveKind[] = [
  "line",
  "ring",
  "diamond",
  "bracket",
];

function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;

  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}

function createRandom(seed: number): () => number {
  let state = seed;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

export function createSigilModel(seed: string): readonly SigilPrimitive[] {
  const random = createRandom(hashSeed(seed));
  const count = 10 + Math.floor(random() * 7);
  const accentCount = Math.floor(count / 3);

  return Array.from({ length: count }, (_, index) => ({
    kind: KINDS[Math.floor(random() * KINDS.length)],
    x: 14 + random() * 72,
    y: 14 + random() * 72,
    size: 6 + random() * 12,
    rotation: random() * 360,
    accent: index < accentCount,
  }));
}
