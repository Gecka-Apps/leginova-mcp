// SPDX-License-Identifier: AGPL-3.0-or-later

import type { HttpClient, RequestOptions } from './http.js';
import type {
  Acte,
  Catalogue,
  CodeArticleNavigation,
  CodeNode,
  CodeSummary,
  DebatNavigation,
  JoncContenu,
  JoncListEntry,
  Jurisprudence,
  SearchResponse,
  SommaireAnalytique,
  Suggestion,
  TexteArticleNavigation,
  TexteConsolide,
  YearCount,
} from './types.js';

const DAY = 24 * 3600 * 1000;

export type Rubrique = 'TOUT' | 'JONC' | 'TEXTE_CONSOLIDE' | 'CODE' | 'JURISPRUDENCE' | 'DEBAT';

export type SortOrder =
  | 'PERTINENCE'
  | 'PLUS_RECENT'
  | 'PLUS_ANCIEN'
  | 'CONSOLIDATION_RECENTE'
  | 'CONSOLIDATION_ANCIENNE'
  | 'ADOPTION_RECENTE'
  | 'ADOPTION_ANCIENNE'
  | 'ALPHABETIQUE';

export interface SearchParams {
  query: string;
  page: number;
  size: number;
  filters: string[];
  dateDebut?: string | undefined;
  dateFin?: string | undefined;
  dateConsolidationDebut?: string | undefined;
  dateConsolidationFin?: string | undefined;
  tri?: SortOrder | undefined;
}

export type AdvancedTarget = 'global' | 'actes' | 'codes' | 'textes-consolides' | 'jurisprudence';

/** One method per endpoint of the Leginova `/api`, mirroring the site's generated Angular client. */
export class LeginovaApi {
  constructor(readonly http: HttpClient) {}

  search(params: SearchParams, opts?: RequestOptions): Promise<SearchResponse> {
    const { filters, ...rest } = params;
    return this.http.getJson('/recherche', { ...rest, filter: filters }, opts);
  }

  advancedSearch(
    target: AdvancedTarget,
    mode: 'guide' | 'expert',
    payload: Record<string, unknown>,
    opts?: RequestOptions,
  ): Promise<SearchResponse> {
    return this.http.postJson(`/recherche-avancee/${target}/${mode}`, payload, opts);
  }

  suggest(query: string, rubrique?: Rubrique, opts?: RequestOptions): Promise<Suggestion[]> {
    return this.http.getJson('/recherche/suggestions', { query, rubrique }, opts);
  }

  catalogue(opts?: RequestOptions): Promise<Catalogue> {
    return this.http.getJson('/recherche-avancee/catalogue', undefined, { ttlMs: DAY, ...opts });
  }

  codes(opts?: RequestOptions): Promise<CodeSummary[]> {
    return this.http.getJson('/code', undefined, { ttlMs: DAY, ...opts });
  }

  codeTree(slug: string, opts?: RequestOptions): Promise<CodeNode> {
    return this.http.getJson(`/code/${encodeURIComponent(slug)}/contenu-complet`, undefined, opts);
  }

  codeArticle(codeSlug: string, articleSlug: string, opts?: RequestOptions): Promise<CodeArticleNavigation> {
    return this.http.getJson(
      `/code/${encodeURIComponent(codeSlug)}/article/${encodeURIComponent(articleSlug)}`,
      undefined,
      opts,
    );
  }

  texteConsolide(id: number, opts?: RequestOptions): Promise<TexteConsolide> {
    return this.http.getJson(`/texte-consolide/${id}`, undefined, opts);
  }

  texteArticle(id: number, articleId: number, opts?: RequestOptions): Promise<TexteArticleNavigation> {
    return this.http.getJson(`/texte-consolide/${id}/article/${articleId}`, undefined, opts);
  }

  texteConsolideYears(opts?: RequestOptions): Promise<YearCount[]> {
    return this.http.getJson('/texte-consolide/annees', undefined, opts);
  }

  texteConsolideByYear(year: number, opts?: RequestOptions): Promise<
    { id: number; natureActe?: string; numero?: string; objet?: string; date?: string }[]
  > {
    return this.http.getJson('/texte-consolide', { annee: year }, opts);
  }

  jurisprudence(slug: string, opts?: RequestOptions): Promise<Jurisprudence> {
    return this.http.getJson(`/jurisprudence/${encodeURIComponent(slug)}`, undefined, opts);
  }

  jurisprudenceYears(opts?: RequestOptions): Promise<YearCount[]> {
    return this.http.getJson('/jurisprudence/annees', undefined, opts);
  }

  jurisprudenceByYear(year: number, opts?: RequestOptions): Promise<Jurisprudence[]> {
    return this.http.getJson('/jurisprudence', { annee: year }, opts);
  }

  joncList(year: number, opts?: RequestOptions): Promise<{ listAnnee: { annee: number; listJonc: JoncListEntry[] }[] }> {
    return this.http.getJson('/jonc/list', { annee: year }, opts);
  }

  joncContenu(numero: string, opts?: RequestOptions): Promise<JoncContenu> {
    return this.http.getJson(`/jonc/${encodeURIComponent(numero)}/contenu`, undefined, opts);
  }

  joncSommaire(numero: string, opts?: RequestOptions): Promise<SommaireAnalytique> {
    return this.http.getJson(`/jonc/${encodeURIComponent(numero)}/sommaire-analytique`, undefined, opts);
  }

  acte(id: number, opts?: RequestOptions): Promise<Acte> {
    return this.http.getJson(`/acte/${id}`, undefined, opts);
  }

  publicationLegale(id: number, opts?: RequestOptions): Promise<Record<string, unknown>> {
    return this.http.getJson(`/publication-legale/${id}`, undefined, opts);
  }

  associationFondation(id: number, opts?: RequestOptions): Promise<Record<string, unknown>> {
    return this.http.getJson(`/association-fondation/${id}`, undefined, opts);
  }

  debat(numero: string, opts?: RequestOptions): Promise<DebatNavigation> {
    return this.http.getJson(`/debat/numero/${encodeURIComponent(numero)}`, undefined, opts);
  }

  debatYears(opts?: RequestOptions): Promise<YearCount[]> {
    return this.http.getJson('/debat/annees', undefined, opts);
  }

  debatByYear(year: number, opts?: RequestOptions): Promise<
    { id: number; numero: string; mandature?: number; dateReference?: string | null }[]
  > {
    return this.http.getJson('/debat', { annee: year }, opts);
  }
}

/** API paths of the PDF renditions, relative to `/api`. */
export const pdfPath = {
  jurisprudence: (slug: string) => `/jurisprudence/${encodeURIComponent(slug)}/pdf`,
  acte: (id: number) => `/acte/${id}/pdf`,
  publicationLegale: (id: number) => `/publication-legale/${id}/pdf`,
  associationFondation: (id: number) => `/association-fondation/${id}/pdf`,
  texteConsolide: (id: number) => `/texte-consolide/${id}/pdf`,
  jonc: (numero: string) => `/jonc/${encodeURIComponent(numero)}/pdf`,
  debat: (id: number) => `/debat/${id}/pdf`,
  code: (slug: string) => `/code/${encodeURIComponent(slug)}/pdf`,
};
