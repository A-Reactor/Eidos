import { applyBriefEdit, type WorldCreationBrief } from '../world-creation-brief';
import type { SourceDossier } from './types';

export function restoreSourceBriefChoices(fresh: WorldCreationBrief, previous: WorldCreationBrief, dossier: SourceDossier): WorldCreationBrief {
  let edited = fresh;
  for (const key of Object.keys(previous.fields) as Array<keyof typeof edited.fields>) {
    const field = previous.fields[key];
    if (field.policy !== 'source') edited = applyBriefEdit(edited, { field: key, policy: field.policy, ...(field.policy === 'custom' ? { text: field.text } : {}), required: field.required }).brief;
    else if (field.required) edited = applyBriefEdit(edited, { field: key, required: true }).brief;
  }
  if (previous.startAnchor) {
    const anchor = dossier.starts.find(a => a.id === previous.startAnchor!.id);
    if (anchor) edited = applyBriefEdit(edited, { startAnchor: anchor }).brief;
  }
  const sameDossier = previous.sourceDossierRef === fresh.sourceDossierRef;
  const sameStyleAnchor = previous.sourceStyleAnchorId === edited.startAnchor?.id;
  if (previous.sourceStyle) {
    edited.sourceStyle = { traits: previous.sourceStyle.traits, samples: sameDossier && sameStyleAnchor ? dossier.styleCandidates.filter(candidate => previous.sourceStyle!.samples.some(prior => prior.id === candidate.id && prior.text === candidate.text && JSON.stringify(prior.ref) === JSON.stringify(candidate.ref))) : [] };
    if (sameDossier && sameStyleAnchor) edited.sourceStyleAnchorId = previous.sourceStyleAnchorId;
  }
  return applyBriefEdit(edited, { styleChoice: previous.styleChoice }).brief;
}
