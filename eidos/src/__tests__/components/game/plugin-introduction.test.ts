// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { PluginIntroduction } from '@/components/game/PluginIntroduction';
import { parsePluginFile } from '@/lib/game/plugins/manifest';
import { exportPluginFile } from '@/lib/game/plugins/library';
import { parseGlobalPlugin } from '@/lib/game/global-plugins/manifest';
const plugin = parsePluginFile({ format: 'eidos-gameplay-plugin', version: 1, id: 'map', name: '文字地图', description: '说明', tags: [], prompts: { creation: '', action: '叙事', review: '' }, rules: [], ui: { html: '<main/>', reading: 'replace', presentation: 'scene-map' } })[0];
afterEach(cleanup);
it('explains the complete plugin without presenting impact categories as install options', () => {
  const { container } = render(React.createElement(PluginIntroduction, { plugin }));
  expect(screen.getByText(/^功能范围 ·/).textContent).toContain('界面布局');
  expect(screen.getByText('功能范围仅作说明，安装时使用完整插件。')).toBeDefined();
  expect(screen.queryByText(/作者补充标注/)).toBeNull();
  expect(container.querySelector('input, button, fieldset, textarea, select')).toBeNull();
});
it('displays externally authored labels and images and preserves the original package on export', () => {
  const introduction = { impacts: ['layout' as const], images: [{ src: 'data:image/png;base64,iVBORw0KGgo=', alt: '地图演示' }] };
  const authored = { ...plugin, introduction };
  const { container } = render(React.createElement(PluginIntroduction, { plugin: authored }));
  expect(screen.getByText(/^作者补充标注 ·/).textContent).toContain('界面布局');
  expect(screen.getByRole('img', { name: '地图演示' }).getAttribute('src')).toBe(introduction.images[0].src);
  expect(container.querySelector('input, button')).toBeNull();
  expect(JSON.parse(exportPluginFile([authored])).introduction).toEqual(introduction);
});
it('also keeps application-wide plugin introductions read-only', () => {
  const global = parseGlobalPlugin({ format: 'eidos-global-plugin', version: 1, id: 'global', name: '全局扩展', release: '1', description: '全局说明', script: 'throw new Error("仅展示，不运行")' });
  const { container } = render(React.createElement(PluginIntroduction, { plugin: global }));
  expect(screen.getByText(/^插件类型 ·/).textContent).toContain('全局插件');
  expect(screen.getByText(/^功能范围 ·/).textContent).toContain('含应用脚本');
  expect(container.querySelector('input, button')).toBeNull();
});
