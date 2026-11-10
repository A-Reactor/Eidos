// ============================================================
// Eidos · 日历与天气模块测试
// ============================================================
import { describe, it, expect } from "vitest";
import {
  gameTimeToCalendar,
  nextWeather,
  timeOfDay,
  weatherEffect,
} from "@/lib/game/calendar";

// ============================================================
// gameTimeToCalendar
// ============================================================
describe("gameTimeToCalendar", () => {
  it("returns epoch date for day 0", () => {
    const result = gameTimeToCalendar({ day: 0, hour: 8, minute: 0 });
    expect(result.year).toBe(512);
    expect(result.month).toBe(3);
    expect(result.day).toBe(15);
  });

  it("advances days within same month", () => {
    // day 10 → March 25
    const result = gameTimeToCalendar({ day: 10, hour: 8, minute: 0 });
    expect(result.month).toBe(3);
    expect(result.day).toBe(25);
  });

  it("crosses month boundary from March to April", () => {
    // March has 31 days. Day 0 = March 15. Day 16 = March 31. Day 17 = April 1.
    const result = gameTimeToCalendar({ day: 17, hour: 8, minute: 0 });
    expect(result.month).toBe(4);
    expect(result.day).toBe(1);
  });

  it("handles large day values", () => {
    const result = gameTimeToCalendar({ day: 365, hour: 8, minute: 0 });
    // Should be well past the epoch year
    expect(result.year).toBeGreaterThanOrEqual(513);
  });

  it("returns a valid calendar date for any input", () => {
    for (const day of [0, 30, 60, 100, 200, 365]) {
      const result = gameTimeToCalendar({ day, hour: 12, minute: 0 });
      expect(result.year).toBeGreaterThanOrEqual(512);
      expect(result.month).toBeGreaterThanOrEqual(1);
      expect(result.month).toBeLessThanOrEqual(12);
      expect(result.day).toBeGreaterThanOrEqual(1);
      expect(result.day).toBeLessThanOrEqual(31);
    }
  });
});

// ============================================================
// nextWeather
// ============================================================
describe("nextWeather", () => {
  it("returns a valid weather from transitions", () => {
    const weathers = ["晴", "多云", "阴", "雨", "雾", "风", "雪"];
    for (const w of weathers) {
      for (let seed = 0; seed < 10; seed++) {
        const next = nextWeather(w as any, seed);
        expect(weathers).toContain(next);
      }
    }
  });

  it("is deterministic for same seed", () => {
    expect(nextWeather("晴", 5)).toBe(nextWeather("晴", 5));
    expect(nextWeather("雨", 3)).toBe(nextWeather("雨", 3));
  });
});

// ============================================================
// timeOfDay
// ============================================================
describe("timeOfDay", () => {
  it("returns 深夜 before 6", () => {
    expect(timeOfDay(0)).toBe("深夜");
    expect(timeOfDay(5)).toBe("深夜");
  });

  it("returns 清晨 from 6 to 8", () => {
    expect(timeOfDay(6)).toBe("清晨");
    expect(timeOfDay(8)).toBe("清晨");
  });

  it("returns 上午 from 9 to 11", () => {
    expect(timeOfDay(9)).toBe("上午");
    expect(timeOfDay(11)).toBe("上午");
  });

  it("returns 正午 from 12 to 13", () => {
    expect(timeOfDay(12)).toBe("正午");
    expect(timeOfDay(13)).toBe("正午");
  });

  it("returns 下午 from 14 to 17", () => {
    expect(timeOfDay(14)).toBe("下午");
    expect(timeOfDay(17)).toBe("下午");
  });

  it("returns 黄昏 from 18 to 20", () => {
    expect(timeOfDay(18)).toBe("黄昏");
    expect(timeOfDay(20)).toBe("黄昏");
  });

  it("returns 夜晚 from 21 onward", () => {
    expect(timeOfDay(21)).toBe("夜晚");
    expect(timeOfDay(23)).toBe("夜晚");
  });
});

// ============================================================
// weatherEffect
// ============================================================
describe("weatherEffect", () => {
  it("returns non-empty string for all known weather", () => {
    const weathers = ["晴", "多云", "阴", "雨", "雾", "风", "雪"];
    for (const w of weathers) {
      expect(weatherEffect(w as any).length).toBeGreaterThan(0);
    }
  });

  it("returns empty string for unknown weather", () => {
    expect(weatherEffect("unknown" as any)).toBe("");
  });
});
