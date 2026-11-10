(() => {
  const P = Palimpsest, el = id => document.getElementById(id), make = (tag, text, css) => { const n = document.createElement(tag); n.textContent = text; if (css) n.className = css; return n; };
  let context, busy = false, generating = false, pendingId = null, candidate = null, epoch = 0;
  const run = () => context?.state?.run;
  const inactive = () => !context || context.surface?.active === false || context.reading?.loading || context.reading?.paused;
  const locked = () => busy || generating || !!pendingId || inactive();
  const message = text => { el('message').textContent = text; };
  const actionButton = (text, fn, disabled = false) => { const b = make('button', text); b.disabled = disabled; b.onclick = fn; return b; };
  async function commit(next) {
    if (locked()) return; const scope = context.scope; busy = true; message(''); render();
    try { const receipt = await Eidos.gameplay.commit({ ...P.operation(next), state: { run: next, still: context.state.still === true, ...(context.state.receivedLetter ? { receivedLetter: context.state.receivedLetter } : {}) } }); if (scope !== context.scope && context.state._eidosGameplay?.last?.id !== receipt.id) return; pendingId = receipt.persistence === 'pending' ? receipt.id : null; if (pendingId) message('这一页已接受，仍需保存；请重试同一结果。'); }
    catch (e) { if (scope === context.scope) message(e.message); } finally { busy = false; render(); }
  }
  function act(action) { if (locked() || !run()) return; try { void commit(P.act(run(), action)); } catch (e) { message(e.message); } }
  function start() { if (locked()) return; el('confirm').hidden = true; void commit(P.start(candidate || P.sample())); }
  function render() {
    const r = run(), disabled = locked(); el('start-panel').hidden = !!r; el('play').hidden = !r;
    el('start').disabled = disabled; el('restart').disabled = disabled || !r;
    el('retry-save').hidden = !pendingId; el('retry-save').disabled = busy || inactive();
    el('generate').disabled = disabled || context?.capabilities?.analysis?.available === false;
    el('import').disabled = disabled; el('export').disabled = disabled;
    el('cancel-generation').hidden = !generating;
    el('candidate').textContent = candidate ? `已准备：${candidate.title}。当前演出未改变。` : '';
    if (!r) return;
    const v = P.view(r); el('scene-title').textContent = v.title;
    el('scene-kind').textContent = `${r.script.title} / ${r.played} 处更改已揭示`;
    const lines = el('stage-lines'); lines.replaceChildren();
    for (const line of v.lines) {
      const p = make('p', '', 'stage-line' + (line.fracture ? ' fracture' : '') + (line.erased ? ' erased' : ''));
      if (line.color) p.classList.add('color-' + line.color);
      if (line.size) p.classList.add('size-' + line.size);
      if (line.speaker) p.append(make('span', line.speaker, 'speaker'));
      p.append(document.createTextNode(line.text)); if (line.aside) p.append(make('span', line.aside, 'aside')); lines.append(p);
    }
    const original = el('original-lines'); original.replaceChildren();
    for (const line of v.lines) original.append(make('p', (line.speaker ? line.speaker + '：' : '') + line.original));
    el('changes').replaceChildren(...v.cues.map(c => {
      const target = (c.kind === 'relabel' ? v.choices : v.lines).find(item => item.id === c.target);
      const original = target.original, excerpt = original.slice(0, 16) + (original.length > 16 ? '…' : '');
      return make('p', `${{ replace: '覆写', erase: '划去', aside: '页边注', fracture: '字迹错位', relabel: '按钮改字', mask: '遮挡', garble: '乱码', color: '颜色', size: '字号' }[c.kind]}「${excerpt}」${c.text ? '：' + c.text : ''}`);
    }));
    el('history').replaceChildren(...r.history.map(h => make('p', h.label + (h.shown !== h.label ? `（舞台曾显示：${h.shown}）` : ''))));
    el('advance').disabled = disabled || v.complete; el('show-all').disabled = disabled || v.complete;
    const choices = el('choices'); choices.replaceChildren();
    for (const c of v.choices) {
      const b = actionButton(c.label, () => act({ type: 'choose', id: c.id }), disabled || !v.complete); b.dataset.choice = c.id;
      if (c.label !== c.original) b.append(make('small', '原文：' + c.original)); choices.append(b);
    }
    el('ending').textContent = v.ending ? (v.complete ? '本场演出已经结束。你可以保存这一页，或从世界线回看别的决定。' : '最后一页还有更改，可继续查看或显示全部。') : '';
    el('still').checked = context.state.still === true; document.documentElement.classList.toggle('static', el('still').checked);
    for (const id of ['send-letter', 'receive-letter']) el(id).disabled = disabled;
    const letter = context.state.receivedLetter; el('received').textContent = letter?.text || '';
    el('letter-status').textContent = letter ? '已明确收取一封分支来信。以下是实际收到的文本。' : '尚未收取来信。';
  }
  el('start').onclick = start; el('restart').onclick = () => { if (!locked()) el('confirm').hidden = false; };
  el('confirm-start').onclick = start; el('cancel-start').onclick = () => { el('confirm').hidden = true; };
  el('advance').onclick = () => act({ type: 'next' }); el('show-all').onclick = () => act({ type: 'skip' });
  el('still').onchange = () => { if (!inactive()) Eidos.setState({ ...context.state, still: el('still').checked }); };
  el('retry-save').onclick = async () => {
    if (!pendingId || busy || inactive()) return;
    const scope = context.scope, id = pendingId, current = () => scope === context.scope || context.state._eidosGameplay?.last?.id === id;
    busy = true; render();
    try { const receipt = await Eidos.gameplay.commit({ ...P.operation(run()), id }); if (!current()) return; if (receipt.persistence === 'saved') { pendingId = null; message('已保存，不重复推进演出。'); } }
    catch (e) { if (current()) message(e.message); } finally { if (!current()) pendingId = null; busy = false; render(); }
  };
  el('generate').onclick = async () => {
    if (locked()) return; const scope = context.scope, request = ++epoch; generating = true; message('正在准备候选剧本，当前演出保留。'); render();
    try {
      const path = 'palimpsest/generation.json'; await Eidos.files.write(path, P.generationMaterial(el('theme').value, request));
      if (request !== epoch || scope !== context.scope || inactive()) return;
      const result = await Eidos.resources.inspect(path, P.generationTask);
      if (request !== epoch || scope !== context.scope || inactive()) return;
      candidate = P.parse(result.content); message('剧本检查通过，确认新开场后采用。');
    } catch (e) { if (request === epoch && scope === context.scope) message('未采用生成结果：' + e.message); }
    finally { if (request === epoch) { generating = false; render(); } }
  };
  el('cancel-generation').onclick = () => { epoch++; generating = false; void Eidos.resources.cancel().catch(e => message(e.message)); message('已取消，迟到结果不会替换剧本。'); render(); };
  el('import').onchange = async event => {
    const file = event.target.files?.[0], scope = context?.scope; event.target.value = ''; if (!file || locked()) return;
    try { if (file.size > 128000) throw new Error('剧本文件过大'); const text = await file.text(); if (scope !== context.scope || inactive()) return; candidate = P.parse(text); message('导入候选通过检查，当前演出未改变。'); render(); }
    catch (e) { message(e.message); }
  };
  async function fileOperation(work) {
    if (locked()) return; const scope = context.scope; busy = true; render();
    try { await work(() => scope === context.scope && !inactive()); }
    catch (e) { if (scope === context.scope) message(e.message); } finally { busy = false; render(); }
  }
  el('export').onclick = () => fileOperation(async current => { const path = 'palimpsest/script.json'; await Eidos.files.write(path, JSON.stringify(candidate || run()?.script || P.sample())); if (current()) { await Eidos.files.export(path); if (current()) message('已请求导出剧本。'); } });
  el('send-letter').onclick = () => fileOperation(async current => { const path = 'palimpsest/letter.json'; await Eidos.files.write(path, JSON.stringify(P.letter(run()))); if (!current()) return; await Eidos.files.publish(path, 'palimpsest-letter-v1'); if (current()) message('这一页已经明确寄出。回溯不撤回邮袋，其他分支仍须主动收取。'); });
  el('receive-letter').onclick = () => fileOperation(async current => {
    const path = 'palimpsest/received-letter.json', receipt = await Eidos.files.receive('palimpsest-letter-v1', path); if (!current()) return;
    const file = await Eidos.files.read(path); if (!current()) return;
    const letter = P.parseLetter(file.text); Eidos.setState({ ...context.state, receivedLetter: { ...letter, origin: receipt.origin } }); message('已收到实际文件。来信不会替你决定当前故事。');
  });
  Eidos.onContext(next => {
    if (context && context.scope !== next.scope) { message(''); if (pendingId && next.state._eidosGameplay?.last?.id !== pendingId) pendingId = null; epoch++; generating = false; el('confirm').hidden = true; if (!busy) { pendingId = null; candidate = null; } }
    if (context && next.surface?.active === false) { epoch++; generating = false; }
    context = next; if (!busy) render();
  });
})();
