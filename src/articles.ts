// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LeginovaApi } from './client/api.js';
import type { CodeNode, CodeSummary } from './client/types.js';

// Article numbers in New Caledonian codes carry a prefix that is part of the
// key. A provision localized by a "loi du pays" moves from `L. 441-6` to
// `Lp. 441-6`, and the same core number can exist under several prefixes in
// one code (Code de commerce: `L. 450-1` and `Lp. 450-1` are two different
// articles). Leginova's own advanced search matches the prefix literally, so
// asking for the metropolitan number returns nothing, which reads as "this
// provision does not exist". Lookups here therefore match on the core number,
// then report precisely how the match relates to what was asked.

/** Prefixes seen across the 31 codes (survey of 25,915 articles, 2026-10). */
export const KNOWN_PREFIXES = ['L', 'Lp', 'R', 'D', 'PS', 'PN', 'AN'] as const;

const PREFIX_FAMILY: Record<string, string> = {
  L: 'legislative',
  Lp: 'legislative',
  R: 'R',
  D: 'D',
  PS: 'PS',
  PN: 'PN',
  AN: 'AN',
};

const PREFIX_CANONICAL: Record<string, string> = {
  l: 'L',
  lp: 'Lp',
  r: 'R',
  d: 'D',
  ps: 'PS',
  pn: 'PN',
  an: 'AN',
};

export interface ParsedNumber {
  raw: string;
  /** Canonical prefix (`L`, `Lp`, `R`...), or null for an unprefixed number. */
  prefix: string | null;
  /** Number without prefix, lower-cased, `1er` folded to `1`: the matching key. */
  core: string;
}

export function parseArticleNumber(input: string): ParsedNumber {
  let text = input
    .replace(/[\u00a0\u202f]/g, ' ')
    .trim()
    .replace(/^(article|art\.?)\s+/i, '')
    .trim();
  let prefix: string | null = null;
  const match = /^(lp|ps|pn|an|l|r|d)\s*\.?\s*(?=\d)/i.exec(text);
  if (match) {
    prefix = PREFIX_CANONICAL[match[1]!.toLowerCase()] ?? null;
    text = text.slice(match[0].length);
  }
  return { raw: input, prefix, core: normalizeCore(text) };
}

export function normalizeCore(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u00a0\u202f]/g, ' ')
    .replace(/\s*([-\u2013\u2011])\s*/g, '-')
    .replace(/[\u2013\u2011]/g, '-')
    .replace(/\b(\d+)\s*(?:er|ère|re)\b/g, '$1')
    .replace(/\s+/g, ' ')
    .replace(/\.$/, '')
    .trim();
}

export function formatNumber(prefix: string | null, numero: string): string {
  return prefix ? `${prefix}. ${numero}` : numero;
}

export interface IndexedArticle {
  codeSlug: string;
  codeTitle: string;
  id: number;
  slug: string;
  /** Number exactly as Leginova prints it. */
  numero: string;
  prefix: string | null;
  core: string;
  /** Titles of the enclosing parts, books, chapters... */
  path: string[];
}

export interface CodeIndex {
  codeSlug: string;
  codeTitle: string;
  /** Authority that files the code: `Etat`, `Nouvelle-Calédonie` or `Province`. */
  authority?: string;
  /** Date of the consolidated version Leginova publishes. */
  inForceOn?: string;
  articles: IndexedArticle[];
  byCore: Map<string, IndexedArticle[]>;
}

function nodeLabel(node: CodeNode): string {
  const type = node.type?.libelle ?? '';
  const numero = node.numero ? ` ${node.numero}` : '';
  const titre = node.titre ? ` - ${node.titre}` : '';
  return `${type}${numero}${titre}`.trim();
}

export function buildCodeIndex(tree: CodeNode, codeSlug: string): CodeIndex {
  const codeTitle = tree.titre ?? codeSlug;
  const articles: IndexedArticle[] = [];
  const walk = (node: CodeNode, path: string[]) => {
    for (const child of node.children ?? []) {
      if (child.type?.id === 'ARTICLE') {
        const numero = (child.numero ?? '').trim();
        const parsed = parseArticleNumber(numero);
        if (child.slug) {
          articles.push({
            codeSlug,
            codeTitle,
            id: child.id,
            slug: child.slug,
            numero,
            prefix: parsed.prefix,
            core: parsed.core,
            path,
          });
        }
      } else {
        walk(child, [...path, nodeLabel(child)]);
      }
    }
  };
  walk(tree, []);
  const byCore = new Map<string, IndexedArticle[]>();
  for (const article of articles) {
    const bucket = byCore.get(article.core);
    if (bucket) bucket.push(article);
    else byCore.set(article.core, [article]);
  }
  return {
    codeSlug,
    codeTitle,
    ...(tree.autoriteDeposante ? { authority: tree.autoriteDeposante } : {}),
    ...(tree.dateApplication ? { inForceOn: tree.dateApplication.slice(0, 10) } : {}),
    articles,
    byCore,
  };
}

export type MatchStatus =
  /** The requested prefix and number exist as such. */
  | 'exact'
  /** No prefix was given and exactly one article carries this number. */
  | 'unique_unprefixed'
  /** The requested prefix does not exist, but the same number exists under an equivalent prefix (L. vs Lp.). */
  | 'prefix_variant'
  /** Several articles fit and none can be preferred safely. */
  | 'ambiguous'
  /** The number exists only under prefixes of a different nature (R., D., PS.…): not substituted. */
  | 'other_prefix_only'
  | 'not_found';

export interface ArticleLookup {
  status: MatchStatus;
  requested: ParsedNumber;
  codeSlug: string;
  codeTitle: string;
  match?: IndexedArticle;
  /** Every article of the code sharing the core number, whatever its prefix. */
  candidates: IndexedArticle[];
  /** Plain-language explanation the model must relay when status is not `exact`. */
  notice?: string;
}

const NOT_EVIDENCE =
  'Absence from Leginova is NOT evidence that no legal basis exists: the rule may sit in another code, in a non-codified text, ' +
  'in State law applicable in New Caledonia that only Légifrance publishes, or the article may have been renumbered or repealed. ' +
  'Do not write "no legal basis" from this result alone.';

export function lookupInIndex(index: CodeIndex, requested: ParsedNumber): ArticleLookup {
  const base = { requested, codeSlug: index.codeSlug, codeTitle: index.codeTitle };
  const candidates = index.byCore.get(requested.core) ?? [];
  const asked = formatNumber(requested.prefix, requested.core);
  const list = (items: IndexedArticle[]) => items.map((a) => a.numero).join(', ');

  if (candidates.length === 0) {
    return {
      ...base,
      status: 'not_found',
      candidates,
      notice:
        `No article numbered "${requested.core}" exists in ${index.codeTitle}, under any prefix ` +
        `(checked ${KNOWN_PREFIXES.map((p) => `${p}.`).join(', ')} and unprefixed; "1er" = "1"). ${NOT_EVIDENCE}`,
    };
  }

  if (requested.prefix === null) {
    if (candidates.length === 1) {
      const [only] = candidates;
      return {
        ...base,
        status: 'unique_unprefixed',
        match: only!,
        candidates,
        ...(only!.prefix
          ? { notice: `No prefix was given; the only article numbered "${requested.core}" in this code is ${only!.numero}.` }
          : {}),
      };
    }
    return {
      ...base,
      status: 'ambiguous',
      candidates,
      notice: `"${requested.core}" exists under several prefixes in this code: ${list(candidates)}. They are distinct provisions; pick one by its full number.`,
    };
  }

  const exact = candidates.filter((a) => a.prefix === requested.prefix);
  const others = candidates.filter((a) => a.prefix !== requested.prefix);
  if (exact.length > 0) {
    const sameFamily = others.filter((a) => a.prefix && PREFIX_FAMILY[a.prefix] === PREFIX_FAMILY[requested.prefix!]);
    return {
      ...base,
      status: exact.length === 1 ? 'exact' : 'ambiguous',
      ...(exact.length === 1 ? { match: exact[0]! } : {}),
      candidates,
      ...(sameFamily.length > 0
        ? {
            notice: `Careful: this code also contains ${list(sameFamily)}, a different article with the same number under another prefix. Make sure ${asked} is the one meant.`,
          }
        : others.length > 0
          ? { notice: `Same number under other prefixes in this code (distinct provisions): ${list(others)}.` }
          : {}),
    };
  }

  const family = PREFIX_FAMILY[requested.prefix];
  const variants = others.filter((a) => a.prefix && PREFIX_FAMILY[a.prefix] === family);
  if (variants.length === 1) {
    const [variant] = variants;
    return {
      ...base,
      status: 'prefix_variant',
      match: variant!,
      candidates,
      notice:
        `${asked} does not exist in ${index.codeTitle}; it is numbered ${variant!.numero} here. ` +
        `"Lp." marks an article adopted or localized by a New Caledonian "loi du pays", which replaces the metropolitan "L." numbering. ` +
        `Check that ${variant!.numero} is the provision meant, and cite it under that number.`,
    };
  }
  if (variants.length > 1) {
    return {
      ...base,
      status: 'ambiguous',
      candidates,
      notice: `${asked} does not exist as such; equivalent numbers found: ${list(variants)}.`,
    };
  }
  return {
    ...base,
    status: 'other_prefix_only',
    candidates,
    notice:
      `${asked} does not exist in ${index.codeTitle}. The number exists only as ${list(others)}: ` +
      `a prefix of another nature (L./Lp. legislative, R./D. regulatory, PS./PN./AN. provincial), so it was NOT substituted. ${NOT_EVIDENCE}`,
  };
}

/** Builds article indexes lazily, one per code, and keeps them in the shared cache. */
export class ArticleIndex {
  constructor(private readonly api: LeginovaApi) {}

  /**
   * Index of one code. `keepTree: false` skips caching the full tree (2 MB of
   * JSON per code): sweeps over all 31 codes only need the compact index.
   */
  forCode(codeSlug: string, signal?: AbortSignal, keepTree = true): Promise<CodeIndex> {
    return this.api.http.memo(
      `article-index:${codeSlug}`,
      async () => {
        const tree = await this.api.codeTree(codeSlug, { signal, ...(keepTree ? {} : { ttlMs: 0 }) });
        const index = buildCodeIndex(tree, codeSlug);
        return { value: index, size: index.articles.length * 400 };
      },
      { signal },
    );
  }

  async lookup(codeSlug: string, number: string, signal?: AbortSignal): Promise<ArticleLookup> {
    return lookupInIndex(await this.forCode(codeSlug, signal), parseArticleNumber(number));
  }

  /** Same core number in every code, for cross-code suggestions when a lookup fails. */
  async acrossCodes(number: string, codes: CodeSummary[], signal?: AbortSignal): Promise<ArticleLookup[]> {
    const requested = parseArticleNumber(number);
    const results = await Promise.all(
      codes.map(async (code) => lookupInIndex(await this.forCode(code.slug, signal, false), requested)),
    );
    return results.filter((r) => r.candidates.length > 0);
  }

  /** Every code with its filing authority and version date. */
  allCodes(codes: CodeSummary[], signal?: AbortSignal): Promise<CodeIndex[]> {
    return Promise.all(codes.map((code) => this.forCode(code.slug, signal, false)));
  }
}
