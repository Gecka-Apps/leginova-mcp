// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CallToolResult } from '@modelcontextprotocol/server';
import type { ArticleIndex } from '../articles.js';
import type { LeginovaApi } from '../client/api.js';
import { LeginovaHttpError } from '../client/http.js';
import type { Config } from '../config.js';
import type { SiteUrls } from '../format/urls.js';

export interface Deps {
  config: Config;
  api: LeginovaApi;
  urls: SiteUrls;
  articles: ArticleIndex;
}

export const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function ok(text: string, structured?: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: 'text', text }],
    ...(structured ? { structuredContent: structured } : {}),
  };
}

/**
 * Result of a reader tool. Some clients hand the model only `structuredContent`
 * when it is present, so it must carry the whole answer: the Markdown text and
 * every metadata field, never a lossy summary of what `content` shows.
 */
export function document(text: string, data: Record<string, unknown>): CallToolResult {
  return ok(text, { ...data, text });
}

export function fail(text: string): CallToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

/**
 * Turns API failures into messages the model can act on. `notFound` explains
 * what a 404 means for this particular lookup and how to recover.
 */
export async function guard(run: () => Promise<CallToolResult>, notFound: string): Promise<CallToolResult> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof LeginovaHttpError) {
      if (error.isNotFound) return fail(`${notFound} (Leginova answered 404${error.detail ? `: ${error.detail}` : ''}).`);
      if (error.status === 400) {
        return fail(
          `Leginova rejected the request as invalid (${error.detail ?? '400'}). Check enumerated values with leginova_get_catalogue and date formats (YYYY-MM-DD).`,
        );
      }
      return fail(`Leginova returned HTTP ${error.status} on ${error.path}. The service may be degraded; retry later.`);
    }
    if (error instanceof Error && error.name === 'AbortError') throw error;
    return fail(error instanceof Error ? error.message : String(error));
  }
}

/** Appended to every empty result set: an empty answer must never read as "this does not exist". */
export function emptyResultCaveat(what: string): string {
  return [
    `No result for ${what}.`,
    'An empty result is not proof that the rule or decision does not exist. Before concluding, try: synonyms or broader terms;',
    'another scope (codes, consolidated texts, JONC, case law); article numbers with leginova_get_code_article (it tolerates L./Lp. prefixes);',
    'and remember that State law applicable in New Caledonia may only be published on Légifrance.',
  ].join(' ');
}

const ARTICLE_REF = /\b(?:art(?:icle)?\.?\s+)?(?:Lp|L|R|D|PS|PN|AN)\s*\.\s*\d+(?:[-\u2011]\d+)*\b/i;

export function mentionsArticleNumber(query: string): boolean {
  return ARTICLE_REF.test(query);
}

export const ARTICLE_NUMBER_HINT =
  'The query contains an article number. Full-text search treats it as words; to fetch a code article by number use ' +
  'leginova_get_code_article with article_number: it matches "L. 441-6" against "Lp. 441-6" and reports the substitution.';

export function bullet(label: string, value: string | number | null | undefined): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return `- **${label}**: ${value}`;
}

/** Joins output lines; `''` keeps a blank separator, `undefined`/`false`/`null` drop the line. */
export function lines(...parts: (string | undefined | false | null)[]): string {
  return parts
    .filter((p): p is string => typeof p === 'string')
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
