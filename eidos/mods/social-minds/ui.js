(() => {
  const M = SocialMinds, el = id => document.getElementById(id), make = (tag, text, css) => { const n = document.createElement(tag); n.textContent = text; if (css) n.className = css; return n; };
  let context, busy = false, pendingId = null;
  const run = () => context?.state?.run;
  const inactive = () => !context || context.surface?.active === false || context.reading?.loading || context.reading?.paused;
  const locked = () => busy || !!pendingId || inactive();
  const message = text => { el('message').textContent = text; };
  const button = (text, fn, disabled) => { const b = make('button', text); b.disabled = disabled; b.onclick = fn; return b; };
  async function commit(next) {
    if (locked()) return; const scope = context.scope; busy = true; message(''); render();
    try { const receipt = await Eidos.gameplay.commit(M.operation(next)); if (scope !== context.scope && context.state._eidosGameplay?.last?.id !== receipt.id) return; pendingId = receipt.persistence === 'pending' ? receipt.id : null; if (pendingId) message('结果已接受，仍需保存。请重试同一结果。'); }
    catch (e) { if (scope === context.scope) message(e.message); } finally { busy = false; render(); }
  }
  function act(command) { if (locked() || !run()) return; try { void commit(M.act(run(), command)); } catch (e) { message(e.message); } }
  function start() { if (locked()) return; el('confirm').hidden = true; void commit(M.start()); }
  function render() {
    const r = run(), disabled = locked(); el('start-panel').hidden = !!r; el('play').hidden = !r;
    el('start').disabled = disabled; el('restart').disabled = disabled || !r;
    el('retry-save').hidden = !pendingId; el('retry-save').disabled = busy || inactive();
    if (!r) return; const ended = r.status !== 'open', v = M.view(r);
    el('stats').textContent = `第 ${r.turn} / 10 回合 · 检修 ${r.repair} / 3 · 每个有效行动后，人物自行决定是否参与`;
    const people = el('people'); people.replaceChildren();
    for (const a of v.actors) {
      const card = make('section', '', 'person'), def = M.definitions.find(d => d.id === a.id);
      card.append(make('h3', a.name), make('p', def.value), make('p', a.attitude + '；' + a.action));
      const controls = make('div', '', 'actions'), actor = r.actors[a.id], unavailable = disabled || ended || actor.withdrew;
      controls.append(button('听其解释', () => act({ type: 'ask', actor: a.id }), unavailable),
        button('承诺三回合内修好', () => act({ type: 'promise', actor: a.id }), unavailable || r.repair === 3 || r.promises.some(p => p.actor === a.id)),
        button('当众追责', () => act({ type: 'accuse', actor: a.id }), unavailable));
      card.append(controls); people.append(card);
    }
    const recipient = el('recipient'), oldRecipient = recipient.value; recipient.replaceChildren();
    for (const a of v.actors.filter(a => !r.actors[a.id].withdrew)) { const o = make('option', a.name); o.value = a.id; recipient.append(o); }
    if ([...recipient.options].some(o => o.value === oldRecipient)) recipient.value = oldRecipient;
    const evidence = el('evidence'); evidence.replaceChildren();
    const select = el('evidence-choice'), oldEvidence = select.value; select.replaceChildren();
    for (const id of r.evidence) { const e = M.evidence[id]; evidence.append(make('p', `${e.name}：${e.text}`, 'evidence-item')); const o = make('option', e.name); o.value = id; select.append(o); }
    if (!r.evidence.length) evidence.append(make('p', '你还没有亲自取得材料。', 'hint'));
    if ([...select.options].some(o => o.value === oldEvidence)) select.value = oldEvidence;
    for (const b of document.querySelectorAll('[data-inspect]')) b.disabled = disabled || ended || r.evidence.includes(b.dataset.inspect);
    for (const id of ['tell', 'announce']) el(id).disabled = disabled || ended || !r.evidence.length || !recipient.value;
    for (const id of ['mediate', 'repair', 'wait', 'leave']) el(id).disabled = disabled || ended || (id === 'repair' && (!r.evidence.includes('fuse') || r.repair === 3));
    for (const id of ['recipient', 'evidence-choice']) el(id).disabled = disabled || ended;
    el('promises').replaceChildren(...r.promises.map(p => make('p', `${r.actors[p.actor].name} · 第 ${p.due} 回合结束前检修完毕 · ${{ pending: '仍需兑现', kept: '已按时兑现', broken: '已失约' }[p.outcome]}`)));
    if (!r.promises.length) el('promises').textContent = '目前没有作出承诺。';
    el('log').replaceChildren(...[...r.log].reverse().map(text => make('p', text)));
    el('ending').textContent = ended ? r.log.at(-1) : '';
    el('narrate').disabled = disabled || !context.state._eidosGameplay?.last?.id;
    el('narration').replaceChildren(...(context.reading?.segments || []).map(segment => make('p', segment.text)));
  }
  el('start').onclick = start; el('restart').onclick = () => { if (!locked()) el('confirm').hidden = false; };
  el('confirm-start').onclick = start; el('cancel-start').onclick = () => { el('confirm').hidden = true; };
  for (const b of document.querySelectorAll('[data-inspect]')) b.onclick = () => act({ type: 'inspect', id: b.dataset.inspect });
  el('tell').onclick = () => act({ type: 'tell', actor: el('recipient').value, id: el('evidence-choice').value });
  el('announce').onclick = () => act({ type: 'tell', actor: el('recipient').value, id: el('evidence-choice').value, public: true });
  for (const id of ['mediate', 'repair', 'wait', 'leave']) el(id).onclick = () => act({ type: id });
  el('narrate').onclick = async () => {
    if (locked()) return; const id = context.state._eidosGameplay?.last?.id, scope = context.scope; if (!id) return;
    busy = true; render(); try { await Eidos.gameplay.narrate(id); if (scope === context.scope) message('已请求人物回应，局内行动不会再结算。'); }
    catch (e) { if (scope === context.scope) message(e.message); } finally { busy = false; render(); }
  };
  el('retry-save').onclick = async () => {
    if (!pendingId || busy || inactive()) return;
    const scope = context.scope, id = pendingId, current = () => scope === context.scope || context.state._eidosGameplay?.last?.id === id;
    busy = true; render();
    try { const receipt = await Eidos.gameplay.commit({ ...M.operation(run()), id }); if (!current()) return; if (receipt.persistence === 'saved') { pendingId = null; message('已保存，不重复行动。'); } }
    catch (e) { if (current()) message(e.message); } finally { if (!current()) pendingId = null; busy = false; render(); }
  };
  Eidos.onContext(next => { if (context && context.scope !== next.scope) { message(''); if (pendingId && next.state._eidosGameplay?.last?.id !== pendingId) pendingId = null; el('confirm').hidden = true; if (!busy) pendingId = null; } context = next; if (!busy) render(); });
})();
