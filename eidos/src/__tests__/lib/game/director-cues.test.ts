import { expect, it } from 'vitest';
import { captureDirectorCue, renderDirectorCue } from '@/lib/game/director-cues';
import type { DirectorFrame, KeiReviewOrigin } from '@/lib/ai/types';
const origin: KeiReviewOrigin = { worldId:'w',playthroughId:'p',worldLineId:'l',archiveScope:'ordinary',parentNodeId:'root',actionId:'reviewed-N' };
const frame: DirectorFrame = { beatFunction:'setup',tensionTarget:'hold',narrativeFocus:[],revealBudget:{allowNewSecret:false,maxFactsToReveal:0,forbiddenFacts:['保密']},successCriteria:['承接钥匙'] };
it('appends at actual adoption and leaves the previous record unchanged for duplicate, revision and withdrawal', () => {
 const a=captureDirectorCue({origin,afterNodeId:'N+2',frame})!;
 const text=renderDirectorCue(a);
 expect(a.afterNodeId).toBe('N+2'); expect(a.origin.actionId).toBe('reviewed-N');
 expect(captureDirectorCue({origin,afterNodeId:'N+3',frame:undefined,previous:a})).toBeNull();
 expect(captureDirectorCue({origin,afterNodeId:'N+3',frame,previous:a})).toBeNull();
 const b=captureDirectorCue({origin,afterNodeId:'N+3',frame:null,previous:a})!;
 expect(b).toMatchObject({kind:'withdraw',frame:null,replaces:a.id,revision:2});
 expect(renderDirectorCue(a)).toBe(text); expect(text).toContain('保密');
 expect(captureDirectorCue({origin,afterNodeId:'N+2',frame})).toEqual(a);
});
