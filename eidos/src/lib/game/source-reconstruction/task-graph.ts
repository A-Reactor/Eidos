import type { SourceTaskGraph, SourceCoverage } from './types';

export function invalidateSourceTasks(graph: SourceTaskGraph, changedInputs: string[]): SourceTaskGraph {
  const next = structuredClone(graph), invalid = new Set(changedInputs);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of Object.values(next.tasks)) if (!invalid.has(node.id) && node.dependsOn.some(id => invalid.has(id))) { invalid.add(node.id); changed = true; }
  }
  for (const id of invalid) if (next.tasks[id]) { next.tasks[id].status = 'pending'; delete next.tasks[id].error; }
  return next;
}
export function taskCoverage(graph: SourceTaskGraph, expected: string[]): SourceCoverage {
  const completed = new Set<string>(), failed = new Set<string>();
  for (const task of Object.values(graph.tasks)) {
    if (task.status === 'complete') task.blockIds.forEach(id => completed.add(id));
    if (task.status === 'failed') task.blockIds.forEach(id => failed.add(id));
  }
  return { expected: [...new Set(expected)], completed: expected.filter(id => completed.has(id)), failed: expected.filter(id => failed.has(id) && !completed.has(id)) };
}
