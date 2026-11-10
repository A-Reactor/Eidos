import path from 'node:path';

// Player bundles keep user files outside the application so updating it preserves media.
export const GENERATED_ROOT = path.resolve(process.env.EIDOS_MEDIA_DIR || path.join(process.cwd(), 'public', 'generated'));
