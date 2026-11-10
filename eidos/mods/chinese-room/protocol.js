/* Layouts describe presentation only. All actionable references belong to the host world. */
globalThis.ChineseRoom = (() => {
  const fail = message => { throw new Error(message); };
  const clone = value => JSON.parse(JSON.stringify(value));
  const chars = text => Array.from(text ?? '');
  const key = (x, y) => `${x},${y}`;
  const steps = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
  const text = value => typeof value === 'string' && !!value.trim();
  const parseJSON = value => typeof value === 'string' ? JSON.parse(value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) : value;
  const walkable = (map, x, y) => map.tiles[chars(map.rows[y])[x]]?.walkable === true;
  function binding(entity, scene) {
    if (entity.kind === 'npc') return scene.npcs.find(n => n.id === entity.ref);
    if (entity.kind === 'exit') return scene.exits.find(e => e.id === entity.ref);
    if (entity.kind === 'object') return scene.objects.find(o => o.id === entity.ref);
    if (entity.kind === 'action' && scene.actions.includes(entity.ref)) return { id: entity.ref, name: entity.name };
    return null;
  }
  function reachable(map, origin, target) {
    const queue = [[origin.x, origin.y, []]], seen = new Set([key(origin.x, origin.y)]);
    const occupied = new Set(map.entities.map(e => key(e.x, e.y)));
    for (let i = 0; i < queue.length; i++) {
      const [x, y, route] = queue[i];
      if (target.entity ? Math.abs(x - target.x) + Math.abs(y - target.y) === 1 : x === target.x && y === target.y) return route;
      for (const [dx, dy] of steps) {
        const nx = x + dx, ny = y + dy, k = key(nx, ny);
        if (!seen.has(k) && !occupied.has(k) && walkable(map, nx, ny)) { seen.add(k); queue.push([nx, ny, [...route, [dx, dy]]]); }
      }
    }
    return null;
  }
  function validateMap(input, scene, player) {
    const map = clone(parseJSON(input));
    if (!object(map) || map.format !== 'eidos-scene-map' || map.version !== 1 || map.sceneId !== scene.id) fail('地图不属于当前地点');
    if (!object(map.tiles) || Object.entries(map.tiles).some(([g, t]) => chars(g).length !== 1 || !object(t) || !text(t.name) || typeof t.walkable !== 'boolean' || ['__proto__', 'constructor', 'prototype'].includes(g))) fail('地形定义无效');
    const width = chars(map.rows?.[0]).length;
    if (!Array.isArray(map.rows) || !map.rows.length || !width || map.rows.some(row => typeof row !== 'string' || chars(row).length !== width || chars(row).some(g => !Object.hasOwn(map.tiles, g)))) fail('地图行须等宽并使用已声明地形');
    if (!object(map.entry) || !Number.isInteger(map.entry.x) || !Number.isInteger(map.entry.y) || !walkable(map, map.entry.x, map.entry.y)) fail('地图入口无效');
    if (!Array.isArray(map.entities) || new Set(map.entities.map(e => e?.id)).size !== map.entities.length) fail('地图对象 ID 重复或无效');
    const occupied = new Set(), refs = new Set();
    for (const e of map.entities) {
      if (!object(e) || !text(e.id) || !text(e.name) || chars(e.glyph).length !== 1 || !Number.isInteger(e.x) || !Number.isInteger(e.y) || !walkable(map, e.x, e.y)) fail('地图对象无效');
      const bound = binding(e, scene); if (!bound) fail('地图引用了当前世界不存在的人物、出口或行动');
      if (e.kind !== 'action') e.name = bound.name;
      const p = key(e.x, e.y), ref = `${e.kind}:${e.ref}`;
      if (occupied.has(p) || refs.has(ref) || p === key(map.entry.x, map.entry.y)) fail('地图对象重叠');
      occupied.add(p); refs.add(ref);
    }
    for (const npc of scene.npcs) if (!refs.has(`npc:${npc.id}`)) fail('地图遗漏当前人物');
    for (const exit of scene.exits) if (!refs.has(`exit:${exit.id}`)) fail('地图遗漏当前出口');
    if (map.entities.some(e => !reachable(map, map.entry, { ...e, entity: true }))) fail('地图有无法接近的人物或出口');
    if (player && (!walkable(map, player.x, player.y) || occupied.has(key(player.x, player.y)) || !reachable(map, map.entry, player))) fail('新地图挡住了主角当前位置');
    // Drop arbitrary fields: a visual map cannot carry inventory, quests or world-state commands.
    return { format: map.format, version: 1, sceneId: scene.id, tiles: map.tiles, rows: map.rows, entry: map.entry,
      entities: map.entities.map(e => ({ id: e.id, kind: e.kind, ref: e.ref, name: e.name, glyph: e.glyph, x: e.x, y: e.y })) };
  }
  return { fail, clone, chars, key, steps, walkable, binding, reachable, validateMap, parseJSON };
})();
