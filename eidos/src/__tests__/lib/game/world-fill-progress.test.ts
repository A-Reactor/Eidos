import { expect, it } from 'vitest';
import { createWorldFillTracker } from '@/lib/game/world-fill-progress';

it('reports completed and currently filling fields before the JSON response finishes', () => {
  const tracker = createWorldFillTracker();
  tracker.push('{"name":"雨港","subtitle":"渡口","regions":{"port":{"scenes":{');
  expect(tracker.snapshot()).toMatchObject({ completedFields: ['name', 'subtitle'], currentField: 'regions' });
  tracker.push('}}},"timeline":[{"id":"wt_1","description":"事件"},');
  expect(tracker.snapshot()).toMatchObject({ completedFields: ['name', 'subtitle', 'regions'], currentField: 'timeline', eventCount: 1 });
});

it('observes nested update fields and ignores names embedded in prose or plugin data', () => {
  const tracker = createWorldFillTracker();
  const text = '```json\n{"toolRequest":{"method":"world.update","params":{"fields":{"overview":"包含 \\\"regions\\\":{} 的文字","gameModeConfig":{"name":"不是标题","npcs":[]},"npcs":{"林":"医师"}}}}}';
  for (const char of text) tracker.push(char);
  expect(tracker.snapshot()).toMatchObject({ completedFields: ['overview', 'gameModeConfig', 'npcs'], currentField: undefined });
});

it('keeps escaped quotes, backslashes and unicode keys correct across arbitrary chunk boundaries', () => {
  const source = '{"\\u006eame":"雨\\\\港\\\"口","regions":{},"timeline":[{"id":"event","description":"[{}]"}]}';
  for (let size = 1; size < 9; size++) {
    const tracker = createWorldFillTracker();
    for (let pos = 0; pos < source.length; pos += size) tracker.push(source.slice(pos, pos + size));
    expect(tracker.snapshot()).toEqual({ completedFields: ['name', 'regions', 'timeline'], currentField: undefined, eventCount: 1, hasTimeline: true });
  }
});

it('does not treat read requests or unfinished values as completed world fields', () => {
  const tracker = createWorldFillTracker();
  tracker.push('{"toolRequest":{"method":"world.read","params":{"fields":["name","regions"]}}}');
  expect(tracker.snapshot().completedFields).toEqual([]);
  const partial = createWorldFillTracker(); partial.push('{"overview":"尚未写完');
  expect(partial.snapshot()).toMatchObject({ completedFields: [], currentField: 'overview' });
});

it('tracks identity fill as part of either a full world or an ordinary update', () => {
  for (const prefix of ['{', '{"toolRequest":{"method":"world.update","params":{"fields":{']) {
    const tracker = createWorldFillTracker();
    tracker.push(prefix + '"identityOptions":[{"id":"visitor","name":"访客"');
    expect(tracker.snapshot().currentField).toBe('identityOptions');
    tracker.push('}]}');
    expect(tracker.snapshot().completedFields).toContain('identityOptions');
  }
});
