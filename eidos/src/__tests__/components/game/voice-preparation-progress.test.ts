// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { VoicePreparationProgress } from '@/components/game/momoi/VoicePreparationProgress';
import type { TrainingJob } from '@/lib/game/momoi/training-model';
afterEach(cleanup);
const view = (props: React.ComponentProps<typeof VoicePreparationProgress>) => React.createElement(VoicePreparationProgress, props);
const job = { status: 'preparing', stage: '自动转写', preparation: { phase: 'transcribing', completed: 2, total: 8 } } as TrainingJob;
it('shows the actual current phase count, then a completed bar only when review is ready', () => {
  const { rerender } = render(view({ job }));
  const bar = screen.getByRole('progressbar', { name: '素材处理进度' });
  expect(bar.getAttribute('value')).toBe('25');
  expect(screen.getByText(/2 \/ 8 段/)).toBeTruthy();
  rerender(view({ job: { ...job, status: 'review' } }));
  expect(screen.getByRole('progressbar').getAttribute('value')).toBe('100');
  expect(screen.getByText('素材处理完成，可以校对台词')).toBeTruthy();
  rerender(view({ job: { ...job, status: 'review', preparation: { phase: 'loading-asr' } } }));
  expect(screen.queryByText(/首次使用可能下载/)).toBeNull();
});
it('keeps submission, ASR loading and legacy jobs indeterminate instead of inventing a percent', () => {
  const { rerender } = render(view({ progress: { phase: 'submitting' } }));
  expect(screen.getByRole('progressbar').hasAttribute('value')).toBe(false);
  rerender(view({ job: { ...job, preparation: { phase: 'loading-asr' } } }));
  expect(screen.getByRole('progressbar').hasAttribute('value')).toBe(false);
  expect(screen.getByText(/首次使用可能下载/)).toBeTruthy();
  rerender(view({ job: { ...job, preparation: undefined } }));
  expect(screen.getByRole('progressbar').hasAttribute('value')).toBe(false);
});
it.each(['failed', 'cancelled'] as const)('preserves partial progress on %s and never labels it complete', status => {
  render(view({ job: { ...job, status } }));
  expect(screen.getByRole('progressbar').getAttribute('value')).toBe('25');
  expect(screen.getByText(status === 'failed' ? '素材处理失败' : '素材处理已取消')).toBeTruthy();
  expect(screen.queryByText('素材处理完成，可以校对台词')).toBeNull();
});
