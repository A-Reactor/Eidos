/* Shared by the real author frame and offline tests; no engine-owned state mutation. */
globalThis.LastPost = Object.freeze({
  decide(story, state, action) {
    if (!['begin', 'inspect', 'send', 'hold'].includes(action)) throw new Error('未知片段');
    if (state.resolution) throw new Error('这个局部决定已经完成，可以继续自由行动或回溯');
    if (action === 'begin' && state.started || action === 'inspect' && state.examined) throw new Error('这个片段已经读过');
    const passage = action === 'begin' ? 'arrival' : action, authored = story.passages[passage];
    if (!authored?.segments?.length) throw new Error('作者片段缺失');
    const next = { ...state, started: true, examined: state.examined === true || action === 'inspect', passage, resolution: ['send', 'hold'].includes(action) ? action : null };
    return { summary: authored.summary, segments: authored.segments, state: next,
      facts: { arrived: true, letterRead: next.examined, ...(next.examined ? { letterContent: story.passages.inspect.segments[0].text } : {}), decision: next.resolution, event: authored.summary } };
  }
});
