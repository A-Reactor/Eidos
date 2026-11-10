import { reviewWorldCreation } from './source-reconstruction/acceptance';
import type { WorldCreationInput } from './world-creation-compiler';
import type { WorldDefinition } from '@/lib/game/types';
import type { WorldCreationSession } from '@/lib/game/world-creation-session';
import { stableHash } from '@/lib/game/source-reconstruction/source-index';
import type { SourceTaskDependencies } from './source-reconstruction/runner';

/** Creative preferences must not turn a finished world into an open-ended review task. */
export async function reviewWorldDraftOnce(input: WorldCreationInput, world: WorldDefinition,
  options: { session: WorldCreationSession; dependencies: SourceTaskDependencies; checkpoint: () => void | Promise<void> }) {
  const { session, dependencies, checkpoint } = options;
  const needsReview = input.brief?.origin === 'source' || Object.values(input.brief?.fields ?? {}).some(field => field.required);
  if (!needsReview) return [];
  const context = stableHash([input.brief, input.dossier, input.skillGuide]);
  const fieldsHash = stableHash(session.fields);
  if (session.review?.context !== context) {
    const issues = await reviewWorldCreation(input, world, { ...dependencies, verificationScope: 'constraints', maxRepairs: 0 });
    session.review = { context, fieldsHash, issues };
    await checkpoint();
  }
  // One targeted author correction is allowed; its structure and exact source identities
  // are still checked locally, without buying another whole-world opinion.
  return session.review.issues.filter(issue => !issue.blocking || session.review!.fieldsHash === fieldsHash);
}
