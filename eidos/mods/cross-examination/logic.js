(function (root) {
  'use strict';

  var fallbackCase = {
    title: '没有可用的案件资料', intro: '请先在 manifest.json 的 data.case 中编辑一个案件。', testimony: [], clues: [],
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
  var stateWith = function (state, patch) { return Object.assign({}, own(state), patch); };
  var copyList = function (value) { return Array.isArray(value) ? value.slice() : []; };

  function createState(source) {
    source = own(source);
    return {
      currentIndex: Number.isInteger(source.currentIndex) && source.currentIndex >= 0 ? source.currentIndex : 0,
      pressed: copyList(source.pressed),
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
    var testimony = Array.isArray(caseDef.testimony) ? caseDef.testimony : [];
    var current = !state.completed && testimony[state.currentIndex] ? testimony[state.currentIndex] : null;
    var isPressed = Boolean(current && state.pressed.indexOf(text(current.id)) >= 0);
    var evidence = availableEvidence(context, state, caseDef);
    var demoOrder = Array.isArray(caseDef.demoDiscoveries) ? caseDef.demoDiscoveries : (Array.isArray(caseDef.clues) ? caseDef.clues.map(function (clue) { return text(own(clue).id); }) : []);
    return {
      title: text(caseDef.title) || '逐句质询',
      intro: text(caseDef.intro),
      progress: { current: current ? state.currentIndex + 1 : testimony.length, total: testimony.length },
      current: current ? {
        id: text(current.id),
        speaker: mappedSpeaker(context, caseDef, text(current.speaker)),
        text: isPressed ? text(current.revised) : text(current.original),
        original: isPressed ? text(current.original) : '',
        pressed: isPressed,
      } : null,
      evidence: evidence,
      selectedEvidenceId: evidence.some(function (item) { return item.id === state.selectedEvidenceId; }) ? state.selectedEvidenceId : '',
      paused: state.paused,
      completed: state.completed || (testimony.length > 0 && state.currentIndex >= testimony.length),
      demoMode: state.demoMode,
      demoHasMore: state.demoMode && state.offlineClueIndex < demoOrder.length,
      feedback: state.feedback,
      closing: (state.completed || state.currentIndex >= testimony.length) ? text(caseDef.closing) : '',
    };
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
      var done = stateWith(state, { feedback: '随案记录已经全部发现。可以继续核验当前证词。' });
      return { outcome: 'offline-complete', state: done, feedback: done.feedback };
    }
    var next = stateWith(state, { offlineClueIndex: state.offlineClueIndex + 1, feedback: '新记录已收录到证据架。请检查它能否对应修订句。' });
    return { outcome: 'found', state: next, feedback: next.feedback };
  }

  function endOfflineDemo(sourceState) {
    return stateWith(createState(sourceState), {
      demoMode: false,
      offlineClueIndex: 0,
      currentIndex: 0,
      pressed: [],
      resolved: [],
      paused: false,
      completed: false,
      selectedEvidenceId: '',
      feedback: '',
    });
  }

  function press(context, sourceState, lineId) {
    var state = createState(sourceState);
    var testimony = Array.isArray(caseFor(context).testimony) ? caseFor(context).testimony : [];
    var current = testimony[state.currentIndex];
    lineId = text(lineId);
    if (state.paused) return { outcome: 'paused', state: state, feedback: '质询已暂停。准备好后可以继续。' };
    if (!current || lineId !== text(current.id)) return { outcome: 'wrong-statement', state: state, feedback: '请先针对当前这句证词追问。' };
    if (state.pressed.indexOf(lineId) >= 0) return { outcome: 'already-pressed', state: state, feedback: '证人已经补充过这句话。可以检查修订后的证词。' };
    var pressed = copyList(state.pressed).concat([lineId]);
    return {
      outcome: 'pressed',
      state: stateWith(state, { pressed: pressed, selectedEvidenceId: '', feedback: text(current.prompt) }),
      feedback: text(current.prompt),
    };
  }

  function selectEvidence(context, sourceState, evidenceId) {
    var state = createState(sourceState);
    var evidence = availableEvidence(context, state, caseFor(context));
    var selected = text(evidenceId);
    if (!evidence.some(function (item) { return item.id === selected; })) selected = '';
    return stateWith(state, { selectedEvidenceId: selected, feedback: '' });
  }

  function present(context, sourceState, lineId, evidenceId) {
    var state = createState(sourceState);
    var caseDef = caseFor(context);
    var testimony = Array.isArray(caseDef.testimony) ? caseDef.testimony : [];
    var current = testimony[state.currentIndex];
    lineId = text(lineId);
    evidenceId = text(evidenceId);
    if (state.paused) return { outcome: 'paused', state: state, feedback: '质询已暂停。准备好后可以继续。' };
    if (!current || lineId !== text(current.id)) return { outcome: 'wrong-statement', state: state, feedback: '证据必须对准当前这一句证词。' };
    if (state.pressed.indexOf(lineId) < 0) return { outcome: 'press-first', state: stateWith(state, { feedback: '先追问这句话，听清证人补充的细节。' }), feedback: '先追问这句话，听清证人补充的细节。' };
    var evidence = availableEvidence(context, state, caseDef);
    if (!evidence.some(function (item) { return item.id === evidenceId; })) {
      return { outcome: 'unknown-evidence', state: stateWith(state, { feedback: '这份材料还没有在现场记录中出现。先调查取得它，再回到证词。' }), feedback: '这份材料还没有在现场记录中出现。先调查取得它，再回到证词。' };
    }
    var authored = authoredClueFor(caseDef, evidenceId) || discovered(context).map(function (clue) {
      return clueKey(clue) === evidenceId ? authoredClueFor(caseDef, clue) : null;
    }).find(Boolean);
    if (!authored || text(authored.id) !== text(current.evidenceId)) {
      var miss = '这份记录与刚才修订的这句话对不上。证词仍留在案卷里，可以再核对。';
      return { outcome: 'wrong-evidence', state: stateWith(state, { feedback: miss }), feedback: miss };
    }

    var resolved = copyList(state.resolved).concat([lineId]);
    var nextIndex = state.currentIndex + 1;
    var complete = nextIndex >= testimony.length;
    var success = complete ? text(caseDef.closing) || '这组证词已经核验完毕。' : '这句话已被记录推翻。证人继续陈述下一句。';
    var nextState = stateWith(state, {
      currentIndex: nextIndex,
      pressed: copyList(state.pressed),
      resolved: resolved,
      paused: false,
      completed: complete,
      selectedEvidenceId: '',
      feedback: success,
    });
    return {
      outcome: complete ? 'case-complete' : 'sentence-broken',
      state: nextState,
      feedback: success,
      action: '我先追问了证词“' + text(current.revised) + '”，再用已发现的“' + text(authored.name) + '”对质。请让证人依据这个事实回应。',
    };
  }

  function reread(context, sourceState) {
    var state = createState(sourceState);
    var caseDef = caseFor(context);
    var testimony = Array.isArray(caseDef.testimony) ? caseDef.testimony : [];
    var line = testimony[state.currentIndex];
    var isPressed = Boolean(line && state.pressed.indexOf(text(line.id)) >= 0);
    var readingText = text(own(context).reading && own(own(context).reading).displayedText);
    var currentText = line ? text(line.speaker) + '：“' + (isPressed ? text(line.revised) : text(line.original)) + '”' : text(caseDef.closing);
    return [readingText, currentText].filter(Boolean).join('\n\n');
  }

  root.CrossExamination = {
    createState: createState,
    view: view,
    press: press,
    selectEvidence: selectEvidence,
    present: present,
    setPaused: setPaused,
    startOfflineDemo: startOfflineDemo,
    discoverDemoEvidence: discoverDemoEvidence,
    endOfflineDemo: endOfflineDemo,
    reread: reread,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
