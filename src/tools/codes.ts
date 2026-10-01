// SPDX-License-Identifier: AGPL-3.0-or-later

import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { ArticleLookup, IndexedArticle } from '../articles.js';
import type { CodeNode, CodeSummary, HistoryEntry } from '../client/types.js';
import { htmlToMarkdown } from '../format/html.js';
import { continuationNote, isoDate, sliceText } from '../format/text.js';
import { type Deps, READ_ONLY, bullet, document, fail, guard, lines, ok } from './common.js';

const codeSlug = z
  .string()
  .trim()
  .min(3)
  .describe('Code slug, e.g. "code-du-travail-de-nouvelle-caledonie" (see leginova_list_codes)');

function nodeTitle(node: CodeNode): string {
  const type = node.type?.libelle ?? '';
  const numero = node.numero ? ` ${node.numero}` : '';
  const titre = node.titre ? ` - ${node.titre}` : '';
  return `${type}${numero}${titre}`.trim() || node.instanceLabel || `#${node.id}`;
}

function countArticles(node: CodeNode): number {
  if (node.type?.id === 'ARTICLE') return 1;
  return (node.children ?? []).reduce((sum, child) => sum + countArticles(child), 0);
}

function findSection(node: CodeNode, slug: string): CodeNode | undefined {
  if (node.slug === slug) return node;
  for (const child of node.children ?? []) {
    const found = findSection(child, slug);
    if (found) return found;
  }
  return undefined;
}

export function renderHistory(entries: HistoryEntry[] | undefined, limit = 15): string | undefined {
  if (!entries || entries.length === 0) return undefined;
  const rows = entries.slice(0, limit).map((h) => {
    const date = isoDate(h.dateActe);
    const where = [h.jonc?.replace(/\s+/g, ' '), h.joncNumero ? `JONC n° ${h.joncNumero}` : undefined, h.jorf]
      .filter(Boolean)
      .join(', ');
    return `- ${[h.typeModification, h.acte].filter(Boolean).join(' ')}${h.article ? ` (${h.article})` : ''}${date ? `, ${date}` : ''}${where ? ` [${where}]` : ''}`;
  });
  if (entries.length > limit) rows.push(`- ... ${entries.length - limit} more`);
  return rows.join('\n');
}

function articleMarkdown(node: CodeNode): string {
  const body = htmlToMarkdown(node.contenu);
  const alineas = (node.listAlinea ?? [])
    .map((a) => htmlToMarkdown(a.contenu))
    .filter(Boolean)
    .join('\n\n');
  const status = [node.statut, node.natureModification].filter(Boolean).join(', ');
  return lines(
    `#### Article ${node.numero ?? ''}${node.titre ? ` - ${node.titre}` : ''}${status ? ` (${status})` : ''}`,
    body || alineas || '_(no text in Leginova for this article)_',
    body && alineas ? alineas : undefined,
    node.note ? `> Note: ${htmlToMarkdown(node.note)}` : undefined,
  );
}

function sectionMarkdown(node: CodeNode, depth: number): string {
  if (node.type?.id === 'ARTICLE') return articleMarkdown(node);
  const heading = '#'.repeat(Math.min(depth, 3) + 1);
  const intro = node.contenu ? htmlToMarkdown(node.contenu) : '';
  return lines(
    `${heading} ${nodeTitle(node)}`,
    intro || undefined,
    ...(node.children ?? []).map((child) => `\n${sectionMarkdown(child, depth + 1)}`),
  );
}

function outlineLines(node: CodeNode, depth: number, maxDepth: number, out: string[], budget: { left: number }): void {
  for (const child of node.children ?? []) {
    if (budget.left <= 0) return;
    const indent = '  '.repeat(depth);
    if (child.type?.id === 'ARTICLE') {
      if (depth < maxDepth) {
        out.push(`${indent}- Art. ${child.numero ?? '?'} (article_slug: ${child.slug})`);
        budget.left--;
      }
      continue;
    }
    const articles = countArticles(child);
    out.push(`${indent}- ${nodeTitle(child)} (section_slug: ${child.slug}, ${articles} article${articles > 1 ? 's' : ''})`);
    budget.left--;
    if (depth + 1 < maxDepth) outlineLines(child, depth + 1, maxDepth, out, budget);
  }
}

function describeCandidate(a: IndexedArticle): string {
  return `${a.numero} in ${a.codeTitle} (code_slug: ${a.codeSlug}, article_slug: ${a.slug})${a.path.length ? `, under ${a.path.join(' > ')}` : ''}`;
}

export function registerCodeTools(server: McpServer, deps: Deps): void {
  const { api, urls, articles } = deps;

  const listCodes = (signal?: AbortSignal): Promise<CodeSummary[]> => api.codes({ signal });

  server.registerTool(
    'leginova_list_codes',
    {
      title: 'List the codes',
      description: [
        'Lists the 31 consolidated codes published on Leginova with the slug every other code tool expects,',
        'the filing authority of each code (Etat, Nouvelle-Calédonie, Province) and the date of the published version.',
        'Titles alone mislead: "Code civil applicable en Nouvelle-Calédonie" is filed by New Caledonia, "Code de la consommation applicable en Nouvelle-Calédonie"',
        'by the State, next to a separate "Code de la consommation de Nouvelle-Calédonie". Codes can also be mixed: the Code de commerce applicable en Nouvelle-Calédonie,',
        'filed by New Caledonia, keeps State-law articles (L.) next to loi du pays articles (Lp.), so competence is read article by article from the prefix.',
        'The first call reads every code and takes a few seconds.',
      ].join(' '),
      inputSchema: z.object({}),
      outputSchema: z.object({
        codes: z.array(
          z.object({
            id: z.number(),
            title: z.string(),
            slug: z.string(),
            filing_authority: z.string().optional(),
            version_date: z.string().optional(),
            url: z.string(),
          }),
        ),
        note: z.string(),
      }),
      annotations: READ_ONLY,
    },
    async (_args, ctx) =>
      guard(async () => {
        const signal = ctx.mcpReq.signal;
        const summaries = await listCodes(signal);
        const indexes = new Map((await articles.allCodes(summaries, signal)).map((i) => [i.codeSlug, i]));
        const codes = summaries.map((c) => {
          const index = indexes.get(c.slug);
          return {
            id: c.id,
            title: c.libelle,
            slug: c.slug,
            ...(index?.authority ? { filing_authority: index.authority } : {}),
            ...(index?.inForceOn ? { version_date: index.inForceOn } : {}),
            url: urls.code(c.slug),
          };
        });
        const note =
          'The filing authority is the body that files and maintains the consolidated code on Leginova. It is a better guide than the title, which says "applicable en Nouvelle-Calédonie" for codes filed by the State and by New Caledonia alike, but it does not settle competence for mixed codes: there, the article prefix tells State-law articles (L., R., D.) from loi du pays articles (Lp.).';
        const groups = new Map<string, typeof codes>();
        for (const code of codes) {
          const key = code.filing_authority ?? 'Unknown authority';
          groups.set(key, [...(groups.get(key) ?? []), code]);
        }
        const text = lines(
          `## ${codes.length} codes on Leginova`,
          note,
          ...[...groups.entries()].map(
            ([authority, list]) =>
              `\n### Filed by: ${authority}\n${list.map((c) => `- ${c.title} (version ${c.version_date ?? '?'})\n  code_slug: ${c.slug}`).join('\n')}`,
          ),
        );
        return ok(text, { codes, note });
      }, 'Could not list codes'),
  );

  server.registerTool(
    'leginova_get_code_outline',
    {
      title: 'Table of contents of a code',
      description:
        'Table of contents of a code (parts, books, titles, chapters, sections) with article counts and the section_slug / article_slug needed to read them. Start broad (depth 2), then zoom in with section_slug.',
      inputSchema: z.object({
        code_slug: codeSlug,
        section_slug: z.string().optional().describe('Restrict the outline to this section'),
        depth: z.number().int().min(1).max(8).default(2).describe('Levels to expand; articles are listed once the depth reaches them'),
      }),
      annotations: READ_ONLY,
    },
    async ({ code_slug, section_slug, depth }, ctx) =>
      guard(async () => {
        const tree = await api.codeTree(code_slug, { signal: ctx.mcpReq.signal });
        const root = section_slug ? findSection(tree, section_slug) : tree;
        if (!root) {
          return fail(
            `No section "${section_slug}" in ${tree.titre ?? code_slug}. Call leginova_get_code_outline without section_slug to see valid slugs.`,
          );
        }
        const out: string[] = [];
        const budget = { left: 400 };
        outlineLines(root, 0, depth, out, budget);
        const total = countArticles(root);
        const text = lines(
          `## ${tree.titre ?? code_slug}${root !== tree ? ` > ${nodeTitle(root)}` : ''}`,
          bullet('Version in force on', isoDate(tree.dateApplication)),
          bullet('Filing authority', tree.autoriteDeposante),
          bullet('Articles in scope', total),
          bullet('URL', urls.code(code_slug, root !== tree ? root.slug : undefined)),
          '',
          out.join('\n'),
          budget.left <= 0 ? '\n[Outline truncated at 400 lines: lower `depth` or pass a section_slug.]' : undefined,
          '\nRead a section with leginova_read_code_section, an article with leginova_get_code_article.',
        );
        return document(text, {
          code_slug,
          title: tree.titre ?? code_slug,
          filing_authority: tree.autoriteDeposante ?? null,
          version_date: isoDate(tree.dateApplication) ?? null,
          articles: total,
          url: urls.code(code_slug),
        });
      }, `No code "${code_slug}". Call leginova_list_codes for valid slugs`),
  );

  server.registerTool(
    'leginova_get_code_article',
    {
      title: 'Read a code article',
      description: [
        'Returns one code article (text, amendment history, place in the code, previous/next articles, official URL).',
        'Give either article_slug (from search results or outlines) or article_number.',
        'article_number matching is prefix-tolerant: "L. 441-6", "Lp 441-6", "441-6" or "art. 1er" all resolve, and the result',
        'states how the match was made (match_status). "Lp." numbers articles adopted or localized by a New Caledonian loi du pays:',
        'the metropolitan "L. 441-6" is "Lp. 441-6" in the Code de commerce applicable en Nouvelle-Calédonie. The same number can',
        'also exist under several prefixes as distinct articles; the result lists them. Without code_slug, every code is searched.',
        'A not_found status is never proof that no legal basis exists: relay the notice.',
      ].join(' '),
      inputSchema: z.object({
        code_slug: codeSlug.optional().describe('Code to look in; omit to search all codes by article_number'),
        article_slug: z.string().optional().describe('e.g. "partie-legislative-article-lp-334-26"'),
        article_number: z.string().max(60).optional().describe('e.g. "L. 441-6", "Lp. 122-13", "R. 4211-1", "2276", "1er"'),
      }),
      outputSchema: z.object({
        match_status: z.enum([
          'by_slug',
          'exact',
          'unique_unprefixed',
          'prefix_variant',
          'ambiguous',
          'other_prefix_only',
          'not_found',
        ]),
        requested: z.string(),
        notice: z.string().optional(),
        article: z
          .object({
            code_slug: z.string(),
            code_title: z.string(),
            article_slug: z.string(),
            number: z.string(),
            filing_authority: z.string().optional(),
            in_force_on: z.string().optional(),
            url: z.string(),
            previous: z.string().optional(),
            next: z.string().optional(),
          })
          .optional(),
        candidates: z.array(
          z.object({ code_slug: z.string(), code_title: z.string(), article_slug: z.string(), number: z.string(), url: z.string() }),
        ),
        text: z.string().describe('The full answer as Markdown: notices, article text, history, neighbours'),
      }),
      annotations: READ_ONLY,
    },
    async ({ code_slug, article_slug, article_number }, ctx) =>
      guard(async () => {
        const signal = ctx.mcpReq.signal;
        if (!article_slug && !article_number) return fail('Give article_slug or article_number.');
        if (article_slug && !code_slug) return fail('article_slug needs code_slug.');

        let lookups: ArticleLookup[] = [];
        let target: { codeSlug: string; articleSlug: string } | undefined;
        let status: string;
        let notice: string | undefined;
        const requested = article_slug ?? article_number!;

        if (article_slug) {
          target = { codeSlug: code_slug!, articleSlug: article_slug };
          status = 'by_slug';
        } else if (code_slug) {
          const lookup = await articles.lookup(code_slug, article_number!, signal);
          lookups = [lookup];
          status = lookup.status;
          notice = lookup.notice;
          if (lookup.match) target = { codeSlug: code_slug, articleSlug: lookup.match.slug };
          if (lookup.status === 'not_found' || lookup.status === 'other_prefix_only') {
            const elsewhere = (await articles.acrossCodes(article_number!, await listCodes(signal), signal)).filter(
              (l) => l.codeSlug !== code_slug,
            );
            if (elsewhere.length > 0) {
              lookups.push(...elsewhere);
              notice = `${notice}\nThe same number exists in other codes: ${elsewhere
                .flatMap((l) => l.candidates)
                .map((a) => `${a.numero} (${a.codeTitle})`)
                .join('; ')}.`;
            }
          }
        } else {
          lookups = await articles.acrossCodes(article_number!, await listCodes(signal), signal);
          const exact = lookups.filter((l) => l.match && l.status === 'exact');
          const strong = lookups.filter(
            (l) => l.match && (l.status === 'exact' || l.status === 'prefix_variant' || l.status === 'unique_unprefixed'),
          );
          const chosen = exact.length === 1 ? exact[0] : strong.length === 1 ? strong[0] : undefined;
          if (chosen) {
            status = chosen.status;
            const others = lookups.filter((l) => l !== chosen).flatMap((l) => l.candidates);
            notice = [
              chosen.notice,
              others.length > 0
                ? `Found in ${chosen.codeTitle}. The number also exists elsewhere: ${others.map((a) => `${a.numero} (${a.codeTitle})`).join('; ')}. Pass code_slug if another code was meant.`
                : undefined,
            ]
              .filter(Boolean)
              .join('\n') || undefined;
            target = { codeSlug: chosen.codeSlug, articleSlug: chosen.match!.slug };
          } else if (lookups.length === 0) {
            status = 'not_found';
            notice =
              `No code on Leginova has an article numbered "${article_number}", under any prefix. ` +
              'This is NOT evidence that no legal basis exists: the rule may be in a non-codified text (try leginova_search), ' +
              'in State law applicable in New Caledonia published only on Légifrance, or renumbered or repealed.';
          } else {
            status = 'ambiguous';
            notice = `"${article_number}" exists in ${lookups.length} code(s). Pass code_slug to pick one.`;
          }
        }

        const candidates = lookups.flatMap((l) => l.candidates).map((a) => ({
          code_slug: a.codeSlug,
          code_title: a.codeTitle,
          article_slug: a.slug,
          number: a.numero,
          url: urls.codeArticle(a.codeSlug, a.slug),
        }));
        const candidateText =
          candidates.length > 0 && (!target || candidates.length > 1)
            ? `\n### Articles with this number\n${lookups.flatMap((l) => l.candidates).map((a) => `- ${describeCandidate(a)}`).join('\n')}`
            : undefined;

        if (!target) {
          const text = lines(`## Article "${requested}": ${status}`, notice ? `\n**${notice}**` : undefined, candidateText);
          return ok(text, { match_status: status, requested, ...(notice ? { notice } : {}), candidates, text });
        }

        const nav = await api.codeArticle(target.codeSlug, target.articleSlug, { signal });
        const article = nav.article!;
        const codeTitle = nav.code?.libelle ?? target.codeSlug;
        const authority = (await articles.forCode(target.codeSlug, signal)).authority;
        const url = urls.codeArticle(target.codeSlug, target.articleSlug);
        const body = htmlToMarkdown(article.contenu);
        const alineas = (article.listAlinea ?? []).map((a) => htmlToMarkdown(a.contenu)).filter(Boolean).join('\n\n');
        const text = lines(
          `## Article ${article.numero ?? ''}, ${codeTitle}`,
          notice ? `\n**${notice}**\n` : undefined,
          bullet('Version in force on', isoDate(nav.code?.dateApplication)),
          bullet('Filing authority of the code', authority),
          bullet('Location', (nav.listAncetre ?? []).map((a) => a.instanceLabel ?? a.titre).join(' > ')),
          bullet('Status', [article.statut, article.natureModification].filter(Boolean).join(', ')),
          bullet('Position', nav.position && nav.total ? `${nav.position} / ${nav.total}` : undefined),
          bullet('URL', url),
          '',
          body || alineas || '_(Leginova has no text for this article: check the official PDF of the code or the amending act.)_',
          body && alineas ? alineas : undefined,
          article.note ? `\n> Note: ${htmlToMarkdown(article.note)}` : undefined,
          article.listHistorique?.length ? `\n### History\n${renderHistory(article.listHistorique)}` : undefined,
          nav.precedent || nav.suivant
            ? `\nPrevious: ${nav.precedent ? `${nav.precedent.numero} (${nav.precedent.slug})` : 'none'} · Next: ${nav.suivant ? `${nav.suivant.numero} (${nav.suivant.slug})` : 'none'}`
            : undefined,
          candidateText,
        );
        return ok(text, {
          match_status: status,
          requested,
          ...(notice ? { notice } : {}),
          article: {
            code_slug: target.codeSlug,
            code_title: codeTitle,
            article_slug: target.articleSlug,
            number: article.numero ?? '',
            ...(authority ? { filing_authority: authority } : {}),
            ...(nav.code?.dateApplication ? { in_force_on: isoDate(nav.code.dateApplication)! } : {}),
            url,
            ...(nav.precedent?.slug ? { previous: nav.precedent.slug } : {}),
            ...(nav.suivant?.slug ? { next: nav.suivant.slug } : {}),
          },
          candidates,
          text,
        });
      }, `Article not found. Check code_slug with leginova_list_codes, or look the article up by article_number`),
  );

  server.registerTool(
    'leginova_read_code_section',
    {
      title: 'Read a section of a code',
      description:
        'Full text of a code section (chapter, section...) with all its articles, in reading order. Long sections are returned in chunks: pass back `offset` to continue.',
      inputSchema: z.object({
        code_slug: codeSlug,
        section_slug: z.string().describe('From leginova_get_code_outline or a SECTION_CODE search result'),
        offset: z.number().int().min(0).default(0),
        max_chars: z.number().int().min(2000).max(100_000).default(30_000),
      }),
      annotations: READ_ONLY,
    },
    async ({ code_slug, section_slug, offset, max_chars }, ctx) =>
      guard(async () => {
        const tree = await api.codeTree(code_slug, { signal: ctx.mcpReq.signal });
        const section = findSection(tree, section_slug);
        if (!section) {
          return fail(`No section "${section_slug}" in ${tree.titre ?? code_slug}. Use leginova_get_code_outline to list section slugs.`);
        }
        const full = sectionMarkdown(section, 1);
        const window = sliceText(full, offset, max_chars);
        const header = lines(
          `## ${tree.titre ?? code_slug}`,
          bullet('Version in force on', isoDate(tree.dateApplication)),
          bullet('Filing authority', tree.autoriteDeposante),
          bullet('URL', urls.code(code_slug, section.slug)),
          '',
        );
        return document(
          `${header}\n\n${window.text}${continuationNote(window, 'Call again with offset={offset} to continue.')}`,
          {
            code_slug,
            section_slug,
            filing_authority: tree.autoriteDeposante ?? null,
            version_date: isoDate(tree.dateApplication) ?? null,
            url: urls.code(code_slug, section.slug),
            offset: window.offset,
            ...(window.nextOffset !== undefined ? { next_offset: window.nextOffset } : {}),
            total_chars: window.totalChars,
          },
        );
      }, `No code "${code_slug}". Call leginova_list_codes for valid slugs`),
  );
}
