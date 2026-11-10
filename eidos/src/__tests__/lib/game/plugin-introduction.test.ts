import { expect, it } from 'vitest';
import { parsePluginFile } from '@/lib/game/plugins/manifest';
import { exportPluginFile } from '@/lib/game/plugins/library';
import { parseGlobalPlugin } from '@/lib/game/global-plugins/manifest';
import { exportGlobalPlugins } from '@/lib/game/global-plugins/library';
import { gameplayPluginForModel } from '@/lib/game/plugins/model-manifest';
import { comparePluginRelease } from '@/lib/game/plugins/update-candidates';
const image = { src: 'data:image/png;base64,iVBORw0KGgo=', alt: '介绍图' };
const introduction = { impacts: ['layout', 'gameplay'], images: [image] };
const gameplay = { format: 'eidos-gameplay-plugin', version: 1, id: 'intro-test', name: '介绍测试', description: '说明', tags: [], prompts: { creation: '', action: '', review: '' }, rules: [], introduction };
it('compares numeric releases without claiming that unknown schemes are newer', () => {
  expect(comparePluginRelease('1.10.0', '1.9')).toBe(1);
  expect(comparePluginRelease('v2.0', '2.0.0')).toBe(0);
  expect(comparePluginRelease('1.0-beta', '1.0')).toBeNull();
});
it('round-trips gameplay and global introductions without putting pictures into model context', () => {
  const p = parsePluginFile(gameplay)[0];
  expect(JSON.parse(exportPluginFile([p])).introduction).toEqual(introduction);
  expect(gameplayPluginForModel(p)).not.toHaveProperty('introduction');
  const global = parseGlobalPlugin({ format: 'eidos-global-plugin', version: 1, id: 'global-intro', name: '全局测试', release: '1.0', description: '说明', css: 'body{}', introduction });
  expect(JSON.parse(exportGlobalPlugins([global])).plugins[0].introduction).toEqual(introduction);
});
it('rejects executable or remote pictures and malformed declarations while accepting legacy packages', () => {
  expect(() => parsePluginFile({ ...gameplay, introduction: { ...introduction, images: [{ src: 'data:image/svg+xml;base64,PHN2Zz4=', alt: 'x' }] } })).toThrow();
  expect(() => parsePluginFile({ ...gameplay, introduction: { ...introduction, images: [{ src: 'https://example.com/x.png', alt: 'x' }] } })).toThrow();
  expect(() => parsePluginFile({ ...gameplay, introduction: { ...introduction, impacts: ['system-access'] } })).toThrow();
  expect(parsePluginFile({ ...gameplay, introduction: undefined })[0]).not.toHaveProperty('introduction');
});
