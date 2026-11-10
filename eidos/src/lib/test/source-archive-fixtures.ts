// ============================================================
// Eidos · 资料建档测试夹具
// ============================================================
// 提供可复用的 SourceCorpus / EvidenceAtom / CanonLedger 构造器，
// 覆盖短/中/长资料、冲突证据、低信心证据等场景。
// 用于 route 测试、组件测试和 world generator 测试。

import type {
  SourceCorpus,
  SourceDocument,
  EvidenceAtom,
  CanonLedger,
  CanonEntity,
  CanonEvent,
  CanonUnknown,
  CanonRule,
  CanonRelationship,
  CanonContradiction,
  AdaptationPlan,
  UzqCreationSeed,
} from "@/lib/ai/source-archive";

// ============================================================
// 工具函数
// ============================================================

let _seq = 0;
function seq(prefix: string): string {
  return `${prefix}_${String(++_seq).padStart(3, "0")}`;
}

function resetSeq(): void {
  _seq = 0;
}

function now(): number {
  return 1719500000000;
}

// ============================================================
// 场景 A：极短资料（低证据、边缘情况）
// ============================================================

export function buildTinyCorpus(): SourceCorpus {
  resetSeq();
  return {
    id: seq("corpus"),
    language: "zh-CN",
    createdAt: now(),
    documents: [
      {
        id: seq("src"),
        title: "一句话设定",
        kind: "pasted_text",
        content: "这座城市建立在裂隙边缘。居民称裂隙为「遗忘之口」。",
        createdAt: now(),
      },
    ],
  };
}

export function buildTinyEvidence(): EvidenceAtom[] {
  return [
    {
      id: seq("ev"),
      sourceId: "src_001",
      category: "place",
      claim: "城市建立在裂隙边缘",
      entities: ["城市", "裂隙"],
      confidence: 90,
      sourceSpan: { start: 0, end: 12, excerpt: "这座城市建立在裂隙边缘。" },
    },
    {
      id: seq("ev"),
      sourceId: "src_001",
      category: "world_rule",
      claim: "居民称裂隙为「遗忘之口」",
      entities: ["居民", "裂隙", "遗忘之口"],
      confidence: 85,
      sourceSpan: { start: 13, end: 31, excerpt: "居民称裂隙为「遗忘之口」。" },
    },
    {
      id: seq("ev"),
      sourceId: "src_001",
      category: "unknown",
      claim: "裂隙的来源未知",
      entities: ["裂隙"],
      confidence: 30,
    },
  ];
}

export function buildTinyLedger(): CanonLedger {
  return {
    id: seq("ledger"),
    title: "遗忘之口城市档案",
    summary: "一座建立在裂隙边缘的城市。居民称裂隙为「遗忘之口」，但裂隙的来源不明。",
    entities: [
      {
        id: seq("ent"),
        name: "城市",
        type: "place",
        description: "建立在裂隙边缘的无名城市。",
        status: "source_confirmed",
        evidenceRefs: ["ev_001"],
      },
      {
        id: seq("ent"),
        name: "裂隙",
        type: "concept",
        description: "被称为「遗忘之口」的异常现象。来源不明。",
        status: "source_confirmed",
        evidenceRefs: ["ev_001", "ev_002"],
      },
    ],
    relationships: [],
    events: [],
    worldRules: [
      {
        id: seq("rule"),
        title: "裂隙的称呼",
        description: "居民称裂隙为「遗忘之口」。",
        status: "source_confirmed",
        evidenceRefs: ["ev_002"],
      },
    ],
    unresolvedQuestions: [
      {
        id: seq("unk"),
        question: "裂隙从何而来？",
        relatedEntities: ["裂隙"],
        evidenceRefs: ["ev_003"],
      },
    ],
    contradictions: [],
    sourceCoverage: {
      documentCount: 1,
      evidenceCount: 3,
      highConfidenceCount: 2,
    },
  };
}

// ============================================================
// 场景 B：中等资料（多人物、多地点、丰富关系）
// ============================================================

export function buildMediumCorpus(): SourceCorpus {
  resetSeq();
  const documents: SourceDocument[] = [
    {
      id: seq("src"),
      title: "裂隙观测局日常",
      kind: "pasted_text",
      content: [
        "裂隙观测局位于城市中心，负责记录裂隙的波动模式。",
        "观测员埃琳娜在裂隙中发现了一个不在未来预言里的身影——一个少年的轮廓。",
        "这个发现动摇了观测局百年来的信条：裂隙只能揭示过去，不能预测未来。",
        "",
        "前观测员特雷弗三年前被逐出观测局，因为他声称裂隙里「有人在看回来」。",
        "现在他在旧城区的地下市场贩卖假观测数据维生。",
        "",
        "观测局局长卡兰德拒绝讨论埃琳娜的发现，下令封存记录。",
        "但私下里，卡兰德在自己的密室里反复重播那段裂隙影像。",
      ].join("\n"),
      createdAt: now(),
    },
    {
      id: seq("src"),
      title: "玩家笔记",
      kind: "player_note",
      content: [
        "我想探索一个建立在预言体制上的社会。观测局是核心权力机构。",
        "裂隙不仅是一种超自然现象，也是社会秩序的基石。",
        "观测员发现异常 → 体制压制 → 个人反抗 → 社会变革。",
      ].join("\n"),
      createdAt: now(),
    },
  ];
  return {
    id: seq("corpus"),
    language: "zh-CN",
    createdAt: now(),
    documents,
  };
}

export function buildMediumEvidence(): EvidenceAtom[] {
  return [
    {
      id: seq("ev"),
      sourceId: "src_001",
      category: "organization",
      claim: "裂隙观测局负责记录裂隙波动",
      entities: ["裂隙观测局", "裂隙"],
      confidence: 95,
      sourceSpan: { start: 0, end: 21, excerpt: "裂隙观测局位于城市中心，负责记录裂隙的波动模式。" },
    },
    {
      id: seq("ev"),
      sourceId: "src_001",
      category: "character",
      claim: "观测员埃琳娜在裂隙中发现了一个少年轮廓",
      entities: ["观测员埃琳娜", "裂隙", "少年"],
      confidence: 90,
      sourceSpan: { start: 22, end: 47, excerpt: "观测员埃琳娜在裂隙中发现了一个不在未来预言里的身影" },
    },
    {
      id: seq("ev"),
      sourceId: "src_001",
      category: "world_rule",
      claim: "观测局的信条：裂隙只能揭示过去，不能预测未来",
      entities: ["裂隙观测局", "裂隙"],
      confidence: 80,
    },
    {
      id: seq("ev"),
      sourceId: "src_001",
      category: "character",
      claim: "前观测员特雷弗因声称裂隙里「有人在看回来」被逐出观测局",
      entities: ["前观测员特雷弗", "裂隙观测局", "裂隙"],
      confidence: 85,
    },
    {
      id: seq("ev"),
      sourceId: "src_001",
      category: "place",
      claim: "特雷弗在旧城区地下市场贩卖假观测数据",
      entities: ["前观测员特雷弗", "旧城区"],
      confidence: 80,
    },
    {
      id: seq("ev"),
      sourceId: "src_001",
      category: "character",
      claim: "观测局局长卡兰德下令封存埃琳娜的发现记录",
      entities: ["观测局局长卡兰德", "观测员埃琳娜", "裂隙观测局"],
      confidence: 90,
    },
    {
      id: seq("ev"),
      sourceId: "src_001",
      category: "event",
      claim: "卡兰德私下反复重播被封存的裂隙影像",
      entities: ["观测局局长卡兰德", "裂隙"],
      confidence: 70,
    },
    {
      id: seq("ev"),
      sourceId: "src_002",
      category: "theme",
      claim: "预言体制下的社会：观测局是核心权力机构",
      entities: ["裂隙观测局"],
      confidence: 60,
    },
    {
      id: seq("ev"),
      sourceId: "src_002",
      category: "theme",
      claim: "裂隙是社会秩序的基石",
      entities: ["裂隙"],
      confidence: 60,
    },
    {
      id: seq("ev"),
      sourceId: "src_002",
      category: "event",
      claim: "叙事方向：观测员发现异常 → 体制压制 → 个人反抗 → 社会变革",
      entities: ["观测员埃琳娜", "裂隙观测局"],
      confidence: 50,
    },
  ];
}

export function buildMediumLedger(): CanonLedger {
  return {
    id: seq("ledger"),
    title: "裂隙之城档案",
    summary: "裂隙观测局统治下的城市。观测员埃琳娜发现裂隙异常后被体制压制，前观测员特雷弗被驱逐后在旧城区流浪，局长卡兰德表面封存记录实则私下研究。",
    entities: [
      {
        id: seq("ent"),
        name: "观测员埃琳娜",
        type: "character",
        description: "裂隙观测局中级观测员。在裂隙中发现异常影像后与体制产生冲突。",
        status: "source_confirmed",
        evidenceRefs: ["ev_002", "ev_006"],
      },
      {
        id: seq("ent"),
        name: "前观测员特雷弗",
        type: "character",
        description: "三年前因异端言论被逐出观测局，现于旧城区地下市场贩卖假观测数据。",
        status: "source_confirmed",
        evidenceRefs: ["ev_004", "ev_005"],
      },
      {
        id: seq("ent"),
        name: "观测局局长卡兰德",
        type: "character",
        description: "观测局最高负责人。公开否认埃琳娜的发现，私下研究被封存的影像。",
        status: "source_confirmed",
        evidenceRefs: ["ev_006", "ev_007"],
      },
      {
        id: seq("ent"),
        name: "裂隙观测局",
        type: "organization",
        description: "城市核心权力机构，垄断裂隙观测与预言发布权。",
        status: "source_confirmed",
        evidenceRefs: ["ev_001", "ev_003"],
      },
      {
        id: seq("ent"),
        name: "旧城区",
        type: "place",
        description: "城市边缘区域，地下市场活跃。",
        status: "source_confirmed",
        evidenceRefs: ["ev_005"],
      },
      {
        id: seq("ent"),
        name: "裂隙",
        type: "concept",
        description: "城市周围出现的超自然现象，可揭示过去片段。社会秩序基石。",
        status: "source_confirmed",
        evidenceRefs: ["ev_001", "ev_003", "ev_009"],
      },
      {
        id: seq("ent"),
        name: "少年",
        type: "character",
        description: "埃琳娜在裂隙影像中发现的神秘身影。不在未来预言中。",
        status: "inferred",
        evidenceRefs: ["ev_002"],
      },
    ],
    relationships: [
      {
        id: seq("rel"),
        from: "观测员埃琳娜",
        to: "裂隙观测局",
        type: "隶属",
        description: "埃琳娜是观测局的中级观测员。",
        status: "source_confirmed",
        evidenceRefs: ["ev_002"],
      },
      {
        id: seq("rel"),
        from: "观测局局长卡兰德",
        to: "观测员埃琳娜",
        type: "压制",
        description: "卡兰德下令封存埃琳娜的发现。",
        status: "source_confirmed",
        evidenceRefs: ["ev_006"],
      },
      {
        id: seq("rel"),
        from: "前观测员特雷弗",
        to: "裂隙观测局",
        type: "被驱逐",
        description: "特雷弗被观测局驱逐。",
        status: "source_confirmed",
        evidenceRefs: ["ev_004"],
      },
      {
        id: seq("rel"),
        from: "观测员埃琳娜",
        to: "少年",
        type: "发现",
        description: "埃琳娜在裂隙影像中发现少年。",
        status: "inferred",
        evidenceRefs: ["ev_002"],
      },
    ],
    events: [
      {
        id: seq("evt"),
        title: "埃琳娜发现裂隙异常",
        description: "观测员埃琳娜在裂隙中发现一个不在未来预言里的少年轮廓。",
        order: 1,
        status: "source_confirmed",
        evidenceRefs: ["ev_002"],
        involvedEntities: ["观测员埃琳娜", "裂隙", "少年"],
      },
      {
        id: seq("evt"),
        title: "特雷弗被驱逐",
        description: "三年前，特雷弗因声称裂隙「有人在看回来」被逐出观测局。",
        order: 0,
        status: "source_confirmed",
        evidenceRefs: ["ev_004"],
        involvedEntities: ["前观测员特雷弗", "裂隙观测局"],
      },
      {
        id: seq("evt"),
        title: "卡兰德封存记录",
        description: "卡兰德下令封存埃琳娜的发现记录，但私下反复重播影像。",
        order: 2,
        status: "source_confirmed",
        evidenceRefs: ["ev_006", "ev_007"],
        involvedEntities: ["观测局局长卡兰德", "观测员埃琳娜"],
      },
    ],
    worldRules: [
      {
        id: seq("rule"),
        title: "裂隙揭示过去",
        description: "裂隙能揭示过去片段。观测局信条：裂隙只能揭示过去，不能预测未来。",
        status: "source_confirmed",
        evidenceRefs: ["ev_003"],
      },
      {
        id: seq("rule"),
        title: "观测局预言垄断",
        description: "裂隙观测局垄断裂隙观测与预言发布权。",
        status: "inferred",
        evidenceRefs: ["ev_008"],
      },
    ],
    unresolvedQuestions: [
      {
        id: seq("unk"),
        question: "少年是谁？为什么不在未来预言里？",
        relatedEntities: ["少年", "裂隙"],
        evidenceRefs: ["ev_002"],
      },
      {
        id: seq("unk"),
        question: "裂隙到底是什么？如何使用？",
        relatedEntities: ["裂隙"],
        evidenceRefs: [],
      },
      {
        id: seq("unk"),
        question: "卡兰德私下研究发现了什么？",
        relatedEntities: ["观测局局长卡兰德", "裂隙"],
        evidenceRefs: ["ev_007"],
      },
    ],
    contradictions: [],
    sourceCoverage: {
      documentCount: 2,
      evidenceCount: 10,
      highConfidenceCount: 7,
    },
  };
}

// ============================================================
// 场景 C：长资料（大量 entity、高密度证据）
// ============================================================

export function buildLargeCorpus(): SourceCorpus {
  resetSeq();
  const docs: SourceDocument[] = [];
  for (let i = 1; i <= 5; i++) {
    docs.push({
      id: seq("src"),
      title: `长篇设定 第${i}章`,
      kind: "pasted_text",
      content: buildChapterContent(i),
      createdAt: now(),
    });
  }
  return {
    id: seq("corpus"),
    language: "zh-CN",
    createdAt: now(),
    documents: docs,
  };
}

function buildChapterContent(chapter: number): string {
  const templates: Record<number, string> = {
    1: [
      "# 源起纪元\n",
      "世界的边缘有一道绵延千里的裂隙，学者称其为「世界之痕」。",
      "裂隙释放的能量塑造了大陆的地理格局，也催生了名为「痕民」的特殊族群。",
      "痕民天生能感知裂隙波动，因此成为各大王国争相招募的对象。",
      "",
      "中央王国设立「观测院」，负责培养痕民、解读裂隙预言。",
      "观测院分为三派：原教派认为裂隙是神罚，实证派主张科学观测，调和派试图两全。",
      "",
      "主角「青」是一名刚觉醒的痕民，被观测院强制征召。",
    ].join("\n"),
    2: [
      "# 三派角逐\n",
      "原教派领袖「太祝」认为每一次裂隙波动都是神的旨意，观测院不得干预。",
      "实证派领袖「首测官·衡」建立了「裂隙波动量化体系」，试图用数学预测裂隙。",
      "调和派由「副院长·涟」领导，她认为裂隙既是自然现象也是精神象征。",
      "",
      "青在入学测试中展现出罕见的「双向感应」能力——既能接收裂隙信号，也能反向发送。",
      "这个能力让三派都视青为关键筹码。",
      "",
      "青在训练中结识了三名同伴：沉默寡言的痕民「墨」、热情冲动的贵族子弟「焰」、",
      "以及来自边疆部落的「霜」。四人结成秘密学习小组。",
    ].join("\n"),
    3: [
      "# 裂隙深处\n",
      "观测院组织了一次深度探测，试图进入裂隙内部。",
      "探测队由实证派主导，青被选为「感应锚点」——负责在裂隙内部维持与外界的联系。",
      "墨作为技术支持，焰负责安保，霜因出身边疆部落而熟知裂隙周边的生存法则。",
      "",
      "在裂隙内部，青感知到了一个不可思议的存在：一个正在沉睡的巨型意识体。",
      "意识体的表层浮现出无数的记忆碎片——有过去的人类战争、有尚未发生的未来事件、",
      "还有一些完全不属于这个世界的画面。",
      "",
      "探测队返回后，实证派立即封锁了数据，原教派要求将探测定性为「神域接触」，",
      "调和派则试图促成两派会谈。",
      "",
      "青私下找到墨，两人开始偷偷分析探测数据。他们发现意识体正在苏醒，",
      "而每一次裂隙波动都是在传递苏醒的信号。",
    ].join("\n"),
    4: [
      "# 体制裂痕\n",
      "青和墨的秘密调查被太祝察觉。太祝宣称青已被裂隙「污染」，要求进行「净化仪式」。",
      "净化仪式实为永久剥夺痕民感应能力的酷刑。",
      "",
      "焰利用家族势力阻止了仪式的执行，但代价是焰被家族除名。",
      "霜暗中联络边疆部落，准备在关键时刻为青提供庇护。",
      "",
      "副院长涟私下找到青，透露了一个秘密：首测官衡的裂隙量子模型预测，",
      "裂隙意识体将在三个月内完全苏醒，届时将引发毁灭性地震，摧毁整片大陆。",
      "衡之所以封锁数据，是因为他认为「提前公布只会引发恐慌，人类需要冷静计算存活概率」。",
      "",
      "涟说：「现在只有你能进入裂隙，在它完全苏醒前与它沟通。这是观测院的请求——",
      "或者应该说，是我个人对你的请求。」",
    ].join("\n"),
    5: [
      "# 抉择\n",
      "青面临三个选择：接受原教派的净化，回到正常生活；信任衡的计算模型，等待概率判定；",
      "进入裂隙深处，尝试与意识体沟通。",
      "",
      "墨向青坦白自己的过去：墨的母亲曾是一名观测员，因为在裂隙中「看到了不该看的东西」",
      "而被净化仪式剥夺了感应能力，现已成为一个对外界毫无反应的「空壳」。",
      "墨说：「我不相信你也会变成那样。」",
      "",
      "焰带着青的资料去了王都，试图说服王室介入。但王室的回复冰冷：",
      "「观测院内部事务，王室不宜干预。」焰被软禁在王都。",
      "",
      "霜带领青从观测院密道逃出，前往边疆部落。在部落中，一位老痕民告诉青：",
      "「裂隙意识体不是敌人。它只是在寻找一个能理解它的人。过去一百年，",
      "无数痕民进入裂隙，但没有人像你这样双向感知。也许你才是它等的那个人。」",
      "",
      "最终，青站在裂隙入口，面对未知的命运。",
    ].join("\n"),
  };
  return templates[chapter] ?? `第${chapter}章内容。`;
}

export function buildLargeEvidence(count = 60): EvidenceAtom[] {
  const categories: EvidenceAtom["category"][] = [
    "character", "place", "organization", "event", "relationship",
    "world_rule", "object", "theme", "unknown",
  ];
  const evidence: EvidenceAtom[] = [];
  for (let i = 0; i < count; i++) {
    evidence.push({
      id: `ev_${String(i + 1).padStart(3, "0")}`,
      sourceId: `src_00${1 + (i % 5)}`,
      category: categories[i % categories.length],
      claim: `证据 ${i + 1}：关于世界的第 ${i + 1} 条描述`,
      entities: [`实体${i + 1}A`, `实体${i + 1}B`],
      confidence: 50 + Math.floor(Math.random() * 45),
    });
  }
  return evidence;
}

export function buildLargeLedger(): CanonLedger {
  return {
    id: "ledger_large",
    title: "世界之痕·长篇档案",
    summary: "中央王国设立观测院管理痕民与裂隙预言。三派角逐下，主角青发现裂隙深处的沉睡意识体。",
    entities: [
      { id: "ent_001", name: "青", type: "character", description: "主角，拥有双向感应能力的痕民。", status: "source_confirmed", evidenceRefs: ["ev_001"] },
      { id: "ent_002", name: "墨", type: "character", description: "青的同伴，沉默寡言的技术痕民。", status: "source_confirmed", evidenceRefs: ["ev_002"] },
      { id: "ent_003", name: "焰", type: "character", description: "贵族子弟，热情的战士。", status: "source_confirmed", evidenceRefs: ["ev_003"] },
      { id: "ent_004", name: "霜", type: "character", description: "边疆部落出身，冷静的行动者。", status: "source_confirmed", evidenceRefs: ["ev_004"] },
      { id: "ent_005", name: "太祝", type: "character", description: "原教派领袖。", status: "source_confirmed", evidenceRefs: ["ev_005"] },
      { id: "ent_006", name: "首测官·衡", type: "character", description: "实证派领袖。", status: "source_confirmed", evidenceRefs: ["ev_006"] },
      { id: "ent_007", name: "副院长·涟", type: "character", description: "调和派领袖。", status: "source_confirmed", evidenceRefs: ["ev_007"] },
      { id: "ent_008", name: "观测院", type: "organization", description: "中央王国设立的痕民管理机构。", status: "source_confirmed", evidenceRefs: ["ev_008"] },
      { id: "ent_009", name: "裂隙意识体", type: "concept", description: "沉睡在裂隙深处的巨型意识。", status: "source_confirmed", evidenceRefs: ["ev_009"] },
      { id: "ent_010", name: "世界之痕", type: "place", description: "绵延千里的裂隙。", status: "source_confirmed", evidenceRefs: ["ev_010"] },
    ],
    relationships: [
      { id: "rel_001", from: "青", to: "观测院", type: "强制征召", description: "", status: "source_confirmed", evidenceRefs: [] },
      { id: "rel_002", from: "青", to: "墨", type: "秘密同盟", description: "", status: "inferred", evidenceRefs: [] },
      { id: "rel_003", from: "首测官·衡", to: "副院长·涟", type: "竞争", description: "", status: "inferred", evidenceRefs: [] },
    ],
    events: [
      { id: "evt_001", title: "青觉醒双向感应", description: "青展现出罕见的双向感应能力。", order: 1, status: "source_confirmed", evidenceRefs: ["ev_001"], involvedEntities: ["青"] },
      { id: "evt_002", title: "深度探测行动", description: "观测院组织进入裂隙内部探测。", order: 2, status: "source_confirmed", evidenceRefs: ["ev_009"], involvedEntities: ["青", "墨", "焰", "霜"] },
      { id: "evt_003", title: "太祝发起净化", description: "太祝称青被裂隙污染。", order: 3, status: "source_confirmed", evidenceRefs: ["ev_005"], involvedEntities: ["太祝", "青"] },
      { id: "evt_004", title: "焰被软禁", description: "焰被王室软禁。", order: 4, status: "source_confirmed", evidenceRefs: ["ev_003"], involvedEntities: ["焰"] },
      { id: "evt_005", title: "青选择进入裂隙", description: "青站在裂隙入口。", order: 5, status: "generated_bridge", evidenceRefs: [], involvedEntities: ["青"] },
    ],
    worldRules: [
      { id: "rule_001", title: "痕民感应", description: "痕民天生可感知裂隙波动。", status: "source_confirmed", evidenceRefs: ["ev_001"] },
      { id: "rule_002", title: "双向感应", description: "罕见痕民可同时接收和发送裂隙信号。", status: "source_confirmed", evidenceRefs: ["ev_001"] },
      { id: "rule_003", title: "净化仪式", description: "永久剥夺痕民感应能力的酷刑。", status: "source_confirmed", evidenceRefs: ["ev_005"] },
      { id: "rule_004", title: "三派体系", description: "观测院分为原教派、实证派、调和派。", status: "source_confirmed", evidenceRefs: ["ev_008"] },
    ],
    unresolvedQuestions: [
      { id: "unk_001", question: "裂隙意识体为何沉睡？", relatedEntities: ["裂隙意识体"], evidenceRefs: ["ev_009"] },
      { id: "unk_002", question: "过去进入裂隙的痕民发生了什么？", relatedEntities: ["观测院"], evidenceRefs: [] },
      { id: "unk_003", question: "王室的真正立场是什么？", relatedEntities: ["焰"], evidenceRefs: [] },
      { id: "unk_004", question: "意识体苏醒后会发生什么？", relatedEntities: ["裂隙意识体"], evidenceRefs: ["ev_009"] },
    ],
    contradictions: [],
    sourceCoverage: {
      documentCount: 5,
      evidenceCount: 60,
      highConfidenceCount: 48,
    },
  };
}

// ============================================================
// 场景 D：冲突资料（同一实体存在矛盾描述）
// ============================================================

export function buildConflictingEvidence(): EvidenceAtom[] {
  return [
    {
      id: "ev_conf_001",
      sourceId: "src_001",
      category: "character",
      claim: "观测局长卡兰德是一位正直的改革者",
      entities: ["观测局局长卡兰德"],
      confidence: 80,
    },
    {
      id: "ev_conf_002",
      sourceId: "src_002",
      category: "character",
      claim: "观测局长卡兰德收受贿赂压制异见",
      entities: ["观测局局长卡兰德"],
      confidence: 75,
    },
    {
      id: "ev_conf_003",
      sourceId: "src_001",
      category: "event",
      claim: "裂隙在三年前首次出现",
      entities: ["裂隙"],
      confidence: 90,
    },
    {
      id: "ev_conf_004",
      sourceId: "src_003",
      category: "event",
      claim: "裂隙在一百年前就已经存在",
      entities: ["裂隙"],
      confidence: 60,
    },
    {
      id: "ev_conf_005",
      sourceId: "src_002",
      category: "world_rule",
      claim: "只有观测员才能看到裂隙",
      entities: ["裂隙", "观测员"],
      confidence: 50,
    },
    {
      id: "ev_conf_006",
      sourceId: "src_001",
      category: "world_rule",
      claim: "所有市民都能看到裂隙",
      entities: ["裂隙", "市民"],
      confidence: 88,
    },
    {
      id: "ev_conf_007",
      sourceId: "src_003",
      category: "relationship",
      claim: "埃琳娜和特雷弗曾是恋人",
      entities: ["观测员埃琳娜", "前观测员特雷弗"],
      confidence: 40,
    },
    {
      id: "ev_conf_008",
      sourceId: "src_002",
      category: "relationship",
      claim: "埃琳娜和特雷弗从未见过面",
      entities: ["观测员埃琳娜", "前观测员特雷弗"],
      confidence: 45,
    },
  ];
}

export function buildConflictingLedger(): CanonLedger {
  return {
    id: "ledger_conflict",
    title: "裂隙之城·冲突档案",
    summary: "关于裂隙和关键人物存在相互矛盾的证据。",
    entities: [
      {
        id: "ent_c_001",
        name: "观测局局长卡兰德",
        type: "character",
        description: "观测局长。证据矛盾：一方描述为改革者，另一方描述为腐败者。",
        status: "contradiction",
        evidenceRefs: ["ev_conf_001", "ev_conf_002"],
      },
      {
        id: "ent_c_002",
        name: "裂隙",
        type: "concept",
        description: "出现时间存在矛盾证据：3年 vs 100年。",
        status: "contradiction",
        evidenceRefs: ["ev_conf_003", "ev_conf_004"],
      },
      {
        id: "ent_c_003",
        name: "观测员埃琳娜",
        type: "character",
        description: "观测员。与特雷弗的关系存在矛盾证据。",
        status: "source_confirmed",
        evidenceRefs: [],
      },
      {
        id: "ent_c_004",
        name: "前观测员特雷弗",
        type: "character",
        description: "前观测员。与埃琳娜的关系不明。",
        status: "source_confirmed",
        evidenceRefs: [],
      },
    ],
    relationships: [
      {
        id: "rel_c_001",
        from: "观测员埃琳娜",
        to: "前观测员特雷弗",
        type: "未知关系",
        description: "证据矛盾：一种说法是恋人，另一种说法是陌生人。",
        status: "contradiction",
        evidenceRefs: ["ev_conf_007", "ev_conf_008"],
      },
    ],
    events: [],
    worldRules: [
      {
        id: "rule_c_001",
        title: "裂隙可见性矛盾",
        description: "证据矛盾：仅观测员可见 vs 所有市民可见。",
        status: "contradiction",
        evidenceRefs: ["ev_conf_005", "ev_conf_006"],
      },
    ],
    unresolvedQuestions: [
      {
        id: "unk_c_001",
        question: "卡兰德到底是改革者还是腐败者？",
        relatedEntities: ["观测局局长卡兰德"],
        evidenceRefs: ["ev_conf_001", "ev_conf_002"],
      },
      {
        id: "unk_c_002",
        question: "裂隙到底存在了多久？",
        relatedEntities: ["裂隙"],
        evidenceRefs: ["ev_conf_003", "ev_conf_004"],
      },
    ],
    contradictions: [
      {
        id: "ctr_001",
        description: "卡兰德的人设矛盾：改革者 vs 腐败压制者",
        conflictingEvidenceRefs: ["ev_conf_001", "ev_conf_002"],
        resolution: "player_decision_required",
      },
      {
        id: "ctr_002",
        description: "裂隙出现时间矛盾：3年 vs 100年",
        conflictingEvidenceRefs: ["ev_conf_003", "ev_conf_004"],
        resolution: "prefer_high_confidence",
      },
      {
        id: "ctr_003",
        description: "裂隙可见性矛盾：仅观测员 vs 所有人",
        conflictingEvidenceRefs: ["ev_conf_005", "ev_conf_006"],
        resolution: "unresolved",
      },
    ],
    sourceCoverage: {
      documentCount: 3,
      evidenceCount: 8,
      highConfidenceCount: 2,
    },
  };
}

// ============================================================
// 场景 E：低证据资料（几乎无法建档的边缘情况）
// ============================================================

export function buildLowEvidenceCorpus(): SourceCorpus {
  resetSeq();
  return {
    id: seq("corpus"),
    language: "zh-CN",
    createdAt: now(),
    documents: [
      {
        id: seq("src"),
        title: "模糊笔记",
        kind: "player_note",
        content: [
          "某个世界。有雾。有人。",
          "可能有一个城市，也可能是一个幻觉。",
          "雾里有东西在动，但看不清楚。",
        ].join("\n"),
        createdAt: now(),
      },
    ],
  };
}

export function buildLowEvidenceEvidence(): EvidenceAtom[] {
  return [
    {
      id: "ev_low_001",
      sourceId: "src_001",
      category: "place",
      claim: "存在一个城市（或幻觉）",
      entities: ["城市"],
      confidence: 30,
    },
    {
      id: "ev_low_002",
      sourceId: "src_001",
      category: "unknown",
      claim: "雾里有不明实体在移动",
      entities: ["雾", "实体"],
      confidence: 25,
    },
    {
      id: "ev_low_003",
      sourceId: "src_001",
      category: "unknown",
      claim: "世界的真实性与否不确定",
      entities: [],
      confidence: 20,
    },
  ];
}

export function buildLowEvidenceLedger(): CanonLedger {
  return {
    id: "ledger_low",
    title: "雾中世界档案",
    summary: "资料极少且信心很低。大部分内容标记为未知。",
    entities: [
      {
        id: "ent_l_001",
        name: "城市",
        type: "place",
        description: "可能存在的城市，也可能是幻觉。",
        status: "inferred",
        evidenceRefs: ["ev_low_001"],
      },
      {
        id: "ent_l_002",
        name: "不明实体",
        type: "concept",
        description: "雾中移动的不明存在。",
        status: "inferred",
        evidenceRefs: ["ev_low_002"],
      },
    ],
    relationships: [],
    events: [],
    worldRules: [],
    unresolvedQuestions: [
      {
        id: "unk_l_001",
        question: "这个世界是否真实存在？",
        relatedEntities: ["城市"],
        evidenceRefs: ["ev_low_003"],
      },
      {
        id: "unk_l_002",
        question: "雾里的实体是什么？",
        relatedEntities: ["不明实体"],
        evidenceRefs: ["ev_low_002"],
      },
      {
        id: "unk_l_003",
        question: "城市的具体位置和规模？",
        relatedEntities: ["城市"],
        evidenceRefs: [],
      },
      {
        id: "unk_l_004",
        question: "这个世界还有其他人吗？",
        relatedEntities: [],
        evidenceRefs: [],
      },
    ],
    contradictions: [],
    sourceCoverage: {
      documentCount: 1,
      evidenceCount: 3,
      highConfidenceCount: 0,
    },
  };
}

// ============================================================
// 场景 F：最小合法输入（刚好通过最低门槛的 20 字符资料）
// ============================================================

export function buildMinimumViableDocuments(): Array<{ title?: string; content: string }> {
  return [
    { title: "微设定", content: "裂隙之城，一座在时间尽头循环的城市。" },
  ];
}

// ============================================================
// 辅助：构建完整的 mock AdaptationPlan 和 UzqCreationSeed
// ============================================================

export function buildMockAdaptationPlan(
  ledger: CanonLedger,
  mode: AdaptationPlan["mode"] = "faithful",
): AdaptationPlan {
  return {
    mode,
    playablePremise: ledger.summary,
    lockedFacts: ledger.entities
      .filter((e) => e.status === "source_confirmed")
      .map((e) => `${e.name}: ${e.description}`),
    allowedInventions: ["场景过渡", "线索呈现方式", "玩家初始入口"],
    forbiddenInventions: ledger.unresolvedQuestions.map(
      (u) => `不得将未知项写成已确认事实：${u.question}`,
    ),
    bridgeContent: [],
  };
}

export function buildMockUzqSeed(
  npcId: string,
  entityId: string,
  evidenceId: string,
): UzqCreationSeed {
  return {
    npcId,
    sourceEntityIds: [entityId],
    archive: {
      coreDesires: ["寻求真相", "保护在意的人"],
      fearsAndTaboos: ["沦为空壳", "失去自主意识"],
      valuePriorities: ["真相", "自由"],
      cognitiveStyle: "analytical",
      emotionalRegulation: "suppression",
      socialStrategy: "verification",
      boundarySensitivity: 55,
      metacognition: 68,
    },
    confidence: 78,
    evidenceRefs: [evidenceId],
    forbiddenNarrativeMoves: [
      `不要让${npcId}凭空知道裂隙的秘密`,
      `不要让${npcId}对体制无理由服从`,
    ],
  };
}

// ============================================================
// 场景 G：空/无效输入（用于测试错误路径）
// ============================================================

export function buildEmptyDocuments(): Array<{ title?: string; content: string }> {
  return [];
}

export function buildTooShortDocuments(): Array<{ title?: string; content: string }> {
  return [{ content: "短" }]; // < 20 chars
}
