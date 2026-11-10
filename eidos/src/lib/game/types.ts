// ============================================================
// Eidos · 核心类型定义
// ============================================================

// ============================================================
// 任务/待办追踪
// ============================================================

export type QuestStatus = "active" | "done" | "failed";

export interface QuestEntry {
  id: string;
  title: string;
  description: string;
  status: QuestStatus;
  /** 涉及的人物 */
  relatedNpcs: string[];
  /** 约定的截止时间（游戏时间，可选） */
  deadline: GameTime | null;
  /** 记录时间 */
  createdAt: GameTime;
  /** 完成/失败时间 */
  resolvedAt: GameTime | null;
}

// ============================================================
// 世界百科全书
// ============================================================

export type EncyclopediaEntryType = "npc" | "item" | "location" | "faction" | "concept" | "other";

/** 百科中的一条知识——来源可追踪、有重要性评分 */
export interface KnowledgeItem {
  text: string;
  source: "ai" | "player" | "discovery";
  addedAt: GameTime;
  importance: number; // 0-100
}

export interface EncyclopediaEntry {
  id: string;
  type: EncyclopediaEntryType;
  name: string;
  /** 一句话简介（玩家可见） */
  description: string;
  /** 随时间积累的详细认知（每一条是一个发现） */
  knowledge: KnowledgeItem[];
  /** 首次记录的游玩时间 */
  firstEncountered: GameTime;
  /** 最后更新的游玩时间 */
  lastUpdated: GameTime;
  /** 关联的其他条目ID */
  relatedEntries: string[];
  /** AI 生成的插图 URL（从 MIDORI icon API 获取，可选） */
  imageUrl?: string;
}

/** 关键信息条目——带重要性评分和引用追踪 */
export interface CriticalFactEntry {
  text: string;
  importanceScore: number;    // 0-100，默认 50
  referencedCount: number;    // 被后续叙事引用的次数
  lastReferencedAt: GameTime | null;
}

// ============================================================
// 其他类型
// ============================================================

/** 区域 */
export type Region = "上城区" | "下城区" | "裂隙深处" | "边缘地带" | string;

/** 场景 */
export interface Scene {
  id: string;
  name: string;
  region: Region;
  initialDescription: string;
  detailLevel: number;
  connections: string[];
  npcs: string[];
  secrets: string[];
  discoveredSecrets: string[];
}

/** 游戏时间 */
export interface GameTime {
  day: number;
  hour: number;
  minute: number;
}

/** 日历日期 */
export interface GameCalendar {
  year: number;
  month: number;
  day: number;
}

/** 天气 */
export type Weather = "晴" | "多云" | "阴" | "雨" | "雾" | "风" | "雪";

// ============================================================
// 背包系统
// ============================================================

/** 背包物品 */
export interface InventoryItem {
  id: string;
  name: string;
  description: string;
  quantity: number;
  /** 获得此物品的场景ID */
  acquiredFrom: string;
  /** 获得时的游戏时间 */
  acquiredAt: GameTime;
  /** 物品类型（用于AI判断使用逻辑） */
  category: "weapon" | "tool" | "consumable" | "key" | "document" | "misc";
  /** 是否可消耗（使用后数量-1，归零则移除） */
  consumable: boolean;
  /** 估计价值（裂隙币），0 表示无特殊价值 */
  value: number;
  /** AI 生成的图标 URL（从 MIDORI icon API 获取，可选） */
  imageUrl?: string;
  documentRef?: import('./documents/types').DocumentRef;
}

// ============================================================
// 线索系统
// ============================================================

/** 线索（世界创建时生成，场景探索中发现） */
export interface Clue {
  id: string;
  name: string;
  description: string;
  /** 线索所属的场景ID */
  sceneId: string;
  /** 发现此线索需要的探索深度阈值（0-100） */
  detailThreshold: number;
  /** 前置线索ID（必须先发现这些线索才能发现此线索） */
  prerequisiteClues: string[];
  /** 此线索关联的世界矛盾 */
  relatedContradiction: string;
  /** 此线索揭示后解锁的后续线索ID */
  unlocksClues: string[];
  /** 是否已被发现 */
  discovered: boolean;
  /** 发现时的游戏时间 */
  discoveredAt: GameTime | null;
}

// ============================================================
// 世界推演
// ============================================================

export interface WorldTimelineEvent {
  id: string;
  timePoint: GameTime;
  title: string;
  region: Region;
  sceneId: string;
  description: string;
  npcsInvolved: string[];
  defaultOutcome: string;
  worldFlags: string[];
  playerModifiable: boolean;
  rippleEffects: {
    description: string;
    triggersAt: GameTime;
  }[];
}

// ============================================================
// 行动记录
// ============================================================

export interface ActionRecord {
  sourceResponse?: string;
  directorCues?: import('./director-cues').DirectorCue[];
  workspaceBranch?: import('./workspace/branch').WorkspaceBranch;
  inputDocuments?: import('./documents/types').DocumentLink[];
  outputDocuments?: import('./documents/types').DocumentLink[];
  inputIdentity?: string;
  workspaceEffects?: import('./workspace/types').WorkspaceToolResult[];
  id: string;
  timestamp: number;
  /** 游戏时间 */
  gameTime: GameTime;
  sceneId: string;
  sceneName: string;
  playerInput: string;
  aiResponse: string;
  summary: string;
  /** 此次行动花费的时间 */
  timeSpent: GameTime;
  /** 此次行动影响的世界方面 */
  worldImpacts: string[];
  /** AI 推荐的后续选项 */
  availableActions?: string[];
  /** 此次行动前的世界快照（用于回档） */
  snapshot: WorldSnapshot | null;
}

// （TimelineBranch 已废弃，由 WorldLineNode 取代）

// ============================================================
// 世界线系统（World → Playthrough → WorldLine → Node）
// ============================================================

export interface PlayerExcerpt {
  id: string;
  text: string;
  note: string;
}

/** 世界线节点 —— 一次玩家行动 + AI 回应 */
export interface WorldLineNode {
  directorCues?: import('./director-cues').DirectorCue[];
  entry?:import('./action-entry').ActionEntry;
  observerInterference?:import('./presentation/observer').ObserverInterference;
  /** Reader presentation is branch-owned metadata; source CAS text stays immutable. */
  presentation?: import('./presentation').Presentation;
  workspaceBranch?: import('./workspace/branch').WorkspaceBranch;
  inputDocuments?: import('./documents/types').DocumentLink[];
  outputDocuments?: import('./documents/types').DocumentLink[];
  inputIdentity?: string;
  workspaceEffects?: import('./workspace/types').WorkspaceToolResult[];
  id: string;                     // "wl_{timestamp}_{random8}"
  parentId: string | null;        // null = 根节点
  stepNumber: number;             // 从根算起的步数（root = 0）

  // 玩家输入与 AI 回应
  playerInput: string;
  aiResponse: string;             // 完整 AI 叙事文本
  summary: string;                // 一句话摘要

  /** Reader-owned metadata, never injected into the world's knowledge. */
  actionId?: string;
  playerVisibleText?: string;
  playerExcerpts?: PlayerExcerpt[];
  /** 玩家人物备注，沿祖先路径继承；空字符串表示本分支清空，不进入 NPC 心理状态。 */
  playerNpcNotes?: Record<string, string>;

  // CAS 引用（去重存储）
  snapshotHash: string;           // WorldSnapshot 的 hash
  segmentHash: string;            // StorySegment[] 的 hash

  // 树结构
  childIds: string[];             // 从此节点出发的分支节点 ID

  // 元数据
  createdAt: number;              // 真实时间戳
  gameTime: GameTime;             // 游戏内时间
  sceneId: string;
  sceneName: string;
  dayNumber: number;              // 用于按天分组

  // 行动耗时
  timeSpent: GameTime;
  worldImpacts: string[];

  // AI 推荐选项（回档时恢复）
  rewindFailure?: { target: string; reason: string };
  availableActions?: string[];

  // 显示
  label?: string;                 // 用户自定义标签

  // 早停标记（玩家在 segment 中途中断）
  /** 本轮生成是否完整播放完毕（false = 玩家在某个 segment 中断） */
  generationComplete: boolean;
  /** 如果中断，中断前最后展示的 segment 索引（0-based） */
  interruptedAtSegment?: number;
  /** ALICE 本轮总共生成了多少 segment（无论是否全部播放） */
  totalSegmentsGenerated?: number;
}

/** 世界线树元数据（属于一个周目） */
export interface WorldLineMeta {
  gameplayPluginHistory?: import('./plugins/package-history').GameplayPackageHistory;
  id: string;                     // "worldline_{timestamp}_{random4}"
  playthroughId: string;          // 所属周目 ID
  worldId: string;
  rootNodeId: string;             // 树的根节点
  allNodeIds: string[];           // 所有节点 ID（扁平索引）
  currentNodeId: string;          // 当前游玩所在的节点
  branchCount: number;            // 总分支数
  totalSteps: number;             // 总行动步数
  createdAt: number;
  updatedAt: number;
}

/** 导出格式 — 自包含、可重放 */
export interface WorldLineExport {
  documents?: import('./documents/transfer').DocumentBundle;
  modResources?: Record<string, import('./workspace/types').ModResource>;
  modMail?: import('./plugins/mailbox').ModMailBundle;
  voiceAssets?: Record<string, import("./momoi/model").VoiceAsset>;
  voiceConfig?: import("./momoi/model").VoiceConfig;
  formatVersion: string;          // "wl_export_v2"
  exportedAt: string;             // ISO
  world: WorldDefinition;         // 完整世界定义（含 gameModeConfig）
  player: {
    name: string;
  };
  nodes: WorldLineNode[];         // 扁平数组（parentId 链接）
  snapshots: Record<string, WorldSnapshot>;   // hash → 快照
  segments: Record<string, any[]>;            // hash → StorySegment[]
  /** Skill 数据——使导出的世界可独立运行（可选） */
  skills?: Record<string, string>;  // skillId → markdown prompt 文本
  metadata: {
    rootNodeId: string;
    nodeCount: number;
    branchCount: number;
    lastGameTime: GameTime;
  };
}

/** 按天分组（UI 渲染用） */
export interface WorldLineGroup {
  day: number;                    // 游戏天数
  nodeIds: string[];              // 主线节点（有序）
  branchRootIds: string[];        // 该天内分支的根节点 ID
}

/** 重放模式 */
export type ReplayMode = "no_branch" | "branch";

/** 重放状态 */
export interface ReplayState {
  active: boolean;
  mode: ReplayMode;
  importData: WorldLineExport | null;
  currentNodeId: string | null;
  hasDiverged: boolean;           // 玩家输入已偏离存储内容
}

// ============================================================
// 世界快照
// ============================================================

export interface WorldSnapshot {
  historyEpochPlan?: import('@/lib/ai/history-epoch').HistoryEpochPlan | null;
  promptContextScope?: import('@/lib/ai/history-epoch').HistoryEpochPlan['scope'];
  midoriAssetRegistry?: import('./midori/asset-registry').MidoriAssetRegistry;
  chapterState?: import('./chapters/types').ChapterState | null;
  /** Compact renderer receipts for the narrator, never character knowledge. */
  presentationContext?: ReturnType<typeof import('./presentation').presentationContext>;
  documentHeads?: import('./documents/types').DocumentRef[];
  workspaceState?: import('./workspace/types').WorkspaceFiles;
  entryContext?: import('./world-entry').WorldEntryContext | null;
  rewindMemory?: import('./rewind').RewindMemory | null;
  gameplayPluginSet?: string;
  narrativeProgress?: import('./narrative-beat').NarrativeBeat | null;
  mapState?: import("./map-state").MapState;
  worldId: string;
  currentSceneId: string;
  currentGameTime: GameTime;
  playerName: string;
  /** 当前场景叙事 */
  sceneNarrative: string;
  historyLength: number;
  discoveredSecrets: Record<string, string[]>;
  worldFlags: Record<string, boolean>;
  /** 独立数值账本；旧存档缺失时使用插件声明初值。 */
  gameplayResources?: Record<string, number>;
  gameplayModState?: import('./plugins/mod-ui').GameplayModState;
  /** Explicit projection for model transport; saved UI state is never transported wholesale. */
  gameplayContext?: import('./plugins/gameplay-state').GameplayModelContext[];
  npcStates?: Record<string, string>;
  sceneDetailLevels: Record<string, number>;
  visitedScenes: string[];
  resolvedTimelineEvents: string[];
  deviatedEvents: Record<string, string>;
  /** 完整背包（直接存，回档时原样恢复） */
  inventory: InventoryItem[];
  /** 完整线索状态 */
  clues: Clue[];
  /** 完整百科 */
  encyclopedia: EncyclopediaEntry[];
  /** 当前推荐行动 */
  availableActions: string[];
  /** 关键信息（重要发现、纸条内容等——AI 上下文需要优先记住） */
  criticalFacts: CriticalFactEntry[];
  /** 任务/待办 */
  questLog: QuestEntry[];
  /** NPC 统一存档域 */
  npcMemory?: NpcMemoryState;
  /** NPC 关系 */
  relationships?: Record<string, NPCRelationship>;
  /** NPC 行为快照（按 NPC 名称索引） */
  npcBehaviors?: Record<string, NpcBehavior>;
  /** 天气状态 */
  weather?: string;
  /** 主角战斗状态 */
  protagonistState?: ProtagonistState | null;
  /** 笔记本（世界事件记录） */
  notebookEvents?: string[];
  /** 日记 */
  diary?: DiaryEntry[];
  /** 因果推演：KEI 预测的连锁反应 */
  causalProjections?: CausalProjection[];
  /** 文学控制：上一轮 KEI 生成的导演帧（供下一轮 ALICE 使用） */
  lastDirectorFrame?: import("@/lib/ai/types").DirectorFrame | null;
  directorAdviceOrigin?: import('@/lib/ai/types').KeiReviewOrigin | null;
  directorCueCandidate?: import('./director-cues').DirectorCue | null;
  /** 人格推演：NPC 人格状态（Phase 1: 人格档案与记忆底座） */
  npcPersonalities?: Record<string, import("@/lib/personality/types").AnyPersonalityState>;
  /** 现实边界材料：玩家主动交给世界的边界材料 */
  realityArtifacts?: import("@/lib/meta-reality/types").RealityArtifact[];
  /** 现实/游戏边界事件 */
  boundaryEvents?: import("@/lib/meta-reality/types").BoundaryEvent[];
  /** 创作者声明的现实边界通道 */
  metaChannelManifest?: import("@/lib/meta-reality/types").MetaChannelManifest | null;
}
// ============================================================

export interface WorldDefinition {
  creationWarnings?: string[];
  generationProfile?: 'full' | 'quick';
  /** Immutable external sources; original bytes live in the local card asset store. */
  cardBindings?: import('./cards/types').CardBinding[];
  /** Round-one card-only input budget in characters, not model tokens. */
  cardContextMaxChars?: number;
  mapState?: import("./map-state").MapState;
  mapRoutes?: import("./map-state").MapRoute[];
  id: string;
  name: string;
  subtitle: string;
  overview: string;
  regions: Record<
    string,
    {
      id: string;
      name?: string;
      description: string;
      scenes: Record<string, Scene>;
    }
  >;
  npcs: Record<string, string>;
  /** 创建时为每个具名人物生成的稳定表达底色；范例不属于剧情历史。 */
  npcSpeechProfiles?: Record<string, import('./npc-speech').NpcSpeechProfile>;
  contradictions: {
    name: string;
    description: string;
    resolution: string;
    reflection: string;
  }[];
  history: { era: string; event: string }[];
  timeline: WorldTimelineEvent[];
  /** 世界预设线索（玩家创建世界时AI生成） */
  clues: Clue[];
  /** 随世界一起创作的可选身份；缺省兼容旧世界，空数组表示仅自定义身份。 */
  identityOptions?: IdentityOption[];
  systemPromptBase: string;
  identityPrompt: string;
  isPlayerCreated: boolean;
  createdAt: number;
  /** 历法名称（默认"裂隙历"） */
  calendarEra?: string;
  /** 用户选择的绘画风格（KEI 在世界创建时融入生图提示词） */
  artStyle?: ArtStyle;
  /** MIDORI 视觉配置（KEI 在世界创建时生成） */
  visualConfig?: VisualConfig;
  /** 游戏模式配置——Skill Prompt 注入后由 KEI 填充（自由格式 JSON） */
  gameModeConfig?: Record<string, unknown>;
  /** Validated data-only gameplay plugins, preserved in world exports and saves. */
  gameplayPlugins?: import("./plugins/types").GameplayPlugin[];
  gameplayPluginHistory?: import("./plugins/package-history").GameplayPackageHistory;
  /** 世界创建来源：普通概念创建或玩家资料建档 */
  sourceMode?: "concept" | "source_archive" | "external_cards";
  /** 玩家资料建档产物：证据、原作事实账本和可游玩改编计划 */
  sourceArchive?: import("@/lib/ai/source-archive").WorldSourceArchive;
  /** 世界级文风档案：KEI 创建期低权重参考，ALICE 运行时主要写法约束 */
  narrativeStyle?: import("@/lib/game/narrative-style").NarrativeStyleProfile;
  /** 创造模式：现实/游戏边界通道声明 */
  metaChannelManifest?: import("@/lib/meta-reality/types").MetaChannelManifest | null;
}

/** 绘画风格预设 — 针对 Pixel Art XL 优化，KEI 融入 VisualConfig */
export interface ArtStyle {
  id: string;
  label: string;
  /** 英文风格关键词，注入 basePrompt */
  keywords: string;
  /** 中文描述，给玩家看的简介 */
  description: string;
  /** 给 KEI 的详细视觉指导（中文，注入 system prompt） */
  keiGuidance: string;
}

/** 可用的绘画风格列表（针对 Pixel Art XL 优化） */
export const ART_STYLES: ArtStyle[] = [
  {
    id: "japanese-avg",
    label: "日系AVG像素",
    keywords: "Japanese visual novel adventure game background art, anime style pixel scenery, detailed environmental storytelling, warm lighting, handcrafted RPG Maker aesthetic, emotional atmosphere, clean linework",
    description: "日系冒险游戏/文字类AVG风格，细腻场景，温暖光影，情感氛围",
    keiGuidance: "日系美少女游戏/冒险游戏(AVG)风格的像素画场景。画面注重环境叙事和情感氛围，光线温暖柔和（金色/琥珀色调为主），场景细节丰富但不杂乱，构图有深度——前景/中景/远景层次分明。色彩偏向雅致不刺眼。场景要像「在这个世界里发生了故事」的感觉，而不是空荡荡的地图。避免过度鲜艳的霓虹色、避免科幻元素、避免血腥恐怖。",
  },
  {
    id: "16bit-rpg",
    label: "16-bit RPG经典",
    keywords: "16-bit RPG style, SNES-era pixel art, Chrono Trigger aesthetic, vibrant yet earthy colors, crisp sprite work, memorable townscapes, Squaresoft golden age",
    description: "超任黄金时代RPG风格，Chrono Trigger/FFVI质感，鲜艳土色调",
    keiGuidance: "经典16-bit日式RPG风格，参考SFC/SNES黄金时代（Chrono Trigger, Final Fantasy VI, 圣剑传说）。色彩鲜艳但不刺眼，以土色和自然色为底，点缀明亮高光。建筑有明确的结构感，城镇布局紧凑合理。场景中有「JRPG感」——比如钟楼、喷泉广场、屋顶烟囱、晾衣绳等生活细节。",
  },
  {
    id: "dark-fantasy",
    label: "暗黑奇幻",
    keywords: "dark fantasy pixel art, gothic architecture, muted desaturated palette, dramatic chiaroscuro lighting, Castlevania aesthetic, moody atmosphere",
    description: "暗黑奇幻，哥特建筑，低饱和，戏剧性明暗，恶魔城质感",
    keiGuidance: "暗黑奇幻风格，参考恶魔城、黑暗之魂的视觉语言。色调以深灰、暗紫、暗红、古铜为主——色彩克制，饱和度低于30%。光源来自少数几个强光源（火炬、烛台、裂隙光），形成强烈的明暗对比。建筑偏哥特——尖拱、石像鬼、铁栅栏。画面有「美丽的衰败感」。避免明亮的蓝色天空、避免活泼的色彩。",
  },
  {
    id: "cyberpunk",
    label: "赛博朋克",
    keywords: "cyberpunk pixel art, neon lights on wet streets, purple-cyan-magenta palette, chrome and steel, rain atmosphere, Blade Runner aesthetic, holographic signs",
    description: "赛博朋克，霓虹雨夜，紫青洋红色调，铬金钢铁，全息广告牌",
    keiGuidance: "赛博朋克像素风。主色调紫/青/品红霓虹灯在湿漉漉的街道上的倒影。建筑由钢铁、铬金、玻璃幕墙构成，高处有全息广告牌。地面总是湿润的——反光很重要。天空是暗紫色或漆黑的（几乎没有自然光）。人群密集，街道拥挤。氛围冷峻但充满能量。避免自然绿色植物、避免阳光、避免木质建筑。",
  },
  {
    id: "ghibli",
    label: "吉卜力风",
    keywords: "Ghibli-inspired pixel art, soft natural colors, painterly detailed backgrounds, warm sunlight through leaves, cozy lived-in spaces, lush vegetation, European townscape",
    description: "宫崎骏/吉卜力风，柔和自然色，树叶间暖阳，舒适的生活空间",
    keiGuidance: "吉卜力工作室风格的像素画。色彩柔和温暖——奶油色、鼠尾草绿、天蓝、暖灰。场景充满生活气息：晾晒的衣物、窗台上的花盆、冒着热气的茶杯、旧书店的橱窗。植被茂密但不杂乱，建筑是欧洲小镇风格（红瓦屋顶、石墙、木梁）。光线是「穿过树叶缝隙的暖阳」——柔和的斑驳光。避免冷色调主导、避免工业感、避免空旷的广场。",
  },
  {
    id: "hd2d",
    label: "HD-2D",
    keywords: "HD-2D style, tilt-shift depth of field, volumetric god rays, Octopath Traveler aesthetic, diorama perspective, rich texture detail, dramatic lighting",
    description: "八方旅人式HD-2D，移轴景深，体积光，微缩模型透视感",
    keiGuidance: "HD-2D风格（参考Octopath Traveler、Triangle Strategy）。利用移轴/微缩模型效果——前景和背景略有虚化，中景锐利。体积光（god rays）从窗户或云层射入。场景像精致的立体透视模型(diorama)。色彩丰富饱满，材质纹理清晰。每个场景都应该有「被光照亮」的焦点区域。避免平面感、避免均匀光照。",
  },
  {
    id: "post-apocalyptic",
    label: "废土求生",
    keywords: "post-apocalyptic pixel art, rust and decay, overgrown ruins, muted browns and grays, scavenger aesthetic, lonely atmosphere, Fallout-inspired",
    description: "废土风，锈蚀废墟，藤蔓覆盖的残骸，孤独的拾荒者氛围",
    keiGuidance: "后启示录废土风格。建筑是文明的残骸——锈蚀的钢结构、爬满藤蔓的混凝土、用废铁拼凑的棚屋。色调以棕色、铁锈红、暗灰、枯黄为主。天空通常是灰蒙蒙的或泛黄。场景中有明显的「过去vs现在」对比——比如废墟中开着野花、倒塌的立交桥下成了集市。避免干净整洁、避免鲜艳色彩、避免完整的建筑。",
  },
  {
    id: "ink-wash",
    label: "水墨丹青",
    keywords: "ink wash painting pixel art, sumi-e style, black ink gradients, minimal color accents, misty mountains, poetic atmosphere, ancient Chinese aesthetic",
    description: "水墨画像素风，墨色浓淡，留白意境，青绿点缀，古风诗意",
    keiGuidance: "中国水墨画风格的像素艺术。主色调是墨色（黑到浅灰的渐变），点缀少量青绿或朱砂红。大面积留白——用「空」来营造意境。山石、树木用写意笔触表现，不求写实。远山在雾中若隐若现，近景有枯枝或孤舟。画面构图遵循中国画的散点透视。避免西方三维透视感、避免过多色彩、避免过度细节堆砌。",
  },
];

// ============================================================
// MIDORI 视觉配置
// ============================================================

/** KEI 生成的视觉配置 — 控制整个世界的 AI 生图风格 */
export interface VisualConfig {
  /** 全局画风方向 */
  artDirection: {
    /** 风格关键词（英文，用于生图提示词） */
    styleKeywords: string[];
    /** 主色调（5个 HEX 色值） */
    colorPalette: string[];
    /** 整体视觉基调描述 */
    moodReference: string;
  };
  /** 每场景的基础生图提示词 */
  scenePrompts: Record<string, SceneVisualPrompt>;
  /** 地区俯视图提示词（跨区域移动时展示） */
  regionOverviews: Record<string, RegionOverviewPrompt>;
  /** NPC 外观描述（用于后续生成 NPC 立绘） */
  npcAppearances: Record<string, string>;
}

/** 地区俯视图提示词 */
export interface RegionOverviewPrompt {
  /** 俯视图生图提示词 */
  basePrompt: string;
  /** 构图描述 */
  composition: string;
  /** 该地区包含的场景 ID 列表 */
  sceneIds: string[];
}

/** 单场景的视觉提示词 */
export interface SceneVisualPrompt {
  /** 生图提示词（英文，150字以内） */
  basePrompt: string;
  /** 需要避免的元素（英文，50字以内） */
  negativePrompt: string;
  /** 构图描述（中文） */
  composition: string;
  /** 可审视的交互区域（在 960×540 画布上的坐标） */
  regions: SceneRegion[];
  /** 是否为室内场景（用于决定 negative prompt：室内禁止 sky/outdoor，室外禁止 walls/ceiling） */
  isIndoor?: boolean;
}

/** 审视交互区域 */
export interface SceneRegion {
  /** 区域唯一 ID（如 "clock_tower"） */
  id: string;
  /** 显示名称（如 "钟楼"） */
  name: string;
  /** 边界框（0-960 坐标） */
  x: number;
  y: number;
  width: number;
  height: number;
  /** 区域细节提示（中文），用于 AI 生成审视特写图 */
  examineHint: string;
}

// ============================================================
// 游戏阶段
// ============================================================

export type GamePhase = "title" | "world_select" | "world_create" | "identity" | "playing" | "world_line_view" | "inventory" | "encyclopedia" | "settings" | "intel_wall" | "diary" | "gallery" | "audio" | "documents" | "creative_settings" | "reading" | "map" | "npc_dossiers";

// ============================================================
// 日记
// ============================================================

export interface DiaryEntry {
  day: number;
  entries: string[];
  summary: string;
  createdAt: GameTime;
}

// ============================================================
// 因果推演系统
// ============================================================

/** 因果推演统计（从 causalProjections 计算得出） */
export interface CausalStats {
  totalPredictions: number;
  fulfilled: number;
  defied: number;
  expired: number;
  pending: number;
  avgConfidence: number;
}

/** 因果预测中的单个连锁反应。
 *  KEI 在 Deep Review 中推演玩家行动的长期影响，
 *  生成 RippleEffect 列表并存入世界状态。 */
export interface RippleEffect {
  id: string;
  /** 触发此连锁反应的事件描述（如"玩家救了NPC A"） */
  triggerAction: string;
  /** 预测的后果（如"A在3天后帮助了B，B因此没有买毒品"） */
  projectedOutcome: string;
  /** 置信度 0-1。高置信度=基于已知NPC性格/关系的必然推演；
   *  低置信度=存在多种可能性的推测 */
  confidence: number;
  /** 预计发生的游戏时间 */
  estimatedTime: GameTime;
  /** 涉及的 NPC 名称 */
  involvedNpcs: string[];
  /** 可能受影响的场景 ID */
  involvedScenes: string[];
  /** 当前状态 */
  status: "pending" | "fulfilled" | "defied" | "expired";
  /** 创建时间（真实时间戳） */
  createdAt: number;
  /** 状态变更时的游戏时间（fulfilled/defied/expired 时有值） */
  resolvedAt: GameTime | null;
  /** 解决说明：预测是如何实现/打破/过期的 */
  resolutionNote: string;
}

/** 一组因果预测，由一次有世界影响的玩家行动触发。
 *  存储在世界状态中，用于跨时间的因果追踪。 */
export interface CausalProjection {
  /** 触发预测的原始行动描述 */
  actionDescription: string;
  /** 推演出的连锁反应（1-5条） */
  rippleEffects: RippleEffect[];
  /** 生成时的游戏时间 */
  generatedAt: GameTime;
}

// ============================================================
// ALICE 笔记本
// ============================================================

/**
 * 主角状态效果。
 * ALICE 根据叙事逻辑添加/移除，不追踪数值。影响叙事、可用行动和 NPC 反应。
 */
export interface StatusEffect {
  /** 效果名称： "疲倦" / "轻伤" / "眩晕" / "饥饿" / "感冒" 等 */
  name: string;
  /** 强度 */
  intensity: "light" | "moderate" | "severe";
  /** 来源（可选，帮助追踪因果） */
  source?: string;
  /** 添加时的游戏时间 */
  addedAt: GameTime;
}

/**
 * 主角状态（叙事驱动——AI 根据叙事逻辑更新，不追踪数值）
 *
 * 伤害、疲劳、情绪等通过自然语言描述反映。
 */
export interface ProtagonistState {
  /** 生命体征描述："良好" / "轻伤" / "重伤" / "虚弱" 等 */
  health: string;
  /** 心情/情绪："平静" / "紧张" / "愤怒" / "悲伤" / "兴奋" 等 */
  mood: string;
  /** 当前活跃的状态效果列表 */
  statusEffects: StatusEffect[];
  /** 额外备注（AI 自由填写） */
  notes: string;
}

// ============================================================
// 备忘录
// ============================================================

// ============================================================
// 游戏设置
// ============================================================

export interface GameSettings {
  // AI provider selection — simple mode keeps setup easy, advanced mode unlocks per-role routing.
  aiProviderMode: "simple" | "advanced";
  aiGlobalProviderId: string;
  aiQualityProfile: "economy" | "balanced" | "quality";
  /** Compatibility switches for third-party and local Chat Completions servers. */
  aiCompatibleJsonMode: boolean;
  aiCompatibleStreamUsage: boolean;
  aliceProviderId: string;
  keiProviderId: string;
  uzqProviderId: string;
  aliceCompatibilityMode: "openai" | "anthropic" | "native";
  keiCompatibilityMode: "openai" | "anthropic" | "native";
  uzqCompatibilityMode: "openai" | "anthropic" | "native";
  aliceEnableReasoning: boolean;
  keiEnableReasoning: boolean;
  uzqEnableReasoning: boolean;
  /** DeepSeek shares reasoning and prose tokens; enlarge the total limit while keeping actual billing. */
  reserveReasoningBudget: boolean;
  /** 0 uses a recognized model window; custom deployments can declare their actual limit. */
  aliceContextWindowTokens: number;
  keiContextWindowTokens: number;
  uzqContextWindowTokens: number;
  aliceReasoningEffort: "low" | "medium" | "high" | "max";
  keiReasoningEffort: "low" | "medium" | "high" | "max";
  uzqReasoningEffort: "low" | "medium" | "high" | "max";
  // 模型配置 — KEI（世界管家，推荐高思考模型）
  keiEndpoint: string;
  keiApiKey: string;
  keiModel: string;
  // 模型配置 — UZQ（人格推演官，推荐高一致性模型）
  uzqEndpoint: string;
  uzqApiKey: string;
  uzqModel: string;
  /** 将 UZQ 本地人格简报作为内隐约束注入 ALICE prompt（默认关闭） */
  enableUzqAliceBrief: boolean;
  // 模型配置 — ALICE（对话推理，推荐快速模型）
  aliceEndpoint: string;
  aliceApiKey: string;
  aliceModel: string;
  temperature: number;
  maxTokens: number;
  aliceUserPrompt: string;
  contextCompressionLowerPercent: number;
  contextCompressionUpperPercent: number;
  // 显示
  fontSize: 1 | 2 | 3 | 4;
  interfaceLanguage: "zh-CN" | "en";
  narrativeLanguage: "zh-CN" | "en";
  interfaceTheme: "dark" | "light";
  interfacePalette: import("@/lib/ui/interface-palette").InterfacePalette;
  interfaceCustomColors: import("@/lib/ui/interface-palette").CustomPalette;
  reduceMotion: boolean;
  hideNarrationInDialogue: boolean;
  sceneOverlayOpacity: number;
  autoAdvance: boolean;
  autoAdvanceDelay: number;
  autoSelect: boolean;
  enableSpeculation: boolean;
  enableContentReview: boolean;
  /** 自动模式下 N 步后自动停止（0 = 不限） */
  autoStopSteps: number;
  // 游戏
  /** Minimum seconds between background recovery points; 0 disables background saves. */
  autoSaveInterval: number;
  keyboardShortcuts: import('./keyboard-shortcuts').KeyboardShortcuts;
  modPreferences: import('./plugins/preferences').ModPreferences;
}

export const DEFAULT_SETTINGS: GameSettings = {
  aiProviderMode: "simple",
  aiGlobalProviderId: "deepseek",
  aiQualityProfile: "balanced",
  aiCompatibleJsonMode: true,
  aiCompatibleStreamUsage: true,
  aliceProviderId: "deepseek",
  keiProviderId: "deepseek",
  uzqProviderId: "deepseek",
  aliceCompatibilityMode: "native",
  keiCompatibilityMode: "native",
  uzqCompatibilityMode: "native",
  aliceEnableReasoning: false,
  keiEnableReasoning: true,
  uzqEnableReasoning: true,
  reserveReasoningBudget: true,
  aliceContextWindowTokens: 0,
  keiContextWindowTokens: 0,
  uzqContextWindowTokens: 0,
  aliceReasoningEffort: "high",
  keiReasoningEffort: "high",
  uzqReasoningEffort: "high",
  keiEndpoint: "https://api.deepseek.com/v1",
  keiApiKey: "",
  keiModel: "deepseek-v4-pro",
  uzqEndpoint: "https://api.deepseek.com/v1",
  uzqApiKey: "",
  uzqModel: "deepseek-v4-pro",
  enableUzqAliceBrief: false,
  aliceEndpoint: "https://api.deepseek.com/v1",
  aliceApiKey: "",
  aliceModel: "deepseek-v4-flash",
  temperature: 0.85,
  maxTokens: 4000,
  aliceUserPrompt: "",
  contextCompressionLowerPercent: 15,
  contextCompressionUpperPercent: 35,
  fontSize: 2,
  interfaceLanguage: "zh-CN",
  narrativeLanguage: "zh-CN",
  interfaceTheme: "light",
  interfacePalette: "classic",
  interfaceCustomColors: { light: { background: "#fafafa", surface: "#ffffff", accent: "#9e0000" }, dark: { background: "#151515", surface: "#1b1b1b", accent: "#ef6363" } },
  reduceMotion: false,
  hideNarrationInDialogue: true,
  sceneOverlayOpacity: 100,
  autoAdvance: false,
  autoAdvanceDelay: 2000,
  autoSelect: false,
  enableSpeculation: true,
  enableContentReview: true,
  autoStopSteps: 0,
  autoSaveInterval: 180,
  keyboardShortcuts: { advance: 'z', previous: 'x', focusInput: 'c', status: 'a', worldline: 's', gallery: 'd' },
  modPreferences: {},
};

// ============================================================
// 创造模式
// ============================================================

export type GameMode = "narrative" | "creative";

/** 创造模式配置 — 独立于 GameSettings 的创作偏好存储 */
export interface CreativeModeConfig {
  /** 游戏模式 */
  gameMode: GameMode;
  /** 进入创造模式前的原存档 ID（用于退出时恢复） */
  originalSaveId: string | null;
  /** 创造模式副本的存档 ID */
  creativeSaveId: string | null;
  /** ALICE 期望：玩家对写作风格/剧情方向的偏好（追加到 ALICE prompt） */
  aliceExpectations: string;
  /** ALICE 温度覆写（0-2，仅创造模式生效） */
  aliceTemperature: number;
  /** KEI 期望：玩家对审核方向的偏好（追加到 KEI prompt） */
  keiExpectations: string;
  /** KEI 温度覆写（0-2，仅创造模式生效） */
  keiTemperature: number;
}

export const DEFAULT_CREATIVE_CONFIG: CreativeModeConfig = {
  gameMode: "narrative",
  originalSaveId: null,
  creativeSaveId: null,
  aliceExpectations: "",
  aliceTemperature: 0.85,
  keiExpectations: "",
  keiTemperature: 0.3,
};

// ============================================================
// NPC 行为快照系统
// ============================================================

/** NPC 行为快照 — 记录 NPC 在某一时刻的位置、活动和互动状态。
 *  不追踪全部 25 个 NPC，只在被观察/受影响时生成：
 *  - 玩家进入场景 → 默认生成（零 API 调用）
 *  - 世界事件影响 NPC → KEI Deep Review 更新
 *  - 玩家切换 POV → KEI 完整生成 */
export interface NpcBehavior {
  /** NPC 当前所在场景 ID */
  currentScene: string;
  /** 正在做什么（一句话描述，如"在吧台后面擦杯子"） */
  currentActivity: string;
  /** 情绪状态（如"平静"、"紧张"、"愤怒"、"愉快"） */
  currentMood: string;
  /** 正在和谁互动（NPC 名称列表） */
  interactingWith: string[];
  /** 上次生成/更新快照的游戏时间 */
  lastObserved: GameTime;
  /** 快照来源 */
  source: "default" | "kei_update" | "pov_generated";
}

// ============================================================
// NPC / 对话
// ============================================================

export interface NPC {
  id: string;
  name: string;
  role: string;
  region: Region;
  personality: string;
  events: string[];
  state: string;
}

// ============================================================
// NPC 关系系统
// ============================================================

/** 玩家与 NPC 的关系追踪 */
export interface NPCRelationship {
  npcName: string;
  /** 好感度 -100 ~ 100 */
  affinity: number;
  /** 信任度 0 ~ 100 */
  trust: number;
  /** 关系标签：朋友、敌人、盟友、欠债人等 */
  tags: string[];
  /** 首次相遇时间 */
  firstMet: GameTime;
  /** 最后一次互动时间 */
  lastInteraction: GameTime;
  /** AI 生成的关系概要 */
  notes: string;
}

// ============================================================
// NPC 存档域
// ============================================================

/** 玩家已知的 NPC 百科信息。NPC 知识在存档中归入 npcMemory，而不是普通百科列表。 */
export interface NpcPlayerKnowledgeSnapshot {
  entryId: string;
  description: string;
  knowledge: KnowledgeItem[];
  firstEncountered: GameTime;
  lastUpdated: GameTime;
  relatedEntries: string[];
  imageUrl?: string;
}

/** 单个 NPC 的统一存档记录。 */
export interface NpcMemoryRecord {
  name: string;
  state?: string;
  relationship?: NPCRelationship;
  behavior?: NpcBehavior;
  personality?: import("@/lib/personality/types").AnyPersonalityState;
  playerKnowledge?: NpcPlayerKnowledgeSnapshot;
}

/** 角色信息的规范化存档域。 */
export interface NpcMemoryState {
  version: "npc_memory_v1";
  records: Record<string, NpcMemoryRecord>;
}

/** AI 输出的关系变更（在 AIGameResponse 中使用） */
export interface RelationshipUpdate {
  npcName: string;
  affinityDelta?: number;
  trustDelta?: number;
  addTags?: string[];
  removeTags?: string[];
}

export type QuickCommand =
  | "对话"
  | "观察"
  | "移动"
  | "对峙"
  | "使用物品"
  | "检查背包";

export interface DialogueOption {
  id: string;
  label: string;
  action: string;
}

export interface IdentityOption {
  id: string;
  name: string;
  description: string;
  openingNarrative: string;
  startingScene: string;
}

// ============================================================
// 行动验证
// ============================================================

/** 行动合理性检查结果 */
export interface ValidityCheck {
  /** 行动是否可实现 */
  isPossible: boolean;
  /** 不可实现时的幽默反馈 */
  fantasyResponse: string | null;
  /** 不可实现的原因 */
  reason: string | null;
}

// ============================================================
// 存档系统
// ============================================================
// 周目 (Playthrough) — 一级存档
// ============================================================

/** 周目元数据 — World 下的容器，每个周目拥有一棵世界线树 */
export interface PlaythroughMeta {
  /** @deprecated Historical archive metadata only; playthroughs remain playable. */
  status?: "active" | "ended";
  endedAt?: number;
  id: string;                   // pt_{timestamp}_{random4}
  worldId: string;              // 所属世界 ID
  name: string;                 // 周目名称（自动生成或玩家命名）
  createdAt: number;            // 真实时间戳（新游戏开始时间）
  updatedAt: number;            // 最后游玩时间
  playerName: string;
  actionCount: number;          // 总行动次数
  gameTime: GameTime;           // 当前游戏内时间
  currentSceneName: string;     // 当前所在场景
  totalPlayDuration: number;    // 总游玩分钟数（近似）
  worldLineId: string;          // 关联的世界线树 ID
  /** 世界树数据大小（字节） */
  worldTreeSizeBytes?: number;
}

// ============================================================

/** 存档元数据（显示在存档列表中） */
export interface SaveSlot {
  id: string;
  /** 存档名称（自动生成或玩家命名） */
  name: string;
  /** 创建时间（真实时间戳） */
  createdAt: number;
  /** 最后更新时间 */
  updatedAt: number;
  /** 游戏时间 */
  gameTime: GameTime;
  /** 所属世界 ID（可靠关联，不受重命名影响） */
  worldId: string;
  /** 世界名称（创建存档时的快照，可能过时；以 worldId 关联为准） */
  worldName: string;
  /** 所属周目 ID */
  playthroughId: string;
  /** 玩家名称和身份 */
  playerName: string;
  /** 当前场景 */
  currentSceneName: string;
  /** 行动次数 */
  actionCount: number;
  /** 预览文本（最近几次行动的摘要） */
  preview: string;
  /** 总游玩时间（真实分钟数，近似） */
  playDuration: number;
  /** 存档类型 */
  type?: "manual" | "autosave" | "autosave_prev";
  /** 存档文件大小（字节，用于 UI 显示） */
  sizeBytes?: number;
}

/** 完整存档数据 */
export interface GameSave {
  meta: SaveSlot;
  /** 世界数据（玩家创建的世界完整保存；内置世界只保存ID） */
  world: WorldDefinition;
  /** 完整游戏状态 */
  state: SerializedGameState;
}

/** 可序列化的游戏状态（用于存档） */
export interface SerializedGameState {
  lastDirectorFrame?: WorldSnapshot['lastDirectorFrame'];
  directorAdviceOrigin?: WorldSnapshot['directorAdviceOrigin'];
  historyEpochPlan?: WorldSnapshot['historyEpochPlan'];
  playbackPosition?: import('./playback-resume').PlaybackPosition | null;
  readingView?: import('./reader-session').ReadingView | null;
  documentHeads?: import('./documents/types').DocumentRef[];
  workspaceState?: import('./workspace/types').WorkspaceFiles;
  entryContext?: import('./world-entry').WorldEntryContext | null;
  rewindMemory?: import('./rewind').RewindMemory | null;
  worldLineNodeId?: string;
  mapState?: import("./map-state").MapState;
  gameTime: GameTime;
  playerName: string;
  currentSceneId: string;
  sceneNarrative: string;
  history: ActionRecord[];
  availableActions: string[];
  sceneDetailLevels: Record<string, number>;
  discoveredSecrets: Record<string, string[]>;
  worldFlags: Record<string, boolean>;
  /** 独立数值账本；旧存档缺失时使用插件声明初值。 */
  gameplayResources?: Record<string, number>;
  chapterState?: import('./chapters/types').ChapterState | null;
  narrativeProgress?: import('./narrative-beat').NarrativeBeat | null;
  gameplayPluginSet?: string;
  gameplayModState?: import('./plugins/mod-ui').GameplayModState;
  npcStates?: Record<string, string>;
  resolvedTimelineEvents: string[];
  deviatedEvents: Record<string, string>;
  visitedScenes: string[];
  /** 背包 */
  inventory: InventoryItem[];
  /** 线索 */
  clues: Clue[];
  /** 百科全书 */
  encyclopedia: EncyclopediaEntry[];
  /** 关键信息 */
  criticalFacts: string[];
  /** 任务/待办 */
  questLog: QuestEntry[];
  /** NPC 统一存档域 */
  npcMemory: NpcMemoryState;
  /** NPC 关系 */
  relationships?: Record<string, NPCRelationship>;
  /** NPC 行为快照 */
  npcBehaviors?: Record<string, NpcBehavior>;
  /** 天气 */
  weather: Weather;
  /** 主人公状态 */
  protagonistState: ProtagonistState;
  /** 日记 */
  diary: DiaryEntry[];
  /** ALICE 笔记本事件 */
  notebookEvents: string[];
  /** 因果推演 */
  causalProjections: CausalProjection[];
  /** 沙箱工具审计（仅沙箱卷宗使用） */
  sandboxToolAudit?: Array<{
    id: string;
    dossierId: string;
    npcId: string;
    toolId: string;
    leaseId: string | null;
    requestedPaths: string[];
    approvedPaths: string[];
    riskLevel: string;
    preSnapshotId?: string;
    beforeSummary: string;
    afterSummary: string;
    result: "success" | "denied" | "failed";
    error?: string;
    evidenceRefs: string[];
    createdAt: number;
  }>;
  /** 沙箱存档标记（仅沙箱卷宗使用） */
  sandboxSaveMarks?: Array<{ text: string; by: string; at: number }>;
  /** 沙箱行动锁（仅沙箱卷宗使用） */
  sandboxActionLock?: { by: string; reason: string; at: number } | null;
  /** 现实边界材料：玩家主动交给世界的边界材料 */
  realityArtifacts?: import("@/lib/meta-reality/types").RealityArtifact[];
  /** 现实/游戏边界事件 */
  boundaryEvents?: import("@/lib/meta-reality/types").BoundaryEvent[];
  /** 创作者声明的现实边界通道 */
  metaChannelManifest?: import("@/lib/meta-reality/types").MetaChannelManifest | null;
  /** MIDORI 图像引擎设置 */
  midoriSettings?: { enabled: boolean; model: string; pixelate?: boolean; autoGenerate: boolean };
  /** MIDORI 图像资产绑定：场景/人物/物品当前使用哪张图 */
  midoriAssetRegistry?: import("@/lib/game/midori/asset-registry").MidoriAssetRegistry;
  /** 可随存档迁移的对话音频，无服务凭据。 */
  voiceAssets?: Record<string, import("./momoi/model").VoiceAsset>;
  /** Internal shared-pool reference; storage hydration supplies voiceAssets for export/load. */
  voiceResourceScope?: string;
  /** MOMOI 语音引擎设置 */
  momoiVoiceSettings?: {
    config?: import("./momoi/model").VoiceConfig;
    enabled: boolean;
    autoPlay: boolean;
    volume: number;
    speed: number;
    defaultVoiceProfileId: string | null;
    defaultVoiceEnabled: boolean;
    /** 全局音色档案 */
    voiceProfiles?: Array<{
      id: string;
      name: string;
      description: string;
      referenceAudio: string | null;
      referenceDuration: number | null;
      createdAt: number;
      tags: string[];
    }>;
    /** NPC → 音色绑定 */
    npcVoiceMap?: Record<string, string>;
  };
  /** 人格推演：NPC 人格状态（Phase 1） */
  npcPersonalities?: Record<string, import("@/lib/personality/types").AnyPersonalityState>;
}

// ============================================================
// API 请求/响应
// ============================================================

export interface WorldCreateRequest {
  concept: string;
  narrativeStyle?: import("@/lib/game/narrative-style").NarrativeStyleProfile;
}

export interface WorldCreateResponse {
  world: WorldDefinition;
}
