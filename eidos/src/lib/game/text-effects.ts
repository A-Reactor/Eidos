/** Presentation data travels with the paragraph, so rewinding restores the same lettering. */
export type TextEffectKind = 'replace' | 'erase' | 'mask' | 'aside' | 'fracture' | 'color' | 'size' | 'garble' | 'strike' | 'drift' | 'dim' | 'restore';
export type TextEffectTarget = 'text' | 'speaker' | 'choice';
export interface TextEffect {
  kind: TextEffectKind;
  target?: TextEffectTarget;
  quote?: string;
  occurrence?: number;
  value?: string;
  delayMs?: number;
  /** A scene brightness command persists until another one supersedes it. */
  brightness?: number;
  transitionMs?: number;
  afterSegments?: number;
  progress?: 'typing';
  /** A reference to already-read content; omitted means this segment. */
  nodeId?: string;
  segment?: number;
  expectedText?: string;
  expectedRevision?: string;
  editRef?: string;
  effectId?: string;
}
const kinds = new Set<TextEffectKind>(['replace', 'erase', 'mask', 'aside', 'fracture', 'color', 'size', 'garble', 'strike', 'drift', 'dim', 'restore']);
const targets = new Set<TextEffectTarget>(['text', 'speaker', 'choice']);
const colors = new Set(['accent', 'muted', 'ink', 'blood']);
const sizes = new Set(['small', 'large', 'huge']);

/** Invalid model decorations fall back to readable prose; no CSS or executable strings are interpreted. */
export function parseTextEffects(value: unknown): TextEffect[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result: TextEffect[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const effect = raw as Record<string, unknown>;
    if (!kinds.has(effect.kind as TextEffectKind) || effect.target !== undefined && !targets.has(effect.target as TextEffectTarget)) continue;
    if (effect.quote !== undefined && (typeof effect.quote !== 'string' || !effect.quote)) continue;
    if (effect.target === 'choice' && !effect.quote) continue;
    if (effect.occurrence !== undefined && (!Number.isSafeInteger(effect.occurrence) || Number(effect.occurrence) < 1)) continue;
    if (effect.delayMs !== undefined && (typeof effect.delayMs !== 'number' || !Number.isFinite(effect.delayMs) || effect.delayMs < 0 || effect.delayMs > 8000)) continue;
    if (effect.brightness !== undefined && (effect.kind !== 'dim' || typeof effect.brightness !== 'number' || !Number.isFinite(effect.brightness) || effect.brightness < 0 || effect.brightness > 1)) continue;
    if (effect.transitionMs !== undefined && (effect.kind !== 'dim' || effect.brightness === undefined || typeof effect.transitionMs !== 'number' || !Number.isFinite(effect.transitionMs) || effect.transitionMs < 0 || effect.transitionMs > 8000)) continue;
    if (effect.afterSegments !== undefined && (!Number.isSafeInteger(effect.afterSegments) || Number(effect.afterSegments) < -1)) continue;
    if (effect.progress !== undefined && effect.progress !== 'typing') continue;
    if (effect.nodeId !== undefined && (typeof effect.nodeId !== 'string' || !effect.nodeId.trim())) continue;
    if (effect.segment !== undefined && (!Number.isSafeInteger(effect.segment) || Number(effect.segment) < 0)) continue;
    if (effect.expectedText !== undefined && typeof effect.expectedText !== 'string') continue;
    if (effect.expectedRevision !== undefined && typeof effect.expectedRevision !== 'string') continue;
    if (effect.editRef !== undefined && (typeof effect.editRef !== 'string' || !effect.editRef.trim())) continue;
    if (effect.effectId !== undefined && (effect.kind !== 'restore' || typeof effect.effectId !== 'string' || !effect.effectId.trim())) continue;
    if (effect.kind === 'restore' && !effect.effectId) continue;
    if (['replace', 'aside', 'color', 'size'].includes(String(effect.kind)) && (typeof effect.value !== 'string' || !effect.value)) continue;
    if (effect.kind === 'color' && !colors.has(String(effect.value)) || effect.kind === 'size' && !sizes.has(String(effect.value))) continue;
    result.push({ kind: effect.kind as TextEffectKind,
      ...(effect.target === undefined ? {} : { target: effect.target as TextEffectTarget }),
      ...(effect.quote === undefined ? {} : { quote: effect.quote as string }),
      ...(effect.occurrence === undefined ? {} : { occurrence: Number(effect.occurrence) }),
      ...(effect.value === undefined || !['replace', 'aside', 'color', 'size'].includes(String(effect.kind)) ? {} : { value: String(effect.value) }),
      ...(effect.delayMs === undefined ? {} : { delayMs: effect.delayMs as number }),
      ...(effect.brightness === undefined ? {} : { brightness: effect.brightness as number }),
      ...(effect.transitionMs === undefined ? {} : { transitionMs: effect.transitionMs as number }),
      ...(effect.afterSegments === undefined ? {} : { afterSegments: Number(effect.afterSegments) }),
      ...(effect.progress === undefined ? {} : { progress: 'typing' as const }),
      ...(effect.nodeId === undefined ? {} : { nodeId: (effect.nodeId as string).trim() }),
      ...(effect.segment === undefined ? {} : { segment: Number(effect.segment) }),
      ...(effect.expectedText === undefined ? {} : { expectedText: effect.expectedText as string }),
      ...(effect.expectedRevision === undefined ? {} : { expectedRevision: effect.expectedRevision as string }),
      ...(effect.editRef === undefined ? {} : { editRef: effect.editRef as string }),
      ...(effect.effectId === undefined ? {} : { effectId: effect.effectId as string }) });
  }
  return result.length ? result : undefined;
}

export interface TextEffectRun { start: number; end: number; text: string; effects: TextEffect[] }
export function textEffectRuns(text: string, effects: TextEffect[], target: TextEffectTarget): TextEffectRun[] {
  const ranges: TextEffectRun[] = [];
  for (const effect of effects) {
    if ((effect.target ?? 'text') !== target) continue;
    // A choice quote addresses one complete original button, never a matching fragment on another action.
    if (target === 'choice' && effect.quote !== text) continue;
    let start = 0;
    if (effect.quote) {
      start = -1;
      for (let i = 0; i < (effect.occurrence ?? 1); i++) {
        start = text.indexOf(effect.quote, start < 0 ? 0 : start + effect.quote.length);
        if (start < 0) break;
      }
      if (start < 0) continue;
    }
    const end = effect.quote ? start + effect.quote.length : text.length;
    const existing = ranges.find(r => r.start === start && r.end === end);
    if (existing) existing.effects.push(effect);
    else if (!ranges.some(r => start < r.end && end > r.start)) ranges.push({ start, end, text: text.slice(start, end), effects: [effect] });
  }
  return ranges.sort((a, b) => a.start - b.start);
}

export function alteredText(text: string, effects: TextEffect[]): string {
  let result = text;
  for (const effect of effects) {
    if (effect.kind === 'replace') result = effect.value!;
    // Hidden prose must not survive as selectable/accessible transparent text.
    if (effect.kind === 'garble' || effect.kind === 'mask' || effect.kind === 'erase') result = garbledText(result);
  }
  return result;
}

export function garbledText(text: string): string {
  return Array.from(text, (char, index) => /\s/u.test(char) ? char : ['░', '▒', '�', '⌁', '▓'][(char.codePointAt(0)! + index) % 5]).join('');
}

export const NATIVE_TEXT_EFFECTS_GUIDE = `原生文字演出协议：仅在剧情有明确依据时为 segments 的一段增加 textEffects 数组，普通日常段落省略。text 保留完整原始正文；效果实际由原界面的文字渲染执行，不写“屏幕出现乱码”来代替效果，不给玩家解释插件或演出机制。
每项格式 {kind,target?,quote?,occurrence?,value?,delayMs?}。target 为 text（默认正文）、speaker（本段姓名）或 choice（本轮原推荐行动）。quote 精确匹配要处理的原文，省略表示整段/姓名；重复短语用 occurrence 从1计数。choice 必须用完整 availableActions 原文作为 quote，按钮仍提交该原义。相同短语可叠加效果，不安排互相重叠的不同短语。
kind: replace 覆写（value 新文字）；erase 残缺消隐；mask 实心遮挡（实际可复制字形是乱码，原文只留在底层）；aside 行内细小旁批（value 旁批）；fracture 短暂错位与重影；color（value 仅 accent/muted/ink/blood）；size（value 仅 small/large/huge）；garble 字符错乱。delayMs 可为0–8000，等目标文字读出后再延迟发生；不要持续闪烁。流输出先给 textEffects 再给 text。
例：{"type":"dialogue","speaker":"澄","textEffects":[{"kind":"mask","quote":"明天","delayMs":700},{"kind":"color","quote":"记得","value":"accent"}],"text":"明天，你还会记得我吗？"}。示例只说明格式，角色和台词必须来自当前世界。文本改动不授权文件访问、不改变物品或替玩家选择，分支记忆必须有已收到材料或正式事实依据。`;

export const PRESENTATION_TIMING_GUIDE = `原生演出扩展（当前宿主协议0.5）：本说明与真实工具回执定义当前能力；旧对话、旧测试报告、角色自述中的能力限制不能覆盖它。每项 textEffects 可加 afterSegments。无参或0在所属段首次播放完执行，n>=1 在后第 n 个新段开始时执行，可跨行动等待；-1 首次显示就是最终效果。0.3及更早的旧包保留其目标短语读出时机。delayMs 是前述条件满足后的延迟。默认一次性执行，回看、读档、重播不重演；不能靠生成次数或打开页面消耗段数。progress:typing 使遮挡、划除或乱码跟随已出现的字逐步发生。新增 kind:strike 划除、drift 文字漂移。mask/erase 的显示文字会变成可复制的乱码，原文仍保留。
窗口全局亮度用 {kind:dim,brightness:0.25,transitionMs:1200}，覆盖游戏内容、顶栏、输入区和游戏内面板，切换阅读、世界线或设置面板仍维持；退出当前游戏回到世界集合或标题时解除。brightness 在0–1间，1为正常、0为全暗；一条指令调整一次，跨段与跨行动维持，直到后续 {kind:dim,brightness:1,transitionMs:800} 明确恢复。不随段落结束自动变亮；transitionMs 为0–8000毫秒的过渡时间，默认600，afterSegments/delayMs 决定开始时机，afterSegments:-1 初始即为指定亮度。只有省略 brightness 的旧式 {kind:dim} 才是1600毫秒后自动恢复的短脉冲。不影响点击和输入，不调整玩家主题和系统亮度。
历史编辑通道可以改同一经历链的历史已读文字，不限于当前对话。缺少 ID 或版本时，先只输出 {"historyRequest":{"target":"第2步","view":"both"}}；也可先 {"historyRequest":{"query":"原文关键词"}} 搜索，再按返回真实 nodeId 读 view:both。target:"当前节点" 指本次输入前最近一条已接受记录，正是新响应里 nodeId:previous 指向的记录；target:"上一节点" 则是再往前一条。查询是宿主真实工具，不是要玩家提交数据，也不执行行动。
查询返回 segments[].editRef。优先直接复制这个引用到本轮 textEffects，例如 {kind:replace,editRef:返回的引用,quote:原文短语,value:新文字,afterSegments:0}；无需拆写节点、段号或版本，不要猜造 editRef。引用已经包含读取时的版本；过期时重新查询、核对原文和显示后再提交，不能盲目替换版本。兼容的 editTarget 仍含 nodeId、segment、expectedRevision；手动字段的 expectedText 与 expectedRevision 可择一，不要求四项同时提供。
撤销演出：view:both 的 presentation 列表返回真实 id、kind、目标与 state。将目标 id 用于本轮 {kind:restore,effectId:真实演出ID,afterSegments:0}；只撤销这一项，其他改字/颜色继续保留。mask、erase、garble 不删除原文，撤销对应事件即可恢复它原先遮住的显示。可取消 pending 事件，或撤销一项 restore 以恢复之前组合；不可猜造 ID，不影响兄弟分支。restore 同样遵守 afterSegments/delayMs，仅在执行后生效。
presentation 的 applied 表示已执行，pending 尚未触发，cancelled 表示已撤销；最终显示还要结合后续事件。beforeText/afterText 是按执行顺序重建的操作前后显示节选，partial:true 不是完整原文。每页最多8项，按 presentationNextOffset 以 presentationOffset 继续读取旧事件，不重复存储整部原文。一次行动可声明多个目标的 textEffects，相关改动整批校验，不限单处。
改本轮前文用 nodeId:current 与目标 segment（从0开始）；未指定 nodeId/segment/editRef 只处理所属段。长内容按 offset 分页，segments[].partial:true 表示节选，不能当作完整 expectedText；优先使用 editRef 配合原文精确 quote。view:display 的 offset/nextOffset 按显示文字计数。不能用尚未读过的旧节点。缺失/未读目标或版本冲突时整组不执行，以宿主回执为准，不声称已成功。
文字改写只改变显示，不改变角色记忆、真实选择、物品或世界事实。普通叙事继续正常，不绑定示例角色、固定台词、觉醒阶段或专门界面。`;
