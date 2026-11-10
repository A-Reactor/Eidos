/* Every belief has a received source. A global answer is never a substitute for witnessing or disclosure. */
((g) => {
  const M = g.SocialMinds, copy = value => JSON.parse(JSON.stringify(value)), clamp = value => Math.max(-3, Math.min(3, value));
  const say = (r, text) => { r.log.push(text); r.lastPublic.push(text); };
  const actorOf = (r, id) => { const a = Object.hasOwn(r.actors, id) ? r.actors[id] : null; if (!a || a.withdrew) throw new Error('这位角色现在不参与会谈'); return a; };
  function disclose(r, command) {
    if (!r.evidence.includes(command.id)) throw new Error('你尚未取得这份证据');
    const actors = command.public ? Object.values(r.actors).filter(a => !a.withdrew) : [actorOf(r, command.actor)];
    const fresh = actors.filter(a => !a.received.includes(command.id));
    if (!fresh.length && !(command.public && !r.publicEvidence.includes(command.id))) throw new Error('对方已经核对过同一份证据');
    for (const a of fresh) { a.received.push(command.id); a.belief = { cause: 'fuse', confidence: 3, source: 'player' }; a.trust = clamp(a.trust + 1); }
    if (command.public) { if (!r.publicEvidence.includes(command.id)) r.publicEvidence.push(command.id); say(r, `你公开了${M.evidence[command.id].name}：${M.evidence[command.id].text}`); }
    else { r.log.push(`你私下向${actors[0].name}出示${M.evidence[command.id].name}。对方核对了实物。`); r.lastPublic.push(`你与${actors[0].name}私下交换了一份材料。`); }
  }
  function mediate(r) {
    const speakers = Object.values(r.actors).filter(a => !a.withdrew && a.trust >= 1 && a.belief.confidence === 3);
    if (!speakers.length) { say(r, '你请大家各说一件核实过的事，但没有人愿意先作担保。'); return; }
    for (const speaker of speakers) {
      say(r, `${speaker.name}愿意担保：目前核对的线索指向旧触点故障，不能只靠广播指控某个人。`);
      for (const a of Object.values(r.actors)) if (!a.withdrew && a.id !== speaker.id && a.belief.confidence < 3) a.belief = { cause: speaker.belief.cause, confidence: 2, source: speaker.id };
    }
  }
  function autonomy(r) {
    for (const a of Object.values(r.actors)) {
      if (a.withdrew) continue;
      if (a.stress >= 4) { a.withdrew = true; say(r, `${a.name}退出会谈，不再替这次行动承担风险。`); continue; }
      const policy = M.definitions.find(d => d.id === a.id);
      const proofReady = !policy.publicProof || r.publicEvidence.includes('fuse');
      if (r.repair > 0 && r.repair < 3 && a.belief.confidence === 3 && !proofReady && !a.boundarySaid) { a.boundarySaid = true; say(r, `${a.name}要求先公开核对材料，再承担站务责任。`); }
      if (r.repair > 0 && r.repair < 3 && !a.helped && a.trust >= policy.helpTrust && proofReady && a.stress < 3 && a.belief.cause === 'fuse' && a.belief.confidence === 3) {
        a.helped = true; r.repair++; say(r, `${a.name}主动帮你完成一段检修；这一次，行动跟上了他核对过的证据。`);
      }
    }
  }
  function settle(r) {
    for (const p of r.promises) if (p.outcome === 'pending') {
      const a = r.actors[p.actor];
      if (r.repair === 3 && r.turn <= p.due) { p.outcome = 'kept'; a.trust = clamp(a.trust + 1); say(r, `你对${a.name}的检修承诺按时兑现。`); }
      else if (r.turn >= p.due) { p.outcome = 'broken'; a.trust = clamp(a.trust - 2); a.stress += 2; say(r, `约定时间已到，${a.name}发现你没有兑现检修承诺。`); }
    }
  }
  function finish(r) {
    const allies = Object.values(r.actors).filter(a => !a.withdrew && a.trust >= 1 && a.belief.cause === 'fuse' && a.belief.confidence >= 2).length;
    for (const p of r.promises) if (p.outcome === 'pending') { p.outcome = 'broken'; const a = r.actors[p.actor]; a.trust = clamp(a.trust - 2); say(r, `你离开时，给${a.name}的承诺仍未兑现。`); }
    r.status = 'ended'; r.ending = r.repair < 3 ? 'stranded' : allies >= 2 ? 'cooperate' : allies === 1 ? 'wary' : 'alone';
    const ending = { cooperate: '共同修复：大家带着各自核实过的部分，一起赶上末班车。', wary: '勉强通行：灯亮了，但愿意与你同行的人仍然有限。', alone: '独自离站：设备修好了，你没有挽回彼此的关系。', stranded: '错过末班：故障仍未排除，承诺和争执都没能让列车多等一刻。' };
    say(r, ending[r.ending]);
  }
  M.act = (input, command) => {
    if (input.status !== 'open') throw new Error('本局已经结束');
    const r = copy(input); r.lastPublic = [];
    if (command.type === 'inspect') {
      if (!Object.hasOwn(M.evidence, command.id) || r.evidence.includes(command.id)) throw new Error('这份材料无效或已经调查');
      r.evidence.push(command.id); r.log.push(`你独自取得${M.evidence[command.id].name}：${M.evidence[command.id].text}`); r.lastPublic.push('你离开候车室调查，带回一份尚未公开的材料。');
    } else if (command.type === 'tell') disclose(r, command);
    else if (command.type === 'mediate') mediate(r);
    else if (command.type === 'ask') {
      const a = actorOf(r, command.actor);
      say(r, `${a.name}：${a.stress >= 2 ? '我现在需要你先拿行动说话。' : a.belief.confidence < 3 ? '广播这样说，可我还没有亲自核对。请拿出实物或时间记录。' : '我核对过线索，愿意看你接下来怎样处理。'}`);
    } else if (command.type === 'accuse') {
      const a = actorOf(r, command.actor); a.trust = clamp(a.trust - 2); a.stress += 2; say(r, `你当众追责${a.name}。对方要求证据，向后退开一步。`);
    } else if (command.type === 'promise') {
      const a = actorOf(r, command.actor); if (r.repair === 3) throw new Error('不能为已经完成的工作重复作承诺'); if (r.promises.some(p => p.actor === a.id)) throw new Error('已有承诺不能重置期限或重复兑现');
      r.promises.push({ actor: a.id, due: r.turn + 4, outcome: 'pending' }); say(r, `你向${a.name}承诺，在第 ${r.turn + 4} 回合结束前完成检修。`);
    } else if (command.type === 'repair') {
      if (!r.evidence.includes('fuse') || r.repair >= 3) throw new Error('先检查熔断器；已经修好的设备无需重复检修');
      r.repair++; for (const a of Object.values(r.actors)) if (!a.withdrew) a.trust = clamp(a.trust + 1);
      say(r, '你按实物线索检修了一段线路；在场的人看到了实际工作。');
    } else if (command.type === 'wait') { for (const a of Object.values(r.actors)) if (!a.withdrew) a.stress = Math.max(0, a.stress - 1); say(r, '你给大家留出一点平静的时间，列车的时刻没有因此推迟。'); }
    else if (command.type !== 'leave') throw new Error('不支持的会谈行动');
    r.turn++; autonomy(r); settle(r); autonomy(r);
    if (command.type === 'leave' || r.turn >= 10) finish(r);
    r.log = r.log.slice(-80); return r;
  };
  M.view = r => ({ evidence: r.evidence, actors: Object.values(r.actors).map(a => ({ id: a.id, name: a.name,
    attitude: a.withdrew ? '已退出会谈' : a.stress >= 2 ? '明显戒备，要求你先行动' : a.trust >= 1 ? '愿意核对，也在观察你的行动' : '保留判断，尚未作出担保',
    action: a.helped ? '已实际协助检修' : a.withdrew ? '拒绝参与' : '仍在等待可承担的理由' })) });
  M.operation = r => {
    const summary = r.lastPublic.join('\n') || r.log.at(-1);
    return { state: { run: r }, summary, segments: [{ type: 'narration', text: summary }], facts: { turn: r.turn, repair: r.repair,
      publicEvidence: r.publicEvidence, publicEvents: r.lastPublic, commitments: r.promises.map(p => ({ actor: r.actors[p.actor].name, due: p.due, outcome: p.outcome })), status: r.status, ending: r.ending || null } };
  };
})(globalThis);
