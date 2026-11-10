import { normalizeGenerationProfile, type WorldGenerationProfile } from '@/lib/ai/world-generation-profile';
import type { CanonLedger, EvidenceAtom, SourceCorpus } from '@/lib/ai/source-archive';
import type { NarrativeStylePresetId } from './narrative-style';
import type { CreationCard } from './cards/creation';
import type { GameplayPlugin } from './plugins/types';
import type { WorldDefinition } from './types';

export interface WorldForm {
  name: string;
  overview: string;
  culture: string;
  regions: string;
  npcs: string;
  contradictions: string;
  history: string;
  clues: string;
  opening: string;
  narrativeStyle: NarrativeStylePresetId;
  narrativeStyleCustom?: string;
}

export type CreationMode = 'concept' | 'source_archive';
export interface SourceDocumentDraft { id?: string; title: string; content: string }

export interface CreationInputs {
  brief?: import('./world-creation-brief').WorldCreationBrief;
  generationProfile?: WorldGenerationProfile;
  cards?: CreationCard[];
  form: WorldForm;
  creationMode: CreationMode;
  selectedSkills: string[];
  gameplayPlugins?: GameplayPlugin[];
  sourceDraft: SourceDocumentDraft;
  sourceDocuments: SourceDocumentDraft[];
}

/** A checkpoint includes model output; it is only reusable when resuming that attempt. */
export interface CreationDraft extends CreationInputs {
  conversation?: import('./world-creation-session').WorldCreationSession;
  reconstruction?: import('./source-reconstruction/types').SourceReconstructionArchive;
  sourceCheckpointId?: string;
  structuralInputHash?: string;
  label?: string;
  concept: string;
  sourceCorpus: SourceCorpus | null;
  sourceEvidence: EvidenceAtom[];
  sourceLedger: CanonLedger | null;
  raw: Record<string, string>;
  completed: number[];
  world: WorldDefinition | null;
  startedAt: number;
  updatedAt: number;
  status: 'paused' | 'complete';
}

/** Use an allowlist so new checkpoint fields cannot silently become creative input. */
export function creationInputsFromPreset(draft: CreationDraft): CreationInputs {
  const form = draft.form;
  return structuredClone({
    brief: draft.brief,
    generationProfile: normalizeGenerationProfile(draft.generationProfile),
    cards: draft.cards ?? [],
    form: {
      name: form.name, overview: form.overview, culture: form.culture,
      regions: form.regions, npcs: form.npcs, contradictions: form.contradictions,
      history: form.history, clues: form.clues, opening: form.opening,
      narrativeStyle: form.narrativeStyle, narrativeStyleCustom: form.narrativeStyleCustom ?? '',
    },
    creationMode: draft.creationMode,
    selectedSkills: draft.selectedSkills,
    gameplayPlugins: draft.gameplayPlugins ?? [],
    sourceDraft: draft.sourceDraft,
    sourceDocuments: draft.sourceDocuments,
  });
}
