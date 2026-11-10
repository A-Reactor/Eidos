function lines(text: string): string[] {
  if (!text) return [];
  const result = text.replace(/\r\n/g, '\n').split('\n');
  if (result.at(-1) === '') result.pop();
  return result;
}
/** Bound the quadratic middle for large rewrites; count that changed block as replacement. */
export function lineChanges(before: string, after: string): { added: number; removed: number } {
  const a = lines(before), b = lines(after);
  let first = 0, endA = a.length, endB = b.length;
  while (first < endA && first < endB && a[first] === b[first]) first++;
  while (endA > first && endB > first && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const removed = endA - first, added = endB - first;
  if (!removed || !added || removed * added > 1_000_000) return { added, removed };
  const row = new Uint32Array(added + 1);
  for (let i = first; i < endA; i++) {
    let previous = 0;
    for (let j = 1; j <= added; j++) {
      const old = row[j];
      row[j] = a[i] === b[first + j - 1] ? previous + 1 : Math.max(row[j], row[j - 1]);
      previous = old;
    }
  }
  return { added: added - row[added], removed: removed - row[added] };
}
