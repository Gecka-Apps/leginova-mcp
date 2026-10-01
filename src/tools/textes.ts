// SPDX-License-Identifier: AGPL-3.0-or-later

import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { TexteArticle, TexteConsolide, TexteSection } from '../client/types.js';
import { htmlToMarkdown } from '../format/html.js';
import { compact, continuationNote, isoDate, sliceText } from '../format/text.js';
import { renderHistory } from './codes.js';
import { type Deps, READ_ONLY, bullet, document, guard, lines } from './common.js';

function articleMarkdown(article: TexteArticle, level: number): string {
  const body = htmlToMarkdown(article.contenu);
  const alineas = (article.listAlinea ?? []).map((a) => htmlToMarkdown(a.contenu)).filter(Boolean).join('\n\n');
  const status = [article.statut, article.natureModification].filter(Boolean).join(', ');
  return lines(
    `${'#'.repeat(Math.min(level, 6))} Article ${article.numero ?? ''}${article.titreArticle ? ` - ${article.titreArticle}` : ''}${status ? ` (${status})` : ''} {article_id: ${article.id}}`,
    body || alineas || '_(no text in Leginova for this article)_',
    body && alineas ? alineas : undefined,
    article.note ? `> Note: ${htmlToMarkdown(article.note)}` : undefined,
  );
}

function sectionMarkdown(section: TexteSection, level: number): string {
  const title = [section.type, section.numero, section.titre ? `- ${section.titre}` : ''].filter(Boolean).join(' ');
  return lines(
    `${'#'.repeat(Math.min(level, 6))} ${title}`,
    ...(section.listPreambule ?? []).map((p) => htmlToMarkdown(p.contenu)),
    section.note ? `> Note: ${htmlToMarkdown(section.note)}` : undefined,
    ...(section.listArticle ?? []).map((a) => `\n${articleMarkdown(a, level + 1)}`),
    ...(section.listSection ?? []).map((s) => `\n${sectionMarkdown(s, level + 1)}`),
  );
}

function outline(sections: TexteSection[] | undefined, articles: TexteArticle[] | undefined, depth = 0): string[] {
  const indent = '  '.repeat(depth);
  const out = (articles ?? []).map((a) => `${indent}- Art. ${a.numero ?? '?'}${a.titreArticle ? ` ${a.titreArticle}` : ''} (article_id: ${a.id})`);
  for (const s of sections ?? []) {
    out.push(`${indent}- ${[s.type, s.numero, s.titre ? `- ${s.titre}` : ''].filter(Boolean).join(' ')}`);
    out.push(...outline(s.listSection, s.listArticle, depth + 1));
  }
  return out;
}

function countArticles(texte: { listArticle?: TexteArticle[]; listSection?: TexteSection[] }): number {
  return (texte.listArticle?.length ?? 0) + (texte.listSection ?? []).reduce((n, s) => n + countArticles(s), 0);
}

function headline(texte: TexteConsolide): string {
  return [texte.natureActe, texte.numero ? `n° ${texte.numero}` : '', texte.date ? `(${isoDate(texte.date)})` : '']
    .filter(Boolean)
    .join(' ');
}

export function registerTexteTools(server: McpServer, deps: Deps): void {
  const { api, urls } = deps;

  server.registerTool(
    'leginova_get_texte_consolide',
    {
      title: 'Read a consolidated text',
      description: [
        'Reads a consolidated text (loi du pays, délibération, arrêté... in its current version with all amendments applied).',
        'mode "outline" returns metadata, the table of articles and the amendment history; mode "full" returns the text itself,',
        'chunked by max_chars (pass back `offset` to continue). Pass article_id to read a single article with its own history.',
        'Always state the consolidation date when quoting: the text is the version in force on that date.',
      ].join(' '),
      inputSchema: z.object({
        id: z.number().int().positive().describe('Consolidated text id (texteConsolideId in search results)'),
        mode: z.enum(['outline', 'full']).default('full'),
        article_id: z.number().int().positive().optional().describe('Read only this article'),
        offset: z.number().int().min(0).default(0),
        max_chars: z.number().int().min(2000).max(100_000).default(30_000),
        include_history: z.boolean().default(true).describe('Append the list of amending acts'),
      }),
      annotations: READ_ONLY,
    },
    async ({ id, mode, article_id, offset, max_chars, include_history }, ctx) =>
      guard(async () => {
        const signal = ctx.mcpReq.signal;
        const url = urls.texteConsolide(id);

        if (article_id) {
          const nav = await api.texteArticle(id, article_id, { signal });
          const t = nav.texte;
          const article = nav.article!;
          const text = lines(
            `## ${[t?.natureActe, t?.numero ? `n° ${t.numero}` : ''].filter(Boolean).join(' ')} ${t?.objet ?? ''}`.trim(),
            bullet('Issuing authority', t?.autorite),
            bullet('Adopted on', isoDate(t?.date)),
            bullet('Version dated', isoDate(t?.dateVersion)),
            bullet('Location', (nav.listAncetre ?? []).map((a) => [a.type, a.numero, a.titre].filter(Boolean).join(' ')).join(' > ')),
            bullet('Position', nav.position && nav.total ? `${nav.position} / ${nav.total}` : undefined),
            bullet('URL', url),
            '',
            articleMarkdown(article, 3),
            article.listHistorique?.length ? `\n### History of this article\n${renderHistory(article.listHistorique, 30)}` : undefined,
            nav.precedent || nav.suivant
              ? `\nPrevious: ${nav.precedent ? `art. ${nav.precedent.numero} (article_id ${nav.precedent.id})` : 'none'} · Next: ${nav.suivant ? `art. ${nav.suivant.numero} (article_id ${nav.suivant.id})` : 'none'}`
              : undefined,
          );
          return document(text, { id, article_id, url, version_date: isoDate(t?.dateVersion) ?? null });
        }

        const texte = await api.texteConsolide(id, { signal });
        const header = lines(
          `## ${headline(texte)}`,
          texte.objet ? `_${texte.objet.trim()}_` : undefined,
          '',
          bullet('Issuing authority', texte.autorite),
          bullet('Consolidated on', isoDate(texte.dateConsolidation) ?? 'not stated (check the latest amendment in the history)'),
          bullet('Themes', texte.listTheme?.join(', ')),
          bullet('Articles', countArticles(texte)),
          bullet('Official PDF', texte.hasPdf ? urls.api(`/texte-consolide/${id}/pdf`) : undefined),
          bullet('URL', url),
        );
        const meta = compact({
          id,
          url,
          nature: texte.natureActe ?? undefined,
          number: texte.numero ?? undefined,
          object: texte.objet?.trim(),
          adopted_on: isoDate(texte.date),
          consolidated_on: isoDate(texte.dateConsolidation),
          issuing_authority: texte.autorite ?? undefined,
          themes: texte.listTheme,
          articles: countArticles(texte),
          pdf_url: texte.hasPdf ? urls.api(`/texte-consolide/${id}/pdf`) : undefined,
          text_status: countArticles(texte) > 0 ? 'structured' : 'not_available',
        });
        const history =
          include_history && texte.listHistorique?.length
            ? `\n### Amendment history\n${renderHistory(texte.listHistorique, 40)}`
            : undefined;
        const applying = texte.listTexteApplication?.length
          ? `\n### Implementing texts\n${texte.listTexteApplication
              .map((t) => `- ${t.libelle ?? [t.numero, t.objet].filter(Boolean).join(' ')}${t.id ? ` (id ${t.id})` : ''}`)
              .join('\n')}`
          : undefined;
        const annexes = texte.listAnnexe?.length
          ? `\n### Annexes\n${texte.listAnnexe
              .map((a) => `- ${a.nom ?? a.libelle ?? `annexe ${a.id}`}: ${urls.api(`/texte-consolide/${id}/annexe/${a.id}`)}`)
              .join('\n')}`
          : undefined;

        if (mode === 'outline') {
          const toc = outline(texte.listSection, texte.listArticle);
          return document(
            lines(header, '\n### Contents', toc.slice(0, 500).join('\n') || '_(no structured articles)_', applying, annexes, history),
            meta,
          );
        }

        const body = lines(
          ...(texte.listPreambule ?? []).map((p) => htmlToMarkdown(p.contenu)),
          ...(texte.listArticle ?? []).map((a) => `\n${articleMarkdown(a, 3)}`),
          ...(texte.listSection ?? []).map((s) => `\n${sectionMarkdown(s, 3)}`),
        );
        const window = sliceText(body, offset, max_chars);
        const first = window.offset === 0;
        const text = lines(
          first ? header : `## ${headline(texte)} (continued)\n- **URL**: ${url}`,
          '',
          window.text || '_(Leginova has no structured text for this document: use the official PDF.)_',
          continuationNote(window, 'Call again with offset={offset} to continue.'),
          window.nextOffset === undefined ? applying : undefined,
          window.nextOffset === undefined ? annexes : undefined,
          window.nextOffset === undefined ? history : undefined,
        );
        return document(text, {
          ...meta,
          offset: window.offset,
          ...(window.nextOffset !== undefined ? { next_offset: window.nextOffset } : {}),
          total_chars: window.totalChars,
        });
      }, `No consolidated text with id ${id}${article_id ? ` / article ${article_id}` : ''}. Find ids with leginova_search (scope textes_consolides) or leginova_suggest`),
  );
}
