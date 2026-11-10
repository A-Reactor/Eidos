// ============================================================
// 统一 API 响应格式
// ============================================================
// 所有 API 路由应使用此类型，确保前端可以一致地处理成功/错误。
// 渐进迁移：新路由优先使用，现有路由逐步适配。

/** 统一 API 响应包装 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  /** 机器可读的错误码，用于前端区分处理策略 */
  code?: ApiErrorCode;
}

export type ApiErrorCode =
  | "TIMEOUT"
  | "PARSE_ERROR"
  | "API_ERROR"
  | "VALIDATION_ERROR"
  | "ABORTED"
  | "NOT_FOUND";

/** 构建成功响应 */
export function apiSuccess<T>(data: T): ApiResponse<T> {
  return { success: true, data };
}

/** 构建错误响应 */
export function apiError(message: string, code?: ApiErrorCode): ApiResponse<never> {
  return { success: false, error: message, ...(code ? { code } : {}) };
}
