import { expect, it } from 'vitest';
import { renderCardTemplate, validateCardTemplate } from '@/lib/game/cards/template';

const context = { char: '守门人', user: '旅人', variables: { Hero: { Level: [20, '等级'], Trust: 65 }, secret: '<门>&"' } };
it('evaluates the community getvar/const/if form without rewriting the source', () => {
  const source = "原文\n<%_ const herolv = getvar('stat_data.Hero.Level[0]'); if (herolv > 70) { _%>高等级<%_ } else if (herolv >= 20) { _%>初见 {{char}} 与 {{user}}<%_ } else { _%>拒绝<%_ } _%>\n尾";
  const result = renderCardTemplate(source, context);
  expect(result).toContain('初见 守门人 与 旅人'); expect(result).not.toContain('高等级');
  expect(renderCardTemplate(source, { ...context, variables: { Hero: { Level: [80, '等级'] } } })).toContain('高等级');
  expect(source).toContain('<%_ const');
});
it('distinguishes raw and HTML escaped output, while leaving ordinary text unchanged', () => {
  const source = "甲\\n  乙<%- getvar('stat_data.secret') %>|<%= getvar('stat_data.secret') %>|{{getvar::stat_data.Hero.Trust}}";
  expect(renderCardTemplate(source, context)).toBe('甲\\n  乙<门>&"|&lt;门&gt;&amp;&#34;|65');
});
it('short circuits missing paths and respects nested branches and arithmetic', () => {
  expect(renderCardTemplate("<% if (getvar('missing') && getvar('missing.x') > 2) { %>错<% } else { %><% if ((2 + 3) * 4 === 20) { %>对<% } %><% } %>", context)).toBe('对');
});
it('allows local output expressions and lexical block scopes', () => {
  expect(renderCardTemplate('<% const x = 3; if (true) { const y = x + 2; %><%- y %><% } %><%- x %>', context)).toBe('53');
  expect(() => validateCardTemplate('<% if (true) { const x = 3; } %><%- x %>')).toThrow();
});
it.each([
  '<% while (true) { %>循环<% } %>', '<%- globalThis %>', '<%- getvar("stat_data.constructor") %>',
  '<% getvar("stat_data.Hero").Level = 1; %>', '<% const x = fetch("https://example.com"); %>',
  '<% if (level > 70) { %>未知<% } %>', '{{setvar::x::2}}', '<% if (true) { %>缺少结束',
])('rejects unsupported or unsafe syntax before generation: %s', source => {
  expect(() => validateCardTemplate(source)).toThrow();
});
it('bounds nesting and generated output', () => {
  expect(() => validateCardTemplate('<% if (' + '('.repeat(80) + 'true' + ')'.repeat(80) + ') { %>x<% } %>')).toThrow(/深度/);
  expect(() => renderCardTemplate('<%- getvar("stat_data.x") %>', { ...context, variables: { x: '大'.repeat(100_001) } })).toThrow(/上限/);
});
it('matches newline-slurp and scalar loose comparison semantics without silent escape changes', () => {
  expect(renderCardTemplate('甲<% if (true) { -%>\n  保留缩进<% } %>', context)).toBe('甲  保留缩进');
  expect(renderCardTemplate('<% if ("20" == 20 && null == undefined) { %>对<% } %>', context)).toBe('对');
  expect(() => validateCardTemplate(String.raw`<%- getvar('stat_data.\x61') %>`)).toThrow(/转义/);
});
it('bounds intermediate strings before coercion and expands macros incrementally', () => {
  const declarations = Array.from({ length: 18 }, (_, i) => `const x${i + 1} = x${i} + x${i};`).join('');
  expect(() => renderCardTemplate(`<% const x0 = 'x'; ${declarations} %>小输出`, context)).toThrow(/上限/);
  expect(() => renderCardTemplate('{{user}}'.repeat(5000), { ...context, user: '大'.repeat(8000) })).toThrow(/上限/);
});
it('keeps evaluated variable text literal and respects escaped output', () => {
  const variables = { v: '{{getvar::secret}}', secret: '<秘密>' };
  expect(renderCardTemplate('<%= getvar("v") %>', { ...context, variables })).toBe('{{getvar::secret}}');
  expect(renderCardTemplate('<%= getvar("secret") %>', { ...context, variables })).toBe('&lt;秘密&gt;');
});
