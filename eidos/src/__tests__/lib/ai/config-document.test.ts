import { describe, expect, it } from 'vitest';
import { exportAiConfig, importAiConfig } from '@/lib/ai/config-document';
import { DEFAULT_SETTINGS } from '@/lib/game/types';

function document() { return JSON.parse(exportAiConfig(DEFAULT_SETTINGS)); }
describe('portable AI configuration', () => {
  it('round trips all three connections and generation options without secrets or unrelated settings', () => {
    const settings = { ...DEFAULT_SETTINGS, aliceApiKey: 'private-key', aliceUserPrompt: 'private-instructions', aiCompatibleJsonMode: false, maxTokens: 7000 };
    const raw = exportAiConfig(settings);
    expect(raw).not.toContain('private-key'); expect(raw).not.toContain('private-instructions');
    expect(importAiConfig(raw, settings)).toMatchObject({ aliceModel: 'deepseek-v4-flash', keiModel: 'deepseek-v4-pro', uzqModel: 'deepseek-v4-pro', aiCompatibleJsonMode: false, maxTokens: 7000, aliceApiKey: 'private-key', aiProviderMode: 'advanced' });
    expect(importAiConfig(raw, settings)).not.toHaveProperty('fontSize');
  });
  it('clears existing credentials when importing another provider or endpoint, and ignores embedded keys', () => {
    const doc = document();
    doc.roles.alice = { ...doc.roles.alice, providerId: 'custom-openai-compatible', endpoint: 'http://localhost:1234/v1', model: 'my-local-model', apiKey: 'untrusted' };
    doc.roles.kei.endpoint = 'https://other.example/v1';
    expect(importAiConfig(JSON.stringify(doc), { ...DEFAULT_SETTINGS, aliceApiKey: 'old', keiApiKey: 'old-kei', uzqApiKey: 'retain' })).toMatchObject({ aliceProviderId: 'custom-openai-compatible', aliceApiKey: '', keiApiKey: '', uzqApiKey: 'retain' });
  });
  it.each([
    (d: ReturnType<typeof document>) => { d.version = 2; },
    (d: ReturnType<typeof document>) => { d.roles.alice.providerId = 'unknown'; },
    (d: ReturnType<typeof document>) => { d.roles.alice.providerId = 'toString'; },
    (d: ReturnType<typeof document>) => { d.roles.alice.endpoint = 'https://secret:password@example.com/v1'; },
    (d: ReturnType<typeof document>) => { d.roles.alice.endpoint = 'https://example.com/v1?api_key=secret'; },
    (d: ReturnType<typeof document>) => { d.roles.alice.endpoint = 'file:///tmp/model'; },
    (d: ReturnType<typeof document>) => { d.roles.alice.enableReasoning = 'false'; },
    (d: ReturnType<typeof document>) => { d.generation.maxTokens = -1; },
    (d: ReturnType<typeof document>) => { delete d.roles.kei; },
  ])('rejects malformed or unsupported configurations atomically', change => {
    const doc = document(); change(doc);
    expect(() => importAiConfig(JSON.stringify(doc), DEFAULT_SETTINGS)).toThrow();
    expect(DEFAULT_SETTINGS.aliceProviderId).toBe('deepseek');
  });
  it('rejects invalid JSON and oversized files with a readable error', () => {
    expect(() => importAiConfig('{', DEFAULT_SETTINGS)).toThrow(/JSON/);
    expect(() => importAiConfig(' '.repeat(128 * 1024 + 1), DEFAULT_SETTINGS)).toThrow(/128/);
  });
});
