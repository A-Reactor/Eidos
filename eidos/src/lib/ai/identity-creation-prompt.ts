/** Shared by world authoring and legacy prompt metadata; never a separate model stage. */
export const IDENTITY_CREATION_GUIDE = `## 身份与开场
identityOptions 是世界的普通顶层字段，和人物、地图、历史、时间线在同一对话中创作与纠错，不单独调用身份生成，也不留待进入世界后补写。
通常提供 3–6 个有差异的可玩入口，数量服从素材与玩法，不凑下限。优先覆盖玩家明确可扮演的人物，保留其真实名称、背景和初始处境；其他适合扮演的已有角色也可作为入口。只有设定允许时才补充局外人，不为身份数量额外创建具名 NPC。
每个身份包含唯一 id、name、description、openingNarrative、startingScene。description 一句话；openingNarrative 为 100-150 字的第二人称当下开场，与该身份自己的经历、能力、物品和所在位置一致；不要共享默认主角的个人记忆、秘密或经历，不替玩家作出重大决定，不提前执行时间线。startingScene 精确引用 regions 中真实场景的 ID，开场结束时人物仍位于该场景。
玩家明确要求、来源事实和插件创建指南优先；没有依据的个人经历留白，不因通用丰富度要求补写来源事实。玩法只允许自定义身份或没有预设身份时，明确提交 identityOptions: []。身份内容齐备时随完整世界直接完成，不增加专门检查、生成阶段或例行复审。`;
