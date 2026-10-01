// SPDX-License-Identifier: AGPL-3.0-or-later

import { LRUCache } from 'lru-cache';
import type { Config } from '../config.js';

export type QueryValue = string | number | boolean | undefined | null | readonly (string | number)[];
export type Query = Record<string, QueryValue>;

export interface RequestOptions {
  signal?: AbortSignal | undefined;
  /** Overrides the default cache TTL; 0 disables caching for this call. */
  ttlMs?: number;
}

/** Error raised for any non-2xx answer, carrying the RFC 9457 problem detail when the API sends one. */
export class LeginovaHttpError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly detail: string | undefined,
  ) {
    super(`Leginova API ${status} on ${path}${detail ? `: ${detail}` : ''}`);
    this.name = 'LeginovaHttpError';
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }
}

/** A PDF above the LEGINOVA_MAX_PDF_MB limit, refused before or after download. */
export class PdfTooLargeError extends Error {
  override name = 'PdfTooLargeError';
}

class Semaphore {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

function retryDelay(attempt: number, retryAfter: string | null): number {
  const seconds = retryAfter ? Number.parseInt(retryAfter, 10) : Number.NaN;
  if (Number.isFinite(seconds)) return Math.min(seconds * 1000, 10_000);
  return 400 * 2 ** attempt + Math.floor(Math.random() * 200);
}

/**
 * Thin HTTP layer over the Leginova JSON API: bounded concurrency, timeout,
 * retries on transient failures, an LRU cache sized in bytes, and coalescing
 * of identical in-flight requests.
 */
export class HttpClient {
  private readonly cache: LRUCache<string, { value: unknown; size: number }>;
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly gate: Semaphore;

  constructor(readonly config: Config) {
    this.gate = new Semaphore(config.maxConcurrency);
    this.cache = new LRUCache({
      maxSize: Math.max(config.cacheMaxBytes, 1),
      sizeCalculation: (entry) => Math.max(entry.size, 1),
      ttl: config.cacheTtlMs || 1,
      ttlAutopurge: false,
    });
  }

  get apiBase(): string {
    return `${this.config.baseUrl}/api`;
  }

  buildUrl(path: string, query?: Query): string {
    const url = new URL(`${this.apiBase}${path}`);
    for (const [key, raw] of Object.entries(query ?? {})) {
      if (raw === undefined || raw === null || raw === '') continue;
      const values = Array.isArray(raw) ? raw : [raw];
      for (const value of values) url.searchParams.append(key, String(value));
    }
    return url.toString();
  }

  getJson<T>(path: string, query?: Query, options: RequestOptions = {}): Promise<T> {
    const url = this.buildUrl(path, query);
    return this.cached(`GET ${url}`, options, async () => {
      const res = await this.send(url, { method: 'GET', headers: { Accept: 'application/json' } }, path, options.signal);
      const text = await res.text();
      return { value: JSON.parse(text) as T, size: text.length * 2 };
    });
  }

  postJson<T>(path: string, body: unknown, options: RequestOptions = {}): Promise<T> {
    const url = this.buildUrl(path);
    const payload = JSON.stringify(body);
    return this.cached(`POST ${url} ${payload}`, options, async () => {
      const res = await this.send(
        url,
        { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: payload },
        path,
        options.signal,
      );
      const text = await res.text();
      return { value: JSON.parse(text) as T, size: text.length * 2 };
    });
  }

  /** Downloads a binary resource. Not cached: callers cache what they derive from it. */
  async getBytes(path: string, options: { signal?: AbortSignal | undefined; maxBytes: number }): Promise<Uint8Array> {
    const url = this.buildUrl(path);
    const res = await this.send(url, { method: 'GET', headers: { Accept: 'application/pdf,*/*' } }, path, options.signal);
    const declared = Number.parseInt(res.headers.get('content-length') ?? '', 10);
    if (Number.isFinite(declared) && declared > options.maxBytes) {
      await res.body?.cancel();
      throw new PdfTooLargeError(
        `${path} is ${(declared / 1048576).toFixed(1)} MB, above the ${(options.maxBytes / 1048576).toFixed(0)} MB limit (LEGINOVA_MAX_PDF_MB).`,
      );
    }
    const buffer = new Uint8Array(await res.arrayBuffer());
    if (buffer.byteLength > options.maxBytes) {
      throw new PdfTooLargeError(`${path} exceeds the ${(options.maxBytes / 1048576).toFixed(0)} MB limit (LEGINOVA_MAX_PDF_MB).`);
    }
    return buffer;
  }

  /** Memoizes an arbitrary derived value (parsed PDF text, article index...) in the same LRU. */
  memo<T>(key: string, compute: () => Promise<{ value: T; size: number }>, options: RequestOptions = {}): Promise<T> {
    return this.cached(`MEMO ${key}`, options, compute);
  }

  private async cached<T>(
    key: string,
    options: RequestOptions,
    load: () => Promise<{ value: T; size: number }>,
  ): Promise<T> {
    const useCache = options.ttlMs !== 0 && this.config.cacheTtlMs > 0;
    if (useCache) {
      const hit = this.cache.get(key);
      if (hit) return hit.value as T;
    }
    const pending = this.inflight.get(key);
    if (pending) return pending as Promise<T>;

    const promise = load()
      .then((entry) => {
        if (useCache && entry.size <= this.config.cacheMaxBytes) {
          this.cache.set(key, entry, options.ttlMs ? { ttl: options.ttlMs } : undefined);
        }
        return entry.value;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }

  private async send(url: string, init: RequestInit, path: string, signal?: AbortSignal): Promise<Response> {
    const headers = { 'User-Agent': this.config.userAgent, ...(init.headers as Record<string, string>) };
    for (let attempt = 0; ; attempt++) {
      const timeout = AbortSignal.timeout(this.config.timeoutMs);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      let res: Response;
      try {
        res = await this.gate.run(() => fetch(url, { ...init, headers, signal: combined }));
      } catch (error) {
        if (signal?.aborted) throw error;
        if (attempt < this.config.retries) {
          await sleep(retryDelay(attempt, null), signal);
          continue;
        }
        const reason = timeout.aborted ? `timed out after ${this.config.timeoutMs} ms` : (error as Error).message;
        throw new Error(`Leginova is unreachable (${reason}) on ${path}. Retry later.`, { cause: error });
      }

      if (res.ok) return res;

      if (RETRYABLE_STATUS.has(res.status) && attempt < this.config.retries) {
        await res.body?.cancel();
        await sleep(retryDelay(attempt, res.headers.get('retry-after')), signal);
        continue;
      }
      throw new LeginovaHttpError(res.status, path, await problemDetail(res));
    }
  }
}

async function problemDetail(res: Response): Promise<string | undefined> {
  try {
    const text = await res.text();
    const body = JSON.parse(text) as { detail?: unknown; title?: unknown };
    if (typeof body.detail === 'string') return body.detail;
    if (typeof body.title === 'string') return body.title;
  } catch {
    // non-JSON error body
  }
  return undefined;
}
