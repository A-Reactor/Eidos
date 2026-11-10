import { describe, expect, expectTypeOf, it } from "vitest";

import {
  formatContinuityCount,
  formatByteSize,
  formatRelativeUpdate,
  interpolateMessage,
  translate,
  translateInterface,
  type Locale,
  type MessageKey,
} from "@/lib/ui/i18n";
import { enMessages } from "@/lib/ui/messages/en";
import { zhCNMessages } from "@/lib/ui/messages/zh-CN";
import { interfaceEnMessages } from '@/lib/ui/messages/interface-en';

describe('shared interface copy', () => {
  it('localizes dynamic labels while preserving interpolated player content', () => {
    expect(translateInterface('en', '应用到「{0}」', { 0: '旅人{1}' })).toBe('Apply to “旅人{1}”');
    expect(translateInterface('zh-CN', '应用到「{0}」', { 0: '旅人' })).toBe('应用到「旅人」');
    expect(translateInterface('en', '玩家写的正文')).toBe('玩家写的正文');
    expect(translateInterface('en', undefined)).toBe('');
  });

  it('preserves every placeholder across shared interface translations', () => {
    const placeholders = (text: string) => [...text.matchAll(/\{([^{}]+)\}/g)].map(match => match[1]).sort();
    for (const [source, english] of Object.entries(interfaceEnMessages)) {
      expect(english.trim().length, source).toBeGreaterThan(0);
      expect(placeholders(english), source).toEqual(placeholders(source));
    }
  });
});

describe("translate", () => {
  it("returns the Chinese message", () => {
    expect(translate("zh-CN", "library.continue")).toBe("继续最近进度");
  });

  it("returns the English message", () => {
    expect(translate("en", "library.continue")).toBe("Continue latest");
  });

  it("interpolates named values", () => {
    expect(translate("en", "library.continuityCount", { count: 3 })).toBe(
      "3 continuities",
    );
  });

  it("replaces every occurrence of a named value", () => {
    expect(
      interpolateMessage("{value} then {value}", { value: "echo" }),
    ).toBe("echo then echo");
  });

  it("requires the parameters declared by each message key", () => {
    translate("en", "library.continue");
    translate("en", "library.continuityCount", { count: 3 });

    if (false) {
      // @ts-expect-error count is required by library.continuityCount
      translate("en", "library.continuityCount");
      // @ts-expect-error cout is not the declared placeholder
      translate("en", "library.continuityCount", { cout: 3 });
    }
  });
});

describe("formatContinuityCount", () => {
  it("uses the English singular form for one continuity", () => {
    expect(formatContinuityCount("en", 1)).toBe("1 continuity");
  });

  it("uses the English plural form for multiple continuities", () => {
    expect(formatContinuityCount("en", 3)).toBe("3 continuities");
  });

  it.each([1, 3])("uses the Chinese count form for %i", (count) => {
    expect(formatContinuityCount("zh-CN", count)).toBe(
      `${count} 条连续性`,
    );
  });
});

describe("formatByteSize", () => {
  it("formats the numeric portion with the selected interface locale", () => {
    const bytes = 1_234_567_890;
    const megabytes = bytes / 1024 ** 2;

    expect(formatByteSize("en", bytes)).toBe(
      `${new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(megabytes)} MB`,
    );
    expect(formatByteSize("zh-CN", bytes)).toBe(
      `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(megabytes)} MB`,
    );
  });
});

describe("formatRelativeUpdate", () => {
  it("formats past, future, and zero seconds in English", () => {
    expect(formatRelativeUpdate("en", 1_000, 31_000)).toBe("30 seconds ago");
    expect(formatRelativeUpdate("en", 31_000, 1_000)).toBe("in 30 seconds");
    expect(formatRelativeUpdate("en", 1_000, 1_000)).toBe("now");
  });

  it("selects minutes, hours, and days by absolute duration", () => {
    expect(formatRelativeUpdate("en", 1_000, 121_000)).toBe("2 minutes ago");
    expect(formatRelativeUpdate("en", 7_201_000, 1_000)).toBe("in 2 hours");
    expect(formatRelativeUpdate("en", 1_000, 172_801_000)).toBe("2 days ago");
  });

  it("formats relative updates in Chinese", () => {
    expect(formatRelativeUpdate("zh-CN", 1_000, 31_000)).toBe("30秒钟前");
  });

  it.each([
    [Number.NaN, 0],
    [0, Number.POSITIVE_INFINITY],
  ])("rejects invalid timestamps", (updatedAt, now) => {
    expect(() => formatRelativeUpdate("en", updatedAt, now)).toThrow(
      new RangeError("updatedAt and now must be finite timestamps"),
    );
  });
});

describe("message dictionaries", () => {
  it("have identical Chinese and English keys", () => {
    expect(Object.keys(enMessages).sort()).toEqual(
      Object.keys(zhCNMessages).sort(),
    );
  });

  it("uses identical placeholders for every localized message", () => {
    const placeholders = (message: string) =>
      [...message.matchAll(/\{([^{}]+)\}/g)]
        .map((match) => match[1])
        .sort();

    for (const key of Object.keys(zhCNMessages) as MessageKey[]) {
      expect(placeholders(enMessages[key]), key).toEqual(
        placeholders(zhCNMessages[key]),
      );
    }
  });

  it("exposes the exact locale and dictionary-derived key types", () => {
    expectTypeOf<Locale>().toEqualTypeOf<"zh-CN" | "en">();
    expectTypeOf<MessageKey>().toEqualTypeOf<keyof typeof zhCNMessages>();
  });
});
