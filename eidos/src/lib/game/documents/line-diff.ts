export interface LineDiff { rows: Array<{ kind: 'same' | 'removed' | 'added'; text: string }>; omitted: number; identical: boolean }
/** A bounded prefix/suffix diff avoids quadratic work on imported multi-megabyte text. */
export function lineDiff(before: string, after: string, limit = 160): LineDiff {
  if (before === after) return { rows: [], omitted: 0, identical: true };
  const old = before.split('\n'), next = after.split('\n');
  let start = 0, oldEnd = old.length, nextEnd = next.length;
  while (start < oldEnd && start < nextEnd && old[start] === next[start]) start++;
  while (oldEnd > start && nextEnd > start && old[oldEnd - 1] === next[nextEnd - 1]) { oldEnd--; nextEnd--; }
  const rows: LineDiff['rows'] = old.slice(Math.max(0, start - 3), start).map(text => ({ kind: 'same', text }));
  const removed = old.slice(start, Math.min(oldEnd, start + limit / 2)), added = next.slice(start, Math.min(nextEnd, start + limit / 2));
  rows.push(...removed.map(text => ({ kind: 'removed' as const, text })), ...added.map(text => ({ kind: 'added' as const, text })));
  rows.push(...next.slice(nextEnd, nextEnd + 3).map(text => ({ kind: 'same' as const, text })));
  return { rows, omitted: oldEnd - start + nextEnd - start - removed.length - added.length, identical: false };
}
