import { ExpressionParser, lexCode, type CodeToken, type Expression } from './template-expression';

export type TemplateNode = { kind: 'text'; text: string } | { kind: 'output'; expression: Expression; escaped: boolean } |
  { kind: 'local'; name: string; expression: Expression } | { kind: 'if'; condition: Expression; yes: TemplateNode[]; no: TemplateNode[] };
interface Token extends CodeToken { node?: TemplateNode }
function tokenize(source: string): Token[] {
  if (source.length > 100_000) throw new Error('模板长度上限');
  const tokens: Token[] = []; let offset = 0, trimNext = '';
  for (const tag of source.matchAll(/<%([_=\-#]?)([\s\S]*?)([_\-]?)%>/g)) {
    let text = source.slice(offset, tag.index);
    text = trimText(text, trimNext);
    if (tag[1] === '_') text = text.replace(/\s+$/, '');
    if (text) tokens.push({ text: '#text', node: { kind: 'text', text } });
    if (tag[1] === '=' || tag[1] === '-') {
      tokens.push({ text: tag[1] === '=' ? '#escaped' : '#raw' }, ...lexCode(tag[2]), { text: '#end' });
    } else if (tag[1] !== '#') tokens.push(...lexCode(tag[2]));
    trimNext = tag[3]; offset = tag.index! + tag[0].length;
    if (tokens.length > 20_000) throw new Error('模板节点上限');
  }
  let tail = source.slice(offset);
  if (tail.includes('<%')) throw new Error('模板标签未闭合');
  tail = trimText(tail, trimNext);
  if (tail) tokens.push({ text: '#text', node: { kind: 'text', text: tail } });
  return tokens;
}
function trimText(text: string, mode: string) { return mode === '_' ? text.replace(/^\s+/, '') : mode === '-' ? text.replace(/^\r?\n/, '') : text; }
class TemplateParser extends ExpressionParser {
  constructor(readonly templateTokens: Token[]) { super(templateTokens); }
  block(depth = 0): TemplateNode[] {
    if (depth > 32) throw new Error('模板分支深度上限');
    const nodes: TemplateNode[] = [];
    while (this.peek() && this.peek() !== '}') nodes.push(this.statement(depth));
    return nodes;
  }
  private statement(depth: number): TemplateNode {
    const token = this.templateTokens[this.index];
    if (token.node) { this.index++; return token.node; }
    if (this.peek() === '#raw' || this.peek() === '#escaped') {
      const escaped = this.take().text === '#escaped'; const expression = this.expression(); this.take('#end');
      return { kind: 'output', expression, escaped };
    }
    if (this.peek() === 'if') return this.conditional(depth + 1);
    if (this.peek() === 'const' || this.peek() === 'let') {
      this.take(); const name = this.take().text;
      if (!/^[A-Za-z_$][\w$]*$/.test(name) || ['getvar', 'char', 'user', 'true', 'false', 'null', 'undefined', '__proto__', 'constructor', 'prototype'].includes(name) || this.names.has(name)) throw new Error('模板局部变量名无效');
      this.take('='); const expression = this.expression(); this.take(';'); this.names.add(name);
      return { kind: 'local', name, expression };
    }
    throw new Error(`模板语句未支持：${this.peek()}`);
  }
  private conditional(depth: number): TemplateNode {
    if (depth > 32) throw new Error('模板分支深度上限');
    this.take('if'); this.take('('); const condition = this.expression(); this.take(')'); this.take('{');
    const outerNames = new Set(this.names);
    const yes = this.block(depth); this.take('}'); this.names = new Set(outerNames); let no: TemplateNode[] = [];
    if (this.peek() === 'else') {
      this.take();
      if (this.peek() === 'if') no = [this.conditional(depth + 1)];
      else { this.take('{'); no = this.block(depth); this.take('}'); }
    }
    this.names = outerNames; return { kind: 'if', condition, yes, no };
  }
}
const cache = new Map<string, TemplateNode[]>();
export function compileCardTemplate(source: string): TemplateNode[] {
  const cached = cache.get(source); if (cached) return cached;
  const parser = new TemplateParser(tokenize(source)); const nodes = parser.block();
  if (parser.peek()) throw new Error('模板分支未正确闭合');
  if (cache.size >= 64) cache.delete(cache.keys().next().value!);
  cache.set(source, nodes); return nodes;
}
