import { readVariable, variablePath } from './variable-path';

export interface TemplateContext { char: string; user: string; variables: Record<string, unknown> }
export type Expression = { kind: 'literal'; value: unknown } | { kind: 'name'; name: string } |
  { kind: 'getvar'; path: string } | { kind: 'unary'; op: string; value: Expression } |
  { kind: 'binary'; op: string; left: Expression; right: Expression };
export interface CodeToken { text: string; literal?: string | number }
export function lexCode(code: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  const pattern = /\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\d+(?:\.\d+)?|===|!==|==|!=|>=|<=|&&|\|\||[A-Za-z_$][\w$]*|[(){};,=+*/%<>!\-]/gy;
  let offset = 0;
  while (offset < code.length) {
    pattern.lastIndex = offset;
    const match = pattern.exec(code);
    if (!match) throw new Error(`模板语法未支持：${code.slice(offset, offset + 30)}`);
    const text = match[0]; offset = pattern.lastIndex;
    if (/^\s|^\/\//.test(text) || text.startsWith('/*')) continue;
    const literal = /^['"]/.test(text) ? decodeString(text) : /^\d/.test(text) ? Number(text) : undefined;
    tokens.push({ text, ...(literal === undefined ? {} : { literal }) });
    if (tokens.length > 20_000) throw new Error('模板节点上限');
  }
  return tokens;
}
function decodeString(text: string) {
  if (/[\r\n]/.test(text) || /\\(?!u[\da-fA-F]{4}|[\\'"nrtbf])/.test(text)) throw new Error('模板字符串转义未支持');
  return text.slice(1, -1).replace(/\\(u[\da-fA-F]{4}|[\\'"nrtbf])/g, (_m, code: string) => {
    if (code.startsWith('u')) return String.fromCharCode(parseInt(code.slice(1), 16));
    return ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' } as Record<string, string>)[code] ?? code;
  });
}
const precedence: Record<string, number> = { '||': 1, '&&': 2, '===': 3, '!==': 3, '==': 3, '!=': 3, '>': 4, '<': 4, '>=': 4, '<=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };
export class ExpressionParser {
  index = 0;
  names = new Set(['char', 'user', 'true', 'false', 'null', 'undefined']);
  constructor(readonly tokens: CodeToken[]) {}
  peek() { return this.tokens[this.index]?.text; }
  take(text?: string) {
    const token = this.tokens[this.index++];
    if (!token || (text !== undefined && token.text !== text)) throw new Error(`模板语法未支持：期望 ${text ?? '表达式'}`);
    return token;
  }
  expression(min = 0, depth = 0): Expression {
    if (depth > 32) throw new Error('模板表达式深度上限');
    let left = this.atom(depth + 1);
    while ((precedence[this.peek() ?? ''] ?? -1) >= min) {
      const op = this.take().text;
      left = { kind: 'binary', op, left, right: this.expression(precedence[op] + 1, depth + 1) };
    }
    return left;
  }
  private atom(depth: number): Expression {
    const token = this.take();
    if (token.literal !== undefined) return { kind: 'literal', value: token.literal };
    if (['!', '-', '+'].includes(token.text)) return { kind: 'unary', op: token.text, value: this.expression(7, depth) };
    if (token.text === '(') { const value = this.expression(0, depth); this.take(')'); return value; }
    if (token.text === 'getvar') {
      this.take('('); const path = this.take().literal; this.take(')');
      if (typeof path !== 'string') throw new Error('getvar 只支持字面量路径');
      variablePath(path); return { kind: 'getvar', path };
    }
    if (!this.names.has(token.text)) throw new Error(`模板未支持的变量／宿主：${token.text}`);
    return { kind: 'name', name: token.text };
  }
}
export function evaluateExpression(node: Expression, context: TemplateContext, locals: Record<string, unknown>, depth = 0): unknown {
  if (depth > 64) throw new Error('模板求值深度上限');
  const evaluate = (expr: Expression) => evaluateExpression(expr, context, locals, depth + 1);
  if (node.kind === 'literal') return node.value;
  if (node.kind === 'name') return Object.hasOwn(locals, node.name) ? locals[node.name] : ({ char: context.char, user: context.user, true: true, false: false, null: null, undefined: undefined } as Record<string, unknown>)[node.name];
  if (node.kind === 'getvar') return readVariable({ ...context.variables, stat_data: context.variables }, node.path);
  if (node.kind === 'unary') { const value = evaluate(node.value); return node.op === '!' ? !value : numeric(node.op === '-' ? -Number(value) : Number(value)); }
  const left = evaluate(node.left);
  if (node.op === '&&') return left && evaluate(node.right);
  if (node.op === '||') return left || evaluate(node.right);
  return binary(node.op, left, evaluate(node.right));
}
function numeric(value: number) { if (!Number.isFinite(value)) throw new Error('模板算术结果非有限数'); return value; }
function binary(op: string, left: unknown, right: unknown): unknown {
  if (op === '===') return left === right;
  if (op === '!==') return left !== right;
  if (op === '==' || op === '!=') return op === '==' ? looseEqual(left, right) : !looseEqual(left, right);
  if (!['string', 'number', 'boolean', 'undefined'].includes(typeof left) || !['string', 'number', 'boolean', 'undefined'].includes(typeof right)) throw new Error('模板运算只支持标量');
  const a = left as number, b = right as number;
  if (op === '>') return a > b; if (op === '<') return a < b;
  if (op === '>=') return a >= b; if (op === '<=') return a <= b;
  if (op === '+' && (typeof left === 'string' || typeof right === 'string')) {
    const x = String(left), y = String(right);
    if (x.length + y.length > 100_000) throw new Error('模板中间字符串长度上限');
    return x + y;
  }
  const x = Number(left), y = Number(right);
  return numeric(op === '+' ? x + y : op === '-' ? x - y : op === '*' ? x * y : op === '/' ? x / y : x % y);
}
function looseEqual(left: unknown, right: unknown): boolean {
  if (left === null || left === undefined) return right === null || right === undefined;
  if (typeof left === typeof right) return left === right;
  if (typeof left === 'boolean') return looseEqual(Number(left), right);
  if (typeof right === 'boolean') return looseEqual(left, Number(right));
  return (typeof left === 'number' && typeof right === 'string') || (typeof left === 'string' && typeof right === 'number') ? Number(left) === Number(right) : false;
}
