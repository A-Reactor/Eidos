/** Saves and CAS snapshots share subtrees; revisiting them can multiply export work. */
export function* exportValues(root: unknown): Generator<unknown> {
  const seen = new WeakSet<object>(), pending = [root];
  while (pending.length) {
    const value = pending.pop();
    if (value && typeof value === 'object') {
      if (seen.has(value)) continue;
      seen.add(value);
      const children = Object.values(value);
      for (let i = children.length - 1; i >= 0; i--) pending.push(children[i]);
    }
    yield value;
  }
}
