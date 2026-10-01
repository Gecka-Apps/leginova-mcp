// SPDX-License-Identifier: AGPL-3.0-or-later

import { VERSION } from './version.js';

export interface Config {
  /** Public site origin, used both for the API (`/api`) and for citation URLs. */
  baseUrl: string;
  userAgent: string;
  timeoutMs: number;
  maxConcurrency: number;
  retries: number;
  cacheMaxBytes: number;
  cacheTtlMs: number;
  /** PDFs above this size are refused instead of downloaded. */
  maxPdfBytes: number;
}

function intFromEnv(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer, got "${value}"`);
  }
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const baseUrl = (env.LEGINOVA_BASE_URL ?? 'https://leginova.gouv.nc').replace(/\/+$/, '');
  return {
    baseUrl,
    userAgent:
      env.LEGINOVA_USER_AGENT ??
      `leginova-mcp/${VERSION} (+https://github.com/Gecka-Apps/leginova-mcp)`,
    timeoutMs: intFromEnv(env.LEGINOVA_TIMEOUT_MS, 30_000, 'LEGINOVA_TIMEOUT_MS'),
    maxConcurrency: Math.max(1, intFromEnv(env.LEGINOVA_MAX_CONCURRENCY, 4, 'LEGINOVA_MAX_CONCURRENCY')),
    retries: intFromEnv(env.LEGINOVA_RETRIES, 2, 'LEGINOVA_RETRIES'),
    cacheMaxBytes: intFromEnv(env.LEGINOVA_CACHE_MB, 256, 'LEGINOVA_CACHE_MB') * 1024 * 1024,
    cacheTtlMs: intFromEnv(env.LEGINOVA_CACHE_TTL_S, 3600, 'LEGINOVA_CACHE_TTL_S') * 1000,
    maxPdfBytes: intFromEnv(env.LEGINOVA_MAX_PDF_MB, 80, 'LEGINOVA_MAX_PDF_MB') * 1024 * 1024,
  };
}
