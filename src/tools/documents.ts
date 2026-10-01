// SPDX-License-Identifier: AGPL-3.0-or-later

import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { pdfPath } from '../client/api.js';
import type { Acte, FileRef, SommaireActe } from '../client/types.js';
import { htmlToMarkdown, stripTags } from '../format/html.js';
import { type PdfReadResult, readPdfText } from '../format/pdf.js';
import { compact, isoDate } from '../format/text.js';
import { type JoncItemKind, isModernJoncNumber } from '../format/urls.js';
import { type Deps, READ_ONLY, bullet, document, guard, lines } from './common.js';

const pageWindow = {
  page_start: z.number().int().min(1).default(1).describe('First PDF page to return'),
  page_end: z.number().int().min(1).optional().describe('Last PDF page to return (default: as many as max_chars allows)'),
  max_chars: z.number().int().min(2000).max(100_000).default(30_000),
};

const MENTION_LABELS: Record<string, string> = {
  VISA: 'Visas',
  CONSIDERATION: 'Considérants',
  ENTENDU: 'Entendus',
  DELIBERANT: 'Délibérants',
};

function files(label: string, refs: FileRef[] | undefined, url: (ref: FileRef) => string): string | undefined {
  if (!refs || refs.length === 0) return undefined;
  return `\n### ${label}\n${refs.map((r) => `- ${r.nom ?? r.libelle ?? `#${r.id}`}: ${url(r)}`).join('\n')}`;
}

function acteHeadline(acte: Acte): string {
  return [
    acte.natureActe,
    acte.qualificatifNature,
    acte.numeroActe ? `n° ${acte.numeroActe}` : '',
    acte.dateActe ? `(${isoDate(acte.dateActe)})` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** True when Leginova holds the act as structured text, false when only its PDF carries it. */
function hasStructuredText(acte: Acte): boolean {
  return (acte.listArticle?.length ?? 0) > 0 || (acte.listMention?.length ?? 0) > 0 || Boolean(stripTags(acte.dispositif));
}

/** Metadata of a JONC act, as exposed in `structuredContent`. */
function acteData(acte: Acte, joncNumero: string | undefined) {
  return compact({
    nature: acte.natureActe ?? undefined,
    number: acte.numeroActe ?? undefined,
    signed_on: isoDate(acte.dateActe),
    object: acte.objet ?? undefined,
    issuer: acte.emetteur ?? undefined,
    filing_authority: acte.autoriteDeposante ?? undefined,
    collectivity: acte.typeCollectivite ?? undefined,
    jonc_numero: joncNumero,
    jonc_section: acte.rubriqueJonc ?? undefined,
    published_in_jonc_on: isoDate(acte.joncDatePublication),
    import_mode: acte.importMode ?? undefined,
    pdf_scope: acte.pdfJoncEntier ? 'whole_issue' : 'act',
    erratum: acte.erratum || undefined,
    corrects_act_id: acte.acteCorrigeId ?? undefined,
    corrects_act_jonc: acte.acteCorrigeJoncNumero ?? undefined,
  });
}

function acteHeader(acte: Acte, url: string | undefined, pdfUrl: string, title?: string): string {
  return lines(
    `## ${title ?? acteHeadline(acte)}`,
    acte.objet ? `_${acte.objet}_` : undefined,
    '',
    bullet('Issuer', acte.emetteur),
    bullet('Filing authority', acte.autoriteDeposante),
    bullet('Collectivity', acte.typeCollectivite),
    bullet('JONC section', acte.rubriqueJonc),
    bullet('Published in the JONC on', isoDate(acte.joncDatePublication)),
    bullet('Erratum', acte.erratum ? `yes, corrects act ${acte.acteCorrigeId ?? '?'} (JONC ${acte.acteCorrigeJoncNumero ?? '?'})` : undefined),
    bullet('URL', url),
    bullet('PDF', `${pdfUrl}${acte.pdfJoncEntier ? ' (the whole JONC issue, not this act alone)' : ''}`),
  );
}

function acteMarkdown(acte: Acte, annexeUrl: (ref: FileRef) => string): string {
  const mentions = new Map<string, string[]>();
  for (const m of acte.listMention ?? []) {
    const text = htmlToMarkdown(m.contenu);
    if (!text) continue;
    const key = m.type ?? 'AUTRE';
    mentions.set(key, [...(mentions.get(key) ?? []), text]);
  }
  const articles = (acte.listArticle ?? []).map((a) => {
    const body = htmlToMarkdown(a.contenu);
    const alineas = (a.listAlinea ?? []).map((al) => htmlToMarkdown(al.contenu)).filter(Boolean).join('\n\n');
    return lines(`#### Article ${a.numeroArticle ?? ''}${a.titre ? ` - ${a.titre}` : ''}`, body, alineas || undefined);
  });
  return lines(
    acte.intro ? htmlToMarkdown(acte.intro) : undefined,
    ...[...mentions.entries()].map(([type, texts]) => `\n### ${MENTION_LABELS[type] ?? type}\n${texts.join('\n')}`),
    acte.preambule ? `\n${htmlToMarkdown(acte.preambule)}` : undefined,
    articles.length > 0 ? `\n### Articles\n${articles.join('\n\n')}` : undefined,
    acte.dispositif ? `\n${htmlToMarkdown(acte.dispositif)}` : undefined,
    acte.mentionFait ? `\n${htmlToMarkdown(acte.mentionFait)}` : undefined,
    acte.listSignataire?.length
      ? `\n### Signatories\n${acte.listSignataire.map((s) => `- ${[s.prenomNom, s.fonction].filter(Boolean).join(', ')}`).join('\n')}`
      : undefined,
    files('Annexes', acte.listAnnexe, annexeUrl),
  );
}

/** Generic rendering for legal publications and associations, whose schema the site does not document. */
function recordMarkdown(record: Record<string, unknown>): string {
  return Object.entries(record)
    .filter(([key, value]) => key !== 'id' && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'))
    .map(([key, value]) => {
      const text = typeof value === 'string' ? (/<[a-z]/i.test(value) ? htmlToMarkdown(value) : value.trim()) : String(value);
      return text ? `- **${key}**: ${text}` : undefined;
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * Renders the outcome of a PDF read. `text_status` tells "this document has no
 * text" (not_available + reason) apart from "here is the text", so a model
 * neither mistakes a scan for an extraction failure nor loops on next_page.
 */
function pdfOutcome(result: PdfReadResult): { markdown: string; data: Record<string, unknown> } {
  if (result.status === 'not_available') {
    return {
      markdown: `**Text not available (${result.reason}).** ${result.detail}`,
      data: compact({
        text_status: 'not_available',
        text_unavailable_reason: result.reason,
        text_unavailable_detail: result.detail,
        total_pages: result.totalPages,
      }),
    };
  }
  const range = `pages ${result.firstPage}-${result.lastPage} of ${result.totalPages}`;
  const tail =
    result.nextPage !== undefined
      ? `[${range}. Text continues: call again with page_start=${result.nextPage}.]`
      : `[${range}. No text after page ${result.lastPage}.]`;
  const blank =
    result.pagesWithoutText.length > 0 ? ` Pages without a text layer: ${result.pagesWithoutText.join(', ')}.` : '';
  return {
    markdown: `${result.text}\n\n${tail}${blank}`,
    data: compact({
      text_status: 'pdf_text',
      text_source: 'pdf',
      first_page: result.firstPage,
      last_page: result.lastPage,
      total_pages: result.totalPages,
      next_page: result.nextPage,
      pages_without_text: result.pagesWithoutText.length > 0 ? result.pagesWithoutText : undefined,
    }),
  };
}

export function registerDocumentTools(server: McpServer, deps: Deps): void {
  const { api, urls } = deps;
  const http = api.http;
  type Window = { page_start: number; page_end?: number | undefined; max_chars: number };
  const readPdf = async (path: string, window: Window, signal: AbortSignal) =>
    pdfOutcome(await readPdfText(http, path, window, signal));

  server.registerTool(
    'leginova_get_jurisprudence',
    {
      title: 'Read a court decision',
      description:
        'Reads a decision published on Leginova (Conseil d\'État, Cour de cassation, Cour d\'appel de Nouméa, Tribunal administratif, Conseil constitutionnel...): metadata plus the full text extracted from the official PDF, by page range. `text_status` says whether text was found and, if not, why.',
      inputSchema: z.object({
        slug: z.string().min(3).describe('Decision slug, e.g. "cour-de-cassation-arret-13-15646-2014-11-04"'),
        ...pageWindow,
      }),
      annotations: READ_ONLY,
    },
    async ({ slug, ...window }, ctx) =>
      guard(async () => {
        const signal = ctx.mcpReq.signal;
        const decision = await api.jurisprudence(slug, { signal });
        const url = urls.jurisprudence(slug);
        const meta = compact({
          slug,
          url,
          court: decision.juridiction?.libelle,
          order: decision.ordre?.libelle,
          decision_type: decision.typeJurisprudence?.libelle,
          reference: decision.numeroReference,
          hearing_date: isoDate(decision.dateAudiencePublique),
          themes: decision.listTheme?.map((t) => t.libelle),
          pdf_url: decision.fichierPdf ? urls.api(pdfPath.jurisprudence(slug)) : undefined,
        });
        const header = lines(
          `## ${decision.instanceLabel ?? slug}`,
          bullet('Court', decision.juridiction?.libelle),
          bullet('Order', decision.ordre?.libelle),
          bullet('Type', decision.typeJurisprudence?.libelle),
          bullet('Reference', decision.numeroReference),
          bullet('Hearing date', isoDate(decision.dateAudiencePublique)),
          bullet('Themes', decision.listTheme?.map((t) => t.libelle).join(', ')),
          bullet('URL', url),
          bullet('PDF', meta.pdf_url as string | undefined),
        );
        if (!decision.fichierPdf) {
          return document(`${header}\n\n**Text not available (no_pdf).** Leginova attaches no PDF to this decision.`, {
            ...meta,
            text_status: 'not_available',
            text_unavailable_reason: 'no_pdf',
          });
        }
        const pdf = await readPdf(pdfPath.jurisprudence(slug), window, signal);
        return document(`${header}\n\n${pdf.markdown}`, { ...meta, ...pdf.data });
      }, `No decision "${slug}". Find slugs with leginova_search (scope jurisprudence) or leginova_browse`),
  );

  server.registerTool(
    'leginova_get_jonc',
    {
      title: 'Open a Journal officiel issue',
      description: [
        'Opens an issue of the Journal officiel de la Nouvelle-Calédonie (JONC).',
        'Numbers like "2026-00020" are items of the new electronic JONC and return the full act directly;',
        'plain numbers like "10068" are classic issues and return their table of contents (acts by section, legal publications, associations),',
        'each with the id to pass to leginova_get_jonc_item. The issue date is the JONC publication date of every act it contains.',
        'leginova_browse lists the issues of a year.',
      ].join(' '),
      inputSchema: z.object({
        numero: z.string().trim().min(1).describe('JONC number, e.g. "10068" or "2026-00020"'),
      }),
      annotations: READ_ONLY,
    },
    async ({ numero }, ctx) =>
      guard(async () => {
        const signal = ctx.mcpReq.signal;
        if (isModernJoncNumber(numero)) {
          const contenu = await api.joncContenu(numero, { signal });
          const url = urls.jonc(numero);
          if (contenu.acte) {
            const acte = contenu.acte;
            const pdfUrl = urls.api(pdfPath.acte(acte.id));
            const text = lines(
              acteHeader(acte, url, pdfUrl, `JONC n° ${numero} (${isoDate(contenu.datePublication) ?? '?'}): ${acteHeadline(acte)}`),
              '',
              acteMarkdown(acte, (r) => urls.api(`/acte/${acte.id}/annexe/${r.id}`)),
            );
            return document(text, {
              numero,
              url,
              issue_date: isoDate(contenu.datePublication) ?? null,
              kind: 'acte',
              acte_id: acte.id,
              ...acteData(acte, numero),
              text_status: hasStructuredText(acte) ? 'structured' : 'not_available',
              pdf_url: pdfUrl,
            });
          }
          const record = contenu.publicationLegale ?? contenu.associationFondation ?? {};
          const text = lines(
            `## JONC n° ${numero} (${isoDate(contenu.datePublication) ?? '?'}): ${contenu.typeContenu ?? ''}`,
            bullet('URL', url),
            '',
            recordMarkdown(record),
          );
          return document(text, { numero, url, issue_date: isoDate(contenu.datePublication) ?? null, kind: contenu.typeContenu ?? 'unknown' });
        }

        const sommaire = await api.joncSommaire(numero, { signal });
        const url = urls.jonc(numero);
        const issueDate = isoDate(sommaire.datePublication);
        const describe = (a: SommaireActe) =>
          [a.natureActe?.instanceLabel ?? a.natureActe?.libelle, a.numeroActe ? `n° ${a.numeroActe}` : '', a.dateActe ? `(${isoDate(a.dateActe)})` : '']
            .filter(Boolean)
            .join(' ');
        const bySection = new Map<string, string[]>();
        for (const a of sommaire.listActe ?? []) {
          const section = a.rubriqueJonc ?? 'Other';
          const line = `- ${describe(a)}: ${a.objet ?? ''}${a.erratum ? ' [ERRATUM]' : ''}${a.pageJonc ? ` (p. ${a.pageJonc})` : ''} {acte id ${a.id}}`;
          bySection.set(section, [...(bySection.get(section) ?? []), line]);
        }
        const publications = (sommaire.listPublicationLegale ?? []).map(
          (p) => `- ${stripTags(String(p.objet ?? p.titre ?? p.libelle ?? ''))} {publication_legale id ${String(p.id)}}`,
        );
        const associations = (sommaire.listAssociationFondation ?? []).map(
          (p) => `- ${stripTags(String(p.nom ?? p.titre ?? p.libelle ?? ''))} {association_fondation id ${String(p.id)}}`,
        );
        const count = sommaire.listActe?.length ?? 0;
        const text = lines(
          `## JONC n° ${sommaire.numeroJonc} of ${issueDate ?? '?'}`,
          bullet('Status', sommaire.statutJonc),
          bullet('Acts', count),
          bullet('URL', url),
          bullet('Full issue PDF', urls.api(pdfPath.jonc(numero))),
          ...[...bySection.entries()].map(([section, items]) => `\n### ${section}\n${items.join('\n')}`),
          publications.length ? `\n### Legal publications\n${publications.join('\n')}` : undefined,
          associations.length ? `\n### Associations and foundations\n${associations.join('\n')}` : undefined,
          count + publications.length + associations.length === 0
            ? '\nThis issue lists no item on Leginova. It may not be published yet or exist only as the full PDF above.'
            : '\nOpen an item with leginova_get_jonc_item {kind, id, jonc_numero}.',
        );
        return document(text, {
          numero,
          url,
          issue_date: issueDate ?? null,
          status: sommaire.statutJonc ?? null,
          pdf_url: urls.api(pdfPath.jonc(numero)),
          acts: (sommaire.listActe ?? []).map((a) =>
            compact({
              id: a.id,
              title: describe(a),
              object: a.objet ?? undefined,
              section: a.rubriqueJonc ?? undefined,
              printed_page: a.pageJonc ?? undefined,
              erratum: a.erratum || undefined,
            }),
          ),
          legal_publications: publications.length,
          associations: associations.length,
        });
      }, `No JONC issue "${numero}". List the issues of a year with leginova_browse {collection: "jonc", year}`),
  );

  server.registerTool(
    'leginova_get_jonc_item',
    {
      title: 'Read an act or publication from the JONC',
      description: [
        'Reads one item published in the JONC: an act (arrêté, délibération, loi du pays, State law...), a legal publication or an association notice.',
        'Returns published_in_jonc_on (date of publication in the JONC) and the filing authority with every act.',
        'Recent acts come as structured text. For many older acts Leginova holds metadata only: with pdf_text "auto" the text is then extracted',
        'from the official PDF. `text_status` is "structured", "pdf_text" or "not_available" with a reason (pdf_without_text_layer = image scan,',
        'retrying other pages will not help). pdf_scope "whole_issue" means the PDF is the entire JONC issue, not the act alone.',
      ].join(' '),
      inputSchema: z.object({
        kind: z.enum(['acte', 'publication_legale', 'association_fondation']).default('acte'),
        id: z.number().int().positive(),
        jonc_numero: z.string().optional().describe('JONC number the item belongs to, used for the citation URL and to locate the act in a whole-issue PDF'),
        pdf_text: z.enum(['auto', 'always', 'never']).default('auto'),
        ...pageWindow,
      }),
      annotations: READ_ONLY,
    },
    async ({ kind, id, jonc_numero, pdf_text, ...window }, ctx) =>
      guard(async () => {
        const signal = ctx.mcpReq.signal;
        const url = jonc_numero ? urls.joncItem(jonc_numero, kind as JoncItemKind, id) : undefined;

        if (kind === 'acte') {
          const acte = await api.acte(id, { signal });
          const structured = hasStructuredText(acte);
          const pdfUrl = urls.api(pdfPath.acte(id));
          const base = { kind, id, ...(url ? { url } : {}), pdf_url: pdfUrl, ...acteData(acte, jonc_numero) };
          const header = acteHeader(acte, url, pdfUrl);
          const body = structured ? acteMarkdown(acte, (r) => urls.api(`/acte/${id}/annexe/${r.id}`)) : '';
          const wantPdf = pdf_text === 'always' || (pdf_text === 'auto' && !structured);

          if (!wantPdf) {
            if (structured) return document(lines(header, '', body), { ...base, text_status: 'structured' });
            return document(
              lines(header, '', '**No structured text on Leginova for this act** (metadata only). Call again with pdf_text "auto" to read the official PDF.'),
              { ...base, text_status: 'not_available', text_unavailable_reason: 'pdf_not_requested' },
            );
          }

          let locate: string | undefined;
          let printedPage: number | undefined;
          if (acte.pdfJoncEntier && jonc_numero && !isModernJoncNumber(jonc_numero)) {
            const sommaire = await api.joncSommaire(jonc_numero, { signal }).catch(() => undefined);
            printedPage = sommaire?.listActe?.find((a) => a.id === id)?.pageJonc ?? undefined;
          }
          if (acte.pdfJoncEntier) {
            locate =
              `This act has no PDF of its own: the PDF below is the whole JONC issue${jonc_numero ? ` n° ${jonc_numero}` : ''}, other acts included.` +
              (printedPage
                ? ` The act starts on printed page ${printedPage} of the JONC (page numbers appear in the page headers).`
                : ' Pass jonc_numero to get the printed page where it starts.');
          }
          const pdf = await readPdf(pdfPath.acte(id), window, signal);
          const source = structured
            ? '### Text extracted from the PDF'
            : '### Text extracted from the official PDF (Leginova holds only the metadata of this act)';
          return document(
            lines(header, body ? `\n${body}` : undefined, '', source, locate ? `_${locate}_` : undefined, '', pdf.markdown),
            {
              ...base,
              ...(printedPage ? { printed_page_in_jonc: printedPage } : {}),
              ...pdf.data,
              ...(structured ? { text_status: 'structured', pdf_text_status: pdf.data.text_status } : {}),
            },
          );
        }

        const record = kind === 'publication_legale' ? await api.publicationLegale(id, { signal }) : await api.associationFondation(id, { signal });
        const pdfApi = kind === 'publication_legale' ? pdfPath.publicationLegale(id) : pdfPath.associationFondation(id);
        const header = lines(
          `## ${kind === 'publication_legale' ? 'Legal publication' : 'Association / foundation'} ${id}`,
          bullet('URL', url),
          bullet('PDF', urls.api(pdfApi)),
        );
        const body = recordMarkdown(record);
        const base = { kind, id, ...(url ? { url } : {}), pdf_url: urls.api(pdfApi) };
        if (pdf_text === 'never' || (pdf_text === 'auto' && body.length > 200)) {
          return document(lines(header, '', body), { ...base, text_status: body ? 'structured' : 'not_available' });
        }
        const pdf = await readPdf(pdfApi, window, signal);
        return document(lines(header, '', body, '\n### Text extracted from the PDF\n', pdf.markdown), { ...base, ...pdf.data });
      }, `No ${kind} with id ${id}. Take ids from leginova_get_jonc or from JONC_ACTE search results`),
  );

  server.registerTool(
    'leginova_get_debat',
    {
      title: 'Read a Congress debate',
      description:
        'Reads the record of a sitting of the Congrès de la Nouvelle-Calédonie ("compte rendu des débats", numbers like "DR-2026-00005"), extracted from the official PDF by page range. These PDFs run to hundreds of pages and the first access downloads up to 60 MB (a few seconds): read them page range by page range.',
      inputSchema: z.object({
        numero: z.string().trim().min(3).describe('Debate number, e.g. "DR-2026-00005"'),
        ...pageWindow,
        max_chars: z.number().int().min(2000).max(100_000).default(20_000),
      }),
      annotations: READ_ONLY,
    },
    async ({ numero, ...window }, ctx) =>
      guard(async () => {
        const signal = ctx.mcpReq.signal;
        const nav = await api.debat(numero, { signal });
        const debat = nav.debat;
        const url = urls.debat(debat.numero);
        const fileUrl = (r: FileRef) => urls.api(`/debat/${debat.id}/fichier/${r.id}`);
        const header = lines(
          `## Congress debate ${debat.numero}`,
          bullet('Term (mandature)', debat.mandature),
          bullet('Sessions', [isoDate(debat.datePremiereSession), isoDate(debat.dateDerniereSession)].filter(Boolean).join(' to ')),
          bullet('Previous / next', `${nav.precedent?.numero ?? 'none'} / ${nav.suivant?.numero ?? 'none'}`),
          bullet('URL', url),
          bullet('PDF', urls.api(pdfPath.debat(debat.id))),
          files('Amendments', debat.listFichierAmendement, fileUrl),
          files('Committee reports', debat.listFichierRapportCommission, fileUrl),
          files('Presentation reports', debat.listFichierRapportPresentation, fileUrl),
          files('Opinions', debat.listFichierAvisInstances, fileUrl),
        );
        const pdf = await readPdf(pdfPath.debat(debat.id), window, signal);
        return document(`${header}\n\n${pdf.markdown}`, {
          numero: debat.numero,
          url,
          term: debat.mandature ?? null,
          previous: nav.precedent?.numero ?? null,
          next: nav.suivant?.numero ?? null,
          pdf_url: urls.api(pdfPath.debat(debat.id)),
          ...pdf.data,
        });
      }, `No debate "${numero}". List debates with leginova_browse {collection: "debats", year} or search with scope debats`),
  );
}
