import { compileCardTemplate, type TemplateNode } from './template-compiler';
import { evaluateExpression, type TemplateContext } from './template-expression';
import { variablePath, readVariable } from './variable-path';

export function validateCardTemplate(source: string) {
  validateMacros(source); compileCardTemplate(source);
}
function validateMacros(source: string) {
  for (const match of source.matchAll(/\{\{([^{}]+)\}\}/g)) {
    if (/^(char|user)$/i.test(match[1])) continue;
    if (/^getvar::[^{}]+$/i.test(match[1])) { variablePath(match[1].slice(8)); continue; }
    throw new Error(`模板未支持的宏：${match[1]}`);
  }
}
export function renderCardTemplate(source: string, context: TemplateContext): string {
  validateMacros(source);
  const locals: Record<string, unknown> = Object.create(null);
  const pieces: string[] = []; let length = 0;
  const append = (text: string) => { length += text.length; if (length > 100_000) throw new Error('模板输出长度上限'); pieces.push(text); };
  const appendSource = (text: string) => {
    let offset = 0;
    // Resolve only source macros: evaluated values remain literal and cannot inject a second lookup.
    for (const match of text.matchAll(/\{\{(char|user|getvar::[^{}]+)\}\}/gi)) {
      append(text.slice(offset, match.index));
      const macro = match[1].toLowerCase();
      append(macro === 'char' ? context.char : macro === 'user' ? context.user : output(readVariable({ ...context.variables, stat_data: context.variables }, match[1].slice(8))));
      offset = match.index! + match[0].length;
    }
    append(text.slice(offset));
  };
  const render = (nodes: TemplateNode[], scope = locals) => {
    for (const node of nodes) {
      if (node.kind === 'text') appendSource(node.text);
      else if (node.kind === 'local') scope[node.name] = evaluateExpression(node.expression, context, scope);
      else if (node.kind === 'if') render(evaluateExpression(node.condition, context, scope) ? node.yes : node.no, { ...scope });
      else {
        const value = output(evaluateExpression(node.expression, context, scope));
        append(node.escaped ? escapeHtml(value) : value);
      }
    }
  };
  render(compileCardTemplate(source));
  return pieces.join('');
}
function output(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') throw new Error('模板输出只支持标量');
  return String(value);
}
function escapeHtml(text: string) { return text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&#34;', "'": '&#39;' })[char]!); }
