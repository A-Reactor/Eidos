// Author-time translation only: portable packages keep deterministic rules and ordinary prose.
const prose = text => [{ type: 'narration', text }];
const dialogue = (speaker, text) => ({ type: 'dialogue', speaker, text });
const patch = (key, value) => ({ op: 'add', path: '/' + key, value });
function nativeBuilder(plugin) {
  const rules = [], actions = [];
  const data = plugin.data ?? {};
  function add(id, label, summary, options = {}) {
    const { requires = {}, sets = {}, facts = {}, state = {}, segments, once = true } = options;
    rules.push({ id, description: summary, requires, sets, once, effects: {
      ...(Object.keys(state).length ? { state: Object.entries(state).map(([key, value]) => patch(key, value)) } : {}),
      facts: [patch('nativeLastResult', summary), ...Object.entries(facts).map(([key, value]) => patch(key, value))],
    } });
    actions.push({ ruleId: id, label, segments: segments ?? prose(summary) });
  }
  const active = { 'n-active': true, 'n-closed': false };
  function start(title, intro, segments) {
    add('n-start', `开始调查：${title}`, intro, { requires: { 'n-started': false }, sets: { 'n-started': true, 'n-active': true }, segments, facts: { caseTitle: title } });
    add('n-pause', `暂离「${title}」`, '你暂时停下调查，已经确认的记录仍然保留。', { requires: active, sets: { 'n-active': false }, once: false });
    add('n-resume', `继续调查：${title}`, '你重新翻开已确认的记录，接着处理尚未解答的问题。', { requires: { 'n-started': true, 'n-active': false, 'n-closed': false }, sets: { 'n-active': true }, once: false });
  }
  return { plugin, data, rules, actions, add, start, active };
}

function compilePost({ data, add }) {
  const story = data.story;
  for (const [id, label, passage] of [['begin', '走进旧港邮局', 'arrival'], ['inspect', '阅读柜台上的原信', 'inspect'], ['send', '请白槿代寄原信', 'send'], ['hold', '暂时保留原信']]) {
    const part = story.passages[passage ?? id];
    add('n-' + id, label, part.summary, { requires: { ...(id === 'begin' ? { 'n-started': false } : { 'n-started': true }), 'n-resolved': false, ...(id === 'inspect' ? { 'n-read': false } : {}) },
      sets: { 'n-started': true, ...(id === 'inspect' ? { 'n-read': true } : {}), ...(['send', 'hold'].includes(id) ? { 'n-resolved': true } : {}) },
      state: { started: true, passage: passage ?? id, ...(id === 'inspect' ? { examined: true } : {}), ...(['send', 'hold'].includes(id) ? { resolution: id } : {}) },
      facts: { arrived: true, ...(id === 'inspect' ? { letterRead: true, letterContent: part.segments[0].text } : {}), ...(['send', 'hold'].includes(id) ? { decision: id } : {}) }, segments: part.segments });
  }
}

function compileEvidence({ data, add, start, active }, kind) {
  const c = data.case, lines = kind === 'cross-examination' ? c.testimony : c.rounds;
  const line = item => kind === 'cross-examination' ? dialogue(item.speaker, item.original) : dialogue(item.statement.speaker, item.statement.text);
  start(c.title, c.intro, [...prose(c.intro), ...(lines.length ? [line(lines[0])] : [])]);
  for (const clue of c.clues) add('n-find-' + clue.id, `查看「${clue.name}」`, clue.summary, { requires: { ...active, ['n-found-' + clue.id]: false }, sets: { ['n-found-' + clue.id]: true }, facts: { ['evidence-' + clue.id]: { id: clue.id, name: clue.name, summary: clue.summary } } });
  lines.forEach((item, index) => {
    const here = { ...active, ['n-done-' + index]: false, ...(index ? { ['n-done-' + (index - 1)]: true } : {}) };
    if (kind === 'cross-examination') add('n-press-' + index, `追问${item.speaker}：${item.prompt}`, `${item.speaker}补充了原来的证词。`, {
      requires: { ...here, ['n-pressed-' + index]: false }, sets: { ['n-pressed-' + index]: true },
      facts: { currentStatement: { speaker: item.speaker, text: item.revised, index } }, segments: [dialogue(item.speaker, item.revised)] });
    for (const clue of c.clues) for (const relation of kind === 'cross-examination' ? ['present'] : ['rebut', 'support']) {
      const correct = clue.id === item.evidenceId && (kind === 'cross-examination' || relation === item.relation);
      const label = kind === 'cross-examination' ? `向${item.speaker}出示「${clue.name}」，核对第${index + 1}句` : `对第${index + 1}句用「${clue.name}」${relation === 'rebut' ? '反驳' : '支持'}`;
      const feedback = correct ? (item.why || `「${clue.name}」的记录与这句证词形成了可以核对的关系。`) : `「${clue.name}」目前不能以这个理由证明或推翻这句话。你可以换一份已取得的材料再核对。`;
      const finished = correct && index === lines.length - 1;
      add(`n-check-${index}-${clue.id}-${relation}`, label, finished ? c.closing : feedback, {
        requires: { ...here, ['n-found-' + clue.id]: true, ...(kind === 'cross-examination' ? { ['n-pressed-' + index]: true } : {}) },
        sets: correct ? { ['n-done-' + index]: true, ...(finished ? { 'n-closed': true, 'n-active': false } : {}) } : {}, once: correct,
        facts: { lastEvidenceResult: { evidence: clue.name, accepted: correct, statement: index }, ...(correct ? { ['resolved-' + index]: true } : {}), ...(finished ? { completed: true } : {}) },
        segments: [...prose(feedback), ...(finished ? prose(c.closing) : correct && lines[index + 1] ? [line(lines[index + 1])] : [])],
      });
    }
  });
}

function compileTrial({ data, add, start, active, plugin, rules }) {
  const names = Object.fromEntries((data.cast ?? []).map(p => [p.id, p.name]));
  const format = value => String(value).replace(/\{(\w+)\}/g, (_, id) => id === 'victim' ? data.case.victimName : names[id] ?? id);
  const c = data.case, resolution = data.resolution;
  start(c.title, format(c.opening), prose(format(c.opening)));
  for (const person of data.cast) add('n-talk-' + person.id, `与${person.name}谈谈日常和能力`, format(person.daily) + '\n' + person.ability.description + '\n' + person.ability.limits, {
    requires: active, facts: { ['person-' + person.id]: { name: person.name, daily: format(person.daily), ability: person.ability } }, segments: [dialogue(person.name, format(person.daily)), ...prose(person.ability.description + '\n' + person.ability.limits)] });
  for (const clue of data.clues) {
    const existing = plugin.rules.find(rule => rule.id === 'discover-' + clue.id);
    add(existing?.id ?? 'n-find-' + clue.id, `调查${clue.place}`, format(clue.detail), {
      requires: { ...existing?.requires, 'n-closed': false, ['n-found-' + clue.id]: false },
      sets: { ...existing?.sets, ['n-found-' + clue.id]: true, 'n-started': true, 'n-active': true },
      facts: { ['evidence-' + clue.id]: { ...clue, detail: format(clue.detail) } },
    });
    // Free input and native buttons reference one canonical discovery, including its old state patches.
    if (existing?.effects) {
      const generated = rules.at(-1);
      generated.effects = { state: existing.effects.state, facts: [...(existing.effects.facts ?? []), ...generated.effects.facts] };
    }
  }
  for (const testimony of data.testimonies) {
    add('n-hear-' + testimony.id, `听取${names[testimony.personId]}的证词`, `${names[testimony.personId]}说明了自己的所见。`, { requires: { ...active, ['n-heard-' + testimony.id]: false }, sets: { ['n-heard-' + testimony.id]: true }, facts: { ['testimony-' + testimony.id]: { speaker: names[testimony.personId], text: format(testimony.text) } }, segments: [dialogue(names[testimony.personId], format(testimony.text))] });
    for (const clue of data.clues) {
      const correct = clue.id === testimony.challengeClue;
      add('n-check-' + testimony.id + '-' + clue.id, `用「${clue.title}」核对${names[testimony.personId]}的证词`, correct ? format(testimony.challenge) : '这份材料不足以否定这条证词，调查仍然可以继续。', {
        requires: { ...active, ['n-heard-' + testimony.id]: true, ['n-found-' + clue.id]: true, ['n-challenged-' + testimony.id]: false },
        sets: correct ? { ['n-challenged-' + testimony.id]: true } : {}, once: correct,
        facts: correct ? { ['contradiction-' + testimony.id]: format(testimony.challenge) } : {},
      });
    }
  }
  // Verdict options remain symmetric: insufficient evidence never silently convicts anyone.
  for (const person of data.cast) {
    const correct = person.id === resolution.culpritId;
    add('n-verdict-' + person.id, `提交关于${person.name}的指控`, correct ? format(resolution.finding) : '现有物证与因果链不足以确认这一指控。怀疑仍然只是怀疑。', {
      requires: { ...active, 'n-verdict': false, ...Object.fromEntries([...resolution.requiredEvidence.map(id => ['n-found-' + id, true]), ['n-challenged-' + resolution.requiredContradiction, true]]) },
      sets: correct ? { 'n-verdict': true } : {}, once: correct, facts: correct ? { verdict: 'guilty', verdictFor: person.name, finding: format(resolution.finding) } : {},
    });
  }
  for (const choice of ['protect', 'publish']) add('n-privacy-' + choice, choice === 'protect' ? '保护私信，只提交匿名事实' : '明确公开私信原文', choice === 'protect' ? format(data.privateLetter.anonymousFact) : format(data.privateLetter.text), {
    requires: { ...active, 'n-verdict': true }, sets: { 'n-closed': true, 'n-active': false }, facts: { privacyChoice: choice, ...(choice === 'publish' ? { disclosedLetter: format(data.privateLetter.text) } : { anonymousFact: format(data.privateLetter.anonymousFact) }) } });
}

export function withNativeGameplay(input, kind) {
  if (!kind) return input;
  if (!['last-post', 'cross-examination', 'debate-room', 'secrets-trial'].includes(kind)) throw new Error('未知原生玩法编译器');
  const plugin = structuredClone(input), builder = nativeBuilder(plugin);
  if (kind === 'last-post') compilePost(builder);
  else if (kind === 'secrets-trial') compileTrial(builder);
  else compileEvidence(builder, kind);
  const { rules, actions } = builder;
  const nativeIds = new Set(rules.map(rule => rule.id));
  plugin.rules = [...plugin.rules.filter(rule => !nativeIds.has(rule.id)), ...rules];
  plugin.ui = { ...plugin.ui, presentation: 'native', reading: 'inherit', actions };
  return plugin;
}
