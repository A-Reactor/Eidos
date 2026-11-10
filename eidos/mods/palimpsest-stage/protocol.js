/* Executable presentation stays in the package; generated/imported scripts are only bounded data. */
((g) => {
  const P = g.Palimpsest = g.Palimpsest || {};
  const fail = message => { throw new Error(message); };
  const text = (value, max = 500) => typeof value === 'string' && value.trim() && value.length <= max ? value : fail('剧本文本缺失或过长');
  const list = (value, min, max) => Array.isArray(value) && value.length >= min && value.length <= max ? value : fail('剧本条目数量无效');
  P.copy = value => JSON.parse(JSON.stringify(value));
  P.validate = input => {
    if (!input || input.format !== 'eidos-stage-script' || input.version !== 1 || JSON.stringify(input).length > 32000) fail('剧本格式或大小无效');
    const nodes = list(input.nodes, 3, 18).map(n => {
      const lines = list(n.lines, 1, 8).map(l => ({ id: text(l.id, 60), text: text(l.text), ...(l.speaker === undefined ? {} : { speaker: text(l.speaker, 60) }) }));
      const choices = list(n.choices, 0, 4).map(c => ({ id: text(c.id, 60), label: text(c.label, 100), to: text(c.to, 60) }));
      if (new Set(lines.map(l => l.id)).size !== lines.length || new Set(choices.map(c => c.id)).size !== choices.length) fail('行或选择 ID 重复');
      const cues = list(n.cues, 0, 12).map(c => {
        if (!['replace', 'erase', 'aside', 'fracture', 'relabel', 'mask', 'color', 'size', 'garble'].includes(c.kind)) fail('不支持的文字指令');
        const target = text(c.target, 60), targets = c.kind === 'relabel' ? choices : lines;
        if (!targets.some(t => t.id === target)) fail('演出目标不存在');
        if (c.kind === 'color' && !['accent', 'muted', 'ink', 'blood'].includes(c.text) || c.kind === 'size' && !['small', 'large', 'huge'].includes(c.text)) fail('文字样式无效');
        return { kind: c.kind, target, ...(['replace', 'aside', 'relabel', 'color', 'size'].includes(c.kind) ? { text: text(c.text, c.kind === 'relabel' ? 100 : 500) } : {}) };
      });
      const ending = n.ending === undefined ? undefined : text(n.ending, 60);
      if (Boolean(ending) !== (choices.length === 0)) fail('非结局须有选择，结局不得继续');
      return { id: text(n.id, 60), title: text(n.title, 100), lines, cues, choices, ...(ending ? { ending } : {}) };
    });
    const byId = new Map(nodes.map(n => [n.id, n]));
    if (byId.size !== nodes.length || !byId.has(input.start)) fail('节点 ID 重复或起点缺失');
    const visited = new Set(), stack = new Set();
    function visit(id) {
      if (stack.has(id)) fail('剧本不允许循环');
      if (visited.has(id)) return;
      const node = byId.get(id); if (!node) fail('选择引用不存在的节点');
      stack.add(id); for (const c of node.choices) visit(c.to); stack.delete(id); visited.add(id);
    }
    visit(input.start); if (visited.size !== nodes.length) fail('剧本包含不可达节点');
    return { format: 'eidos-stage-script', version: 1, id: text(input.id, 60), title: text(input.title, 100), start: input.start, nodes };
  };
  P.parseLetter = source => {
    if (typeof source !== 'string' || source.length > 40000) fail('署名信大小无效');
    const value = JSON.parse(source);
    if (value?.format !== 'eidos-stage-letter' || value.version !== 1) fail('不是已寄出的舞台信');
    return { format: value.format, version: 1, title: text(value.title, 100), scene: text(value.scene, 100), text: text(value.text, 10000) };
  };
  P.parse = source => P.validate(JSON.parse(source.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')));
})(globalThis);
