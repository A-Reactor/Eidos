// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { WorldBriefEditor } from '@/components/game/creation/WorldBriefEditor';
import { SourceReconstructionPanel } from '@/components/game/creation/SourceReconstructionPanel';
import { SourceStylePicker } from '@/components/game/creation/SourceStylePicker';
import { briefFromConcept, WORLD_BRIEF_FIELDS } from '@/lib/game/world-creation-brief';
import type { WorldForm } from '@/lib/game/creation-materials';
afterEach(cleanup);
const form = { ...Object.fromEntries(WORLD_BRIEF_FIELDS.map(k => [k, ''])), name: '雨港', narrativeStyle: 'balanced' } as WorldForm;
it('allows per-field source choices only for text worlds and retains explicit constraints', () => {
  const brief = briefFromConcept({ form }), onEdit = vi.fn();
  const view = render(React.createElement(WorldBriefEditor, { brief, disabled: false, onEdit }));
  expect(screen.queryByRole('option', { name: '遵照原文' })).toBeNull();
  view.rerender(React.createElement(WorldBriefEditor, { brief: { ...brief, origin: 'source' }, disabled: false, onEdit }));
  fireEvent.change(screen.getByLabelText('重要人物来源'), { target: { value: 'custom' } });
  expect(onEdit).toHaveBeenLastCalledWith({ field: 'npcs', policy: 'custom' });
  fireEvent.change(screen.getByLabelText('重要人物'), { target: { value: '阿岚是医师' } });
  expect(onEdit).toHaveBeenLastCalledWith({ field: 'npcs', text: '阿岚是医师' });
  fireEvent.click(screen.getByRole('button', { name: '重要人物：AI 重新整理' }));
  expect(onEdit).toHaveBeenLastCalledWith({ field: 'npcs', required: true });
});
it('supports source ordering/removal and reports actual reading progress', () => {
  const onDocuments = vi.fn();
  render(React.createElement(SourceReconstructionPanel, { draft: { title: '新资料', content: '' }, documents: [{ title: '一', content: '第一章' }, { title: '二', content: '末章' }], disabled: false, busy: true, progress: { completed: 1, total: 2, message: '阅读资料' }, onDraft: vi.fn(), onDocuments, onBuild: vi.fn() }));
  expect(screen.getByText('已读 1 / 2 个片段')).toBeTruthy();
  expect(screen.getByRole('button', { name: '上移二' })).toHaveProperty('disabled', true);
});
it('allows choosing original style without displaying it as a concept preset', () => {
  const brief = briefFromConcept({ form }); brief.origin = 'source';
  brief.styleChoice = 'source';
  brief.sourceStyle = { traits: '短句和感官细节', samples: [] };
  const onEdit = vi.fn();
  render(React.createElement(SourceStylePicker, { brief, candidates: [], disabled: false, onEdit }));
  fireEvent.click(screen.getByRole('button', { name: '遵照原文文风' }));
  expect(onEdit).toHaveBeenCalledWith({ styleChoice: 'source' });
  expect(screen.getByText('短句和感官细节')).toBeTruthy();
});
