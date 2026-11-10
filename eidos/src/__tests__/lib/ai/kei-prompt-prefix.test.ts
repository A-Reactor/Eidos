import { describe, expect, it } from 'vitest';
import { buildKeiPromptSections } from '@/lib/ai/kei-prompts';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { resolveGameplayPlugins } from '@/lib/game/plugins/builtins';
const world = { ...buildRiftCityStartState().world, gameplayPlugins: resolveGameplayPlugins(['mystery']) };
describe('KEI stable review templates', () => {
  it.each(['light', 'quality', 'causal'] as const)('%s keeps proposals, context, plugin state and mode outside its prefix', level => {
    const first = buildKeiPromptSections({ level, world, validationContext: '当前状态甲', updatesText: '提案甲', hasPendingRipples: false, runtimeAdditions: '后台模式甲' });
    const next = buildKeiPromptSections({ level, world, worldFlags: { 'gameplay.mystery.solved': true }, validationContext: '当前状态乙', updatesText: '提案乙', hasPendingRipples: true, runtimeAdditions: '未验证提案，不能当事实' });
    expect(first.stablePrefix).toBe(next.stablePrefix);
    for (const value of ['提案乙', '当前状态乙', '"gameplay.mystery.solved":true', '未验证提案，不能当事实']) expect(next.dynamicSuffix).toContain(value);
    expect(next.stablePrefix).toContain('## 输出 JSON');
    expect(next.stablePrefix).toContain('插件不能授予文件、网络或沙箱工具权限');
    if (level === 'quality') {
      expect(next.stablePrefix).not.toContain('triggeredEnding');
      expect(next.stablePrefix).not.toContain('achievementsSuggested');
      expect(next.stablePrefix).toContain('## 叙事导演审核');
    }
    if (level === 'causal') {
      expect(first.stablePrefix).toContain('projectionVerifications');
      expect(first.dynamicSuffix).toContain('无待验证预测');
      expect(next.dynamicSuffix).toContain('仅核对列出的待验证预测');
    }
  });
});

 it('keeps conditional review guides dynamic and puts current evidence before the changing proposal', () => {
 const conditional={...world,gameplayPlugins:world.gameplayPlugins.map(p=>({...p,activation:{requires:{solved:true}}}))};
 const a=buildKeiPromptSections({level:'quality',world:conditional,validationContext:'当前证据甲',updatesText:'新提案甲',hasPendingRipples:false,runtimeAdditions:''});
 const b=buildKeiPromptSections({level:'quality',world:conditional,worldFlags:{'gameplay.mystery.solved':true},validationContext:'当前证据甲',updatesText:'新提案乙',hasPendingRipples:false,runtimeAdditions:''});
 expect(a.stablePrefix).toBe(b.stablePrefix);
 expect(b.dynamicSuffix.indexOf('当前证据甲')).toBeLessThan(b.dynamicSuffix.indexOf('新提案乙'));
 });
