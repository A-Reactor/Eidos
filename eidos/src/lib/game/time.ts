// ============================================================
// Eidos · 时间推进
// 模型决定叙事耗时，程序只做数值规范化与时间加法
// ============================================================

import type { GameTime } from "./types";

/** 将 GameTime 转为总分钟数 */
export function timeToMinutes(t: GameTime): number {
  return t.day * 24 * 60 + t.hour * 60 + t.minute;
}

/** 分钟数转 GameTime */
export function minutesToTime(total: number): GameTime {
  const day = Math.floor(total / (24 * 60));
  const rest = total % (24 * 60);
  const hour = Math.floor(rest / 60);
  const minute = rest % 60;
  return { day, hour, minute };
}

/** 时间加法 */
export function addTime(a: GameTime, b: GameTime): GameTime {
  return minutesToTime(timeToMinutes(a) + timeToMinutes(b));
}

/** Reject malformed numbers, but do not impose narrative-specific duration caps. */
function validMinutes(value: GameTime | undefined | null): number | null {
  if (!value || ![value.day, value.hour, value.minute].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0)) return null;
  const total = timeToMinutes(value);
  return Number.isSafeInteger(Math.round(total)) ? Math.round(total) : null;
}

/** Absolute end time avoids asking the model to calculate a duration for “wait until evening”. */
export function resolveActionTime(
  _input: string,
  aiTime: GameTime | undefined | null,
  currentTime?: GameTime,
  timeAfter?: GameTime | null,
): GameTime {
  const end = validMinutes(timeAfter);
  const start = validMinutes(currentTime);
  if (end !== null && start !== null && end >= start) return minutesToTime(end - start);
  return minutesToTime(validMinutes(aiTime) ?? 5);
}

export function buildActionTimeContext(time: GameTime): string {
  return `行动开始时间为第${time.day}天 ${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}。由你决定行动结束的时刻，叙事、昼夜氛围和 timeAfter 必须一致；程序会计算实际流逝时间。`;
}

/** 格式化显示时间流逝 */
export function formatTimeSpent(t: GameTime): string {
  if (t.day > 0) {
    return `+${t.day}天${t.hour > 0 ? t.hour + "小时" : ""}${t.minute > 0 ? t.minute + "分钟" : ""}`;
  }
  if (t.hour > 0) {
    return `+${t.hour}小时${t.minute > 0 ? t.minute + "分钟" : ""}`;
  }
  return `+${t.minute}分钟`;
}

/** 格式化显示游戏时间 */
export function formatGameTime(t: GameTime): string {
  const hh = String(t.hour).padStart(2, "0");
  const mm = String(t.minute).padStart(2, "0");
  if (t.day > 0) {
    return `第${t.day}天 ${hh}:${mm}`;
  }
  return `${hh}:${mm}`;
}
