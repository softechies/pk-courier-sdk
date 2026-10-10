import { CourierError } from './errors.js';
import type { CourierName, HttpOptions } from './types.js';

export interface RequestSpec {
  method: 'GET' | 'POST' | 'PUT';
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  /** Only idempotent requests are retried. */
  retry?: boolean;
}

const RETRY_DELAYS_MS = [400, 1200, 3000];

/** Small fetch wrapper: JSON in and out, timeouts, and retries for safe requests. */
export class HttpClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly retries: number;

  constructor(
    private readonly courier: CourierName,
    options: HttpOptions = {},
  ) {
    const impl = options.fetch ?? globalThis.fetch;
    if (!impl) {
      throw new Error('No fetch implementation found. Use Node 18+ or pass options.fetch.');
    }
    this.fetchImpl = impl;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.retries = options.retries ?? 2;
  }

  async request<T = unknown>(spec: RequestSpec): Promise<T> {
    const attempts = spec.retry ? this.retries + 1 : 1;
    let lastError: unknown;

    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) {
        await sleep(RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)]!);
      }

      try {
        return await this.send<T>(spec);
      } catch (error) {
        lastError = error;
        const retryable =
          !(error instanceof CourierError) || (error.httpStatus !== undefined && error.httpStatus >= 500);
        if (!retryable) throw error;
      }
    }

    if (lastError instanceof CourierError) throw lastError;
    throw new CourierError(this.courier, `Request failed: ${describe(lastError)}`, { cause: lastError });
  }

  private async send<T>(spec: RequestSpec): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(spec.url, {
        method: spec.method,
        headers: {
          Accept: 'application/json',
          ...(spec.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...spec.headers,
        },
        body: spec.body !== undefined ? JSON.stringify(spec.body) : undefined,
        signal: controller.signal,
      });

      const text = await response.text();
      const data = parseJson(text);

      if (!response.ok) {
        throw new CourierError(this.courier, `HTTP ${response.status}: ${messageFrom(data) ?? (text.slice(0, 200) || response.statusText)}`, {
          httpStatus: response.status,
          raw: data ?? text,
        });
      }
      if (data === undefined) {
        throw new CourierError(this.courier, `Expected JSON but got: ${text.slice(0, 120)}`, { httpStatus: response.status, raw: text });
      }
      return data as T;
    } catch (error) {
      if (error instanceof CourierError) throw error;
      if (controller.signal.aborted) {
        throw new CourierError(this.courier, `Timed out after ${this.timeoutMs} ms`, { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

function parseJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function messageFrom(data: unknown): string | undefined {
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    for (const key of ['statusMessage', 'message', 'error', 'errorMessage']) {
      if (typeof d[key] === 'string' && d[key]) return d[key] as string;
    }
  }
  return undefined;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
