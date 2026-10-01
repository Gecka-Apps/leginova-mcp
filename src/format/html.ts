// SPDX-License-Identifier: AGPL-3.0-or-later

import TurndownService from 'turndown';

// Some consolidated texts embed scanned tables or maps as base64 images inside
// an article body (one of them weighs 1.1 MB). They carry no text for the model
// and would blow the context window, so they collapse to a marker.
const IMAGE_MARKER = '[image omitted: see the PDF or the page on leginova.gouv.nc]';

function cellText(service: TurndownService, cell: HTMLElement): string {
  return service
    .turndown(cell.innerHTML)
    .replace(/\n+/g, '<br>')
    .replace(/\|/g, '\\|')
    .trim();
}

function tableToMarkdown(service: TurndownService, table: HTMLElement): string {
  const rows = Array.from(table.querySelectorAll('tr')).map((tr) =>
    Array.from(tr.children)
      .filter((cell) => cell.nodeName === 'TD' || cell.nodeName === 'TH')
      .map((cell) => cellText(service, cell as HTMLElement)),
  );
  const nonEmpty = rows.filter((row) => row.some((cell) => cell !== ''));
  if (nonEmpty.length === 0) return '';
  const width = Math.max(...nonEmpty.map((row) => row.length));
  const pad = (row: string[]) => [...row, ...Array<string>(width - row.length).fill('')];
  const [head, ...body] = nonEmpty.map(pad);
  const line = (row: string[]) => `| ${row.join(' | ')} |`;
  return ['', line(head!), line(Array<string>(width).fill('---')), ...body.map(line), ''].join('\n');
}

function createService(): TurndownService {
  const service = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    emDelimiter: '_',
    strongDelimiter: '**',
    codeBlockStyle: 'fenced',
  });

  service.addRule('inlineImage', {
    filter: 'img',
    replacement: (_content, node) => {
      const src = (node as HTMLElement).getAttribute('src') ?? '';
      if (src === '' || src.startsWith('data:')) return IMAGE_MARKER;
      const alt = (node as HTMLElement).getAttribute('alt') ?? 'image';
      return `![${alt}](${src})`;
    },
  });

  service.addRule('searchHighlight', {
    filter: ['mark'],
    replacement: (content) => (content.trim() ? `**${content}**` : content),
  });

  service.addRule('table', {
    filter: 'table',
    replacement: (_content, node) => `\n\n${tableToMarkdown(service, node as HTMLElement)}\n\n`,
  });

  service.remove(['script', 'style', 'colgroup']);
  // Legal text is quoted verbatim downstream: Markdown escaping would turn
  // "IV. - Les conditions" into "IV. \- Les conditions".
  service.escape = (text: string) => text;
  return service;
}

let shared: TurndownService | undefined;

/** Converts the HTML fragments stored by Leginova (article bodies, visas, notes) to Markdown. */
export function htmlToMarkdown(html: string | null | undefined): string {
  if (!html) return '';
  const cleaned = html
    .replace(/<img\b[^>]*\bsrc\s*=\s*["']data:[^"']*["'][^>]*>/gi, '<span>[[IMAGE]]</span>')
    .replace(/<p>\s*<\/p>/g, '');
  shared ??= createService();
  return shared
    .turndown(cleaned)
    .replace(/\[\[IMAGE\]\]/g, IMAGE_MARKER)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Replaces `<mark>` search highlights with Markdown bold and drops any other tag. */
export function highlightToMarkdown(fragment: string | null | undefined): string {
  if (!fragment) return '';
  return fragment
    .replace(/<\/mark>(\s*)<mark>/g, '$1')
    .replace(/<mark>/g, '**')
    .replace(/<\/mark>/g, '**')
    .replace(/<[^>]+>/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Plain text without highlight markers, for titles and identifiers. */
export function stripTags(fragment: string | null | undefined): string {
  if (!fragment) return '';
  return fragment.replace(/<[^>]+>/g, '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}
