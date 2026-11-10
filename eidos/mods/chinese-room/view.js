Object.assign(ChineseRoom, {
  renderView({ context, map, position, generating }, handlers) {
    const G = ChineseRoom, board = document.getElementById('board');
    if (!map || !position) { board.replaceChildren(); return; }
    const existing = new Map([...board.children].map(cell => [cell.dataset.cell, cell]));
    const focused = document.activeElement?.closest?.('[data-cell]')?.dataset.cell, visible = new Set();
    let index = 0;
    const style = getComputedStyle(document.getElementById('map-surface')), root = getComputedStyle(document.documentElement);
    const padding = name => parseFloat(style[name]) || 8;
    const { view, cellSize, glyphSize } = G.layoutViewport(map, position, { width: window.innerWidth - padding('paddingLeft') - padding('paddingRight'), height: window.innerHeight - padding('paddingTop') - padding('paddingBottom'), fontSize: parseFloat(root.fontSize) || 16 });
    const disabled = handlers.locked(), near = G.near(map, position);
    board.setAttribute('aria-label', `${context.world?.sceneName ?? '当前地点'}文字地图`); board.setAttribute('aria-busy', String(generating));
    board.style.gridTemplateColumns = `repeat(${view.width},minmax(0,1fr))`;
    board.style.gridTemplateRows = `repeat(${view.height},minmax(0,1fr))`;
    board.style.width = `${view.width * cellSize}px`; board.style.height = `${view.height * cellSize}px`;
    board.style.setProperty('--map-glyph-size', `${glyphSize}px`);
    const counts = {}; for (const g of G.chars(map.rows.join(''))) if (map.tiles[g].walkable) counts[g] = (counts[g] ?? 0) + 1;
    const ground = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    for (let y = view.y; y < view.y + view.height; y++) for (let x = view.x; x < view.x + view.width; x++) {
      const glyph = G.chars(map.rows[y])[x], tile = map.tiles[glyph], entity = map.entities.find(e => e.x === x && e.y === y), player = position.x === x && position.y === y;
      const cell = G.key(x, y), b = existing.get(cell) ?? document.createElement('button');
      visible.add(cell); b.type = 'button'; b.tabIndex = entity ? 0 : -1;
      delete b.dataset.player; delete b.dataset.facing; delete b.dataset.blocked;
      b.title = player ? '我' : entity?.name ?? tile.name;
      b.textContent = player ? '我' : entity?.glyph ?? (glyph === ground ? ' ' : glyph);
      b.className = player ? 'player' : entity ? entity.kind : tile.walkable ? 'ground' : 'terrain';
      if (entity?.kind === 'exit' && context.scene?.exits.find(exit => exit.id === entity.ref)?.blocked) { b.dataset.blocked = 'true'; b.title = `${entity.name}（暂不可通行）`; }
      if (entity && near.some(e => e.id === entity.id)) b.classList.add('near');
      if (player) { b.dataset.player = 'true'; const [dx, dy] = position.facing; b.dataset.facing = dx > 0 ? 'right' : dx < 0 ? 'left' : dy < 0 ? 'up' : 'down'; }
      b.dataset.cell = cell; b.setAttribute('aria-label', `${b.title}，${x}列${y}行`);
      b.disabled = disabled || player || !tile.walkable;
      b.onclick = () => { void handlers.goTo(x, y, entity); };
      if (board.children[index] !== b) board.insertBefore(b, board.children[index] ?? null);
      index++;
    }
    for (const cell of [...board.children]) if (!visible.has(cell.dataset.cell)) cell.remove();
    if (focused) {
      const cell = [...board.children].find(cell => cell.dataset.cell === focused);
      if (cell && !cell.disabled && document.activeElement !== cell) cell.focus({ preventScroll: true });
    }
  },
});
