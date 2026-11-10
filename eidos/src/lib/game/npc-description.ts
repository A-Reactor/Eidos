const PREFERRED_NPC_FIELDS = [
  "name",
  "title",
  "role",
  "description",
  "background",
  "personality",
  "motivation",
  "goal",
  "goals",
  "traits",
  "appearance",
  "relationship",
  "relationships",
  "notes",
];

export function normalizeNpcDescription(input: unknown, fallbackName = ""): string {
  const parts = collectDescriptionParts(input);
  const text = uniqueParts(parts).join("；").trim();
  return text || fallbackName;
}

export function normalizeNpcDescriptions(
  input: Record<string, unknown> | null | undefined,
): Record<string, string> {
  if (!input) return {};
  return Object.fromEntries(
    Object.entries(input).map(([name, value]) => [
      name,
      normalizeNpcDescription(value, name),
    ]),
  );
}

function collectDescriptionParts(input: unknown, depth = 0): string[] {
  if (input == null) return [];
  if (typeof input === "string") return [input.trim()].filter(Boolean);
  if (typeof input === "number" || typeof input === "boolean") return [String(input)];
  if (Array.isArray(input)) {
    return input.flatMap((item) => collectDescriptionParts(item, depth + 1));
  }
  if (typeof input !== "object" || depth > 2) return [];

  const record = input as Record<string, unknown>;
  const parts: string[] = [];
  const seen = new Set<string>();

  for (const key of PREFERRED_NPC_FIELDS) {
    if (key in record) {
      seen.add(key);
      parts.push(...collectDescriptionParts(record[key], depth + 1));
    }
  }

  for (const [key, value] of Object.entries(record)) {
    if (seen.has(key)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || Array.isArray(value)) {
      parts.push(...collectDescriptionParts(value, depth + 1));
    }
  }

  return parts;
}

function uniqueParts(parts: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of parts) {
    const part = raw.replace(/\s+/g, " ").trim();
    if (!part || seen.has(part)) continue;
    seen.add(part);
    result.push(part);
  }
  return result;
}
