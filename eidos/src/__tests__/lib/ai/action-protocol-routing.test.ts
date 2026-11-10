import { describe, expect, it } from 'vitest';
import { buildActionPromptSections } from '@/lib/ai/prompt-templates';
import { composeSystemPrompt } from '@/lib/ai/prompt-layout';
import { buildSandboxToolProtocolContext } from '@/lib/ai/sandbox-tool-pipeline';

function prompt(sandbox: boolean) {
  return buildActionPromptSections({
    systemPromptBase: '一个普通的小镇故事。', worldName: '小镇', timeNote: '午后',
    worldContext: { stablePrefix: '', dynamicSuffix: '玩家正在买菜。' },
    pluginStatic: '', pluginRuntime: '', narrativeLanguage: 'zh-CN',
    runtimeAdditions: buildSandboxToolProtocolContext({ enabled: sandbox }),
  });
}

describe('action execution protocol routing', () => {
  it('does not advertise sandbox requests or permission workflows during ordinary dialogue', () => {
    const ordinary = composeSystemPrompt(prompt(false));
    expect(ordinary).not.toContain('sandboxToolRequests');
    expect(ordinary).not.toContain('许可已置位');
    expect(ordinary).not.toContain('快照');
  });

  it('adds real execution constraints only when the sandbox is enabled', () => {
    const ordinary = prompt(false), sandbox = prompt(true);
    expect(sandbox.stablePrefix).toBe(ordinary.stablePrefix);
    expect(sandbox.dynamicSuffix).toContain('sandboxToolRequests');
    expect(sandbox.dynamicSuffix).toContain('本轮生成的提议尚未执行');
    expect(sandbox.dynamicSuffix).toContain('较早正文中的成功宣称不能覆盖失败回执');
    expect(sandbox.dynamicSuffix).toContain('sandbox.restore_snapshot');
  });
});
