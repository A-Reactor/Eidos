/** Kept as a string because author HTML executes in an opaque-origin iframe. */
export const WORKSPACE_SDK = `
 const pending = new Map(); const eventListeners = new Set(); const seen = new Set(); let sequence = 0;
 const rpc = (method, params = {}) => new Promise((resolve, reject) => {
  if (!context) { reject(new Error('等待宿主连接')); return; }
  const id = String(++sequence);
  const timer = setTimeout(() => { pending.delete(id); reject(new Error('操作超时')); }, 125000);
  pending.set(id, { resolve, reject, timer, scope: context.scope }); send('rpc', { id, method, params });
 });
 const importFile = async (path, file, expectedVersion) => {
  if (!file || typeof file.arrayBuffer !== 'function') throw new Error('请选择或拖入文件');
  if (file.size > 4 * 1024 * 1024) throw new Error('单份材料超过 4 MB');
  const mimeType = file.type || (/\\.(txt|md|json|csv|log|ya?ml)$/i.test(file.name) ? 'text/plain' : 'application/octet-stream');
  let resource;
  if (mimeType.startsWith('text/') || /\\.(txt|md|json|csv|log|ya?ml)$/i.test(file.name)) resource = { mimeType, text: await file.text() };
  else { const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ''; for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192)); resource = { mimeType, base64: btoa(binary) }; }
  return rpc('resources.import', { path, resource, expectedVersion });
 };
 const workspaceApi = {
  capabilities() { return context?.capabilities || {}; },
  world: Object.freeze({ files: Object.freeze({ read: (path, version) => rpc('world.files.read', {path, version}) }), notice: message => rpc('world.notice', { message }), interact: (intent, state) => rpc('world.interact', { intent, ...(state === undefined ? {} : { state }) }) }),
  gameplay: Object.freeze({
   perform: (ruleId, options = {}) => rpc('gameplay.perform', { ...options, ruleId, id: options.id || crypto.randomUUID(), expectedRevision: options.expectedRevision ?? context?.state?._eidosGameplay?.revision ?? 0 }),
   commit: operation => rpc('gameplay.commit', { ...operation, id: operation.id || crypto.randomUUID(), expectedRevision: operation.expectedRevision ?? context?.state?._eidosGameplay?.revision ?? 0 }),
   narrate: id => rpc('gameplay.narrate', {id})
  }),
  onEvent(fn) { eventListeners.add(fn); return () => eventListeners.delete(fn); },
  files: Object.freeze({
   list: () => rpc('files.list'), read: path => rpc('files.read', {path}),
   write: (path, text, options = {}) => rpc('files.write', { path, text, ...options }),
   remove: (path, expectedVersion) => rpc('files.remove', { path, expectedVersion }),
   export: path => rpc('files.export', {path}),
   checkout: path => rpc('files.checkout', {path}), reload: path => rpc('files.reload', {path}),
   publish: (path, key) => rpc('files.publish', {path, key}),
   receive: (key, path, expectedVersion) => rpc('files.receive', {key, path, expectedVersion})
  }),
  resources: Object.freeze({ import: importFile, inspect: (path, task, options = {}) => rpc('resources.inspect', {path, task, ...options}), cancel: () => rpc('resources.cancel') }),
  stages: Object.freeze({ open: stage => rpc('stages.open', stage), update: stage => rpc('stages.update', stage), close: id => rpc('stages.close', {id}), list: () => rpc('stages.list') })
 };
 const deliverEvents = next => {
  const events = next.state?._eidosWorkspace?.events || [];
  for (const event of events) if (!seen.has(event.id)) { seen.add(event.id); for (const fn of eventListeners) { try { fn(event); } catch { fail(); } } }
  if (seen.size > 256) { seen.clear(); for (const event of events) seen.add(event.id); }
 };
 const rpcResult = data => {
  const task = pending.get(data.id); if (!task || data.scope !== task.scope) return;
  pending.delete(data.id); clearTimeout(task.timer);
  if (data.ok) task.resolve(data.result); else task.reject(new Error(data.error || '操作失败'));
 };
`;
