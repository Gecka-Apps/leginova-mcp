// SPDX-License-Identifier: AGPL-3.0-or-later

// Public page URLs, as listed in https://leginova.gouv.nc/llms.txt and the sitemap.
// Every tool result carries one so answers can cite the official page.

export class SiteUrls {
  constructor(private readonly base: string) {}

  code(slug: string, sectionSlug?: string | null): string {
    return `${this.base}/codes/${slug}${sectionSlug ? `#${sectionSlug}` : ''}`;
  }

  codeArticle(codeSlug: string, articleSlug: string): string {
    return `${this.base}/codes/${codeSlug}/article/${articleSlug}`;
  }

  texteConsolide(id: number): string {
    return `${this.base}/textes-consolides/${id}`;
  }

  jurisprudence(slug: string): string {
    return `${this.base}/jurisprudences/${slug}`;
  }

  /** Issues numbered `YYYY-NNNNN` carry a single item; older issues use a plain number and a summary page. */
  jonc(numero: string): string {
    return isModernJoncNumber(numero)
      ? `${this.base}/jonc/contenu/${numero}`
      : `${this.base}/jonc/sommaire-analytique/${numero}`;
  }

  joncItem(numero: string, kind: JoncItemKind, id: number): string {
    if (isModernJoncNumber(numero)) return `${this.base}/jonc/contenu/${numero}`;
    return `${this.base}/jonc/sommaire-analytique/${numero}/${JONC_ITEM_SEGMENT[kind]}/${id}`;
  }

  debat(numero: string): string {
    return `${this.base}/jonc/debat-congres/${numero}`;
  }

  search(query: string): string {
    return `${this.base}/recherche?q=${encodeURIComponent(query)}`;
  }

  api(path: string): string {
    return `${this.base}/api${path}`;
  }
}

export type JoncItemKind = 'acte' | 'publication_legale' | 'association_fondation';

const JONC_ITEM_SEGMENT: Record<JoncItemKind, string> = {
  acte: 'acte',
  publication_legale: 'publication',
  association_fondation: 'association-fondation',
};

export function isModernJoncNumber(numero: string): boolean {
  return /^\d{4}-\d+$/.test(numero.trim());
}
