((g) => {
  const M = g.SocialMinds = {};
  M.evidence = { fuse: { name: '熔断器残片', text: '熔断痕迹由旧触点过热造成，不是人为拉闸。' }, log: { name: '值守时间记录', text: '停电发生在林禾离岗之后，广播的指控对不上时间。' } };
  M.definitions = [
    { id: 'mechanic', name: '林禾', value: '把故障修好，也要保住自己的清白。', helpTrust: 0, publicProof: false, trust: 1, cause: 'fuse', confidence: 3, source: 'self' },
    { id: 'station', name: '郑遥', value: '先确认责任与安全，再为末班车开闸。', helpTrust: 1, publicProof: true, trust: 0, cause: 'sabotage', confidence: 1, source: 'broadcast' },
    { id: 'passenger', name: '陈穗', value: '赶上末班车；不愿把离开的机会交给一句空话。', helpTrust: 2, publicProof: false, trust: 0, cause: 'sabotage', confidence: 1, source: 'broadcast' },
  ];
  M.start = () => ({ turn: 0, repair: 0, evidence: [], publicEvidence: [], promises: [], status: 'open',
    actors: Object.fromEntries(M.definitions.map(d => [d.id, { id: d.id, name: d.name, trust: d.trust, stress: 0, helped: false, withdrew: false, received: [], belief: { cause: d.cause, confidence: d.confidence, source: d.source } }])),
    log: ['末班车将在十回合后离站。广播把停电归咎于检修员林禾；她说，需要先看配电柜。'], lastPublic: ['三人在熄灯的候车室等你。'] });
})(globalThis);
