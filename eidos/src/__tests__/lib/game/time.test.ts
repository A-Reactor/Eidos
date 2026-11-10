// ============================================================
// Eidos · 时间模块测试
// ============================================================
import { describe, it, expect } from "vitest";
import {
  timeToMinutes,
  minutesToTime,
  addTime,
  resolveActionTime,
  formatTimeSpent,
  formatGameTime,
} from "@/lib/game/time";

// ============================================================
// timeToMinutes
// ============================================================
describe("timeToMinutes", () => {
  it("returns 0 for zero time", () => {
    expect(timeToMinutes({ day: 0, hour: 0, minute: 0 })).toBe(0);
  });

  it("converts days and hours correctly", () => {
    // 1 day 2 hours 30 minutes = 1440 + 120 + 30 = 1590
    expect(timeToMinutes({ day: 1, hour: 2, minute: 30 })).toBe(1590);
  });

  it("handles large day values", () => {
    expect(timeToMinutes({ day: 100, hour: 0, minute: 0 })).toBe(100 * 24 * 60);
  });
});

// ============================================================
// minutesToTime
// ============================================================
describe("minutesToTime", () => {
  it("returns zero for 0 minutes", () => {
    expect(minutesToTime(0)).toEqual({ day: 0, hour: 0, minute: 0 });
  });

  it("converts 1590 minutes to 1 day 2 hours 30 minutes", () => {
    expect(minutesToTime(1590)).toEqual({ day: 1, hour: 2, minute: 30 });
  });

  it("is inverse of timeToMinutes", () => {
    const original = { day: 3, hour: 14, minute: 45 };
    expect(minutesToTime(timeToMinutes(original))).toEqual(original);
  });
});

// ============================================================
// addTime
// ============================================================
describe("addTime", () => {
  it("adds two times correctly within same day", () => {
    expect(addTime({ day: 0, hour: 1, minute: 30 }, { day: 0, hour: 2, minute: 45 })).toEqual({
      day: 0,
      hour: 4,
      minute: 15,
    });
  });

  it("crosses day boundary", () => {
    expect(addTime({ day: 0, hour: 22, minute: 30 }, { day: 0, hour: 3, minute: 0 })).toEqual({
      day: 1,
      hour: 1,
      minute: 30,
    });
  });

  it("handles adding zero time", () => {
    expect(addTime({ day: 5, hour: 12, minute: 30 }, { day: 0, hour: 0, minute: 0 })).toEqual({
      day: 5,
      hour: 12,
      minute: 30,
    });
  });
});

describe('model-controlled action time', () => {
  it('honours resting from 14:30 to evening and crosses midnight accurately', () => {
    const elapsed = resolveActionTime('歇息到傍晚', { day: 0, hour: 4, minute: 0 }, { day: 1, hour: 14, minute: 30 }, { day: 1, hour: 18, minute: 30 });
    expect(addTime({ day: 1, hour: 14, minute: 30 }, elapsed)).toEqual({ day: 1, hour: 18, minute: 30 });
    expect(resolveActionTime('过夜', null, { day: 1, hour: 23, minute: 0 }, { day: 2, hour: 7, minute: 0 })).toEqual({ day: 0, hour: 8, minute: 0 });
  });
  it('accepts zero duration, short travel, and multi-day model durations without keyword caps', () => {
    expect(resolveActionTime('前往广场', { day: 0, hour: 0, minute: 3 })).toEqual({ day: 0, hour: 0, minute: 3 });
    expect(resolveActionTime('看', { day: 0, hour: 1, minute: 0 })).toEqual({ day: 0, hour: 1, minute: 0 });
    expect(resolveActionTime('等三天', { day: 3, hour: 0, minute: 0 })).toEqual({ day: 3, hour: 0, minute: 0 });
    expect(resolveActionTime('想', { day: 0, hour: 0, minute: 0 })).toEqual({ day: 0, hour: 0, minute: 0 });
  });
  it('normalizes duration overflow and rejects malformed or backwards clock values', () => {
    expect(resolveActionTime('', { day: 0, hour: 0, minute: 90 })).toEqual({ day: 0, hour: 1, minute: 30 });
    expect(resolveActionTime('', { day: 0, hour: NaN, minute: 1 })).toEqual({ day: 0, hour: 0, minute: 5 });
    expect(resolveActionTime('', { day: -1, hour: 0, minute: 0 })).toEqual({ day: 0, hour: 0, minute: 5 });
    expect(resolveActionTime('', { day: 0, hour: 0, minute: 10 }, { day: 2, hour: 9, minute: 0 }, { day: 1, hour: 9, minute: 0 })).toEqual({ day: 0, hour: 0, minute: 10 });
  });
});

// ============================================================
// formatTimeSpent
// ============================================================
describe("formatTimeSpent", () => {
  it("formats multi-day time", () => {
    expect(formatTimeSpent({ day: 1, hour: 2, minute: 30 })).toBe("+1天2小时30分钟");
  });

  it("formats hours only (no days)", () => {
    expect(formatTimeSpent({ day: 0, hour: 3, minute: 15 })).toBe("+3小时15分钟");
  });

  it("formats minutes only", () => {
    expect(formatTimeSpent({ day: 0, hour: 0, minute: 5 })).toBe("+5分钟");
  });

  it("omits zero components", () => {
    expect(formatTimeSpent({ day: 1, hour: 0, minute: 30 })).toBe("+1天30分钟");
    expect(formatTimeSpent({ day: 0, hour: 2, minute: 0 })).toBe("+2小时");
  });
});

// ============================================================
// formatGameTime
// ============================================================
describe("formatGameTime", () => {
  it("formats day 0 without day prefix", () => {
    expect(formatGameTime({ day: 0, hour: 8, minute: 0 })).toBe("08:00");
  });

  it("formats day > 0 with day prefix", () => {
    expect(formatGameTime({ day: 5, hour: 14, minute: 30 })).toBe("第5天 14:30");
  });

  it("pads single-digit hour and minute", () => {
    expect(formatGameTime({ day: 0, hour: 9, minute: 5 })).toBe("09:05");
  });
});
