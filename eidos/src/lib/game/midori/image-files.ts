import fs from 'node:fs/promises';
import path from 'node:path';
import { GENERATED_ROOT, imageFilePath, imagePublicUrl } from './image-paths';
import { IMAGE_FILE_EXTENSION } from './image-format';

export interface ImageFile {
  relativePath: string;
  filename: string;
  url: string;
  fileSize: number;
  lastModified: number;
}

export function fileMissing(cause: unknown): boolean {
  return (cause as NodeJS.ErrnoException)?.code === 'ENOENT';
}

/** Refuse symlink escapes as well as textual traversal before reading or deleting a file. */
export async function existingImagePath(worldId: string, relativePath: string): Promise<string | null> {
  const candidate = imageFilePath(worldId, relativePath);
  try {
    const [root, actual] = await Promise.all([fs.realpath(GENERATED_ROOT), fs.realpath(candidate)]);
    const worldRoot = path.join(root, worldId) + path.sep;
    if (!actual.startsWith(worldRoot)) throw new Error('Image path leaves world directory');
    if (!(await fs.stat(actual)).isFile()) throw new Error('Image path is not a file');
    return candidate;
  } catch (cause) {
    if (fileMissing(cause)) return null;
    throw cause;
  }
}

export async function listImageFiles(worldId: string, directory: string): Promise<ImageFile[]> {
  const files: ImageFile[] = [];
  async function walk(relativeDir: string): Promise<void> {
    // Validate the root and every nested directory before touching the filesystem.
    const dir = path.dirname(imageFilePath(worldId, `${relativeDir}/probe.png`));
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); }
    catch (cause) { if (fileMissing(cause)) return; throw cause; }
    for (const entry of entries) {
      const relativePath = `${relativeDir}/${entry.name}`;
      if (entry.isDirectory()) await walk(relativePath);
      else if (entry.isFile() && IMAGE_FILE_EXTENSION.test(entry.name)) {
        const actual = await existingImagePath(worldId, relativePath);
        if (!actual) continue;
        const stat = await fs.stat(actual).catch(cause => { if (fileMissing(cause)) return null; throw cause; });
        if (stat) files.push({ relativePath, filename: entry.name, url: imagePublicUrl(worldId, relativePath), fileSize: stat.size, lastModified: stat.mtimeMs });
      }
    }
  }
  await walk(directory);
  return files.sort((a, b) => b.lastModified - a.lastModified || a.relativePath.localeCompare(b.relativePath));
}
