import type { EngineUsage, JsonObject, JsonValue } from './types';

export class EngineError extends Error {
  usage?: EngineUsage;
  constructor(readonly code: string, message: string) { super(message); this.name = 'EngineError'; }
}
export function invalid(message: string): never { throw new EngineError('invalid_input', message); }
export function object(value: unknown, label = 'object'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${label} must be an object`);
  return value as Record<string, unknown>;
}
export function fields(value: Record<string, unknown>, allowed: string[]): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) invalid(`Unknown field: ${key}`);
}
export function string(value: unknown, label = 'text'): string {
  if (typeof value !== 'string' || !value.trim()) invalid(`${label} must be non-empty text`);
  return value;
}
export function identifier(value: unknown): string {
  const id = string(value, 'id');
  if (id.length > 256 || /[\s\u0000-\u001f\ud800-\udfff]/u.test(id) || ['__proto__', 'prototype', 'constructor'].includes(id)) invalid('Invalid id');
  return id;
}
/** Generated references include two percent-encoded user IDs; they are opaque to hosts. */
export function reference(value: unknown): string {
  const id = string(value, 'reference');
  if (id.length > 8192 || /[\s\u0000-\u001f]/u.test(id)) invalid('Invalid reference');
  return id;
}
export function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalid('Invalid revision');
  return value as number;
}
export function isEngineDigest(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}
export interface JsonShape {
  optional?: readonly string[];
  fields?: Record<string, JsonShape>;
  elements?: JsonShape;
  values?: JsonShape;
}
export const ENGINE_JSON_DEPTH = 64;
// Valid inputs acquire extra nesting in stored operations, receipts and transport envelopes.
export const ENGINE_ENVELOPE_DEPTH = ENGINE_JSON_DEPTH + 8;
interface JsonReadOptions { label?: string; shape?: JsonShape; maxDepth?: number }
function childPath(path: string, key: string): string {
  if (/^[A-Za-z_$][\w$]*$/u.test(key)) return path ? `${path}.${key}` : key;
  return `${path}[${JSON.stringify(key)}]`;
}
function readJson(value: unknown, ancestors: Set<object>, depth: number, maxDepth: number, path: string, shape?: JsonShape): JsonValue {
  const fail = (message: string): never => invalid(`${message} at ${path || '$'}`);
  if (depth > maxDepth) fail('JSON nesting is too deep');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || ancestors.has(value)) return fail('Value must be finite, acyclic JSON');
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('Value must be a plain JSON object');
  if (Object.getOwnPropertySymbols(value).length) fail('JSON cannot contain symbols');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return Array.from(value, (entry, index) => readJson(entry, ancestors, depth + 1, maxDepth, `${path}[${index}]`, shape?.elements));
    const result: JsonObject = {};
    for (const [key, entry] of Object.entries(value)) {
      const nextPath = childPath(path, key);
      if (['__proto__', 'constructor', 'prototype'].includes(key)) invalid(`Reserved JSON key at ${nextPath}`);
      if (entry === undefined && shape?.optional?.includes(key)) continue;
      const nextShape = shape?.fields && Object.hasOwn(shape.fields, key) ? shape.fields[key] : shape?.values;
      result[key] = readJson(entry, ancestors, depth + 1, maxDepth, nextPath, nextShape);
    }
    return result;
  } finally { ancestors.delete(value); }
}
/** Only known protocol optionals may be omitted. Opaque JSON data remains strict. */
export function json(value: unknown, options: JsonReadOptions = {}): JsonValue {
  return readJson(value, new Set(), 0, options.maxDepth ?? ENGINE_JSON_DEPTH, options.label ?? '', options.shape);
}
export function jsonObject(value: unknown, options?: JsonReadOptions): JsonObject {
  return object(json(value, options), options?.label) as JsonObject;
}
export function list(value: unknown, label = 'list'): unknown[] {
  if (!Array.isArray(value)) invalid(`${label} must be an array`);
  return value;
}
export function canonical(value: unknown): string {
  const sort = (v: JsonValue): JsonValue => Array.isArray(v) ? v.map(sort)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sort(v[k])])) : v;
  return JSON.stringify(sort(json(value, { maxDepth: ENGINE_ENVELOPE_DEPTH })));
}
