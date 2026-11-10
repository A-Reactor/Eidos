(function (root) {
  'use strict';

  var relationNames = { rebut: '反驳', support: '支持' };
  var fallbackCase = {
    title: '没有可用的案件资料', intro: '请先在 manifest.json 的 data.case 中编辑一个案件。', rounds: [], clues: [],
  };
  var text = function (value) { return typeof value === 'string' ? value.trim() : ''; };
  var normal = function (value) { return text(value).toLocaleLowerCase(); };
  var own = function (value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; };
  var caseFor = function (context) {
    return own(own(own(context).plugin).data).case || fallbackCase;
  };
  var mappedSpeaker = function (context, caseDef, speaker) {
    var target = text(own(caseDef.characterBindings)[speaker]);
    if (!target) return speaker;
    var characters = Array.isArray(own(context).characters) ? context.characters : [];
    var match = characters.find(function (character) {
      if (typeof character === 'string') return normal(character) === normal(target);
      character = own(character);
      return ['id', 'name', 'displayName', 'label'].some(function (key) { return normal(character[key]) === normal(target); });
    });
    if (typeof match === 'string') return match;
    if (match) return text(own(match).name || own(match).displayName || own(match).label || target);
    return target;
  };
  var clueParts = function (clue) {
    if (typeof clue === 'string') return [clue];
    clue = own(clue);
    return ['id', 'clueId', 'name', 'title', 'label', 'text', 'key'].map(function (key) { return text(clue[key]); }).filter(Boolean);
  };
  var clueKey = function (clue) {
    if (typeof clue === 'string') return clue.trim();
    clue = own(clue);
    return text(clue.id || clue.clueId || clue.name || clue.title || clue.label || clue.text || clue.key);
  };
  var authoredClueFor = function (caseDef, clue) {
    var parts = clueParts(clue).map(normal);
    return (Array.isArray(caseDef.clues) ? caseDef.clues : []).find(function (entry) {
      entry = own(entry);
      return [entry.id, entry.name].concat(Array.isArray(entry.aliases) ? entry.aliases : []).map(normal).some(function (name) {
        return name && parts.indexOf(name) >= 0;
      });
    }) || null;
  };
  var discovered = function (context) {
    var clues = own(context).clues;
    return Array.isArray(clues) ? clues : [];
  };
  var visibleEvidence = function (context, caseDef) {
    return discovered(context).map(function (clue) {
      var authored = authoredClueFor(caseDef, clue);
      var source = own(clue);
      return {
        id: clueKey(clue),
        name: authored ? text(authored.name) || clueKey(clue) : clueKey(clue),
        summary: authored ? text(authored.summary) : text(source.summary || source.description || source.text || source.detail),
      };
    }).filter(function (item) { return item.id; });
  };
  var availableEvidence = function (context, state, caseDef) {
    var result = visibleEvidence(context, caseDef);
    if (!state.demoMode) return result;
    var authored = Array.isArray(caseDef.clues) ? caseDef.clues : [];
    var order = Array.isArray(caseDef.demoDiscoveries) ? caseDef.demoDiscoveries : authored.map(function (clue) { return text(own(clue).id); });
    order.slice(0, state.offlineClueIndex).forEach(function (id) {
      var clue = authored.find(function (entry) { return text(own(entry).id) === text(id); });
      if (clue && !result.some(function (item) { return item.id === text(id); })) {
        result.push({ id: text(id), name: text(clue.name) || text(id), summary: text(clue.summary) });
      }
    });
    return result;
  };
  var stateWith = function (state, patch) {
    return Object.assign({}, own(state), patch);
  };
  var copyList = function (value) { return Array.isArray(value) ? value.slice() : []; };

  function createState(source) {
    source = own(source);
    return {
      roundIndex: Number.isInteger(source.roundIndex) && source.roundIndex >= 0 ? source.roundIndex : 0,
      resolved: copyList(source.resolved),
      paused: source.paused === true,
      completed: source.completed === true,
      selectedEvidenceId: text(source.selectedEvidenceId),
      feedback: text(source.feedback),
      demoMode: source.demoMode === true,
      offlineClueIndex: Number.isInteger(source.offlineClueIndex) && source.offlineClueIndex > 0 ? source.offlineClueIndex : 0,
    };
  }

  function view(context, sourceState) {
    var state = createState(sourceState);
    var caseDef = caseFor(context);
    var rounds = Array.isArray(caseDef.rounds) ? caseDef.rounds : [];
    var current = !state.completed && rounds[state.roundIndex] ? rounds[state.roundIndex] : null;
    var evidence = availableEvidence(context, state, caseDef);
    var demoOrder = Array.isArray(caseDef.demoDiscoveries) ? caseDef.demoDiscoveries : (Array.isArray(caseDef.clues) ? caseDef.clues.map(function (clue) { return text(own(clue).id); }) : []);
    return {
      title: text(caseDef.title) || '焦点辩论',
      intro: text(caseDef.intro),
      progress: { current: current ? state.roundIndex + 1 : rounds.length, total: rounds.length },
      current: current ? {
        id: text(own(current.statement).id),
        topic: text(current.topic),
        statement: {
          id: text(own(current.statement).id),
          speaker: mappedSpeaker(context, caseDef, text(own(current.statement).speaker)),
          text: text(own(current.statement).text),
        },
      } : null,
      evidence: evidence,
      selectedEvidenceId: evidence.some(function (item) { return item.id === state.selectedEvidenceId; }) ? state.selectedEvidenceId : '',
      paused: state.paused,
      completed: state.completed || (rounds.length > 0 && state.roundIndex >= rounds.length),
      demoMode: state.demoMode,
      demoHasMore: state.demoMode && state.offlineClueIndex < demoOrder.length,
      feedback: state.feedback,
      closing: (state.completed || state.roundIndex >= rounds.length) ? text(caseDef.closing) : '',
    };
  }

  function selectEvidence(context, sourceState, evidenceId) {
    var state = createState(sourceState);
    var visible = availableEvidence(context, state, caseFor(context));
    var selected = text(evidenceId);
    if (!visible.some(function (item) { return item.id === selected; })) selected = '';
    return stateWith(state, { selectedEvidenceId: selected, feedback: '' });
  }

  function setPaused(sourceState, paused) {
    return stateWith(createState(sourceState), { paused: paused === true });
  }

  function startOfflineDemo(sourceState) {
    return stateWith(createState(sourceState), { demoMode: true, offlineClueIndex: 0, feedback: '离线案例已打开。调查动作会逐条揭开随案记录，不调用模型。' });
  }

  function discoverDemoEvidence(context, sourceState) {
    var state = createState(sourceState);
    var caseDef = caseFor(context);
    var clues = Array.isArray(caseDef.clues) ? caseDef.clues : [];
    var order = Array.isArray(caseDef.demoDiscoveries) ? caseDef.demoDiscoveries : clues.map(function (clue) { return text(own(clue).id); });
    if (!state.demoMode) return { outcome: 'not-demo', state: state, feedback: '请先开启离线案例。' };
    if (state.offlineClueIndex >= order.length) {
      var done = stateWith(state, { feedback: '随案记录已经全部发现。可以继续核对当前发言。' });
      return { outcome: 'offline-complete', state: done, feedback: done.feedback };
    }
    var next = stateWith(state, { offlineClueIndex: state.offlineClueIndex + 1, feedback: '新记录已收录到证据架。请判断它是否回应当前发言。' });
    return { outcome: 'found', state: next, feedback: next.feedback };
  }

  function endOfflineDemo(sourceState) {
    return stateWith(createState(sourceState), {
      demoMode: false,
      offlineClueIndex: 0,
      roundIndex: 0,
      resolved: [],
      paused: false,
      completed: false,
      selectedEvidenceId: '',
      feedback: '',
    });
  }

  function respond(context, sourceState, response) {
    var state = createState(sourceState);
    var caseDef = caseFor(context);
    var rounds = Array.isArray(caseDef.rounds) ? caseDef.rounds : [];
    var round = rounds[state.roundIndex];
    response = own(response);
    var lineId = text(response.lineId);
    var evidenceId = text(response.evidenceId);
    var relation = text(response.relation);
    var evidence = availableEvidence(context, state, caseDef);

    if (state.paused) return { outcome: 'paused', state: state, feedback: '辩论已暂停。准备好后可以继续。' };
    if (!round) return { outcome: 'case-complete', state: stateWith(state, { completed: true }), feedback: text(caseDef.closing) };
    if (lineId !== text(own(round.statement).id)) return { outcome: 'wrong-statement', state: state, feedback: '请先围绕当前这条发言回应。' };
    if (!evidence.some(function (item) { return item.id === evidenceId; })) {
      return { outcome: 'unknown-evidence', state: stateWith(state, { feedback: '这份材料还没有在现场记录中出现。先调查取得它，再带回辩论室。' }), feedback: '这份材料还没有在现场记录中出现。先调查取得它，再带回辩论室。' };
    }
    if (relation !== 'rebut' && relation !== 'support') {
      return { outcome: 'invalid-relation', state: stateWith(state, { feedback: '选择“反驳”或“支持”，再说明这条记录怎样回应发言。' }), feedback: '选择“反驳”或“支持”，再说明这条记录怎样回应发言。' };
    }
    var authored = authoredClueFor(caseDef, evidenceId) || discovered(context).map(function (clue) {
      return clueKey(clue) === evidenceId ? authoredClueFor(caseDef, clue) : null;
    }).find(Boolean);
    var fits = Boolean(authored && text(authored.id) === text(round.evidenceId) && relation === text(round.relation));
    if (!fits) {
      var miss = relation !== text(round.relation) && authored && text(authored.id) === text(round.evidenceId)
        ? '方向不对：证据与这条发言的关系没有被正确表达。'
        : '这份记录还不能证明或推翻当前这句话。可以换一条已发现的证据再试。';
      return { outcome: authored && text(authored.id) === text(round.evidenceId) ? 'wrong-relation' : 'wrong-evidence', state: stateWith(state, { feedback: miss }), feedback: miss };
    }

    var resolved = copyList(state.resolved).concat([text(round.id)]);
    var nextIndex = state.roundIndex + 1;
    var complete = nextIndex >= rounds.length;
    var success = complete ? text(caseDef.closing) || '这组发言已核对完毕。' : '记录与发言的关系成立。辩论继续，下一位发言人正在回应。';
    var nextState = stateWith(state, {
      roundIndex: nextIndex,
      resolved: resolved,
      paused: false,
      completed: complete,
      selectedEvidenceId: '',
      feedback: success,
    });
    return {
      outcome: complete ? 'case-complete' : 'resolved',
      state: nextState,
      feedback: success,
      action: '我在辩论中' + relationNames[relation] + '了“' + text(own(round.statement).text) + '”，依据是已发现的“' + (authored ? text(authored.name) : evidenceId) + '”。请让现场人物依据这个事实回应。',
    };
  }

  function reread(context, sourceState) {
    var state = createState(sourceState);
    var caseDef = caseFor(context);
    var rounds = Array.isArray(caseDef.rounds) ? caseDef.rounds : [];
    var round = rounds[state.roundIndex];
    var readingText = text(own(context).reading && own(own(context).reading).displayedText);
    return [readingText, round ? text(own(round.statement).speaker) + '：“' + text(own(round.statement).text) + '”' : text(caseDef.closing)].filter(Boolean).join('\n\n');
  }

  root.DebateRoom = {
    createState: createState,
    view: view,
    selectEvidence: selectEvidence,
    setPaused: setPaused,
    startOfflineDemo: startOfflineDemo,
    discoverDemoEvidence: discoverDemoEvidence,
    endOfflineDemo: endOfflineDemo,
    respond: respond,
    reread: reread,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
