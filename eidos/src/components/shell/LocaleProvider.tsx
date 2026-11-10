"use client";

import { createContext, useCallback, useContext, useMemo } from "react";

import { translate, type Locale, type MessageKey } from "@/lib/ui/i18n";
import { zhCNMessages } from "@/lib/ui/messages/zh-CN";

type PlaceholderNames<Template extends string> =
  Template extends `${string}{${infer Name}}${infer Rest}`
    ? Name | PlaceholderNames<Rest>
    : never;

type TranslationArguments<Key extends MessageKey> =
  [PlaceholderNames<(typeof zhCNMessages)[Key]>] extends [never]
    ? []
    : [
        values: {
          [Name in PlaceholderNames<(typeof zhCNMessages)[Key]>]: unknown;
        },
      ];

type Translate = <Key extends MessageKey>(
  key: Key,
  ...args: TranslationArguments<Key>
) => string;

interface I18nContextValue {
  locale: Locale;
  t: Translate;
}

function defaultTranslate<Key extends MessageKey>(
  key: Key,
  ...args: TranslationArguments<Key>
): string {
  return translate("zh-CN", key, ...args);
}

const I18nContext = createContext<I18nContextValue>({
  locale: "zh-CN",
  t: defaultTranslate,
});

interface LocaleProviderProps {
  children?: React.ReactNode;
  locale?: Locale;
}

export function LocaleProvider({
  children,
  locale = "zh-CN",
}: LocaleProviderProps) {
  const t = useCallback(
    <Key extends MessageKey,>(
      key: Key,
      ...args: TranslationArguments<Key>
    ): string => translate(locale, key, ...args),
    [locale],
  );
  const value = useMemo(() => ({ locale, t }), [locale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
