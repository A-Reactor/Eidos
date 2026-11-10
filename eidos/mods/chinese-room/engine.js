Object.assign(ChineseRoom, (() => {
  const G = ChineseRoom;
  const glyph = name => {
    const letters = G.chars(name).filter(g => /[\p{L}\p{N}]/u.test(g));
    return letters[0] === '阿' ? letters.at(-1) : letters.length > 3 ? letters.at(-2) : letters.at(-1) ?? '物';
  };
  function baseMap(scene) {
    const refs = [...scene.npcs.map(n => ({ ...n, kind: 'npc' })), ...scene.exits.map(e => ({ ...e, kind: 'exit' })), ...scene.objects.map(o => ({ ...o, kind: 'object' }))];
    const indoor = /屋|室|房|店|工坊|车厢|办公室|大厅|客厅|书房/.test(scene.name) || /屋内|室内|房间里|房间内/.test(scene.description);
    const water = /河|湖|海|岸|港|渡|桥/.test(scene.name), forest = /林|山|园|田|村/.test(scene.name);
    const ground = indoor ? '板' : forest ? '草' : '石', border = indoor ? '墙' : water ? '水' : forest ? '树' : '屋';
    const width = 15, height = Math.max(9, 5 + Math.ceil(refs.length / 5) * 2);
    const cells = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => x === 0 || y === 0 || x === width - 1 || y === height - 1 ? border : ground));
    if (!indoor) {
      for (let y = 1; y < height - 1; y++) { const x = water ? 6 + (y > height / 2 ? 1 : 0) : 7; cells[y][x] = '路'; cells[y][x + 1] = '路'; }
      for (let x = 1; x < width - 1; x++) cells[Math.floor(height / 2)][x] = '路';
    }
    if (water) for (let y = 2; y < height - 2; y++) for (let x = 1; x <= (y % 3 === 0 ? 2 : 1); x++) cells[y][x] = border;
    const map = { format: 'eidos-scene-map', version: 1, sceneId: scene.id,
      tiles: { [ground]: { name: indoor ? '地板' : forest ? '草地' : '广场地面', walkable: true }, [border]: { name: indoor ? '墙壁' : water ? '水面' : forest ? '树丛' : '街边建筑', walkable: false }, ...(!indoor ? { 路: { name: '道路', walkable: true } } : {}) },
      rows: [], entry: { x: 7, y: height - 2 }, entities: [] };
    const occupied = new Set([G.key(map.entry.x, map.entry.y)]);
    const edges = [[7, 0], [14, Math.floor(height / 2)], [7, height - 1], [0, Math.floor(height / 2)], [3, 0], [11, 0]];
    for (let y = 1; y < height - 1; y++) edges.push([0, y], [14, y]);
    for (let x = 1; x < width - 1; x++) edges.push([x, 0], [x, height - 1]);
    const spaces = [[4, 3], [10, 5], [6, height - 3], [11, 2], [3, height - 3], [8, 4]];
    for (let y = 2; y < height - 1; y += 2) for (let x = 2; x < width - 1; x += 2) spaces.push([x, y]);
    let slot = 0;
    // Doors belong to boundaries; people belong to walkable activity zones rather than a menu row.
    for (const ref of [...refs.filter(r => r.kind === 'exit'), ...refs.filter(r => r.kind !== 'exit')]) {
      const candidates = ref.kind === 'exit' ? [...edges, ...spaces] : spaces;
      const cell = candidates.find(([x, y]) => !occupied.has(G.key(x, y)) && (ref.kind === 'exit' || map.tiles[cells[y][x]].walkable));
      if (!cell) G.fail('当前地点缺少足够的活动空间');
      const [x, y] = cell; occupied.add(G.key(x, y)); if (ref.kind === 'exit') cells[y][x] = ground;
      map.entities.push({ id: `entity-${++slot}`, kind: ref.kind, ref: ref.id, name: ref.name, glyph: glyph(ref.name), x, y });
    }
    map.rows = cells.map(row => row.join(''));
    return G.validateMap(map, scene);
  }
  function reconcile(map, scene, position) {
    try {
      const next = G.clone(map); next.entities = next.entities.filter(e => G.binding(e, scene)).map(e => e.kind === 'action' ? e : { ...e, name: G.binding(e, scene).name });
      const required = [...scene.npcs.map(n => ({ ...n, kind: 'npc' })), ...scene.exits.map(e => ({ ...e, kind: 'exit' })), ...scene.objects.map(o => ({ ...o, kind: 'object' }))];
      const occupied = new Set(next.entities.map(e => G.key(e.x, e.y))); occupied.add(G.key(next.entry.x, next.entry.y)); if (position) occupied.add(G.key(position.x, position.y));
      for (const ref of required) {
        if (next.entities.some(e => e.kind === ref.kind && e.ref === ref.id)) continue;
        let found = false;
        for (let y = 1; y < next.rows.length - 1 && !found; y++) for (let x = 1; x < G.chars(next.rows[y]).length - 1 && !found; x++) {
          if (occupied.has(G.key(x, y)) || !G.walkable(next, x, y)) continue;
          const e = { id: `added-${ref.kind}-${ref.id}`, kind: ref.kind, ref: ref.id, name: ref.name, glyph: glyph(ref.name), x, y };
          next.entities.push(e);
          try { G.validateMap(next, { ...scene, npcs: scene.npcs.filter(n => next.entities.some(e => e.kind === 'npc' && e.ref === n.id)), exits: scene.exits.filter(n => next.entities.some(e => e.kind === 'exit' && e.ref === n.id)) }, position); occupied.add(G.key(x, y)); found = true; }
          catch { next.entities.pop(); }
        }
        if (!found) return baseMap(scene);
      }
      return G.validateMap(next, scene, position);
    } catch { return baseMap(scene); }
  }
  const near = (map, p) => map.entities.filter(e => Math.abs(e.x - p.x) + Math.abs(e.y - p.y) === 1);
  function move(map, input, dx, dy) {
    if (!G.steps.some(s => s[0] === dx && s[1] === dy)) G.fail('移动方向无效');
    const p = { ...input, facing: [dx, dy] }, x = p.x + dx, y = p.y + dy;
    if (!G.walkable(map, x, y)) return { position: p };
    const entity = map.entities.find(e => e.x === x && e.y === y);
    return entity ? { position: p, entity } : { position: { ...p, x, y } };
  }
  function intent(entity) {
    return { kind: { npc: 'talk', exit: 'travel', object: 'inspect', action: 'action' }[entity.kind], targetId: entity.ref };
  }
  const positionFor = (map, saved) => saved && G.walkable(map, saved.x, saved.y) && !map.entities.some(e => e.x === saved.x && e.y === saved.y) ? { ...G.clone(saved), facing: G.steps.some(s => s[0] === saved.facing?.[0] && s[1] === saved.facing?.[1]) ? saved.facing : [0, -1] } : { ...map.entry, facing: [0, -1] };
  function viewport(map, position, limit = { width: 17, height: 11 }) {
    const width = Math.min(limit.width, G.chars(map.rows[0]).length), height = Math.min(limit.height, map.rows.length);
    return { width, height, x: Math.max(0, Math.min(G.chars(map.rows[0]).length - width, position.x - Math.floor(width / 2))), y: Math.max(0, Math.min(map.rows.length - height, position.y - Math.floor(height / 2))) };
  }
  function layoutViewport(map, position, frame) {
    const width = Math.max(1, frame.width), height = Math.max(1, frame.height);
    const scale = Math.max(0.7, Math.min(3, frame.fontSize / 14));
    const view = viewport(map, position, { width: Math.max(1, Math.min(17, Math.floor(width / (32 * scale)))), height: Math.max(1, Math.min(11, Math.floor(height / (32 * scale)))) });
    const cellSize = Math.min(width / view.width, height / view.height, 38 * scale);
    return { view, cellSize, glyphSize: cellSize * 0.68 };
  }
  function arrival(map, from) {
    const exit = map.entities.find(e => e.kind === 'exit' && e.ref === from);
    if (exit) for (const [dx, dy] of G.steps) {
      const x = exit.x + dx, y = exit.y + dy;
      if (G.walkable(map, x, y) && !map.entities.some(e => e.x === x && e.y === y) && G.reachable(map, map.entry, { x, y })) return { x, y, facing: [dx, dy] };
    }
    return positionFor(map);
  }
  return { viewport, layoutViewport, arrival, baseMap, reconcile, near, move, intent, positionFor };
})());
