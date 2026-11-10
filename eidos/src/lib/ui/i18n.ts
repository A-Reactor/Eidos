import { enMessages } from "./messages/en";
import { interfaceEnMessages } from './messages/interface-en';
import { zhCNMessages, type MessageKey } from "./messages/zh-CN";

export type Locale = "zh-CN" | "en";
export type { MessageKey };

const existingInterfaceEnglish = new Map<string, string>(
  (Object.keys(zhCNMessages) as MessageKey[]).map(key => [zhCNMessages[key], enMessages[key]]),
);

export function translateInterface(locale: Locale, source: string | null | undefined, values: Record<string, unknown> = {}): string {
  if (source == null) return '';
  const template = locale === 'en'
    ? (Object.hasOwn(interfaceEnMessages, source) ? interfaceEnMessages[source] : existingInterfaceEnglish.get(source) ?? source)
    : source;
  return interpolateMessage(template, values);
}

type PlaceholderNames<Template extends string> =
  Template extends `${string}{${infer Name}}${infer Rest}`
    ? Name | PlaceholderNames<Rest>
    : never;

type MessageValues<Key extends MessageKey> = {
  [Name in PlaceholderNames<(typeof zhCNMessages)[Key]>]: unknown;
};

type TranslationArguments<Key extends MessageKey> =
  [PlaceholderNames<(typeof zhCNMessages)[Key]>] extends [never]
    ? []
    : [values: MessageValues<Key>];

const messages: Record<Locale, Record<MessageKey, string>> = {
  "zh-CN": zhCNMessages,
  en: enMessages,
};

export function interpolateMessage(
  template: string,
  values: Record<string, unknown>,
): string {
  return template.replace(/\{([^{}]+)\}/g, (placeholder, name) =>
    Object.prototype.hasOwnProperty.call(values, name)
      ? String(values[name])
      : placeholder,
  );
}

export function translate<Key extends MessageKey>(
  locale: Locale,
  key: Key,
  ...args: TranslationArguments<Key>
): string;
export function translate(
  locale: Locale,
  key: MessageKey,
  values: Record<string, unknown> = {},
): string {
  return interpolateMessage(messages[locale][key], values);
}

export function formatContinuityCount(locale: Locale, count: number): string {
  const category = new Intl.PluralRules(locale).select(count);
  const key =
    category === "one"
      ? "library.continuityCount.one"
      : "library.continuityCount";
  const formattedCount = new Intl.NumberFormat(locale).format(count);

  return translate(locale, key, { count: formattedCount });
}

export function formatByteSize(locale: Locale, bytes?: number): string {
  if (!bytes || !Number.isFinite(bytes) || bytes < 0) return "";

  let value = bytes;
  let unit = "B";
  let maximumFractionDigits = 0;

  if (bytes >= 1024 ** 2) {
    value = bytes / 1024 ** 2;
    unit = "MB";
    maximumFractionDigits = 2;
  } else if (bytes >= 1024) {
    value = bytes / 1024;
    unit = "KB";
    maximumFractionDigits = 1;
  }

  const formatted = new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value);
  return `${formatted} ${unit}`;
}

export function formatRelativeUpdate(
  locale: Locale,
  updatedAt: number,
  now: number = Date.now(),
): string {
  if (!Number.isFinite(updatedAt) || !Number.isFinite(now)) {
    throw new RangeError("updatedAt and now must be finite timestamps");
  }

  const elapsedSeconds = (updatedAt - now) / 1_000;
  const absoluteSeconds = Math.abs(elapsedSeconds);
  let divisor: number;
  let unit: Intl.RelativeTimeFormatUnit;

  if (absoluteSeconds < 60) {
    divisor = 1;
    unit = "second";
  } else if (absoluteSeconds < 60 * 60) {
    divisor = 60;
    unit = "minute";
  } else if (absoluteSeconds < 24 * 60 * 60) {
    divisor = 60 * 60;
    unit = "hour";
  } else {
    divisor = 24 * 60 * 60;
    unit = "day";
  }

  const value = Math.round(elapsedSeconds / divisor);

  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(
    value,
    unit,
  );
}
