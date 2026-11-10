# Skill: 知识考古探索 (curiosity-archaeology)

教 KEI 和 ALICE 设计以知识为进度的探索游戏：玩家通过理解碎片记录、遗迹痕迹、设备日志和自然现象推进，而不是通过数值成长或钥匙收集推进。

## Part A: KEI 世界生成指南

```
## 知识考古设计

你正在设计一个以知识本身作为进度的探索世界。玩家真正获得的奖励不是装备、等级或通关钥匙，而是对世界规律、历史错误、地点关联和人物选择的理解。

### 核心原则
- 每个重要地点至少保存一条可验证的局部事实。
- 每条线索回答一个小问题，同时制造一个更精确的新问题。
- 不要安排单个 NPC 或单份档案直接解释最终谜底。
- 线索之间应当形成可回访的网络：A 地点的记录指向 B 现象，B 现象解释 C 设备，C 设备改变玩家对 A 记录的理解。
- 谜题推进优先依赖玩家已经理解的事实，而不是物品栏里的钥匙。

### 在 gameModeConfig 中声明
{
  "knowledgeOnlyProgression": true,
  "evidenceNodes": [
    {
      "id": "evidence_node_signal_shift",
      "locationSceneId": "scene_observatory",
      "surfaceText": "玩家可见的碎片记录、碑文、日志或环境痕迹",
      "answersQuestion": "它回答的一个小问题",
      "opensQuestion": "它制造的下一个更精确问题",
      "pointsTo": ["scene_well", "scene_south_tower"],
      "requiredPriorFacts": [],
      "revealsFacts": ["某个可加入 criticalFactsDiscovered 的事实"],
      "forbiddenDirectExplanation": "不得直接解释最终谜底"
    }
  ],
  "knowledgeGates": [
    {
      "gateId": "gate_enter_core",
      "requiresFacts": ["玩家必须已经理解的事实"],
      "unlocksSceneId": "scene_core",
      "naturalPlayerAction": "玩家可能说出的自然行动，而不是按钮式口令"
    }
  ]
}

### KEI 生成检查
- 至少设计 6 个 evidenceNodes，并保证它们跨越不同地点或不同信息载体。
- 至少设计 2 个知识门禁 knowledgeGates，它们应该能被自然行动触发，例如“按照井中回声的节奏敲塔门”。
- 所有关键事实都要能被多个弱线索交叉支持，避免单点剧透。
- 允许循环、时间、天体、机关或档案主题，但它们必须服务“理解带来进度”。
```

## Part B: ALICE 运行时指南

```
## 知识考古运行

当玩家阅读、检查、观察、测量、回访、对照线索或提出假设时：

### 输出方式
- 给出短而具体的碎片记录或环境反应。
- 每次最多确认 1 个新事实，并加入 criticalFactsDiscovered。
- 同时抛出 1 个更精确的新疑问，推动玩家去另一个地点、现象或实验。
- availableActions 应该包含“回访某地 / 对照某条记录 / 测试某个现象 / 询问某个见证者”等自然行动。

### 知识门禁
- 如果玩家行动体现出他们已经理解 requiresFacts，即使没有输入精确口令，也应该允许通过。
- 如果玩家还没理解，不要机械拒绝；用环境反馈指出缺失的事实。
- 不要说“你还没有解锁条件”，要让世界以自然方式回应。

### 叙事边界
- 不要直接解释最终谜底。
- 不要把所有线索整理成完整答案讲给玩家听。
- 不要让 NPC 代替玩家推理。
- 当玩家提出合理假设时，给出可验证反馈，而不是马上宣布正确或错误。
```

## Part C: KEI 审核指南

```
## 知识考古审核

1. evidenceNodes 是否形成连通网络，而不是孤立条目？
2. 每条线索是否只回答一个局部问题，并保留新的探索方向？
3. knowledgeOnlyProgression 是否被遵守：进度主要来自理解，而不是装备、等级或硬钥匙？
4. knowledgeGates 的触发是否允许自然语言行动，而不是死板口令？
5. 是否避免了单个 NPC、日志或旁白直接解释最终谜底？
6. ALICE 是否把新事实写入 criticalFactsDiscovered，并用 availableActions 引导下一步验证？
```
