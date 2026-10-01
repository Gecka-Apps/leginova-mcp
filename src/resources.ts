// SPDX-License-Identifier: AGPL-3.0-or-later

import { type McpServer, ProtocolError, ProtocolErrorCode, ResourceNotFoundError, ResourceTemplate } from '@modelcontextprotocol/server';
import { LeginovaHttpError } from './client/http.js';
import { htmlToMarkdown } from './format/html.js';
import { isoDate } from './format/text.js';
import { GUIDE_MARKDOWN } from './instructions.js';
import type { Deps } from './tools/common.js';

async function orNotFound<T>(uri: URL, load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (error instanceof LeginovaHttpError && error.isNotFound) throw new ResourceNotFoundError(uri.href);
    throw error;
  }
}

function single(value: string | string[] | undefined, name: string): string {
  const v = Array.isArray(value) ? value[0] : value;
  if (!v) throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Missing ${name}`);
  return decodeURIComponent(v);
}

export function registerResources(server: McpServer, deps: Deps): void {
  const { api, urls } = deps;

  const completeCodeSlug = async (value: string) => {
    const needle = value.toLowerCase();
    return (await api.codes()).map((c) => c.slug).filter((slug) => slug.includes(needle)).slice(0, 50);
  };

  server.registerResource(
    'guide',
    'leginova://guide',
    {
      title: 'How to use Leginova',
      description: 'Workflow, citation rules, article-number prefixes (L./Lp.) and sources of New Caledonian law',
      mimeType: 'text/markdown',
    },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: GUIDE_MARKDOWN }] }),
  );

  server.registerResource(
    'codes',
    'leginova://codes',
    { title: 'Codes on Leginova', description: 'The 31 codes with their slugs', mimeType: 'application/json' },
    async (uri) => {
      const codes = (await api.codes()).map((c) => ({ title: c.libelle, slug: c.slug, url: urls.code(c.slug) }));
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(codes, null, 2) }] };
    },
  );

  server.registerResource(
    'code-article',
    new ResourceTemplate('leginova://codes/{codeSlug}/articles/{articleSlug}', {
      list: undefined,
      complete: { codeSlug: completeCodeSlug },
    }),
    { title: 'Code article', description: 'One article of a code, as Markdown', mimeType: 'text/markdown' },
    async (uri, variables) => {
      const codeSlug = single(variables.codeSlug, 'codeSlug');
      const articleSlug = single(variables.articleSlug, 'articleSlug');
      const nav = await orNotFound(uri, () => api.codeArticle(codeSlug, articleSlug));
      const text = [
        `# Article ${nav.article?.numero ?? ''}, ${nav.code?.libelle ?? codeSlug}`,
        `Version in force on ${isoDate(nav.code?.dateApplication) ?? '?'}. Source: ${urls.codeArticle(codeSlug, articleSlug)}`,
        '',
        htmlToMarkdown(nav.article?.contenu) || '_(no text)_',
      ].join('\n');
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text }] };
    },
  );

  server.registerResource(
    'texte-consolide',
    new ResourceTemplate('leginova://textes-consolides/{id}', { list: undefined }),
    {
      title: 'Consolidated text (metadata)',
      description: 'Metadata and amendment history of a consolidated text; read the body with leginova_get_texte_consolide',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const id = Number(single(variables.id, 'id'));
      if (!Number.isInteger(id) || id <= 0) throw new ProtocolError(ProtocolErrorCode.InvalidParams, 'id must be a positive integer');
      const t = await orNotFound(uri, () => api.texteConsolide(id));
      const meta = {
        id: t.id,
        nature: t.natureActe,
        numero: t.numero,
        objet: t.objet,
        date: isoDate(t.date),
        consolidated_on: isoDate(t.dateConsolidation),
        authority: t.autorite,
        themes: t.listTheme,
        history: t.listHistorique?.map((h) => ({ change: h.typeModification, act: h.acte, date: isoDate(h.dateActe), jonc: h.joncNumero })),
        url: urls.texteConsolide(t.id),
      };
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(meta, null, 2) }] };
    },
  );

  server.registerResource(
    'jurisprudence',
    new ResourceTemplate('leginova://jurisprudences/{slug}', { list: undefined }),
    { title: 'Court decision (metadata)', description: 'Metadata of a decision; read its text with leginova_get_jurisprudence', mimeType: 'application/json' },
    async (uri, variables) => {
      const slug = single(variables.slug, 'slug');
      const d = await orNotFound(uri, () => api.jurisprudence(slug));
      const meta = {
        label: d.instanceLabel,
        court: d.juridiction?.libelle,
        type: d.typeJurisprudence?.libelle,
        reference: d.numeroReference,
        date: isoDate(d.dateAudiencePublique),
        themes: d.listTheme?.map((t) => t.libelle),
        url: urls.jurisprudence(d.slug),
        pdf: urls.api(`/jurisprudence/${d.slug}/pdf`),
      };
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(meta, null, 2) }] };
    },
  );
}
