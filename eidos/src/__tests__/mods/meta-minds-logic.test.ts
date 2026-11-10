import { expect, it } from 'vitest';
import { loadMetaMinds } from './meta-minds-fixtures';
const { meta, mind } = loadMetaMinds();
it('validates a reusable bounded stage graph and rejects broken cues, references, cycles and unreachable content', () => {
  const script = meta.sample(); expect(meta.parse(JSON.stringify(script))).toEqual(script);
  for (const corrupt of [
    (s: typeof script) => { s.nodes[0].choices[0].to = 'missing'; },
    (s: typeof script) => { s.nodes[0].cues[0].target = 'missing'; },
    (s: typeof script) => { s.nodes[1].choices[0].to = s.start; },
    (s: typeof script) => { s.nodes.push({ ...structuredClone(s.nodes.at(-1)!), id: 'orphan' }); },
    (s: typeof script) => { s.nodes[0].cues[0].kind = 'script' as 'replace'; },
  ]) { const value = structuredClone(script); corrupt(value); expect(() => meta.validate(value)).toThrow(); }
});
it('rewrites only accepted cues, retains originals and records the actual choice behind a changed button', () => {
  let run = meta.start(meta.sample()); const pristine = structuredClone(run);
  expect(() => meta.act(run, { type: 'choose', id: 'enter' })).toThrow();
  run = meta.act(run, { type: 'skip' }); run = meta.act(run, { type: 'choose', id: 'enter' });
  const before = meta.view(run);
  run = meta.act(run, { type: 'skip' }); const after = meta.view(run);
  expect(after.lines.some((line, i) => line.text !== before.lines[i].text && line.original === before.lines[i].text)).toBe(true);
  expect(after.choices[0].label).not.toBe(after.choices[0].original);
  run = meta.act(run, { type: 'choose', id: 'remember' });
  expect(run.history.at(-1)).toMatchObject({ choice: 'remember', label: '记住她的名字', shown: '忘了她的名字' });
  expect(pristine.played).toBe(0); expect(pristine.nodeId).toBe('threshold');
  expect(JSON.stringify(meta.operation(run).facts)).not.toContain('nodes');
});
it.each(['keep', 'return', 'erase'])('reaches a complete %s ending through the same local protocol', ending => {
  let run = meta.start(meta.sample());
  for (const id of ['enter', 'remember', ending]) { run = meta.act(run, { type: 'skip' }); run = meta.act(run, { type: 'choose', id }); }
  run = meta.act(run, { type: 'skip' });
  expect(meta.view(run)).toMatchObject({ complete: true, ending });
  expect(() => meta.act(run, { type: 'choose', id: 'enter' })).toThrow();
});
it('keeps private evidence local to its actual recipient and cannot farm trust with duplicates', () => {
  let run = mind.start(); const initial = structuredClone(run);
  run = mind.act(run, { type: 'inspect', id: 'fuse' });
  expect(run.actors.station.belief.cause).toBe('sabotage');
  run = mind.act(run, { type: 'tell', actor: 'station', id: 'fuse' });
  expect(run.actors.station.belief).toMatchObject({ cause: 'fuse', confidence: 3, source: 'player' });
  expect(run.actors.passenger.belief.cause).toBe('sabotage');
  expect(() => mind.act(run, { type: 'tell', actor: 'station', id: 'fuse' })).toThrow();
  expect(() => mind.act(initial, { type: 'tell', actor: 'station', id: 'fuse' })).toThrow();
  const facts = JSON.stringify(mind.operation(run).facts);
  expect(facts).not.toContain('confidence'); expect(facts).not.toContain('belief'); expect(facts).not.toContain('fuse');
  expect(initial.evidence).toEqual([]);
});
it('lets public proof correct witnesses while mediated testimony stays second hand', () => {
  let run = mind.act(mind.start(), { type: 'inspect', id: 'fuse' });
  run = mind.act(run, { type: 'mediate' });
  expect(run.actors.station.belief).toMatchObject({ cause: 'fuse', confidence: 2, source: 'mechanic' });
  run = mind.act(run, { type: 'tell', actor: 'station', id: 'fuse', public: true });
  expect(Object.values(run.actors).every(a => a.belief.cause === 'fuse' && a.belief.confidence === 3)).toBe(true);
  expect(mind.operation(run).facts.publicEvidence).toEqual(['fuse']);
});
it('settles commitments once, and actual cooperative repair fulfills them within the deadline', () => {
  let run = mind.act(mind.start(), { type: 'promise', actor: 'station' });
  run = mind.act(run, { type: 'inspect', id: 'fuse' });
  run = mind.act(run, { type: 'tell', actor: 'station', id: 'fuse', public: true });
  run = mind.act(run, { type: 'repair' });
  expect(run.repair).toBe(3); expect(run.promises[0].outcome).toBe('kept');
  expect(Object.values(run.actors).filter(a => a.helped).length).toBeGreaterThanOrEqual(2);
  expect(() => mind.act(run, { type: 'repair' })).toThrow();
  run = mind.act(run, { type: 'leave' }); expect(run.ending).toBe('cooperate');
  let broken = mind.act(mind.start(), { type: 'promise', actor: 'station' });
  for (let i = 0; i < 3; i++) broken = mind.act(broken, { type: 'wait' });
  expect(broken.promises[0].outcome).toBe('broken');
  const trust = broken.actors.station.trust;
  broken = mind.act(broken, { type: 'wait' });
  expect(broken.actors.station.trust).toBe(trust);
  expect(() => mind.act(broken, { type: 'promise', actor: 'station' })).toThrow();
});
it('makes hostility and deadlines matter, exposes only observable attitudes and always ends', () => {
  let run = mind.start();
  run = mind.act(run, { type: 'accuse', actor: 'mechanic' }); run = mind.act(run, { type: 'accuse', actor: 'mechanic' });
  expect(run.actors.mechanic.withdrew).toBe(true);
  expect(mind.view(run).actors.find(a => a.id === 'mechanic')!.attitude).toContain('退出');
  expect(JSON.stringify(mind.view(run).actors)).not.toContain('trust');
  while (run.status === 'open') run = mind.act(run, { type: 'wait' });
  expect(run.turn).toBe(10); expect(run.ending).toBe('stranded');
  expect(() => mind.act(run, { type: 'wait' })).toThrow();
});
it('does not reward promises about finished work and closes outstanding commitments on early departure', () => {
  let run = mind.act(mind.start(), { type: 'inspect', id: 'fuse' });
  run = mind.act(run, { type: 'tell', actor: 'station', id: 'fuse', public: true }); run = mind.act(run, { type: 'repair' });
  expect(() => mind.act(run, { type: 'promise', actor: 'station' })).toThrow();
  let early = mind.act(mind.start(), { type: 'promise', actor: 'station' });
  early = mind.act(early, { type: 'leave' }); expect(early.promises[0].outcome).toBe('broken');
});

it('exports only the current visible stage in a bounded letter and rejects arbitrary received data', () => {
  const letter = meta.letter(meta.start(meta.sample()));
  expect(letter.text).not.toContain('署名信'); expect(meta.parseLetter(JSON.stringify(letter)).text).toBe(letter.text);
  expect(() => meta.parseLetter(JSON.stringify({ text: 'forged' }))).toThrow();
});
it('gives a station keeper a public accountability boundary instead of the same help rule as the mechanic', () => {
  let run = mind.act(mind.start(), { type: 'inspect', id: 'fuse' });
  run = mind.act(run, { type: 'tell', actor: 'station', id: 'fuse' });
  run = mind.act(run, { type: 'repair' });
  expect(run.actors.mechanic.helped).toBe(true); expect(run.actors.station.helped).toBe(false); expect(run.repair).toBe(2);
  run = mind.act(run, { type: 'tell', actor: 'station', id: 'fuse', public: true });
  expect(run.actors.station.helped).toBe(true); expect(run.repair).toBe(3);
});
it('can make a first public disclosure after everyone saw a private copy without rewarding the same proof twice', () => {
  let run = mind.act(mind.start(), { type: 'inspect', id: 'fuse' });
  for (const actor of ['mechanic', 'station', 'passenger']) run = mind.act(run, { type: 'tell', actor, id: 'fuse' });
  const trust = Object.values(run.actors).map(a => a.trust);
  run = mind.act(run, { type: 'tell', actor: 'station', id: 'fuse', public: true });
  expect(run.publicEvidence).toEqual(['fuse']); expect(Object.values(run.actors).map(a => a.trust)).toEqual(trust);
  expect(() => mind.act(run, { type: 'tell', actor: 'station', id: 'fuse', public: true })).toThrow();
});
it('rejects prototype names as actors or evidence rather than treating inherited properties as game content', () => {
  for (const id of ['constructor', '__proto__', 'missing']) {
    expect(() => mind.act(mind.start(), { type: 'inspect', id })).toThrow();
    expect(() => mind.act(mind.start(), { type: 'ask', actor: id })).toThrow();
  }
});

it('can preserve every visible character of a maximum-size valid page in a cross-branch letter', () => {
  const script = meta.sample(), node = script.nodes[0];
  node.lines = Array.from({ length: 8 }, (_, i) => ({ id: 'line-' + i, text: '文'.repeat(500), speaker: '名'.repeat(60) }));
  node.cues = node.lines.map(line => ({ kind: 'aside', target: line.id, text: '注'.repeat(500) }));
  const run = meta.act(meta.start(meta.validate(script)), { type: 'skip' });
  const letter = meta.letter(run); expect(letter.text.match(/注/g)).toHaveLength(4000);
  expect(meta.parseLetter(JSON.stringify(letter)).text).toBe(letter.text);
});
