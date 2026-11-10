// ============================================================
// Eidos · API 重试工具
// ============================================================

export interface RetryOptions {
  /** 最大重试次数（默认 3） */
  maxRetries?: number;
  /** 基础延迟（毫秒，默认 1000） */
  baseDelayMs?: number;
  /** 最大延迟（毫秒，默认 30000） */
  maxDelayMs?: number;
  /** 判断错误是否可重试。返回 true = 重试，false = 立即抛出 */
  shouldRetry?: (error: Error) => boolean;
}

/**
 * 带指数退避和抖动的重试包装器
 *
 * 仅重试网络/超时类错误（AbortError、TypeError）。
 * HTTP 4xx/5xx 错误不重试——它们不是瞬态故障。
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options?: RetryOptions
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 1000;
  const maxDelayMs = options?.maxDelayMs ?? 30000;
  const shouldRetry =
    options?.shouldRetry ??
    ((error: Error) => {
      // AbortError = 超时
      if (error.name === "AbortError") return true;
      // TypeError = 网络故障（fetch 在 DNS/连接失败时抛出）
      if (error instanceof TypeError) return true;
      return false;
    });

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // 最后一次尝试失败 → 抛出
      if (attempt >= maxRetries) break;

      // 不可重试的错误 → 立即抛出
      if (!shouldRetry(lastError)) break;

      // 指数退避 + 抖动
      const baseDelay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
      const jitter = baseDelay * (0.5 + Math.random() * 0.5);
      await new Promise((resolve) => setTimeout(resolve, jitter));
    }
  }

  throw lastError ?? new Error("Retry failed with unknown error");
}

/**
 * HTTP 错误类——用于区分网络错误和 API 错误
 */
export class HttpError extends Error {
  status: number;
  statusText: string;

  constructor(status: number, statusText: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.statusText = statusText;
  }
}
