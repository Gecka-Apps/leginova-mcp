// SPDX-License-Identifier: AGPL-3.0-or-later

import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { AdvancedTarget, Rubrique, SortOrder } from '../client/api.js';
import { hitsFrom, normalizeFacets, renderFacets, renderHits } from '../format/hits.js';
import { stripTags } from '../format/html.js';
import {
  ARTICLE_NUMBER_HINT,
  DATE,
  type Deps,
  READ_ONLY,
  emptyResultCaveat,
  guard,
  lines,
  mentionsArticleNumber,
  ok,
} from './common.js';

const SCOPES = {
  all: 'TOUT',
  jonc: 'JONC',
  textes_consolides: 'TEXTE_CONSOLIDE',
  codes: 'CODE',
  jurisprudence: 'JURISPRUDENCE',
  debats: 'DEBAT',
} as const satisfies Record<string, Rubrique>;

const SORTS = [
  'PERTINENCE',
  'PLUS_RECENT',
  'PLUS_ANCIEN',
  'CONSOLIDATION_RECENTE',
  'CONSOLIDATION_ANCIENNE',
  'ADOPTION_RECENTE',
  'ADOPTION_ANCIENNE',
  'ALPHABETIQUE',
] as const satisfies readonly SortOrder[];

const hitSchema = z.object({
  kind: z.string().describe('TEXTE_CONSOLIDE, CODE, SECTION_CODE, ARTICLE_CODE, JURISPRUDENCE, JONC_ACTE, JONC or DEBAT'),
  title: z.string(),
  reference: z.string().optional(),
  date: z.string().optional(),
  consolidated_on: z.string().optional(),
  published_in_jonc_on: z.string().optional().describe('JONC acts: publication date in the Journal officiel'),
  source: z.string().optional(),
  snippet: z.string().optional(),
  url: z.string().describe('Official page to cite'),
  next: z
    .object({ tool: z.string(), arguments: z.record(z.string(), z.union([z.string(), z.number()])) })
    .optional()
    .describe('Tool call that opens the full document'),
  erratum: z.boolean().optional(),
});

const facetSchema = z.object({
  filter: z.string(),
  label: z.string(),
  values: z.array(
    z.object({ value: z.string(), label: z.string(), count: z.number(), parent: z.string().optional() }),
  ),
});

const searchOutput = z.object({
  query: z.string(),
  total: z.number(),
  page: z.number(),
  page_size: z.number(),
  results: z.array(hitSchema),
  best_matches: z.array(hitSchema),
  facets: z.array(facetSchema).optional(),
  notes: z.array(z.string()),
  site_url: z.string(),
});

const pagination = {
  page: z.number().int().min(1).max(500).default(1).describe('1-based page number'),
  page_size: z.number().int().min(1).max(50).default(10).describe('Results per page (max 50)'),
};

function serializeFilters(filters: Record<string, string | string[]> | undefined): string[] {
  return Object.entries(filters ?? {})
    .filter(([key]) => key !== 'filterRubrique')
    .map(([key, value]) => `${key}:${(Array.isArray(value) ? value : [value]).join('|')}`)
    .filter((entry) => !entry.endsWith(':'));
}

export function registerSearchTools(server: McpServer, deps: Deps): void {
  const { api, urls } = deps;

  server.registerTool(
    'leginova_search',
    {
      title: 'Search Leginova (full text)',
      description: [
        'Full-text search across the official law of New Caledonia on leginova.gouv.nc: Journal officiel (JONC) acts,',
        'consolidated texts (lois du pays, délibérations, arrêtés...), codes, case law and Congress debates.',
        'Write queries in French. Words are AND-ed by default; "double quotes" search an exact phrase; OU / SAUF',
        '(or OR / NOT) combine terms. Each result carries its official URL (cite it) and a `next` tool call to open it.',
        'Restrict `scope` to get facets (themes, courts, act types...) that can be fed back through `filters`.',
        'An empty result is not proof that a rule does not exist; to fetch a code article by number use leginova_get_code_article.',
      ].join(' '),
      inputSchema: z.object({
        query: z.string().trim().min(1).max(500).describe('Search terms in French, e.g. "bail commercial" or "\\"licenciement économique\\""'),
        scope: z
          .enum(Object.keys(SCOPES) as [keyof typeof SCOPES, ...(keyof typeof SCOPES)[]])
          .default('all')
          .describe('Collection to search'),
        filters: z
          .record(z.string(), z.union([z.string(), z.array(z.string())]))
          .optional()
          .describe(
            'Facet filters as returned in `facets`, e.g. {"filterJuridiction": ["COUR_APPEL"], "filterTheme": ["30"]}. Several values are OR-ed.',
          ),
        date_from: z.string().regex(DATE).optional().describe('Lower bound of the document date, YYYY-MM-DD'),
        date_to: z.string().regex(DATE).optional().describe('Upper bound of the document date, YYYY-MM-DD'),
        consolidated_from: z.string().regex(DATE).optional().describe('Consolidated texts only: consolidation date lower bound'),
        consolidated_to: z.string().regex(DATE).optional().describe('Consolidated texts only: consolidation date upper bound'),
        sort: z
          .enum(SORTS)
          .optional()
          .describe('Default is relevance. CONSOLIDATION_* and ADOPTION_* apply to consolidated texts, ALPHABETIQUE to titles'),
        include_facets: z.boolean().default(false).describe('Return facet counts (only when scope is not "all")'),
        ...pagination,
      }),
      outputSchema: searchOutput,
      annotations: READ_ONLY,
    },
    async (args, ctx) =>
      guard(async () => {
        const rubrique = SCOPES[args.scope];
        const filters = serializeFilters(args.filters);
        if (rubrique !== 'TOUT') filters.unshift(`filterRubrique:${rubrique}`);
        const response = await api.search(
          {
            query: args.query,
            page: args.page - 1,
            size: args.page_size,
            filters,
            dateDebut: args.date_from,
            dateFin: args.date_to,
            dateConsolidationDebut: args.consolidated_from,
            dateConsolidationFin: args.consolidated_to,
            tri: args.sort,
          },
          { signal: ctx.mcpReq.signal },
        );
        const { total, results, best } = hitsFrom(response, urls);
        const facets = args.include_facets ? normalizeFacets(response.listFacetGroup) : undefined;
        const notes: string[] = [];
        if (mentionsArticleNumber(args.query)) notes.push(ARTICLE_NUMBER_HINT);
        if (total === 0) notes.push(emptyResultCaveat(`"${args.query}" in scope "${args.scope}"`));
        if (args.include_facets && args.scope === 'all') notes.push('Facets are only computed when `scope` is restricted.');
        const firstRank = (args.page - 1) * args.page_size + 1;
        const lastRank = firstRank + results.length - 1;
        const siteUrl = urls.search(args.query);

        const text = lines(
          `## Leginova search: "${args.query}" (${args.scope})`,
          total > 0
            ? `${total} result(s); showing ${firstRank}-${lastRank}.${lastRank < total ? ` Next page: page=${args.page + 1}.` : ''}`
            : undefined,
          best.length > 0 ? `\n### Best match (${response.natureMeilleureCorrespondance ?? 'reference'})\n${renderHits(best, 1)}` : undefined,
          results.length > 0 ? `\n### Results\n${renderHits(results, firstRank)}` : undefined,
          facets ? renderFacets(facets) : undefined,
          notes.length > 0 ? `\n${notes.map((n) => `Note: ${n}`).join('\n')}` : undefined,
          `\nSearch page: ${siteUrl}`,
        );
        return ok(text, {
          query: args.query,
          total,
          page: args.page,
          page_size: args.page_size,
          results,
          best_matches: best,
          ...(facets ? { facets } : {}),
          notes,
          site_url: siteUrl,
        });
      }, 'Search failed'),
  );

  registerAdvancedSearch(server, deps);

  server.registerTool(
    'leginova_suggest',
    {
      title: 'Resolve a title to a Leginova document',
      description:
        'Autocomplete over titles: turns a partial name ("code du travail", "loi du pays 2021-2", "télétravail") into documents with their ids and slugs. Cheaper than a search when the target is known by name.',
      inputSchema: z.object({
        query: z.string().trim().min(2).max(200).describe('Partial title in French'),
        scope: z
          .enum(Object.keys(SCOPES) as [keyof typeof SCOPES, ...(keyof typeof SCOPES)[]])
          .default('all'),
      }),
      outputSchema: z.object({
        suggestions: z.array(
          z.object({
            kind: z.string(),
            title: z.string(),
            id: z.number().optional(),
            slug: z.string().optional(),
            url: z.string().optional(),
          }),
        ),
      }),
      annotations: READ_ONLY,
    },
    async ({ query, scope }, ctx) =>
      guard(async () => {
        const rubrique = SCOPES[scope];
        const raw = await api.suggest(query, rubrique === 'TOUT' ? undefined : rubrique, { signal: ctx.mcpReq.signal });
        const suggestions = raw.map((s) => {
          const kind = s.type?.id ?? 'UNKNOWN';
          const title = stripTags(s.titre);
          let url: string | undefined;
          if (kind === 'CODE' && s.slug) url = urls.code(s.slug);
          else if (kind === 'TEXTE_CONSOLIDE' && s.id) url = urls.texteConsolide(s.id);
          else if (kind === 'JURISPRUDENCE' && s.slug) url = urls.jurisprudence(s.slug);
          return { kind, title, ...(s.id ? { id: s.id } : {}), ...(s.slug ? { slug: s.slug } : {}), ...(url ? { url } : {}) };
        });
        const text =
          suggestions.length === 0
            ? `No title matches "${query}". Try leginova_search, which also searches the body of documents.`
            : suggestions
                .map((s) => `- [${s.kind}] ${s.title}${s.id ? ` (id ${s.id})` : ''}${s.slug ? ` (slug ${s.slug})` : ''}${s.url ? `\n  ${s.url}` : ''}`)
                .join('\n');
        return ok(text, { suggestions });
      }, 'Suggestion lookup failed'),
  );
}

const ADVANCED_TARGETS = {
  global: 'global',
  actes: 'actes',
  codes: 'codes',
  textes_consolides: 'textes-consolides',
  jurisprudence: 'jurisprudence',
} as const satisfies Record<string, AdvancedTarget>;

const CONDITION_SCOPES = [
  'TOUT_LE_TEXTE',
  'TITRE',
  'MENTION',
  'ARTICLE',
  'NUMERO_ACTE',
  'TOUT_LE_CODE',
  'INTITULES',
  'CONTENU_ARTICLE',
  'TOUT',
  'NUMERO_REFERENCE',
  'NUMERO_ARTICLE',
] as const;

const SCOPES_BY_TARGET: Record<keyof typeof ADVANCED_TARGETS, readonly string[]> = {
  global: [],
  actes: ['TOUT_LE_TEXTE', 'TITRE', 'MENTION', 'ARTICLE', 'NUMERO_ACTE'],
  codes: ['TOUT_LE_CODE', 'INTITULES', 'CONTENU_ARTICLE'],
  textes_consolides: ['TOUT_LE_TEXTE', 'INTITULES', 'CONTENU_ARTICLE'],
  jurisprudence: ['TOUT', 'NUMERO_REFERENCE'],
};

const words = (value: string | string[] | undefined): string[] | undefined => {
  if (value === undefined) return undefined;
  const list = (Array.isArray(value) ? value.join(' ') : value).split(/\s+/).filter(Boolean);
  return list.length > 0 ? list.slice(0, 80).map((w) => w.slice(0, 200)) : undefined;
};

const ids = (values: (string | number)[] | undefined) =>
  values && values.length > 0 ? values.map((id) => ({ id })) : undefined;

const nonEmpty = <T>(values: T[] | undefined) => (values && values.length > 0 ? values : undefined);

function registerAdvancedSearch(server: McpServer, deps: Deps): void {
  const { api, urls } = deps;
  const listOf = z.union([z.string(), z.array(z.string())]);

  server.registerTool(
    'leginova_advanced_search',
    {
      title: 'Advanced search (structured criteria)',
      description: [
        'Structured search mirroring leginova.gouv.nc/recherche-avancee. Pick a `target`, then either keyword groups',
        '(all_words / any_words / exclude_words / exact_phrase) or boolean `conditions` (ET/OU/SAUF with a field scope), plus filters.',
        'Use it for precise requests: acts of a given type and authority over a period, decisions of a given court, articles of selected codes.',
        'IDs for themes, authorities, collectivities, act types, courts and codes come from leginova_get_catalogue.',
        'Filters apply per target: act_types/authority_ids (actes, textes_consolides), collectivity_ids (actes, codes, global),',
        'code_slugs/section_types (codes), courts/court_orders/decision_types/case_number (jurisprudence), consolidated_* (textes_consolides).',
        'The meaning of date_from/date_to follows the target: publication date (actes), application date (codes), text date (textes_consolides), hearing date (jurisprudence).',
        'There is no article-number field here: use leginova_get_code_article, which tolerates L./Lp. prefixes.',
      ].join(' '),
      inputSchema: z.object({
        target: z.enum(Object.keys(ADVANCED_TARGETS) as [keyof typeof ADVANCED_TARGETS, ...(keyof typeof ADVANCED_TARGETS)[]]),
        all_words: listOf.optional().describe('Every word must appear'),
        any_words: listOf.optional().describe('At least one of these words'),
        exclude_words: listOf.optional().describe('None of these words'),
        exact_phrase: z.string().optional().describe('Words that must appear as an exact phrase'),
        conditions: z
          .array(
            z.object({
              operator: z.enum(['ET', 'OU', 'SAUF']).describe('ET = and, OU = or, SAUF = and not'),
              term: z.string().min(1),
              scope: z
                .enum(CONDITION_SCOPES)
                .optional()
                .describe(
                  'actes: TOUT_LE_TEXTE|TITRE|MENTION|ARTICLE|NUMERO_ACTE; codes: TOUT_LE_CODE|INTITULES|CONTENU_ARTICLE; textes_consolides: TOUT_LE_TEXTE|INTITULES|CONTENU_ARTICLE; jurisprudence: TOUT|NUMERO_REFERENCE; global: none',
                ),
            }),
          )
          .max(20)
          .optional()
          .describe('Boolean conditions, evaluated in order (expert mode). Not combinable with the keyword fields.'),
        date_from: z.string().regex(DATE).optional(),
        date_to: z.string().regex(DATE).optional(),
        consolidated_from: z.string().regex(DATE).optional(),
        consolidated_to: z.string().regex(DATE).optional(),
        theme_ids: z.array(z.number().int()).optional(),
        authority_ids: z.array(z.number().int()).optional(),
        collectivity_ids: z.array(z.number().int()).optional(),
        act_types: z.array(z.string()).optional().describe('e.g. ["ARRETE", "DELIBERATION", "LOIS_DU_PAYS"]'),
        code_slugs: z.array(z.string()).optional(),
        section_types: z.array(z.string()).optional().describe('e.g. ["PARTIE", "LIVRE", "TITRE", "CHAPITRE"]'),
        courts: z.array(z.string()).optional().describe('e.g. ["COUR_APPEL", "TRIBUNAL_ADMINISTRATIF"]'),
        court_orders: z.array(z.enum(['CONSTITUTIONNELLE', 'ADMINISTRATIVE', 'JUDICIAIRE'])).optional(),
        decision_types: z.array(z.string()).optional().describe('e.g. ["ARRET", "JUGEMENT", "ORDONNANCE", "DECISION"]'),
        case_number: z.string().optional().describe('Jurisprudence reference number, e.g. "13-15646"'),
        sort: z.enum(['PERTINENCE', 'PLUS_RECENT', 'PLUS_ANCIEN']).optional().describe('global target only'),
        ...pagination,
      }),
      outputSchema: searchOutput,
      annotations: READ_ONLY,
    },
    async (args, ctx) =>
      guard(async () => {
        const keywords = {
          motsTous: words(args.all_words),
          motsAuMoinsUn: words(args.any_words),
          motsSauf: words(args.exclude_words),
          expressionExacte: words(args.exact_phrase),
        };
        const hasKeywords = Object.values(keywords).some(Boolean);
        const conditions = (args.conditions ?? []).filter((c) => c.term.trim() !== '');
        if (hasKeywords && conditions.length > 0) {
          return {
            content: [{ type: 'text', text: 'Use either the keyword fields or `conditions`, not both.' }],
            isError: true,
          };
        }
        if (conditions.some((c) => c.scope === 'NUMERO_ARTICLE')) {
          return {
            content: [
              {
                type: 'text',
                text:
                  'NUMERO_ARTICLE is not offered: Leginova matches it literally, so "L. 441-6", "441-6" or "Lp 441-6" all return nothing for an article numbered "Lp. 441-6". ' +
                  'Use leginova_get_code_article with article_number, which matches any prefix and reports the substitution.',
              },
            ],
            isError: true,
          };
        }
        const allowedScopes = SCOPES_BY_TARGET[args.target];
        const badScope = conditions.find((c) =>
          allowedScopes.length === 0 ? c.scope !== undefined : c.scope !== undefined && !allowedScopes.includes(c.scope),
        );
        if (badScope) {
          return {
            content: [
              {
                type: 'text',
                text:
                  allowedScopes.length === 0
                    ? 'The global target takes conditions without `scope`.'
                    : `Scope ${badScope.scope} is not valid for target ${args.target}; use one of ${allowedScopes.join(', ')}.`,
              },
            ],
            isError: true,
          };
        }

        const payload: Record<string, unknown> = {
          page: args.page - 1,
          size: args.page_size,
          ...(hasKeywords ? { motsCles: keywords } : {}),
          ...(conditions.length > 0
            ? {
                listCondition: conditions.map((c) => ({
                  operator: c.operator,
                  terme: c.term.trim(),
                  ...(args.target !== 'global' ? { scope: c.scope ?? allowedScopes[0] } : {}),
                })),
              }
            : {}),
        };
        const themes = nonEmpty(args.theme_ids);
        switch (args.target) {
          case 'global':
            Object.assign(payload, {
              listCollectiviteId: nonEmpty(args.collectivity_ids),
              listThematiqueId: themes,
              tri: args.sort,
            });
            break;
          case 'actes':
            Object.assign(payload, {
              datePublicationDebut: args.date_from,
              datePublicationFin: args.date_to,
              listAutoriteEmettriceId: nonEmpty(args.authority_ids),
              listTypeCollectiviteId: nonEmpty(args.collectivity_ids),
              listThematiqueId: themes,
              listType: ids(args.act_types),
            });
            break;
          case 'codes':
            Object.assign(payload, {
              dateApplicationDebut: args.date_from,
              dateApplicationFin: args.date_to,
              listCollectiviteId: nonEmpty(args.collectivity_ids),
              listThematiqueId: themes,
              listSlugCode: nonEmpty(args.code_slugs),
              listTypeSection: nonEmpty(args.section_types),
            });
            break;
          case 'textes_consolides':
            Object.assign(payload, {
              dateDebut: args.date_from,
              dateFin: args.date_to,
              dateConsolidationDebut: args.consolidated_from,
              dateConsolidationFin: args.consolidated_to,
              listAutoriteId: nonEmpty(args.authority_ids),
              listThematiqueId: themes,
              listNatureActe: ids(args.act_types),
            });
            break;
          case 'jurisprudence':
            Object.assign(payload, {
              dateAudienceDebut: args.date_from,
              dateAudienceFin: args.date_to,
              listThematiqueId: themes,
              listJuridiction: ids(args.courts),
              listOrdre: ids(args.court_orders),
              listTypeJurisprudence: ids(args.decision_types),
              numeroReference: args.case_number?.trim() || undefined,
            });
            break;
        }

        const response = await api.advancedSearch(
          ADVANCED_TARGETS[args.target],
          conditions.length > 0 ? 'expert' : 'guide',
          JSON.parse(JSON.stringify(payload)) as Record<string, unknown>,
          { signal: ctx.mcpReq.signal },
        );
        const { total, results, best } = hitsFrom(response, urls);
        const facets = normalizeFacets(response.listFacetGroup);
        const summary = hasKeywords
          ? Object.entries(keywords)
              .filter(([, v]) => v)
              .map(([k, v]) => `${k}=${v!.join(' ')}`)
              .join('; ')
          : conditions.map((c) => `${c.operator} ${c.term}${c.scope ? ` [${c.scope}]` : ''}`).join(' ') || 'filters only';
        const notes = total === 0 ? [emptyResultCaveat(`advanced search on ${args.target} (${summary})`)] : [];
        const firstRank = (args.page - 1) * args.page_size + 1;
        const lastRank = firstRank + results.length - 1;
        const siteUrl = `${deps.config.baseUrl}/recherche-avancee`;

        const text = lines(
          `## Advanced search on ${args.target}: ${summary}`,
          total > 0
            ? `${total} result(s); showing ${firstRank}-${lastRank}.${lastRank < total ? ` Next page: page=${args.page + 1}.` : ''}`
            : undefined,
          results.length > 0 ? `\n${renderHits(results, firstRank)}` : undefined,
          facets.length > 0 ? renderFacets(facets) : undefined,
          notes.length > 0 ? `\nNote: ${notes.join('\n')}` : undefined,
        );
        return ok(text, {
          query: summary,
          total,
          page: args.page,
          page_size: args.page_size,
          results,
          best_matches: best,
          ...(facets.length > 0 ? { facets } : {}),
          notes,
          site_url: siteUrl,
        });
      }, 'Advanced search failed'),
  );
}
