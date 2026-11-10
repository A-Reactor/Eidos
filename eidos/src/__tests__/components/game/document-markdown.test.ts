// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { DocumentMarkdown } from '@/components/ui/DocumentMarkdown';
afterEach(cleanup);

it('renders headings, nested lists, emphasis, tables and fenced code as document structure', () => {
  const content = '# 报告\n\n**证据**与*推断*\n\n- 第一项\n  - 子项\n\n| 来源 | 结论 |\n| --- | --- |\n| 记录 | 已确认 |\n\n```ts\nconst value = "<tag>";\n```';
  const view = render(React.createElement(DocumentMarkdown, { content }));
  expect(screen.getByRole('heading', { level: 1, name: '报告' })).toBeDefined();
  expect(screen.getAllByRole('list')).toHaveLength(2);
  expect(view.container.querySelector('strong')?.textContent).toBe('证据');
  expect(view.container.querySelector('em')?.textContent).toBe('推断');
  expect(screen.getByRole('table').textContent).toContain('已确认');
  expect(view.container.querySelector('pre code')?.textContent).toBe('const value = "<tag>";\n');
});

it('keeps HTML and dangerous URLs inert and does not fetch remote images', () => {
  const view = render(React.createElement(DocumentMarkdown, { content: '<script>alert(1)</script>\n\n[危险](javascript:alert%281%29) [来源](https://example.com/source)\n\n![图片说明](https://example.com/track.png)' }));
  expect(view.container.querySelector('script')).toBeNull();
  expect(screen.getByText('危险').closest('a')?.getAttribute('href')).not.toContain('javascript:');
  expect(screen.getByRole('link', { name: '来源' }).getAttribute('rel')).toContain('noreferrer');
  expect(view.container.querySelector('img')).toBeNull();
  expect(screen.getByRole('link', { name: '图片说明' }).getAttribute('href')).toBe('https://example.com/track.png');
});
