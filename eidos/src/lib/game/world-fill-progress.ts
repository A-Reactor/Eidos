import { WORLD_CREATION_FIELDS, type WorldCreationField } from './world-creation-session';

type Frame = { kind: '{' | '['; path: string[]; key?: string; state: 'key' | 'value' | 'after' };
export interface WorldFillProgress { completedFields: string[]; currentField?: string; eventCount: number; hasTimeline: boolean }
const fieldAt = (path: string[]): WorldCreationField | undefined => {
  const key = path.at(-1) as WorldCreationField;
  return WORLD_CREATION_FIELDS.includes(key) && (path.length === 1 || path.length === 4 && path.slice(0, 3).join('.') === 'toolRequest.params.fields') ? key : undefined;
};

/** A read-only stream observer. It never alters JSON, submits fields or requests a model turn. */
export function createWorldFillTracker() {
  const frames: Frame[] = [], completed = new Set<string>();
  let started = false, quoted = false, escaped = false, keyString = false, keyBuffer = '';
  let stringOwner: Frame | undefined, primitive: Frame | undefined, currentField: string | undefined;
  let eventCount = 0, hasTimeline = false;
  const valuePath = (owner: Frame) => [...owner.path, owner.kind === '{' ? owner.key ?? '' : '*'];
  const beginValue = (owner?: Frame) => {
    if (!owner) return;
    const field = fieldAt(valuePath(owner));
    if (field) { currentField = field; if (field === 'timeline') hasTimeline = true; }
  };
  const finishValue = (owner?: Frame) => {
    if (!owner) return;
    const field = fieldAt(valuePath(owner));
    if (field) { completed.add(field); currentField = undefined; }
    owner.state = 'after';
  };
  const stringCharacter = (char: string) => {
    if (keyString) keyBuffer += char;
    if (escaped) { escaped = false; return; }
    if (char === '\\') { escaped = true; return; }
    if (char !== '"') return;
    quoted = false;
    if (keyString && stringOwner) {
      try { stringOwner.key = JSON.parse(keyBuffer); } catch { stringOwner.key = undefined; }
    } else finishValue(stringOwner);
  };
  const structuralCharacter = (char: string) => {
    const owner = frames.at(-1);
    if (char === '"') {
      quoted = true; escaped = false; stringOwner = owner;
      keyString = owner?.kind === '{' && owner.state === 'key'; keyBuffer = keyString ? '"' : '';
      if (!keyString) beginValue(owner);
    } else if (char === ':' && owner) { owner.state = 'value'; beginValue(owner); }
    else if (char === '{' || char === '[') {
      beginValue(owner);
      frames.push({ kind: char, path: owner ? valuePath(owner) : [], state: char === '{' ? 'key' : 'value' });
    } else if (char === '}' || char === ']') {
      const closed = frames.pop();
      if (closed?.kind === '{' && closed.path.at(-1) === '*' && fieldAt(closed.path.slice(0, -1)) === 'timeline') eventCount++;
      finishValue(frames.at(-1));
    } else if (char === ',' && owner) { owner.state = owner.kind === '{' ? 'key' : 'value'; owner.key = undefined; }
    else if (owner?.state === 'value' && !/\s/.test(char)) { beginValue(owner); primitive = owner; }
  };
  return {
    push(delta: string) {
      for (const char of delta) {
        if (!started) { if (char === '{') { started = true; frames.push({ kind: '{', path: [], state: 'key' }); } continue; }
        if (quoted) { stringCharacter(char); continue; }
        if (primitive) {
          if (!/[\s,}\]]/.test(char)) continue;
          finishValue(primitive); primitive = undefined;
        }
        structuralCharacter(char);
      }
    },
    snapshot(): WorldFillProgress { return { completedFields: [...completed], currentField, eventCount, hasTimeline }; },
  };
}

export const WORLD_FILL_SECTIONS = [
  { id: 'name', label: '名称', fields: ['name', 'subtitle'] },
  { id: 'overview', label: '概况', fields: ['overview'] },
  { id: 'regions', label: '地图', fields: ['regions'] },
  { id: 'npcs', label: '人物', fields: ['npcs'] },
  { id: 'identityOptions', label: '身份', fields: ['identityOptions'] },
  { id: 'contradictions', label: '矛盾', fields: ['contradictions'] },
  { id: 'history', label: '历史', fields: ['history'] },
  { id: 'clues', label: '线索', fields: ['clues'] },
  { id: 'timeline', label: '走向', fields: ['timeline'] },
  { id: 'gameModeConfig', label: '玩法', fields: ['gameModeConfig'] },
] as const;
