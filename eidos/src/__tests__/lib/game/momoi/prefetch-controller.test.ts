import { expect, it, vi } from 'vitest';
import { VoicePrefetchController } from '@/lib/game/momoi/prefetch-controller';
import { VoiceLibrary } from '@/lib/game/momoi/library';
import { buildVoiceRequest, DEFAULT_VOICE_CONFIG } from '@/lib/game/momoi/model';
import type { StorySegment } from '@/lib/ai/types';

const audio = { audioBase64: 'UklGRg==', mimeType: 'audio/wav' };
const dialogue = (text: string): StorySegment => ({ type: 'dialogue', text, speaker: '甲' });
function fixture() {
  let finish!: (value: typeof audio) => void;
  const calls: string[] = [];
  const library = new VoiceLibrary({}, async () => {}, async request => {
    calls.push(request.text);
    return calls.length === 1 ? new Promise(resolve => { finish = resolve; }) : audio;
  });
  const failed = vi.fn();
  const controller = new VoicePrefetchController({ library, requestForSegment: segment => buildVoiceRequest(segment, DEFAULT_VOICE_CONFIG), onError: failed });
  return { library, controller, calls, failed, release: () => finish(audio) };
}
it('starts closed dialogue during streaming, excludes drafts, and bounds early work to two lines', async () => {
  const f = fixture(), first = dialogue('完整首句。');
  const ensure = vi.spyOn(f.library, 'ensure');
  f.controller.update({ segments: [first, dialogue('草稿')], index: 0, streaming: true, lastIsDraft: true, active: true });
  await vi.waitFor(() => expect(f.calls).toEqual(['完整首句。']));
  f.controller.update({ segments: [first, dialogue('草稿还在增长')], index: 0, streaming: true, lastIsDraft: true, active: true });
  expect(ensure).toHaveBeenCalledTimes(1);
  const segments = [first, dialogue('第二句。'), dialogue('第三句。'), dialogue('末句草稿')];
  f.controller.update({ segments, index: 0, streaming: true, lastIsDraft: true, active: true });
  await vi.waitFor(() => expect(f.library.queueItems.map(item => item.text)).toEqual(['完整首句。', '第二句。']));
  f.controller.update({ segments, index: 0, streaming: false, active: true });
  await vi.waitFor(() => expect(f.library.queueItems).toHaveLength(4));
  expect(f.library.queueItems.map(item => item.priority)).toEqual(['current', 'next', 'next', 'prefetch']);
  f.release(); await vi.waitFor(() => expect(Object.keys(f.library.assets)).toHaveLength(4));
  expect(f.failed).not.toHaveBeenCalled(); f.controller.dispose();
});
it('drops skipped waiting lines and promotes the next two after jumping forward', async () => {
  const f = fixture(), segments = ['一', '二', '三', '四', '五'].map(dialogue);
  f.controller.update({ segments, index: 0, streaming: false, active: true });
  await vi.waitFor(() => expect(f.library.queueItems).toHaveLength(5));
  f.controller.update({ segments, index: 3, streaming: false, active: true });
  await vi.waitFor(() => expect(f.library.queueItems.map(item => item.text)).toEqual(['一', '四', '五']));
  expect(f.library.queueItems.slice(1).map(item => item.priority)).toEqual(['current', 'next']);
  f.release(); await vi.waitFor(() => expect(f.library.queueItems).toHaveLength(0));
  expect(f.calls).toEqual(['一', '四', '五']);
  expect(Object.keys(f.library.assets)).toHaveLength(3);
  expect(f.failed).not.toHaveBeenCalled(); f.controller.dispose();
});
it('cancels obsolete waiters on pause, while a shared playback and completed audio survive', async () => {
  const f = fixture(), segments = ['一', '二'].map(dialogue);
  f.controller.update({ segments, index: 0, streaming: false, active: true });
  await vi.waitFor(() => expect(f.library.queueItems).toHaveLength(2));
  const playback = f.library.ensure(buildVoiceRequest(segments[1], DEFAULT_VOICE_CONFIG)!, false, { priority: 'current' });
  await vi.waitFor(() => expect(f.library.queueItems[1].priority).toBe('current'));
  f.controller.update({ segments, index: 0, streaming: false, active: false });
  f.release(); await playback;
  expect(f.calls).toEqual(['一', '二']); expect(f.failed).not.toHaveBeenCalled(); f.controller.dispose();
});
it('halts automatic work after one failure instead of sending the remaining lines', async () => {
  const synthesize = vi.fn().mockRejectedValue(new Error('offline'));
  const library = new VoiceLibrary({}, async () => {}, synthesize), failed = vi.fn();
  const controller = new VoicePrefetchController({ library, requestForSegment: segment => buildVoiceRequest(segment, DEFAULT_VOICE_CONFIG), onError: failed });
  const view = { segments: ['一', '二', '三'].map(dialogue), index: 0, streaming: false, active: true };
  controller.update(view);
  await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce());
  controller.update(view); await new Promise(resolve => setTimeout(resolve, 20));
  expect(synthesize).toHaveBeenCalledOnce(); expect(library.queueItems).toHaveLength(0); controller.dispose();
});

it('refills the local original streaming window as complete lines finish, without waiting for done or a page turn', async () => {
  const f = fixture(), segments = ['一', '二', '三', '四', '仍在增长的草稿'].map(dialogue);
  f.controller.update({ segments, index: 0, streaming: true, lastIsDraft: true, active: true });
  await vi.waitFor(() => expect(f.library.queueItems.map(item => item.text)).toEqual(['一', '二']));
  f.release();
  await vi.waitFor(() => expect(Object.values(f.library.assets).map(asset => asset.text)).toEqual(['一', '二', '三', '四']));
  expect(f.calls).toEqual(['一', '二', '三', '四']);
  expect(f.failed).not.toHaveBeenCalled(); f.controller.dispose();
});

it('resumes the remaining prefetch after successful foreground synthesis proves the service recovered', async () => {
  let offline = true;
  const calls: string[] = [];
  const library = new VoiceLibrary({}, async () => {}, async request => {
    calls.push(request.text);
    if (offline) throw new Error('offline');
    return audio;
  });
  const failed = vi.fn(), segments = ['一', '二', '三'].map(dialogue);
  const controller = new VoicePrefetchController({ library, requestForSegment: segment => buildVoiceRequest(segment, DEFAULT_VOICE_CONFIG), onError: failed });
  controller.update({ segments, index: 0, streaming: false, active: true });
  await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce());
  offline = false;
  await library.ensure(buildVoiceRequest(segments[0], DEFAULT_VOICE_CONFIG)!, false, { priority: 'current' });
  await vi.waitFor(() => expect(Object.values(library.assets).map(asset => asset.text)).toEqual(['一', '二', '三']));
  expect(calls).toEqual(['一', '一', '二', '三']);
  expect(failed).toHaveBeenCalledOnce(); controller.dispose();
});

it.each(['translated', 'remote'])('does not refill unconfirmed %s material beyond the early allowance', async kind => {
  const synthesize = vi.fn().mockResolvedValue(audio), library = new VoiceLibrary({}, async () => {}, synthesize);
  const config = kind === 'translated'
    ? { ...DEFAULT_VOICE_CONFIG, material: 'translated' as const, translationLanguage: 'ja' as const }
    : { ...DEFAULT_VOICE_CONFIG, provider: 'compatible' as const };
  const controller = new VoicePrefetchController({ library, requestForSegment: segment => buildVoiceRequest(segment, config), onError: vi.fn() });
  const view = { segments: ['一', '二', '三'].map(dialogue), index: 0, streaming: true, active: true };
  controller.update(view);
  await vi.waitFor(() => expect(Object.values(library.assets).map(asset => asset.text)).toEqual(['一', '二']));
  controller.update(view);
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(synthesize).toHaveBeenCalledTimes(2);
  controller.update({ ...view, streaming: false });
  await vi.waitFor(() => expect(Object.keys(library.assets)).toHaveLength(3)); controller.dispose();
});

it('does not interpret cached playback as backend recovery', async () => {
  const synthesize = vi.fn().mockResolvedValue(audio), library = new VoiceLibrary({}, async () => {}, synthesize);
  const cached = buildVoiceRequest(dialogue('已缓存'), DEFAULT_VOICE_CONFIG)!;
  await library.ensure(cached);
  synthesize.mockRejectedValue(new Error('offline'));
  const failed = vi.fn(), controller = new VoicePrefetchController({ library, requestForSegment: segment => buildVoiceRequest(segment, DEFAULT_VOICE_CONFIG), onError: failed });
  controller.update({ segments: ['一', '二', '三'].map(dialogue), index: 0, streaming: false, active: true });
  await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce());
  await library.ensure(cached, false, { priority: 'current' });
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(synthesize).toHaveBeenCalledTimes(2); controller.dispose();
});

it('keeps an explicit queue cancellation stopped after shared foreground work succeeds', async () => {
  const f = fixture(), segments = ['一', '二', '三'].map(dialogue);
  f.controller.update({ segments, index: 0, streaming: false, active: true });
  await vi.waitFor(() => expect(f.library.queueItems).toHaveLength(3));
  const foreground = f.library.ensure(buildVoiceRequest(segments[0], DEFAULT_VOICE_CONFIG)!, false, { priority: 'current' });
  f.library.cancelWaiting();
  await new Promise(resolve => setTimeout(resolve, 0));
  f.release(); await foreground;
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(f.calls).toEqual(['一']); expect(f.library.queueItems).toEqual([]);
  expect(f.failed).not.toHaveBeenCalled(); f.controller.dispose();
});
