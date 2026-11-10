/* Only a map lives here. Dialogue, inventory, menus, outcomes and errors belong to the host. */
(() => {
  const G = ChineseRoom;
  let context, map = null, position = null, busy = false, generating = false;
  let walkEpoch = 0, generationEpoch = 0, attempted = new Set(), lastMove = 0, arrival = null;
  let local = { maps: {}, positions: {} }, publicScene = null;
  let fileEpoch = 0, filePending = false, fileScan = '';
  const fileCache = new Map(), fileScenes = new Map(), invalidFiles = new Set();
  const unavailable = () => !context || context.surface?.active === false || context.reading?.loading || context.reading?.paused || !context.reading?.complete && !context.reading?.error;
  const locked = () => busy || unavailable() || context?.reading?.inputBlocked;
  const render = () => G.renderView({ context: context ? { ...context, scene: context.scene ?? publicScene } : context, map, position, generating }, { locked, goTo });
  const state = () => ({ ...context.state, maps: local.maps, positions: local.positions });
  const notice = message => { void Eidos.world.notice(message).catch(error => console.warn('地图提示未能显示', error)); };
  const signature = scene => JSON.stringify([scene.id, scene.npcs, scene.exits, scene.objects, context.settings?.map_style ?? '']);
  const attemptKeyFor = scene => JSON.stringify([context.world?.id, signature(scene)]);
  const attemptKey = () => attemptKeyFor(context.scene);
  function save() { Eidos.setState(state()); }
  function syncPosition(next) {
    position = next; local.positions[map.sceneId] = next;
    // Once the player has acted spatially, a replacement must preserve that position.
    const { placeholder: _placeholder, entryFrom: _entryFrom, ...saved } = local.maps[map.sceneId] ?? {};
    local.maps[map.sceneId] = saved; save(); render();
  }
  function cancelGeneration() {
    if (!generating) return;
    generationEpoch++; generating = false;
    void Eidos.resources.cancel().catch(error => console.warn('旧地图绘制停止失败', error));
  }
  async function interact(entity) {
    if (locked() || !map || !G.near(map, position).some(e => e.id === entity.id)) return;
    walkEpoch++; cancelGeneration(); busy = true; render();
    const intent = G.intent(entity);
    if (intent.kind === 'travel' && context.scene?.exits.find(exit => exit.id === entity.ref)?.blocked) {
      busy = false; notice('这条通路目前无法通过。'); render(); return;
    }
    if (intent.kind === 'travel') arrival = { from: map.sceneId, to: entity.ref, nodeId: context.world?.nodeId };
    try { await Eidos.world.interact(intent, state()); }
    catch (error) { arrival = null; notice(error.message); }
    finally { busy = false; render(); maybeGenerate(); }
  }
  function move(dx, dy, repeat = false) {
    if (locked() || !map) return;
    const now = Date.now(); if (repeat && now - lastMove < 120) return; lastMove = now;
    walkEpoch++; const next = G.move(map, position, dx, dy); syncPosition(next.position);
    // NPCs wait for confirmation; walking through a doorway uses the existing travel action.
    if (next.entity?.kind === 'exit') void interact(next.entity);
  }
  async function goTo(x, y, entity) {
    if (locked() || !map) return;
    const ticket = ++walkEpoch, scope = context.scope;
    const route = G.reachable(map, position, { x, y, entity: !!entity });
    if (!route) { notice('这里暂时走不到。'); return; }
    for (const [dx, dy] of route) {
      if (ticket !== walkEpoch || scope !== context.scope || locked()) return;
      syncPosition(G.move(map, position, dx, dy).position);
      if (document.documentElement.dataset.motion !== 'reduced') await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (ticket === walkEpoch && scope === context.scope && !locked() && entity) {
      syncPosition({ ...position, facing: [entity.x - position.x, entity.y - position.y] });
      await interact(entity);
    }
  }
  async function generate() {
    if (locked() || generating || !context.scene || context.capabilities?.analysis?.available === false) return;
    const ticket = ++generationEpoch, scope = context.scope, key = attemptKey();
    attempted.add(key); generating = true; render();
    const current = () => ticket === generationEpoch && scope === context.scope && context.scene && key === attemptKey() && !unavailable();
    try {
      await Eidos.files.write('chinese-room/map-request.json', G.generationMaterial(context, map, position, context.settings?.map_style));
      if (!current()) return;
      const result = await Eidos.resources.inspect('chinese-room/map-request.json', G.generationTask);
      if (!current()) return;
      const generated = G.validateMap(result.content, context.scene, position);
      walkEpoch++; map = generated;
      const { placeholder: _placeholder, entryFrom: _entryFrom, ...saved } = local.maps[map.sceneId] ?? {};
      local.maps[map.sceneId] = { ...saved, layout: map, generated: signature(context.scene) }; save();
    } catch (error) {
      if (current()) notice(`地图暂未更新，仍可继续探索。${error instanceof SyntaxError ? '模型未返回有效地图。' : error.message}`);
    } finally { if (ticket === generationEpoch) { generating = false; render(); } }
  }
  async function readMapFile(file, id, current) {
    if (fileCache.has(id)) return fileCache.get(id);
    const result = await Eidos.world.files.read(file.path, file.version);
    if (!current()) return null;
    if (result.version !== file.version) throw new Error('地图文件版本已变化');
    const candidate = G.parseJSON(result.text);
    fileScenes.set(id, candidate?.sceneId);
    // Retain only the pending layout, not every historical file's full text.
    fileCache.clear(); fileCache.set(id, candidate);
    return candidate;
  }
  function adoptMapFile(candidate, scene, id) {
    const starting = local.maps[scene.id]?.placeholder === true;
    const next = G.validateMap(candidate, context.scene ?? scene, starting ? undefined : position);
    walkEpoch++; map = next;
    if (starting) position = local.maps[scene.id]?.entryFrom ? G.arrival(map, local.maps[scene.id].entryFrom) : G.positionFor(map);
    local.positions[scene.id] = position;
    local.maps[scene.id] = { layout: map, generated: signature(context.scene ?? scene), sourceFile: id };
    attempted.add(attemptKeyFor(scene)); fileCache.delete(id); save(); render();
  }
  // Only played, committed files are advertised by the host; no draft can change the map.
  function syncMapFiles() {
    const scene = context.scene ?? publicScene;
    if (!scene || !map || context.world?.sceneId && scene.id !== context.world.sceneId || context.reading?.loading || context.reading?.paused || context.surface?.active === false) return;
    const files = [...(context.sceneMapFiles ?? [])].reverse();
    const key = JSON.stringify([context.scope, scene.id, context.reading?.complete, files]);
    if (fileScan === key || !files.length) return;
    fileScan = key;
    const ticket = ++fileEpoch, scope = context.scope;
    const current = () => ticket === fileEpoch && scope === context.scope && context.surface?.active !== false;
    filePending = true; cancelGeneration();
    void (async () => {
      for (const file of files) {
        const id = JSON.stringify([file.path, file.version]);
        if (fileScenes.has(id) && fileScenes.get(id) !== scene.id) continue;
        if (local.maps[scene.id]?.sourceFile === id || invalidFiles.has(id)) return;
        try {
          const candidate = await readMapFile(file, id, current);
          if (!current()) return;
          if (candidate?.sceneId !== scene.id) { fileCache.delete(id); continue; }
          adoptMapFile(candidate, scene, id); return;
        } catch (error) {
          if (!current()) return;
          // A new person/door may not be public until the response is read; retry with that scene then.
          if (!context.reading?.complete) return;
          if (!invalidFiles.has(id)) { invalidFiles.add(id); notice(`地图文件未采用，保留原图。${error.message}`); }
          return;
        }
      }
    })().finally(() => { if (current()) { filePending = false; maybeGenerate(); } });
  }
  function maybeGenerate() {
    if (locked() || generating || filePending || !map || !context.scene || context.settings?.auto_map === false || attempted.has(attemptKey())) return;
    if (local.maps[context.scene.id]?.generated !== signature(context.scene)) void generate();
  }
  window.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="dialog"]')) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const bindings = context?.keyboardShortcuts;
    const reserved = bindings && Object.entries(bindings).find(([, binding]) => binding && binding === key)?.[0];
    if (reserved && (reserved !== 'advance' || event.repeat)) return;
    const confirm = Eidos.keyboard?.matches ? Eidos.keyboard.matches(event, 'advance')
      : [' ', 'Enter', ...(bindings ? [bindings.advance].filter(Boolean) : ['z', 'e'])].includes(key);
    const direction = { ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1], ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0] }[key];
    if (confirm) {
      if (context?.reading?.inputBlocked) return;
      if (['Enter', ' '].includes(key) && event.target?.closest?.('button[data-cell]')) return;
      event.preventDefault();
      if (event.repeat) return;
      if (!context?.reading?.complete && !context?.reading?.error) { if (!context?.reading?.loading && !context?.reading?.paused) Eidos.advance(); return; }
      if (locked() || !map || event.repeat) return;
      const entity = G.near(map, position).find(e => e.x === position.x + position.facing[0] && e.y === position.y + position.facing[1]);
      if (entity) void interact(entity);
    } else if (direction && !locked()) { event.preventDefault(); move(...direction, event.repeat); }
    else if (key === 'Escape') { walkEpoch++; cancelGeneration(); render(); }
  });
  window.addEventListener('resize', render);
  Eidos.onContext(next => {
    if (context && (context.scope !== next.scope || next.surface?.active === false || next.reading?.paused || next.reading?.loading)) { walkEpoch++; cancelGeneration(); fileEpoch++; filePending = false; fileScan = ''; }
    if (context?.world?.id !== next.world?.id) { map = null; position = null; arrival = null; attempted = new Set(); publicScene = null; fileCache.clear(); fileScenes.clear(); invalidFiles.clear(); fileScan = ''; fileEpoch++; filePending = false; }
    if (context?.settings?.auto_map === false && next.settings?.auto_map === true) attempted = new Set();
    context = next;
    if (next.scene) publicScene = next.scene;
    local = { maps: G.clone(next.state?.maps ?? {}), positions: G.clone(next.state?.positions ?? {}) };
    if (!map && next.world?.sceneId && local.maps[next.world.sceneId]?.layout) {
      const saved = local.maps[next.world.sceneId].layout;
      try {
        // Reopen the already saved picture while dialogue is unfinished; actual bindings reconcile later.
        const refs = kind => saved.entities.filter(entity => entity.kind === kind).map(entity => ({ id: entity.ref, name: entity.name }));
        map = G.validateMap(saved, { id: next.world.sceneId, npcs: refs('npc'), exits: refs('exit'), objects: refs('object'), actions: refs('action').map(entity => entity.id) });
        position = G.positionFor(map, local.positions[next.world.sceneId]);
      } catch (error) { map = null; position = null; console.warn('暂存地图未能恢复，将按公开场景重建', error); }
    }
    if (next.scene && !next.reading?.loading && !next.reading?.paused) {
      const saved = local.maps[next.scene.id], previous = saved?.layout;
      position = local.positions[next.scene.id] ?? null;
      map = previous ? G.reconcile(previous, next.scene, position) : G.baseMap(next.scene); position = G.positionFor(map, position);
      let entryFrom;
      if (arrival) {
        if (next.scene.id === arrival.to) { entryFrom = arrival.from; position = G.arrival(map, arrival.from); arrival = null; }
        else if (next.scene.id !== arrival.from || next.world?.nodeId !== arrival.nodeId && !busy) arrival = null;
      }
      if (!previous || JSON.stringify(previous) !== JSON.stringify(map) || JSON.stringify(position) !== JSON.stringify(local.positions[next.scene.id])) {
        local.maps[next.scene.id] = { ...saved, layout: map, ...(!previous ? { placeholder: true } : {}), ...(entryFrom ? { entryFrom } : {}) }; local.positions[next.scene.id] = position; save();
      }
    }
    render(); syncMapFiles(); maybeGenerate();
  });
})();
