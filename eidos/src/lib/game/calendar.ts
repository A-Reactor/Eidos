// ============================================================
// Eidos · 日历与天气
// ============================================================

import type { GameTime, GameCalendar, Weather } from "./types";

/**
 * 从游戏天数转换为日历日期
 * 裂隙之城使用「裂隙历」——以裂隙观测局成立之年为元年
 * 世界历史记载「现在」为裂隙出现后约500年
 * 游戏第0天 = 裂隙历 512年 3月15日（初春）
 */
const CALENDAR_EPOCH_YEAR = 512;
const CALENDAR_EPOCH_MONTH = 3;
const CALENDAR_EPOCH_DAY = 15;

/** 每月天数 */
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function gameTimeToCalendar(t: GameTime): GameCalendar {
  const totalDays = t.day + Math.floor(t.hour / 24);
  let y = CALENDAR_EPOCH_YEAR;
  let m = CALENDAR_EPOCH_MONTH - 1; // 0-indexed
  let d = CALENDAR_EPOCH_DAY + totalDays;

  while (true) {
    const daysInMonth = MONTH_DAYS[m] + (m === 1 && isLeapYear(y) ? 1 : 0);
    if (d <= daysInMonth) break;
    d -= daysInMonth;
    m++;
    if (m >= 12) { m = 0; y++; }
  }

  return { year: y, month: m + 1, day: d };
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function formatCalendar(cal: GameCalendar): string {
  return `裂隙历 ${cal.year}年 ${cal.month}月${cal.day}日`;
}

export function formatCalendarShort(cal: GameCalendar): string {
  return `${cal.year}/${String(cal.month).padStart(2, "0")}/${String(cal.day).padStart(2, "0")}`;
}

// ============================================================
// 天气
// ============================================================

/**
 * 根据游戏时间和当前天气生成新天气
 * 每天变化2-3次，有连续性（不会从晴突然跳到雪）
 */
const WEATHER_TRANSITIONS: Record<Weather, Weather[]> = {
  "晴": ["晴", "晴", "晴", "多云", "风"],
  "多云": ["多云", "晴", "阴", "风"],
  "阴": ["阴", "多云", "雨", "雾"],
  "雨": ["雨", "阴", "多云", "风"],
  "雾": ["雾", "阴", "多云"],
  "风": ["风", "晴", "多云", "阴"],
  "雪": ["雪", "阴", "多云"],
};

export function nextWeather(current: Weather, seed: number): Weather {
  const options = WEATHER_TRANSITIONS[current] || WEATHER_TRANSITIONS["晴"];
  return options[seed % options.length];
}

/** 每天的时间段 */
export function timeOfDay(hour: number): string {
  if (hour < 6) return "深夜";
  if (hour < 9) return "清晨";
  if (hour < 12) return "上午";
  if (hour < 14) return "正午";
  if (hour < 18) return "下午";
  if (hour < 21) return "黄昏";
  return "夜晚";
}

/** 天气对场景的影响描述 */
export function weatherEffect(weather: Weather): string {
  switch (weather) {
    case "晴": return "阳光洒落，空气清朗";
    case "多云": return "云层遮挡了部分光线，天色稍暗";
    case "阴": return "天空灰蒙蒙的，气氛略显压抑";
    case "雨": return "雨水淅沥，街道湿滑，空气里弥漫着潮湿的气息";
    case "雾": return "薄雾笼罩，视野受限，远处的建筑轮廓模糊";
    case "风": return "风声呼啸，卷起地面的尘土和落叶";
    case "雪": return "雪花飘落，地面铺上一层薄薄的白色";
    default: return "";
  }
}
