// SPDX-License-Identifier: AGPL-3.0-or-later

import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { Catalogue } from '../client/types.js';
import { isoDate } from '../format/text.js';
import { type Deps, READ_ONLY, guard, lines, ok } from './common.js';

interface Entry {
  label: string;
  date?: string;
  open: { tool: string; arguments: Record<string, string | number> };
  url: string;
}

export function registerBrowseTools(server: McpServer, deps: Deps): void {
  const { api, urls } = deps;

  server.registerTool(
    'leginova_browse',
    {
      title: 'Browse a collection by year',
      description:
        'Lists a collection chronologically, like the site map: without `year`, the number of entries per year; with `year`, every entry of that year (paged with offset/limit). Collections: textes_consolides (by adoption year), jurisprudence (by hearing year), debats (Congress debates), jonc (Journal officiel issues). Useful for "what was published in 2025" questions that a keyword search cannot express.',
      inputSchema: z.object({
        collection: z.enum(['textes_consolides', 'jurisprudence', 'debats', 'jonc']),
        year: z.number().int().min(1850).max(2300).optional(),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(500).default(100),
      }),
      outputSchema: z.object({
        collection: z.string(),
        year: z.number().optional(),
        years: z.array(z.object({ year: z.string(), count: z.number() })).optional(),
        total: z.number().optional(),
        entries: z
          .array(
            z.object({
              label: z.string(),
              date: z.string().optional(),
              url: z.string(),
              open: z.object({ tool: z.string(), arguments: z.record(z.string(), z.union([z.string(), z.number()])) }),
            }),
          )
          .optional(),
        next_offset: z.number().optional(),
      }),
      annotations: READ_ONLY,
    },
    async ({ collection, year, offset, limit }, ctx) =>
      guard(async () => {
        const signal = ctx.mcpReq.signal;

        if (year === undefined) {
          if (collection === 'jonc') {
            return ok(
              'The JONC has no per-year count endpoint. Call again with a year (e.g. the current year) to list its issues.',
              { collection },
            );
          }
          const counts =
            collection === 'textes_consolides'
              ? await api.texteConsolideYears({ signal })
              : collection === 'jurisprudence'
                ? await api.jurisprudenceYears({ signal })
                : await api.debatYears({ signal });
          const years = counts
            .map((c) => ({ year: c.annee, count: c.nombre }))
            .sort((a, b) => b.year.localeCompare(a.year));
          const total = years.reduce((n, y) => n + y.count, 0);
          return ok(
            lines(
              `## ${collection}: ${total} entries`,
              years.map((y) => `- ${y.year}: ${y.count}`).join('\n'),
              '\nCall again with a year to list its entries.',
            ),
            { collection, years, total },
          );
        }

        let entries: Entry[];
        switch (collection) {
          case 'textes_consolides':
            entries = (await api.texteConsolideByYear(year, { signal })).map((t) => ({
              label: [t.natureActe, t.numero ? `n° ${t.numero}` : '', t.objet].filter(Boolean).join(' '),
              ...(t.date ? { date: isoDate(t.date)! } : {}),
              open: { tool: 'leginova_get_texte_consolide', arguments: { id: t.id } },
              url: urls.texteConsolide(t.id),
            }));
            break;
          case 'jurisprudence':
            entries = (await api.jurisprudenceByYear(year, { signal })).map((j) => ({
              label: [j.typeJurisprudence?.libelle, j.numeroReference ? `n° ${j.numeroReference}` : '', j.juridiction?.libelle ? `- ${j.juridiction.libelle}` : '']
                .filter(Boolean)
                .join(' '),
              ...(j.dateAudiencePublique ? { date: isoDate(j.dateAudiencePublique)! } : {}),
              open: { tool: 'leginova_get_jurisprudence', arguments: { slug: j.slug } },
              url: urls.jurisprudence(j.slug),
            }));
            break;
          case 'debats':
            entries = (await api.debatByYear(year, { signal })).map((d) => ({
              label: `${d.numero}${d.mandature ? ` (term ${d.mandature})` : ''}`,
              ...(d.dateReference ? { date: isoDate(d.dateReference)! } : {}),
              open: { tool: 'leginova_get_debat', arguments: { numero: d.numero } },
              url: urls.debat(d.numero),
            }));
            break;
          case 'jonc': {
            const list = await api.joncList(year, { signal });
            entries = list.listAnnee
              .filter((y) => y.annee === year)
              .flatMap((y) => y.listJonc)
              .map((j) => ({
                label: `JONC n° ${j.numero}${j.nombreActes !== undefined ? ` (${j.nombreActes} item${j.nombreActes > 1 ? 's' : ''})` : ''}`,
                ...(j.datePublication ? { date: isoDate(j.datePublication)! } : {}),
                open: { tool: 'leginova_get_jonc', arguments: { numero: j.numero } },
                url: urls.jonc(j.numero),
              }));
            break;
          }
        }
        entries.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
        const page = entries.slice(offset, offset + limit);
        const next = offset + limit < entries.length ? offset + limit : undefined;
        const text = lines(
          `## ${collection} ${year}: ${entries.length} entries${entries.length > page.length ? `, showing ${offset + 1}-${offset + page.length}` : ''}`,
          page.map((e) => `- ${e.date ?? '????-??-??'} ${e.label}\n  open: ${e.open.tool} ${JSON.stringify(e.open.arguments)}`).join('\n') ||
            `Nothing listed for ${year}. Leginova's coverage of older years is partial; this is not proof that nothing was published.`,
          next !== undefined ? `\nMore: call again with offset=${next}.` : undefined,
        );
        return ok(text, { collection, year, total: entries.length, entries: page, ...(next !== undefined ? { next_offset: next } : {}) });
      }, `Nothing to browse for ${collection}${year ? ` in ${year}` : ''}`),
  );

  const sections = {
    codes: (c: Catalogue) => (c.listCode ?? []).map((x) => `${x.slug}: ${x.libelle}`),
    themes: (c: Catalogue) =>
      (c.listThematique ?? []).map((x) => `${x.id}: ${x.libelle}${x.themePrincipalId ? ` (under ${x.themePrincipalId})` : ''}`),
    authorities: (c: Catalogue) =>
      (c.listAutoriteEmettrice ?? []).map((x) => `${x.id}: ${x.libelle}${x.typeCollectiviteLibelle ? ` [${x.typeCollectiviteLibelle}]` : ''}`),
    collectivities: (c: Catalogue) => (c.listTypeCollectivite ?? []).map((x) => `${x.id}: ${x.libelle}`),
    act_types: (c: Catalogue) => (c.listTypeActe ?? []).map((x) => `${x.value}: ${x.libelle}`),
    courts: (c: Catalogue) => (c.listJuridiction ?? []).map((x) => `${x.id}: ${x.libelle}${x.ordre ? ` [${x.ordre}]` : ''}`),
    court_orders: (c: Catalogue) => (c.listOrdreJurisprudence ?? []).map((x) => `${x.id}: ${x.libelle}`),
    decision_types: (c: Catalogue) => (c.listTypeJurisprudence ?? []).map((x) => `${x.id}: ${x.libelle}`),
    section_types: (c: Catalogue) => (c.listTypeSection ?? []).map((x) => `${x.id}: ${x.libelle}`),
    condition_scopes: (c: Catalogue) => [
      ...(c.listScopeRecherche ?? []).map((x) => `actes ${x.id}: ${x.tooltip ?? x.libelle}`),
      ...(c.listScopeRechercheCode ?? []).filter((x) => x.id !== 'NUMERO_ARTICLE').map((x) => `codes ${x.id}: ${x.tooltip ?? x.libelle}`),
      ...(c.listScopeRechercheTexteConsolide ?? []).filter((x) => x.id !== 'NUMERO_ARTICLE').map((x) => `textes_consolides ${x.id}: ${x.tooltip ?? x.libelle}`),
      ...(c.listScopeRechercheJurisprudence ?? []).map((x) => `jurisprudence ${x.id}: ${x.tooltip ?? x.libelle}`),
    ],
  } as const;
  type Section = keyof typeof sections;

  server.registerTool(
    'leginova_get_catalogue',
    {
      title: 'Reference lists for advanced search',
      description:
        'Identifiers accepted by leginova_advanced_search: codes, themes, issuing authorities, collectivities, act types, courts, decision types, section types and condition scopes. Filter by `section` and by a `contains` substring to keep the answer short.',
      inputSchema: z.object({
        section: z.enum(['all', ...(Object.keys(sections) as Section[])]).default('all'),
        contains: z.string().optional().describe('Case-insensitive filter on labels, e.g. "province sud"'),
      }),
      annotations: READ_ONLY,
    },
    async ({ section, contains }, ctx) =>
      guard(async () => {
        const catalogue = await api.catalogue({ signal: ctx.mcpReq.signal });
        const wanted = section === 'all' ? (Object.keys(sections) as Section[]) : [section];
        const needle = contains?.toLocaleLowerCase('fr');
        const blocks = wanted.map((name) => {
          const items = sections[name](catalogue).filter((line) => !needle || line.toLocaleLowerCase('fr').includes(needle));
          return items.length > 0 ? `### ${name}\n${items.map((i) => `- ${i}`).join('\n')}` : undefined;
        });
        const text = lines(...blocks) || `Nothing matches "${contains}" in ${section}.`;
        return ok(text);
      }, 'Catalogue unavailable'),
  );
}
