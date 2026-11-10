import type { GameStore } from '@/store/game-store';
import type { StreamRequestScope } from './stream-lifecycle';
import type { ReadingReference } from './reader-session';
import type { ObserverBranchPlan } from './observer-branch';

export interface ActionObservation {inputSource?:import("./chapters/types").ChapterInputSource;branch?:ObserverBranchPlan;reference?:ReadingReference;accepted?:boolean}
const requests=new Map<string,ActionObservation>();
export function bindActionObservation(scope:StreamRequestScope,observation:ActionObservation) {
 requests.set(scope.requestId,observation);
 while(requests.size>8) requests.delete(requests.keys().next().value!);
}
export const getActionObservation=(scope?:StreamRequestScope)=>scope ? requests.get(scope.requestId) : undefined;
/** A request's facts stay pinned while the player is free to look at other records. */
export function observedActionState(state:GameStore,scope?:StreamRequestScope):GameStore {
 const observation=getActionObservation(scope);
 return observation?.branch && !observation.accepted ? observation.branch.state : state;
}
export function observationContext(scope?:StreamRequestScope):string {
 const observation=getActionObservation(scope);if(!observation) return '';
 const reference=observation.reference;
 const data={inputSource:observation.inputSource,...(reference ? {readingReference:{...reference,sourceText:reference.sourceText.slice(0,12000),displayText:reference.displayText.slice(0,12000),partial:reference.sourceText.length>12000 || reference.displayText.length>12000}} : {}),
  ...(observation.branch ? {branchOrigin:{nodeId:observation.branch.interference.targetNodeId,observedFrom:observation.branch.interference.originNodeId,changes:observation.branch.interference.changes}} : {})};
 return Object.keys(data).length ? `\n## 本轮阅读引用与行动来源\n${JSON.stringify(data)}` : '';
}
