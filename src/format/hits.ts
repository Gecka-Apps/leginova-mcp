// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FacetGroup, SearchHit, SearchResponse } from '../client/types.js';
import { highlightToMarkdown, stripTags } from './html.js';
import { compact, isoDate } from './text.js';
import type { SiteUrls } from './urls.js';

export interface NormalizedHit {
  kind: string;
  title: string;
  reference?: string;
  date?: string;
  consolidated_on?: string;
  /** JONC acts: date of publication in the Journal officiel de la Nouvelle-Calédonie. */
  published_in_jonc_on?: string;
  source?: string;
  snippet?: string;
  url: string;
  /** Tool call that opens the full document. */
  next?: { tool: string; arguments: Record<string, string | number> };
  erratum?: boolean;
}

function natureLabel(hit: SearchHit): string {
  return hit.natureActe?.libelle ?? hit.natureActe?.instanceLabel ?? '';
}

export function normalizeHit(hit: SearchHit, urls: SiteUrls): NormalizedHit {
  const kind = hit.type?.id ?? 'UNKNOWN';
  const snippet = highlightToMarkdown(hit.headlineContenu) || undefined;
  const common = { kind, snippet, erratum: hit.erratum || undefined };

  switch (kind) {
    case 'TEXTE_CONSOLIDE': {
      const id = hit.texteConsolideId!;
      const reference = [natureLabel(hit), hit.numeroTexteConsolide ? `n° ${hit.numeroTexteConsolide}` : '']
        .filter(Boolean)
        .join(' ');
      return compact({
        ...common,
        title: stripTags(hit.objetTexteConsolide ?? hit.headlineObjetTexteConsolide) || reference,
        reference,
        date: isoDate(hit.dateTexteConsolide),
        consolidated_on: isoDate(hit.dateConsolidationTexteConsolide),
        source: hit.collectiviteLibelle,
        url: urls.texteConsolide(id),
        next: { tool: 'leginova_get_texte_consolide', arguments: { id } },
      }) as NormalizedHit;
    }
    case 'CODE':
      return compact({
        ...common,
        title: stripTags(hit.nomCode ?? hit.headlineTitre),
        date: isoDate(hit.codeDateApplication),
        source: hit.collectiviteLibelle,
        url: urls.code(hit.slugCode!),
        next: { tool: 'leginova_get_code_outline', arguments: { code_slug: hit.slugCode! } },
      }) as NormalizedHit;
    case 'SECTION_CODE':
      return compact({
        ...common,
        title: stripTags(hit.headlineTitre),
        reference: [hit.nomCode, hit.nomPartieCode].filter(Boolean).join(', '),
        date: isoDate(hit.codeDateApplication),
        url: urls.code(hit.slugCode!, hit.slugSection),
        next: {
          tool: 'leginova_read_code_section',
          arguments: { code_slug: hit.slugCode!, section_slug: hit.slugSection! },
        },
      }) as NormalizedHit;
    case 'ARTICLE_CODE':
      return compact({
        ...common,
        title: `Article ${stripTags(hit.headlineNumero ?? hit.headlineTitre)}`,
        reference: [hit.nomCode, hit.nomPartieCode].filter(Boolean).join(', '),
        date: isoDate(hit.codeDateApplication),
        url: hit.slugArticle ? urls.codeArticle(hit.slugCode!, hit.slugArticle) : urls.code(hit.slugCode!),
        ...(hit.slugArticle
          ? {
              next: {
                tool: 'leginova_get_code_article',
                arguments: { code_slug: hit.slugCode!, article_slug: hit.slugArticle },
              },
            }
          : {}),
      }) as NormalizedHit;
    case 'JURISPRUDENCE': {
      const slug = hit.slugJurisprudence!;
      const court = hit.juridiction?.libelle;
      const type = hit.typeJurisprudence?.libelle;
      return compact({
        ...common,
        title: [type, hit.numeroReference ? `n° ${hit.numeroReference}` : '', court ? `- ${court}` : '']
          .filter(Boolean)
          .join(' '),
        reference: hit.numeroReference,
        date: isoDate(hit.dateAudiencePublique),
        source: court,
        url: urls.jurisprudence(slug),
        next: { tool: 'leginova_get_jurisprudence', arguments: { slug } },
      }) as NormalizedHit;
    }
    case 'JONC_ACTE': {
      const numero = hit.joncNumero ?? stripTags(hit.headlineJoncNumero);
      const reference = [natureLabel(hit), hit.numeroActe ? `n° ${hit.numeroActe}` : ''].filter(Boolean).join(' ');
      return compact({
        ...common,
        title: stripTags(hit.headlineObjet) || reference,
        reference: `${reference}${numero ? ` (JONC n° ${numero})` : ''}`,
        date: isoDate(hit.dateActe),
        published_in_jonc_on: isoDate(hit.joncDatePublication),
        source: hit.collectiviteLibelle,
        url: urls.joncItem(numero, 'acte', hit.acteId!),
        next: {
          tool: 'leginova_get_jonc_item',
          arguments: { kind: 'acte', id: hit.acteId!, jonc_numero: numero },
        },
      }) as NormalizedHit;
    }
    case 'JONC': {
      const numero = hit.joncNumero ?? stripTags(hit.headlineJoncNumero);
      return compact({
        ...common,
        title: `JONC n° ${numero}`,
        date: isoDate(hit.joncDatePublication),
        url: urls.jonc(numero),
        next: { tool: 'leginova_get_jonc', arguments: { numero } },
      }) as NormalizedHit;
    }
    case 'DEBAT': {
      const numero = hit.joncNumero!;
      return compact({
        ...common,
        title: `Congress debate ${numero}${hit.mandature ? ` (term ${hit.mandature})` : ''}`,
        reference: numero,
        url: urls.debat(numero),
        next: { tool: 'leginova_get_debat', arguments: { numero } },
      }) as NormalizedHit;
    }
    default:
      return compact({
        ...common,
        title: stripTags(hit.headlineTitre ?? hit.headlineObjet ?? hit.type?.libelle) || kind,
        url: urls.search(stripTags(hit.headlineTitre ?? '')),
      }) as NormalizedHit;
  }
}

export interface NormalizedFacet {
  filter: string;
  label: string;
  values: { value: string; label: string; count: number; parent?: string }[];
}

export function normalizeFacets(groups: FacetGroup[] | undefined, limit = 15): NormalizedFacet[] {
  return (groups ?? [])
    .filter((g) => g.listValue.length > 0)
    .map((g) => ({
      filter: g.code,
      label: g.label,
      values: g.listValue
        .slice(0, limit)
        .map((v) => compact({ value: v.value, label: v.label, count: v.count, parent: v.parentValue }) as NormalizedFacet['values'][number]),
    }));
}

export function renderHits(hits: NormalizedHit[], startRank: number): string {
  return hits
    .map((hit, i) => {
      const meta = [
        hit.reference && hit.reference !== hit.title ? hit.reference : undefined,
        hit.date ? `dated ${hit.date}` : undefined,
        hit.consolidated_on ? `consolidated ${hit.consolidated_on}` : undefined,
        hit.published_in_jonc_on ? `published in the JONC ${hit.published_in_jonc_on}` : undefined,
        hit.source && !hit.reference?.includes(hit.source) ? hit.source : undefined,
        hit.erratum ? 'ERRATUM' : undefined,
      ]
        .filter(Boolean)
        .join(' · ');
      const next = hit.next ? `\n   open: ${hit.next.tool} ${JSON.stringify(hit.next.arguments)}` : '';
      const snippet = hit.snippet ? `\n   > ${hit.snippet}` : '';
      return `${startRank + i}. **${hit.title}** [${hit.kind}]${meta ? `\n   ${meta}` : ''}\n   ${hit.url}${snippet}${next}`;
    })
    .join('\n');
}

export function renderFacets(facets: NormalizedFacet[]): string {
  if (facets.length === 0) return '';
  const blocks = facets.map(
    (f) =>
      `- ${f.label} (\`${f.filter}\`): ${f.values.map((v) => `${v.label} [${v.value}] ${v.count}`).join('; ')}`,
  );
  return `\n\n### Facets (refine with filters: {"${facets[0]!.filter}": ["value"]})\n${blocks.join('\n')}`;
}

export function hitsFrom(response: SearchResponse, urls: SiteUrls) {
  return {
    total: response.totalCount ?? 0,
    results: (response.listResultat ?? []).map((h) => normalizeHit(h, urls)),
    best: (response.listMeilleureCorrespondance ?? []).map((h) => normalizeHit(h, urls)),
  };
}
