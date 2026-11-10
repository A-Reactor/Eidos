// ============================================================
// AI Provider Error Normalization
// ============================================================

import { AiProviderError, type AiProviderErrorCode } from "./types";

export function normalizeProviderError(status: number | undefined, detail: string): AiProviderError {
  const code = codeForStatus(status, detail);
  return new AiProviderError(code, messageForCode(code, detail), status);
}

function codeForStatus(status: number | undefined, detail: string): AiProviderErrorCode {
  if (/missing\s+api\s+key/i.test(detail)) return "missing_api_key";
  if (status === 401 || status === 403) return "auth_failed";
  if (status === 404) return "model_not_found";
  if (status === 429) return "rate_limited";
  if (status === undefined) return "provider_unreachable";
  return "provider_error";
}

function messageForCode(code: AiProviderErrorCode, detail: string): string {
  switch (code) {
    case "missing_api_key":
      return "API key is missing.";
    case "auth_failed":
      return "Invalid API key or access denied.";
    case "rate_limited":
      return "Rate limit or quota exceeded.";
    case "model_not_found":
      return "Model not found.";
    case "json_mode_unsupported":
      return "JSON mode is not supported.";
    case "stream_unsupported":
      return "Streaming is not supported.";
    case "provider_unreachable":
      return `Connection failed: ${detail.slice(0, 160)}`;
    case "provider_error":
      return `Provider error: ${detail.slice(0, 160)}`;
  }
}
