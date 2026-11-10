// ============================================================
// Eidos · 档案卷宗命名空间
// ============================================================
// 普通卷宗使用现有 key；沙箱卷宗用 sandbox_<dossier>_ 前缀隔离。

export const DEFAULT_SANDBOX_DOSSIER_ID = "002";
export const CURRENT_SAVE_SESSION_KEY = "eidos_current_save";
export const CURRENT_ARCHIVE_SCOPE_SESSION_KEY = "eidos_current_archive_scope";
const ORDINARY_ARCHIVE_SCOPE = "ordinary";

export interface ArchiveScopeSource {
  sandboxMode?: boolean;
  sandboxDossierId?: string | null;
}

export function getSandboxDossierId(dossierId?: string | null): string {
  const normalized = (dossierId ?? DEFAULT_SANDBOX_DOSSIER_ID).trim();
  return normalized.length > 0 ? normalized : DEFAULT_SANDBOX_DOSSIER_ID;
}

export function getArchiveScopeId(source: ArchiveScopeSource): string | null {
  return source.sandboxMode ? getSandboxDossierId(source.sandboxDossierId) : null;
}

export function scopeStorageKey(source: ArchiveScopeSource, key: string): string {
  const scopeId = getArchiveScopeId(source);
  return scopeId ? `sandbox_${sanitizeScopeId(scopeId)}_${key}` : key;
}

export function sandboxStorageKey(dossierId: string | null | undefined, key: string): string {
  return `sandbox_${sanitizeScopeId(getSandboxDossierId(dossierId))}_${key}`;
}

export function archiveScopeSessionValue(source: ArchiveScopeSource): string {
  const scopeId = getArchiveScopeId(source);
  return scopeId ? `sandbox:${sanitizeScopeId(scopeId)}` : ORDINARY_ARCHIVE_SCOPE;
}

export function currentSaveSessionKey(source: ArchiveScopeSource): string {
  return scopeStorageKey(source, CURRENT_SAVE_SESSION_KEY);
}

export function writeCurrentSaveToSession(source: ArchiveScopeSource, saveId: string): void {
  if (typeof window === "undefined" || !saveId) return;
  try {
    sessionStorage.setItem(CURRENT_ARCHIVE_SCOPE_SESSION_KEY, archiveScopeSessionValue(source));
    sessionStorage.setItem(currentSaveSessionKey(source), saveId);
  } catch {
    // sessionStorage is advisory context for image/gallery routing.
  }
}

export function readCurrentSaveFromSession(): string {
  if (typeof window === "undefined") return "";
  try {
    const scope = sessionStorage.getItem(CURRENT_ARCHIVE_SCOPE_SESSION_KEY);
    if (scope?.startsWith("sandbox:")) {
      const dossierId = scope.slice("sandbox:".length);
      return sessionStorage.getItem(sandboxStorageKey(dossierId, CURRENT_SAVE_SESSION_KEY)) ?? "";
    }
    return sessionStorage.getItem(CURRENT_SAVE_SESSION_KEY) ?? "";
  } catch {
    return "";
  }
}

function sanitizeScopeId(id: string): string {
  return id
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    || DEFAULT_SANDBOX_DOSSIER_ID;
}
