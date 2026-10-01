// SPDX-License-Identifier: AGPL-3.0-or-later

import { getDocumentProxy } from 'unpdf';
import { type HttpClient, LeginovaHttpError, PdfTooLargeError } from '../client/http.js';

interface TextItemLike {
  str?: string;
  hasEOL?: boolean;
  transform?: number[];
  width?: number;
  height?: number;
}

function tidy(page: string): string {
  return page
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/(\p{L})-\n(\p{Ll})/gu, '$1$2')
    .trim();
}

/**
 * Rebuilds the reading text of a page. pdf.js emits positioned fragments: two
 * fragments of one line may carry no space between them ("JOURNAL OFFICIEL"
 * + "DE LA"), so a horizontal gap becomes a space and a vertical jump a newline.
 */
export function joinTextItems(items: TextItemLike[]): string {
  let text = '';
  let lastY: number | undefined;
  let lastEnd: number | undefined;
  let lastHeight = 10;
  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    const x = item.transform?.[4];
    const y = item.transform?.[5];
    const height = item.height || lastHeight;
    if (text !== '' && !text.endsWith('\n') && x !== undefined && y !== undefined && lastY !== undefined) {
      if (Math.abs(y - lastY) > Math.max(height, lastHeight) * 0.6) text += '\n';
      else if (lastEnd !== undefined && x - lastEnd > height * 0.15 && !/\s$/.test(text) && !/^\s/.test(item.str)) text += ' ';
    }
    text += item.str;
    if (item.hasEOL) text += '\n';
    if (x !== undefined && y !== undefined) {
      lastY = y;
      lastEnd = x + (item.width ?? 0);
    }
    if (item.height) lastHeight = item.height;
  }
  return tidy(text);
}

export type TextUnavailableReason =
  | 'pdf_without_text_layer'
  | 'pdf_not_found'
  | 'pdf_too_large'
  | 'download_failed'
  | 'extraction_failed';

export type PdfReadResult =
  | {
      status: 'pdf_text';
      text: string;
      firstPage: number;
      lastPage: number;
      totalPages: number;
      /** Next page worth reading: absent when nothing after `lastPage` carries text. */
      nextPage?: number;
      /** Pages of the returned range that carry no text layer. */
      pagesWithoutText: number[];
    }
  | {
      status: 'not_available';
      reason: TextUnavailableReason;
      detail: string;
      totalPages?: number;
    };

const PROBE_LIMIT = 400;

/**
 * Reads a page range of a PDF rendition as text and never throws for a
 * document-level problem: the caller gets a status saying whether text exists,
 * and why not. The PDF bytes stay in the shared cache and pages are extracted
 * on demand, each one cached: a Congress debate weighs ~60 MB for 700+ pages,
 * and extracting all of it up front would cost ~20 s.
 */
export async function readPdfText(
  http: HttpClient,
  apiPath: string,
  range: { page_start: number; page_end?: number | undefined; max_chars: number },
  signal?: AbortSignal,
): Promise<PdfReadResult> {
  let bytes: Uint8Array;
  try {
    bytes = await http.memo(
      `pdf-bytes:${apiPath}`,
      async () => {
        const value = await http.getBytes(apiPath, { signal, maxBytes: http.config.maxPdfBytes });
        return { value, size: value.byteLength };
      },
      { signal, ttlMs: 15 * 60 * 1000 },
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof LeginovaHttpError && error.isNotFound) {
      return { status: 'not_available', reason: 'pdf_not_found', detail: 'Leginova has no PDF for this document.' };
    }
    if (error instanceof PdfTooLargeError) {
      return { status: 'not_available', reason: 'pdf_too_large', detail: error.message };
    }
    return { status: 'not_available', reason: 'download_failed', detail: (error as Error).message };
  }

  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    // pdf.js may detach the buffer it is given, so it works on a copy.
    pdf = await getDocumentProxy(bytes.slice());
  } catch (error) {
    return { status: 'not_available', reason: 'extraction_failed', detail: `The PDF could not be parsed: ${(error as Error).message}` };
  }

  try {
    const totalPages = pdf.numPages;
    const pageText = (n: number) =>
      http.memo(`pdf-page:${apiPath}:${n}`, async () => {
        const proxy = await pdf.getPage(n);
        const content = await proxy.getTextContent();
        proxy.cleanup();
        const value = joinTextItems(content.items as TextItemLike[]);
        return { value, size: value.length * 2 + 64 };
      });

    const first = Math.min(Math.max(range.page_start, 1), Math.max(totalPages, 1));
    const last = Math.min(range.page_end ?? totalPages, totalPages);
    const parts: string[] = [];
    const pagesWithoutText: number[] = [];
    let used = 0;
    let textChars = 0;
    let page = first;
    for (; page <= last; page++) {
      signal?.throwIfAborted();
      const body = await pageText(page);
      if (body === '') pagesWithoutText.push(page);
      textChars += body.length;
      const chunk = `--- page ${page}/${totalPages} ---\n${body || '(no text layer on this page)'}`;
      if (parts.length > 0 && used + chunk.length > range.max_chars) break;
      parts.push(chunk.length > range.max_chars ? `${chunk.slice(0, range.max_chars)}\n[page truncated]` : chunk);
      used += chunk.length;
    }
    const lastPage = page - 1;

    // Pointing at the next page is only useful if some later page carries
    // text; otherwise it invites page-by-page retries that all come back empty.
    let nextPage: number | undefined;
    for (let n = lastPage + 1; n <= totalPages && n <= lastPage + PROBE_LIMIT; n++) {
      signal?.throwIfAborted();
      if (textChars > 0 || (await pageText(n)) !== '') {
        nextPage = n;
        break;
      }
    }

    if (textChars === 0 && nextPage === undefined) {
      let earlier = false;
      for (let n = 1; n < first && n <= PROBE_LIMIT; n++) {
        if ((await pageText(n)) !== '') {
          earlier = true;
          break;
        }
      }
      if (!earlier) {
        return {
          status: 'not_available',
          reason: 'pdf_without_text_layer',
          detail: `The PDF (${totalPages} page${totalPages > 1 ? 's' : ''}) is an image scan without a text layer: no page carries extractable text. Read it through its URL; retrying other pages will not help.`,
          totalPages,
        };
      }
    }

    return {
      status: 'pdf_text',
      text: parts.join('\n\n'),
      firstPage: first,
      lastPage,
      totalPages,
      ...(nextPage !== undefined ? { nextPage } : {}),
      pagesWithoutText,
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { status: 'not_available', reason: 'extraction_failed', detail: `Text extraction failed: ${(error as Error).message}` };
  } finally {
    await pdf.loadingTask.destroy();
  }
}
