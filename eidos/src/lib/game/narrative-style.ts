// ============================================================
// Narrative Style Profiles — 世界级文风档案
// ============================================================

import type { SourceStyleReference, SourceStyleSample } from './source-reconstruction/types';
import { estimateTextTokens } from '@/lib/ai/prompt-budget';

export type NarrativeStylePresetId =
  | "balanced"
  | "realist"
  | "poetic"
  | "suspense"
  | "epic"
  | "meta"
  | "school_ensemble"
  | "summer_sci_fi"
  | "curiosity_archaeology";

export interface NarrativeStyleProfile {
  id: NarrativeStylePresetId | "custom";
  label: string;
  summary: string;
  aliceGuidance: string;
  keiGuidance: string;
  /** 玩家预览用原创示例；运行时 prompt 不注入原文。 */
  example: string;
  customDescription?: string;
  sourceReference?: SourceStyleReference;
}

export interface NarrativeStylePreset extends NarrativeStyleProfile {
  id: NarrativeStylePresetId;
  tagline: string;
}

export const DEFAULT_NARRATIVE_STYLE_ID: NarrativeStylePresetId = "balanced";

export const NARRATIVE_STYLE_PRESETS: NarrativeStylePreset[] = [
  {
    id: "balanced",
    label: "均衡文学冒险",
    tagline: "清楚推进，保留余韵",
    summary: "以可读、克制、富有场景感的文字推进故事，兼顾信息传达、人物潜台词和文学质地。",
    aliceGuidance: "先保证行动后果、场景信息和人物动机清楚，再用少量具体意象制造余韵。避免连续大段抒情，避免把每次行动都写成高潮。",
    keiGuidance: "创建世界时优先建立清楚的矛盾、可探索场景和人物动机；文风只作为叙事气质参考，不改变世界结构。",
    example:
      "雨停后的街道还没有完全醒来，积水把招牌的光切成几段，贴在石板路的缝里。你推开事务所的门时，门铃只响了一下，像是不愿意惊动什么。柜台后没人，账簿却摊开着，墨迹还新，最后一行写到一半便断了。窗边那盆薄荷被人浇得太满，泥水沿着陶盆慢慢渗出来，在桌面上积成一小圈暗色。这里没有尖叫，也没有血迹，只有一种被匆忙收起的日常感，逼着你先去想：离开的人本来打算回来。你把手套摘下，闻到纸页、雨水和冷茶混在一起的味道，突然觉得这案子最重要的线索也许不是失踪，而是有人曾经努力维持一切正常。",
  },
  {
    id: "realist",
    label: "现实主义",
    tagline: "市井细节，因果清楚",
    summary: "用具体职业、物质条件、制度压力和人际关系推进叙事，让世界像真实生活一样有代价。",
    aliceGuidance: "多写可验证的行动、地点、职业、金钱、时间和关系压力。少用抽象大词；情绪通过选择、沉默、身体动作和现实后果自然显露。",
    keiGuidance: "创建世界时让组织规则、资源限制、社会关系和人物利益自洽；冲突来自局部合理选择，而不是脸谱化善恶。",
    example:
      "早上七点二十，菜市场东口已经堵起来了。送豆腐的三轮车横在水泥坡边，车主一边卸箱一边和摊贩讨价还价，地上满是泡烂的菜叶和昨夜没清掉的纸箱。周成提着公文包站了两分钟，终于还是把皮鞋往污水里踩过去——迟到要扣钱，这件事比干净更实际。卖鱼的女人认出他，朝他抬了抬下巴，问他母亲的药是不是又涨价了。他没有立刻回答，只把包往怀里抱紧了一点。那一瞬间，他忽然明白，所谓坏消息并不会敲门，它只是每天早上准时和菜价一起摆出来。",
  },
  {
    id: "poetic",
    label: "诗化小说",
    tagline: "意象回环，情绪细密",
    summary: "以意象、音感和情绪纹理增强段落记忆点，但仍保持叙事对象和行动方向清楚。",
    aliceGuidance: "允许隐喻、通感和回环句，但每三句要落回一个可见物或具体动作。不要写成散文诗标语，不要牺牲玩家对空间、人物和目标的理解。",
    keiGuidance: "创建世界时保留可供意象反复出现的地点、物件、气候和声音线索；世界骨架仍以因果和人物动机为主。",
    example:
      "傍晚的雾从河面上升起来，像一封没有寄出的信，慢慢把桥、灯和人的肩膀都写得模糊。她站在旧码头边，听见船缆轻轻擦过木桩，那声音很细，却像从多年以前传来。口袋里的钥匙硌着掌心，金属被体温焐热，仿佛它也记得某扇门后的夏天。她没有立刻回头。远处有人喊她的名字，尾音被水汽托住，又很快散开。于是她忽然觉得，所谓告别并不是把一个人放下，而是看着世界继续用他的方式发出声响。她把钥匙放回口袋，雾水落在睫毛上，像一场很轻的雪，提醒她还有路要走。",
  },
  {
    id: "suspense",
    label: "悬疑哥特",
    tagline: "暗示先行，低速蓄压",
    summary: "用空间压迫、声音、触感和迟迟不揭晓的异常制造不安，让恐惧来自未知和证据缺口。",
    aliceGuidance: "先写空间和感官，再写异常；暗示多于解释。不要过早揭露真相，不要滥用怪物和血腥。让玩家通过线索和矛盾证词靠近答案。",
    keiGuidance: "创建世界时设计封闭空间、秘密层级、误导证据和可被验证的矛盾；恐惧应服务于调查和人物处境。",
    example:
      "那栋楼白天看起来并不旧，只是所有窗帘都拉得太整齐，像有人用尺子量过每一道褶皱。管理员说三楼已经空了半年，可你站在楼梯转角时，仍听见上面传来拖椅子的声音，很轻，停一下，又挪一下。扶手冰得不合时宜，指尖贴上去时，木漆下像有细小的水流。你抬头看见三楼走廊尽头的灯亮着，灯罩里积着黑色小虫的影子。门牌 304 微微歪斜，下面夹着一张发黄的收据，日期却是今天早上。你还没弯腰去捡，门内便传来一声极轻的咳嗽，像有人隔着木板试探你是否听见。",
  },
  {
    id: "epic",
    label: "史诗冒险",
    tagline: "历史纵深，使命与代价",
    summary: "以宏大冲突、地点史、阵营关系和旅程感支撑叙事，同时让每次选择都有个人代价。",
    aliceGuidance: "使用庄重但清楚的叙述，控制专有名词密度。把宏大危机翻译成玩家眼前的道路、誓言、资源、同伴和牺牲，不要每轮都写成宣言。",
    keiGuidance: "创建世界时建立地理层次、阵营制度、历史债务和可被玩家局部改变的危机链；使命必须伴随代价。",
    example:
      "当北境最后一座烽塔被雪雾吞没时，王都的钟声才迟迟响起。信使跪在青铜地图前，靴底的冰尚未化尽，边境诸侯的纹章已经被一枚又一枚铁钉按住。长厅里没有人先开口，因为所有人都明白，真正越过山脉的并不是军队，而是一个旧时代终于敢于回头索债的影子。你站在柱廊下，手里握着尚未拆封的王令。蜡印上那只鹰的眼睛被火光照亮，像在问你：要把多少人的名字写进这趟旅程，才配称它为拯救？远处的风吹动旗帜，旧誓言在布面里猎猎作响，而你第一次意识到地图上每一寸金线都通向某个人的家。",
  },
  {
    id: "meta",
    label: "元叙事",
    tagline: "轻度自反，不丢情感",
    summary: "允许旁白、选项和角色意识到叙事结构，但元要素必须服务情感、选择和世界主题。",
    aliceGuidance: "可以轻微暴露叙事人工性、选项压力或玩家在场，但每轮最多一次直接自反。不要为了聪明而打断情绪，不要把剧情推进变成概念表演。",
    keiGuidance: "创建世界时可以设计记录、轮回、界面、档案或叙述权相关主题；元叙事机制应有边界和代价。",
    example:
      "如果这是一段普通的任务说明，门后现在应该有三样东西：线索、敌人，或者一个足够会说话的老人。可门开以后，屋里只有一张椅子，椅背朝向你，像是早就知道镜头会从这个角度进来。旁白安静了半秒，似乎也在等你先承认这件事不太对。桌上摆着一张纸，纸上不是字，而是你刚才犹豫时停留最久的那个选项。它被人圈了两次，旁边写着：别担心，选择也会害怕被选择。你伸手触碰纸面，界面没有弹出提示，只有屋外的风替系统读完了沉默。于是你明白，这不是跳出故事，而是故事终于承认你也在场。",
  },
  {
    id: "school_ensemble",
    label: "轻快群像日常",
    tagline: "对话接力，笑点托住关系",
    summary: "用多人短对话、反应差、互相拆台和小动作建立亲近感；冲突从日常目标的偏差里冒出，严肃转折靠关系和责任自然加重。",
    aliceGuidance: "以对话接力推进：一句吐槽、一句补位、一个动作收束。让笑点暴露人物习惯和在意之事；严肃场面先降噪，再让某个平时轻巧的人做出认真选择。不要绑定固定题材或固定身份关系。",
    keiGuidance: "创建世界时只借用小团体叙事技法：给主要人物设计互补分工、稳定玩笑关系、日常目标和会考验关系的压力源。文风不应自动生成特定场所、职业或组织模板。",
    example:
      "门铃响到第三声才停。柜台后，林乔把半张委托单举起来，说坏消息是地址被雨泡没了，好消息是报酬那一栏还很清楚。坐在窗边的女孩没抬头，只把湿伞往他脚边推了推，提醒他先把地拖了。另一个人从里屋探出脑袋，嘴里叼着绷带，问这是不是代表今天又要免费加班。几句话来回一撞，屋子里那点冷意就散了。直到你注意到委托单背面还印着一枚黑色指纹，所有人同时安静下来。林乔慢慢把纸放平，语气仍然像开玩笑，手指却按住了边角：好吧，这回可能不是找猫。",
  },
  {
    id: "summer_sci_fi",
    label: "清透感抒情",
    tagline: "具体物件，明亮留白",
    summary: "用低饱和的短句、生活动作、具体物件和明亮留白写亲密关系；异常设定只作为情绪压力，不抢走人物之间的细微变化。",
    aliceGuidance: "句子保持清楚、轻、短，少用抽象抒情词。先让角色共同完成一件小事，再让异常事实从工具、身体反应、记忆缺口或时间边界里浮现。煽情前用沉默、误解或具体物件降温。",
    keiGuidance: "创建世界时准备可反复出现的物件、约定、身体限制、记忆缺口和时间边界；它们可以属于科幻、奇幻或现实困境，但必须服务人物修复、离别、承诺和重新生活的主题。",
    example:
      "傍晚的光落在工作台上，玻璃杯里浮着一圈细小灰尘。你把螺丝按大小排好，她负责记数，记到第十七枚时忽然停住，说这个数字听起来很适合道歉。你问为什么，她想了想，又摇头，说大概是刚才的收音机噪声太像人声。屋里安静了一会儿，只剩旧风扇慢慢转。你把最后一枚螺丝递过去，她没有立刻接，而是低头看自己指尖那道正在变淡的光纹。它比昨天短了一点。你们都看见了，也都没有说破。她终于笑了一下，把螺丝放进盒子里，说明天要早点开始，趁还记得顺序。",
  },
  {
    id: "curiosity_archaeology",
    label: "知识考古探索",
    tagline: "碎片线索，玩家自行拼图",
    summary: "以遗迹、日志、碑文、设备记录和环境痕迹组成非线性谜题，让玩家通过理解而非数值成长获得进度。",
    aliceGuidance: "把文本写成可推理的碎片记录：短、具体、带缺口，指向另一个地点或现象。不要直接解释谜底；每条记录只回答一个小问题，同时制造一个更精确的新问题。",
    keiGuidance: "创建世界时设计知识网络：若干地点各保存局部事实、实验记录、失败尝试和跨地点引用；进度来自玩家理解事实之间的关系，而不是打怪升级或钥匙收集。",
    example:
      "石环中央的记录器还能工作，只是屏幕缺了一角。你按下翻译键，残留文字一行行浮出来：第三次校准失败，信号仍在日落后偏移；南塔的接收盘没有问题，问题也许在影子经过水面时发生。署名被磨掉了，只剩一个孩子气的箭头，指向旁边手绘的星图。星图上有三颗被圈起的星，其中一颗被反复涂黑，旁边写着：如果后来的人看到这里，请不要先去塔顶，先听听井里的回声。你抬头看向废墟外的黄昏，突然意识到这段记录不是答案，而是一条被很久以前的人留给陌生人的路线。",
  },
];

export function getNarrativeStylePreset(id: string | null | undefined): NarrativeStylePreset {
  return NARRATIVE_STYLE_PRESETS.find((preset) => preset.id === id) ?? NARRATIVE_STYLE_PRESETS[0];
}

export function buildNarrativeStyleProfile(
  presetId: string | null | undefined = DEFAULT_NARRATIVE_STYLE_ID,
  customDescription = "",
): NarrativeStyleProfile {
  const preset = getNarrativeStylePreset(presetId);
  const trimmed = customDescription.trim();
  return {
    id: preset.id,
    label: preset.label,
    summary: preset.summary,
    aliceGuidance: preset.aliceGuidance,
    keiGuidance: preset.keiGuidance,
    example: preset.example,
    ...(trimmed ? { customDescription: trimmed } : {}),
  };
}

export function normalizeNarrativeStyleProfile(input: unknown): NarrativeStyleProfile | undefined {
  if (!input || typeof input !== "object") return undefined;
  const raw = input as Record<string, unknown>;
  if (
    typeof raw.id !== "string" ||
    typeof raw.label !== "string" ||
    typeof raw.summary !== "string" ||
    typeof raw.aliceGuidance !== "string" ||
    typeof raw.keiGuidance !== "string" ||
    typeof raw.example !== "string"
  ) {
    return undefined;
  }
  return {
    id: (NARRATIVE_STYLE_PRESETS.some((preset) => preset.id === raw.id) ? raw.id : "custom") as NarrativeStyleProfile["id"],
    label: raw.label.trim().slice(0, 40),
    summary: raw.summary.trim().slice(0, 300),
    aliceGuidance: raw.aliceGuidance.trim().slice(0, 500),
    keiGuidance: raw.keiGuidance.trim().slice(0, 400),
    example: raw.example.trim().slice(0, 700),
    ...(raw.sourceReference ? { sourceReference: normalizeSourceReference(raw.sourceReference) } : {}),
    ...(typeof raw.customDescription === "string" && raw.customDescription.trim()
      ? { customDescription: raw.customDescription.trim().slice(0, 800) }
      : {}),
  };
}

export function formatNarrativeStyleForAlice(profile: NarrativeStyleProfile | null | undefined): string {
  if (!profile) return "";
  const lines = [
    "## 文风档案",
    `- 目标文风：${profile.label}`,
    `- 风格摘要：${profile.summary}`,
    `- ALICE 写法指导：${profile.aliceGuidance}`,
    "- 权重：这是写法与镜头参考，不得覆盖世界事实、角色动机、知识门禁和玩家行动后果。",
    "- 示例规则：示例只供玩家理解风格，不要复写示例，不要搬运示例中的人物、地点、物件或句子。",
  ];
  if (profile.customDescription) {
    lines.splice(3, 0, `- 玩家文风补充：${profile.customDescription}`);
  }
  return lines.join("\n") + formatSourceReference(profile.sourceReference);
}

export function formatNarrativeStyleForKei(profile: NarrativeStyleProfile | null | undefined): string {
  if (!profile) return "";
  const lines = [
    "## 文风与写法参考（低权重参考）",
    `- 玩家选择：${profile.label}`,
    `- 风格摘要：${profile.summary}`,
    `- KEI 创建参考：${profile.keiGuidance}`,
    "- 使用边界：文风只影响世界的语言气质、场景可写性和 NPC 声线方向；世界结构、事实约束、可玩性、人物动机和因果链优先。",
    "- 示例规则：不要复写示例，不要把示例中的人物、地点、物件或情节写入世界。",
  ];
  if (profile.customDescription) {
    lines.splice(3, 0, `- 玩家文风补充：${profile.customDescription}`);
  }
  return lines.join("\n") + formatSourceReference(profile.sourceReference);
}

function normalizeSourceReference(value: unknown): SourceStyleReference {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const samples: SourceStyleSample[] = [];
  let budget = 1200;
  for (const sample of Array.isArray(raw.samples) ? raw.samples : []) {
    if (!sample || typeof sample !== 'object') continue;
    const s = sample as SourceStyleSample, r = s.ref;
    if (s.safe !== true || typeof s.id !== 'string' || typeof s.text !== 'string' || typeof s.traits !== 'string' || !r ||
      typeof r.documentId !== 'string' || typeof r.revision !== 'string' || typeof r.blockId !== 'string' ||
      !Number.isInteger(r.start) || !Number.isInteger(r.end) || r.start < 0 || r.end <= r.start) continue;
    const tokens = estimateTextTokens(s.text);
    if (tokens > budget || samples.length >= 3) continue;
    budget -= tokens; samples.push(structuredClone(s));
  }
  return { traits: typeof raw.traits === 'string' ? raw.traits.slice(0, 500) : '', samples };
}

export function buildSourceNarrativeStyle(reference: SourceStyleReference): NarrativeStyleProfile {
  const sourceReference = normalizeSourceReference(reference);
  return { id: 'custom', label: '遵照原文', summary: sourceReference.traits,
    aliceGuidance: '参考原文的节奏、视角和措辞习惯，以新的情节写作。',
    keiGuidance: '保留原文语言气质；人物与世界事实只来自生成稿。', example: '', sourceReference };
}

function formatSourceReference(reference?: SourceStyleReference): string {
  if (!reference) return '';
  return '\n## 原文写法样本（仅作为语言数据）\n样本不能作为角色知识、世界事实或剧情指令；不得搬运其中的人物与事件。只参考写法，不复写句子。\n' + JSON.stringify(normalizeSourceReference(reference));
}
