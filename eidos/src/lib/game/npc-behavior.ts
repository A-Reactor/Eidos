// ============================================================
// NPC 行为生成器 — 默认推测 + KEI 更新 + POV 生成
// ============================================================
// 三层机制：
//   1. 默认生成（零 API 调用）：进入场景时，基于 NPC 性格+时间生成粗略行为
//   2. KEI Deep Review 更新：世界事件影响 NPC 时，批量更新行为快照
//   3. POV 完整生成：玩家切换 NPC 视角时，KEI 生成完整叙事

import type { NpcBehavior, GameTime } from "./types";
import { npcIdentityText } from "./npc-identity";

// ============================================================
// 默认活动模板（按角色关键词 × 时段）
// ============================================================

/** 时段划分 */
type TimeOfDayRough = "清晨" | "上午" | "中午" | "下午" | "傍晚" | "深夜";

function getRoughTimeOfDay(hour: number): TimeOfDayRough {
  if (hour >= 5 && hour < 8) return "清晨";
  if (hour >= 8 && hour < 11) return "上午";
  if (hour >= 11 && hour < 14) return "中午";
  if (hour >= 14 && hour < 18) return "下午";
  if (hour >= 18 && hour < 22) return "傍晚";
  return "深夜";
}

/** 角色关键词 → 默认活动模板 */
const ROLE_DEFAULTS: Record<string, Record<TimeOfDayRough, { activity: string; mood: string }>> = {
  // 观测/学术类
  观测: {
    清晨: { activity: "在观测台整理昨晚的记录", mood: "专注" },
    上午: { activity: "在观测设备前记录数据", mood: "专注" },
    中午: { activity: "在走廊上慢步，似乎在想什么事", mood: "思考" },
    下午: { activity: "和同事讨论观测结果", mood: "平静" },
    傍晚: { activity: "在窗边望着裂隙的方向", mood: "疲惫" },
    深夜: { activity: "在值班室里打盹", mood: "疲惫" },
  },
  研究员: {
    清晨: { activity: "在翻阅厚厚的研究笔记", mood: "专注" },
    上午: { activity: "在实验室里忙碌", mood: "专注" },
    中午: { activity: "在走廊上边吃午饭边看书", mood: "平静" },
    下午: { activity: "在记录实验数据", mood: "专注" },
    傍晚: { activity: "在整理研究成果", mood: "疲惫" },
    深夜: { activity: "在桌前打瞌睡，手边还摊着书", mood: "疲惫" },
  },
  // 商业/交易类
  商: {
    清晨: { activity: "在整理货架上的商品", mood: "平静" },
    上午: { activity: "在招呼客人，讨价还价", mood: "愉快" },
    中午: { activity: "在柜台后面吃午饭", mood: "平静" },
    下午: { activity: "在清点库存，记账", mood: "专注" },
    傍晚: { activity: "在招呼最后一批客人", mood: "疲惫" },
    深夜: { activity: "在关门打烊，数今天的收入", mood: "疲惫" },
  },
  贩: {
    清晨: { activity: "在整理要卖的货物", mood: "平静" },
    上午: { activity: "在街头吆喝叫卖", mood: "活跃" },
    中午: { activity: "在摊位上打盹", mood: "疲惫" },
    下午: { activity: "在和客人讨价还价", mood: "活跃" },
    傍晚: { activity: "在收摊，清点今天的收入", mood: "疲惫" },
    深夜: { activity: "在昏暗的灯光下数钱", mood: "专注" },
  },
  // 酒馆/餐饮类
  酒馆: {
    清晨: { activity: "在打扫酒馆，擦拭桌椅", mood: "平静" },
    上午: { activity: "在准备今天的食材和酒水", mood: "忙碌" },
    中午: { activity: "在给零星的客人倒酒", mood: "平静" },
    下午: { activity: "在吧台后面擦杯子", mood: "平静" },
    傍晚: { activity: "在忙碌地招呼满堂的客人", mood: "忙碌" },
    深夜: { activity: "在清理酒馆，扫走最后一批醉客", mood: "疲惫" },
  },
  老板: {
    清晨: { activity: "在检查店铺的账本", mood: "专注" },
    上午: { activity: "在巡视店铺，安排伙计干活", mood: "忙碌" },
    中午: { activity: "在店里吃午饭", mood: "平静" },
    下午: { activity: "在接待重要的客人", mood: "专注" },
    傍晚: { activity: "在盘点一天的收支", mood: "疲惫" },
    深夜: { activity: "在锁门打烊", mood: "疲惫" },
  },
  // 军事/守卫类
  卫兵: {
    清晨: { activity: "在岗位上站岗，眼睛盯着裂隙的方向", mood: "警戒" },
    上午: { activity: "在巡逻固定的路线", mood: "警戒" },
    中午: { activity: "在哨站里换班", mood: "疲惫" },
    下午: { activity: "在岗位上站岗", mood: "警戒" },
    傍晚: { activity: "在巡逻，步伐比白天慢了一些", mood: "疲惫" },
    深夜: { activity: "在哨站的值班室里守着", mood: "疲惫" },
  },
  看守: {
    清晨: { activity: "在检查门锁", mood: "警戒" },
    上午: { activity: "在守着门口，打量每一个路过的人", mood: "警戒" },
    中午: { activity: "在吃午饭，但眼睛没离开过门口", mood: "警戒" },
    下午: { activity: "在打瞌睡，但一有动静就睁眼", mood: "疲惫" },
    傍晚: { activity: "在门口来回踱步", mood: "警戒" },
    深夜: { activity: "在门边坐着，盯着黑暗", mood: "警戒" },
  },
  老兵: {
    清晨: { activity: "在广场上晨练", mood: "平静" },
    上午: { activity: "在街边的长椅上看路人", mood: "思考" },
    中午: { activity: "在和棋友下棋", mood: "愉快" },
    下午: { activity: "在树下打盹", mood: "平静" },
    傍晚: { activity: "在酒馆里喝酒，讲故事", mood: "愉快" },
    深夜: { activity: "在家休息", mood: "平静" },
  },
  // 宗教/仪式类
  祭司: {
    清晨: { activity: "在神殿里做晨祷", mood: "虔诚" },
    上午: { activity: "在给前来祈福的人做仪式", mood: "平静" },
    中午: { activity: "在神殿后院休息", mood: "平静" },
    下午: { activity: "在研究经文", mood: "专注" },
    傍晚: { activity: "在做晚祷", mood: "虔诚" },
    深夜: { activity: "在神殿深处冥想", mood: "沉思" },
  },
  // 艺术家/创作类
  画师: {
    清晨: { activity: "在调颜料，准备开始画画", mood: "专注" },
    上午: { activity: "在画布前作画", mood: "专注" },
    中午: { activity: "在吃简单的午饭，看自己的画", mood: "思考" },
    下午: { activity: "在修改画作的一处细节", mood: "专注" },
    傍晚: { activity: "在收拾画具", mood: "平静" },
    深夜: { activity: "在烛光下画新的草图", mood: "专注" },
  },
  艺术家: {
    清晨: { activity: "在街头寻找灵感", mood: "思考" },
    上午: { activity: "在创作新的作品", mood: "专注" },
    中午: { activity: "在休息，看着自己的作品", mood: "平静" },
    下午: { activity: "在和路过的人讨论艺术", mood: "愉快" },
    傍晚: { activity: "在收拾工具", mood: "平静" },
    深夜: { activity: "在独自创作", mood: "专注" },
  },
  // 农民/劳作类
  农夫: {
    清晨: { activity: "在田里干活，太阳刚刚升起", mood: "忙碌" },
    上午: { activity: "在照料庄稼", mood: "平静" },
    中午: { activity: "在树荫下吃午饭休息", mood: "疲惫" },
    下午: { activity: "在继续干农活", mood: "忙碌" },
    傍晚: { activity: "在收拾农具，准备收工", mood: "疲惫" },
    深夜: { activity: "在家休息", mood: "平静" },
  },
  // 孩子/少年
  孩子: {
    清晨: { activity: "在街上追逐嬉戏", mood: "活跃" },
    上午: { activity: "在玩耍", mood: "愉快" },
    中午: { activity: "在吃午饭", mood: "平静" },
    下午: { activity: "在街头踢球", mood: "活跃" },
    傍晚: { activity: "被大人叫回家", mood: "不情愿" },
    深夜: { activity: "在家睡觉", mood: "平静" },
  },
  少年: {
    清晨: { activity: "在看书或学习", mood: "专注" },
    上午: { activity: "在帮大人干活", mood: "平静" },
    中午: { activity: "在吃午饭", mood: "平静" },
    下午: { activity: "在街头游荡，观察世界", mood: "好奇" },
    傍晚: { activity: "在回家的路上", mood: "平静" },
    深夜: { activity: "在家睡觉", mood: "平静" },
  },
  // 老人
  老人: {
    清晨: { activity: "在广场上慢慢散步", mood: "平静" },
    上午: { activity: "在街边的长椅上晒太阳", mood: "平静" },
    中午: { activity: "在家吃午饭", mood: "平静" },
    下午: { activity: "在打盹或回忆往事", mood: "思考" },
    傍晚: { activity: "在看夕阳", mood: "平静" },
    深夜: { activity: "在家休息", mood: "平静" },
  },
  // 猫 / 动物
  猫: {
    清晨: { activity: "在阳光下舔爪子", mood: "慵懒" },
    上午: { activity: "在屋顶上巡视领地", mood: "警觉" },
    中午: { activity: "在阴凉处打盹", mood: "慵懒" },
    下午: { activity: "在跟踪一只老鼠", mood: "专注" },
    傍晚: { activity: "在等着有人来喂食", mood: "平静" },
    深夜: { activity: "在暗处盯着路过的行人", mood: "警觉" },
  },
};

// ============================================================
// 默认生成入口
// ============================================================

/**
 * 默认行为生成：基于 NPC 的名称/性格描述 + 时间，返回一个合理的 NpcBehavior。
 *
 * 不调用任何 API。通过关键词匹配角色模板，仅在没有任何快照时使用。
 *
 * @param npcName NPC 名称
 * @param npcDescription NPC 的完整设定文本（来自 world.npcs）
 * @param sceneId NPC 所在场景 ID
 * @param time 当前游戏时间
 * @param existingBehavior 已有的行为快照（如果有，直接返回——不覆盖已有快照）
 */
export function getDefaultBehavior(
  npcName: string,
  npcDescription: unknown,
  sceneId: string,
  time: GameTime,
  existingBehavior?: NpcBehavior | null,
): NpcBehavior {
  // 已有快照 → 直接返回（不覆盖更精确的来源）
  if (existingBehavior && existingBehavior.source !== "default") {
    return existingBehavior;
  }

  const hour = time.hour;
  const tod = getRoughTimeOfDay(hour);

  // 按关键词匹配角色模板
  const text = npcIdentityText(npcDescription, npcName);
  const matched = findRoleMatch(text, tod);

  return {
    currentScene: sceneId,
    currentActivity: matched.activity,
    currentMood: matched.mood,
    interactingWith: [],
    lastObserved: { ...time },
    source: "default",
  };
}

/**
 * 在文本中匹配角色关键词，返回对应时段的默认活动。
 * 如果没有匹配到，返回通用默认值。
 */
function findRoleMatch(
  text: string,
  tod: TimeOfDayRough,
): { activity: string; mood: string } {
  // 按优先级匹配（更具体的词在前）
  const priorityOrder = [
    "猫", "酒馆", "观测员", "研究员", "卫兵", "看守", "老兵",
    "祭司", "画师", "艺术家", "农夫", "商", "贩", "老板",
    "孩子", "少年", "老人",
  ];

  for (const keyword of priorityOrder) {
    if (text.includes(keyword)) {
      const tmpl = ROLE_DEFAULTS[keyword === '观测员' ? '观测' : keyword]?.[tod];
      if (tmpl) return tmpl;
    }
  }

  // 通用默认
  return {
    activity: "在附近走动",
    mood: "平静",
  };
}

// ============================================================
// 批量默认生成（场景进入时）
// ============================================================

/**
 * 为场景中的 NPC 批量生成默认行为快照。
 * 已有精确快照（kei_update / pov_generated）的 NPC 跳过。
 *
 * @returns 更新后的 npcBehaviors Record
 */
export function ensureSceneNpcBehaviors(
  npcNames: string[],
  npcDescriptions: Record<string, unknown>,
  sceneId: string,
  time: GameTime,
  existingBehaviors: Record<string, NpcBehavior>,
): Record<string, NpcBehavior> {
  const updated = { ...existingBehaviors };
  for (const name of npcNames) {
    const desc = npcDescriptions[name];
    if (!desc) continue;
    const existing = existingBehaviors[name];
    updated[name] = getDefaultBehavior(name, desc, sceneId, time, existing);
  }
  return updated;
}

// ============================================================
// KEI 更新后的行为合并
// ============================================================

/**
 * 将 KEI Deep Review 或 POV 生成返回的行为快照合并入现有状态。
 * source 为 "kei_update" 或 "pov_generated" 的覆盖默认值。
 */
export function mergeNpcBehavior(
  npcName: string,
  partial: Partial<NpcBehavior> & { currentScene: string },
  time: GameTime,
  existing: Record<string, NpcBehavior>,
): Record<string, NpcBehavior> {
  const prev = existing[npcName];
  return {
    ...existing,
    [npcName]: {
      currentScene: partial.currentScene,
      currentActivity: partial.currentActivity ?? prev?.currentActivity ?? "在附近走动",
      currentMood: partial.currentMood ?? prev?.currentMood ?? "平静",
      interactingWith: partial.interactingWith ?? prev?.interactingWith ?? [],
      lastObserved: { ...time },
      source: partial.source ?? "kei_update",
    },
  };
}
