/** 找真正的顶层键；字符串、范例对象和嵌套档案中的同名键不属于回复协议。 */
export function topLevelJsonValueStart(input: string, key: string): number {
  let depth = 0, quoted = -1, escaped = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted >= 0) {
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (char !== '"') continue;
      if (depth === 1 && input.slice(quoted, i + 1) === JSON.stringify(key)) {
        let next = i + 1;
        while (next < input.length && /\s/.test(input[next])) next++;
        if (input[next] === ':') {
          next++;
          while (next < input.length && /\s/.test(input[next])) next++;
          return next;
        }
      }
      quoted = -1;
    } else if (char === '"') quoted = i;
    else if (char === '{' || char === '[') depth++;
    else if (char === '}' || char === ']') depth--;
  }
  return -1;
}

/** 只返回该字段的容器范围；截断时保留已到达部分，不吞入后面的元数据。 */
export function topLevelJsonContainer(input: string, key: string): { text: string; complete: boolean } | undefined {
  const start = topLevelJsonValueStart(input, key);
  if (start < 0 || !['{', '['].includes(input[start])) return undefined;
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{' || char === '[') depth++;
    else if (char === '}' || char === ']') {
      depth--;
      if (depth === 0) return { text: input.slice(start, i + 1), complete: true };
    }
  }
  return { text: input.slice(start), complete: false };
}
