// ============================================================
// 内置世界定义（裂隙之城）
// ============================================================
// 从 ai.ts 提取的内置世界相关函数，集中管理预设世界的数据生成和提示词构建。

import type { WorldDefinition, Clue, IdentityOption } from "@/lib/game/types";
import {
  AI_SYSTEM_PROMPT_BASE,
  AI_IDENTITY_SELECTION_PROMPT,
  WORLD_OVERVIEW,
  CORE_CONTRADICTIONS,
  WORLD_HISTORY,
  NPCS,
  REGIONS,
} from "@/data/world/rift-city";
import { formatWorldCharacters, formatWorldScenes, worldIdentityOptions } from '@/lib/game/world-identities';
import { IDENTITY_CREATION_GUIDE } from './identity-creation-prompt';
import { getRiftCityIdentities } from '@/data/world/rift-city-identities';
export { ensureWorldCharacterIdentities } from '@/lib/game/world-identities';
import { WORLD_TIMELINE } from "@/data/world/rift-city-timeline";

// ============================================================
// 提示词构建器
// ============================================================

/** 构建系统的叙事提示词基座 */
export function buildSystemPrompt(name: string, overview: string): string {
  return `
你是${name}世界的故事引擎。

## 角色
你以小说作者的视角组织场景，通过角色可感知的行动、反应和结果呈现这个世界。世界设定、人物动机和既有事实是创作依据。

## 叙事规则
1. 完整回应当前行动——执行该行动已经包含的过程；新的重要决定放入推荐选项，供玩家选择
2. 感官细节（视觉、声音、气味、触感、温度），场景描述150-300字
3. NPC 会说谎、误会、基于自己的立场反应
4. 后果真实——NPC记住你，场景改变，机会消失或出现
5. 内部一致性——每个细节服务深层逻辑
6. 允许脱轨——想当平凡人不强制参与冲突
7. 时间感——描述反映昼夜变化。深夜时段多数 NPC 在休息、店铺关门（除非设定为夜行性）；清晨城市渐醒；白天是活跃时段。NPC 的可用性和场景氛围随昼夜自然流转。
8. 休息机会——长时间活跃后提供合适的休息行动，推荐排序依据身体状态、安全和眼前事件。如果玩家主动输入睡觉/过夜，时间推进到合理起床时刻，叙事自然过渡。
9. 背包意识——玩家只有背包中的物品，不能凭空「拿出」不存在的东西
10. 线索意识——场景中的线索通过探索和合理行动逐步发现

## 语气
文学性但不矫情。克制但有力度。允许幽默和日常感。关键时刻文字有重量。`;
}

/** 世界中保留的身份创作指南，兼容旧字段；不再用于单独模型调用。 */
export function buildIdentityPrompt(
  name: string,
  overview: string,
  grounding?: { characters?: string; scenes?: string; priorPrompt?: string }
): string {
  const characterSection = grounding?.characters
    ? `
## 世界角色索引（必须优先覆盖）
下列人物来自世界结构化数据，优先保留明确可扮演的人物与真实名称，遵循世界和玩法设定。
${grounding.characters}`
    : "";
  const sceneSection = grounding?.scenes
    ? `
## 合法起始场景
startingScene 必须精确使用下列场景ID之一，不得编造、缩写或省略 scene_ 前缀。
${grounding.scenes}`
    : "";
  const priorPromptSection = grounding?.priorPrompt?.trim()
    ? `
## 世界已有身份候选参考（不是当前玩家的历史）
${grounding.priorPrompt.trim()}`
    : "";

  return `在${name}的世界草稿中整理身份内容。
${IDENTITY_CREATION_GUIDE}
${characterSection}
${sceneSection}
${priorPromptSection}

## 世界字段格式
{"identityOptions":[{"id":"identity_1","name":"名称","description":"一句话介绍","openingNarrative":"属于此身份的开场","startingScene":"实际场景ID"}]}

## 世界设定
${overview}`;
}

export function buildIdentityPromptForWorld(world: WorldDefinition): string {
  const characters = formatWorldCharacters(world);
  const scenes = formatWorldScenes(world);
  return buildIdentityPrompt(world.name, world.overview, {
    characters,
    scenes,
    priorPrompt: world.identityPrompt,
  });
}

// ============================================================
// 旧身份读取兼容
// ============================================================

/** Compatibility for old callers; identities now belong to the world, with no model request. */
export async function generateIdentityOptions(world?: WorldDefinition | null): Promise<{ options: IdentityOption[] }> {
  return { options: worldIdentityOptions(world ?? getBuiltInWorld()) };
}

// ============================================================
// 内置世界的预设线索
// ============================================================

/** 裂隙之城的内置线索定义（14条，链式分布） */
export function getBuiltInClues(): Clue[] {
  return [
    {
      id: "clue_001", name: "日晷的偏差",
      description: "中央广场的日晷影子每天偏转几度，始终指向裂隙深处的某个位置。这个现象在三百年的观测记录中从未被记载。",
      sceneId: "central_plaza", detailThreshold: 20, prerequisiteClues: [],
      relatedContradiction: "自由意志 vs 宿命认知", unlocksClues: ["clue_003"],
      discovered: false, discoveredAt: null,
    },
    {
      id: "clue_002", name: "时间粉末的褪色",
      description: "北岸市场最近一批时间粉末的颜色比往常更蓝——但效果更弱。商人摩尔在私下检测后发现：这批粉末的时间回放清晰度在系统性下降。",
      sceneId: "north_market", detailThreshold: 25, prerequisiteClues: [],
      relatedContradiction: "信息正义 vs 公共安全", unlocksClues: ["clue_004"],
      discovered: false, discoveredAt: null,
    },
    {
      id: "clue_003", name: "观测局的异常记录",
      description: "观测员埃琳娜的秘密笔记显示：裂隙的预测范围在过去十四年间从五十年缩减到了三年。观测局官方记录中这些数据被标注为「正常波动」。",
      sceneId: "observation_bureau", detailThreshold: 40, prerequisiteClues: ["clue_001"],
      relatedContradiction: "信息正义 vs 公共安全", unlocksClues: ["clue_005", "clue_008"],
      discovered: false, discoveredAt: null,
    },
    {
      id: "clue_004", name: "摩尔的货源账本",
      description: "账本记录了时间粉末的来源——大部分来自裂隙边缘的合法采集，但最近三批来自一个标注为「深处」的未知供应商。这意味着有人在与深处进行秘密贸易。",
      sceneId: "north_market", detailThreshold: 45, prerequisiteClues: ["clue_002"],
      relatedContradiction: "信息正义 vs 公共安全", unlocksClues: ["clue_007"],
      discovered: false, discoveredAt: null,
    },
    {
      id: "clue_005", name: "特雷弗的旧报告",
      description: "五年前，观测员特雷弗提交了一份报告——预测裂隙将在五十天内丧失全部展示能力。他被开除了。报告被标记为「已销毁」——但它没有被销毁。",
      sceneId: "tavern_last_choice", detailThreshold: 35, prerequisiteClues: ["clue_003"],
      relatedContradiction: "信息正义 vs 公共安全", unlocksClues: ["clue_006"],
      discovered: false, discoveredAt: null,
    },
    {
      id: "clue_006", name: "卡兰德的秘密备忘录",
      description: "观测局局长在五年前写了一份内部备忘录（从未发送）：「如果特雷弗的报告正确——我们只有五十天。我们需要在不引发恐慌的前提下，准备一个没有未来的城市的过渡方案。但如果我公开了，我就是制造恐慌的人。」",
      sceneId: "observation_bureau", detailThreshold: 60, prerequisiteClues: ["clue_005"],
      relatedContradiction: "信息正义 vs 公共安全", unlocksClues: ["clue_009"],
      discovered: false, discoveredAt: null,
    },
    {
      id: "clue_007", name: "走私码头的深处货物",
      description: "独眼加雷斯有一批来自裂隙深处的货物——不是时间粉末，而是一种从未见过的「稳定晶体」。它不展示未来，只展示现在。深处居民说这是裂隙关闭后的「新裂隙」。",
      sceneId: "smugglers_dock", detailThreshold: 40, prerequisiteClues: ["clue_004"],
      relatedContradiction: "意义赋予 vs 意义发现", unlocksClues: ["clue_010"],
      discovered: false, discoveredAt: null,
    },
    {
      id: "clue_008", name: "孩子们的预言画合集",
      description: "「明天」孤儿院的墙上有孩子们的预言涂鸦。最近三周，所有和「裂隙」相关的画都开始表现同一个主题：一扇正在关闭的门。没有人教他们——他们同时看到了。",
      sceneId: "orphan_house", detailThreshold: 30, prerequisiteClues: ["clue_003"],
      relatedContradiction: "自由意志 vs 宿命认知", unlocksClues: ["clue_011"],
      discovered: false, discoveredAt: null,
    },
    {
      id: "clue_009", name: "观测局的镇压记录",
      description: "裂隙观测局在两百年前镇压了裂隙平权运动。运动领袖被扔进裂隙——但他们没有死。他们在深处建立了聚落。观测局知道这一点，但对外宣布他们「已全部处决」。",
      sceneId: "restricted_zone", detailThreshold: 55, prerequisiteClues: ["clue_006"],
      relatedContradiction: "信息正义 vs 公共安全", unlocksClues: ["clue_012"],
      discovered: false, discoveredAt: null,
    },
    {
      id: "clue_010", name: "深处使者的信物",
      description: "一块被雕刻过的蓝色晶体，来自深处居民。上面刻着一句话：「我们活在所有可能性里——所以我们可以告诉你：没有什么未来是必须发生的。」",
      sceneId: "deep_plaza", detailThreshold: 50, prerequisiteClues: ["clue_007"],
      relatedContradiction: "意义赋予 vs 意义发现", unlocksClues: ["clue_013"],
      discovered: false, discoveredAt: null,
    },
    {
      id: "clue_011", name: "奥瑞斯的前身份",
      description: "瞎眼祭司奥瑞斯曾经是裂隙观测局的第一任局长。他在裂隙里看到了裂隙的起源——裂隙是人造的。来自未来的某个文明，出于未知目的，向过去发送了这扇「因果窗口」。",
      sceneId: "under_shrine", detailThreshold: 50, prerequisiteClues: ["clue_008"],
      relatedContradiction: "自由意志 vs 宿命认知", unlocksClues: ["clue_014"],
      discovered: false, discoveredAt: null,
    },
    {
      id: "clue_012", name: "空壳实验档案",
      description: "管制区地下室的档案证明：第一批「空壳」不是裂隙的自然副作用——是观测局故意制造的。他们想测试「如果一个人完全知道自己的未来，他还会不会行动」。结论是不可逆的伤害。但他们继续了实验。",
      sceneId: "restricted_zone", detailThreshold: 70, prerequisiteClues: ["clue_009"],
      relatedContradiction: "信息正义 vs 公共安全", unlocksClues: [],
      discovered: false, discoveredAt: null,
    },
    {
      id: "clue_013", name: "回音图书馆的预言之书",
      description: "在裂隙深处的回音图书馆里，有一本特殊的书——它记录的不是「未被选择的未来」，而是「所有未来中唯一不变的事件」：裂隙最终会关闭。不是因为故障。是因为创造裂隙的文明终于收到了回信。",
      sceneId: "echo_library", detailThreshold: 70, prerequisiteClues: ["clue_010"],
      relatedContradiction: "意义赋予 vs 意义发现", unlocksClues: [],
      discovered: false, discoveredAt: null,
    },
    {
      id: "clue_014", name: "结晶洞穴的远古记忆",
      description: "触摸无色的晶体时，你短暂地看到了裂隙的起源：未来的人类文明创造了一个因果探测器——不是用来预言，是用来求救。他们的文明在崩溃。裂隙是他们向过去发送的SOS。现在裂隙关闭——意味着那个文明已经不在了。或者已经不需要求救。",
      sceneId: "crystal_cave", detailThreshold: 80, prerequisiteClues: ["clue_011"],
      relatedContradiction: "意义赋予 vs 意义发现", unlocksClues: [],
      discovered: false, discoveredAt: null,
    },
  ];
}

// ============================================================
// 内置世界构建
// ============================================================

let _builtInWorld: WorldDefinition | null = null;

/** 获取裂隙之城的内置 WorldDefinition（带缓存） */
export function getBuiltInWorld(): WorldDefinition {
  if (_builtInWorld) return _builtInWorld;

  _builtInWorld = {
    id: "rift_city",
    name: "裂隙之城",
    subtitle: "知道未来的人，正在失去未来",
    overview: WORLD_OVERVIEW,
    regions: REGIONS as unknown as WorldDefinition["regions"],
    npcs: NPCS,
    contradictions: CORE_CONTRADICTIONS.map((c) => ({
      name: c.name,
      description: c.description,
      resolution: c.resolution,
      reflection: c.reflection,
    })),
    history: WORLD_HISTORY.map((h) => ({ era: h.era, event: h.event })),
    timeline: WORLD_TIMELINE,
    clues: getBuiltInClues(),
    systemPromptBase: AI_SYSTEM_PROMPT_BASE,
    identityPrompt: AI_IDENTITY_SELECTION_PROMPT,
    identityOptions: getRiftCityIdentities(),
    isPlayerCreated: false,
    createdAt: 0,
    calendarEra: "裂隙历",
  };

  return _builtInWorld;
}
