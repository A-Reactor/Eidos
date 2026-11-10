((g) => {
  const P = g.Palimpsest, node = r => r.script.nodes.find(n => n.id === r.nodeId);
  P.start = script => { const value = P.validate(script); return { script: value, nodeId: value.start, played: 0, history: [], log: ['你走进空白剧场。'] }; };
  P.view = r => {
    const n = node(r), lines = n.lines.map(l => ({ ...l, original: l.text })), choices = n.choices.map(c => ({ ...c, original: c.label }));
    for (const cue of n.cues.slice(0, r.played)) {
      const target = (cue.kind === 'relabel' ? choices : lines).find(l => l.id === cue.target);
      if (cue.kind === 'replace') target.text = cue.text;
      if (cue.kind === 'erase') { target.text = '〔这一行被划去〕'; target.erased = true; }
      if (cue.kind === 'aside') target.aside = cue.text;
      if (cue.kind === 'fracture') target.fracture = true;
      if (cue.kind === 'mask') target.text = Array.from(target.text, char => /\s/u.test(char) ? char : '■').join('');
      if (cue.kind === 'garble') target.text = Array.from(target.text, (char, index) => /\s/u.test(char) ? char : ['░', '▒', '�', '⌁', '▓'][(char.codePointAt(0) + index) % 5]).join('');
      if (cue.kind === 'color') target.color = cue.text;
      if (cue.kind === 'size') target.size = cue.text;
      if (cue.kind === 'relabel') target.label = cue.text;
    }
    return { title: n.title, lines, choices, complete: r.played === n.cues.length, ending: n.ending, cues: n.cues.slice(0, r.played) };
  };
  P.act = (input, action) => {
    const r = P.copy(input), n = node(r);
    if (action.type === 'next' || action.type === 'skip') {
      if (r.played >= n.cues.length) throw new Error('本段演出已经完整');
      r.played = action.type === 'skip' ? n.cues.length : r.played + 1;
      r.log.push(action.type === 'skip' ? '你看完这一页全部更改。' : '你看见一处新的字迹变化。');
    } else if (action.type === 'choose') {
      if (r.played !== n.cues.length) throw new Error('请先看完本页更改，或显示全部');
      const c = n.choices.find(c => c.id === action.id); if (!c) throw new Error('当前页没有这个选择');
      const shown = P.view(r).choices.find(v => v.id === c.id).label;
      r.history.push({ nodeId: n.id, choice: c.id, label: c.label, shown });
      r.nodeId = c.to; r.played = 0; r.log.push(`你选择了「${c.label}」。`);
    } else throw new Error('不支持的舞台行动');
    r.log = r.log.slice(-40); return r;
  };
  P.letter = r => {
    const v = P.view(r);
    return P.parseLetter(JSON.stringify({ format: 'eidos-stage-letter', version: 1, title: r.script.title, scene: v.title,
      text: v.lines.map(l => (l.speaker ? l.speaker + '：' : '') + l.text + (l.aside ? '\n〔页边〕' + l.aside : '')).join('\n\n') }));
  };
  P.operation = r => {
    const view = P.view(r), summary = r.log.at(-1);
    // The author workbench and native reader share one original text and one accepted cue history.
    const segments = view.lines.map(line => {
      const effects = view.cues.filter(c => c.target === line.id && c.kind !== 'relabel').map(c => ({ kind: c.kind, ...(c.text ? { value: c.text } : {}) }));
      return { type: line.speaker ? 'dialogue' : 'narration', text: line.original, ...(line.speaker ? { speaker: line.speaker } : {}), ...(effects.length ? { textEffects: effects } : {}) };
    });
    for (const choice of view.choices) if (choice.label !== choice.original) (segments.at(-1).textEffects ??= []).push({ kind: 'replace', target: 'choice', quote: choice.original, value: choice.label });
    return { state: { run: r }, summary, segments, facts: { title: r.script.title, scene: view.title,
      visibleLines: view.lines.map(l => ({ text: l.text, ...(l.speaker ? { speaker: l.speaker } : {}) })),
      choices: r.history.map(h => h.label), ending: view.complete ? view.ending || null : null } };
  };
})(globalThis);
