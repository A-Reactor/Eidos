/** Own UI code uses the existing SDK; original card HTML/scripts remain inert. */
export const CARD_PANEL_HTML = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><style>
body{margin:0;padding:12px;color:#c8e9eb;background:#102023;font:13px system-ui}h3{margin:0 0 8px;font-size:14px}dl{display:flex;gap:12px;flex-wrap:wrap;margin:0}dt{opacity:.6;font-size:11px}dd{margin:3px 0}button{padding:6px 9px;color:inherit;border:1px solid #426268;background:transparent;cursor:pointer}#actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:9px}#hint{opacity:.6;font-size:11px}
</style></head><body><h3 id="name"></h3><dl id="values"></dl><p id="hint"></p><div id="actions"></div><script>
Eidos.onContext(context => {
 document.getElementById('name').textContent = context.plugin.name;
 const values = document.getElementById('values'); values.replaceChildren();
 for (const item of context.state.publicVariables || []) {
  const block = document.createElement('div'), label = document.createElement('dt'), value = document.createElement('dd');
  label.textContent = item.path; value.textContent = String(item.value ?? ''); block.append(label,value); values.append(block);
 }
 document.getElementById('hint').textContent = values.childElementCount ? '变量随已接受的行动与回溯变化' : '作者未声明公开变量';
 const actions = document.getElementById('actions'); actions.replaceChildren();
 for (const action of (context.actions || []).slice(0,4)) {
  const button = document.createElement('button'); button.textContent = action;
  button.disabled = context.reading.loading || context.reading.paused || context.reading.typing || !context.reading.complete;
  button.onclick = () => Eidos.submit(action); actions.append(button);
 }
});
</script></body></html>`;
