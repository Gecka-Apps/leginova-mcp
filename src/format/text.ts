// SPDX-License-Identifier: AGPL-3.0-or-later

/** Normalizes the API's mixed date formats (`2026-09-28`, `28/09/2026`, `2020-07-02T00:00:00`) to ISO dates. */
export function isoDate(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const fr = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (fr) return `${fr[3]}-${fr[2]}-${fr[1]}`;
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return iso ? iso[1] : value.trim();
}

export interface TextWindow {
  text: string;
  offset: number;
  /** Offset to pass back to read the next chunk, absent on the last chunk. */
  nextOffset?: number;
  totalChars: number;
}

/**
 * Cuts a long document into model-sized chunks, preferring a paragraph break
 * near the end of the window so an article is not split mid-sentence.
 */
export function sliceText(text: string, offset: number, maxChars: number): TextWindow {
  const totalChars = text.length;
  const start = Math.min(Math.max(offset, 0), totalChars);
  let end = Math.min(start + maxChars, totalChars);
  if (end < totalChars) {
    const floor = start + Math.floor(maxChars * 0.6);
    const paragraph = text.lastIndexOf('\n\n', end);
    const line = text.lastIndexOf('\n', end);
    if (paragraph > floor) end = paragraph;
    else if (line > floor) end = line;
  }
  return {
    text: text.slice(start, end),
    offset: start,
    ...(end < totalChars ? { nextOffset: end } : {}),
    totalChars,
  };
}

export function continuationNote(window: TextWindow, hint: string): string {
  if (window.nextOffset === undefined) {
    return window.offset > 0 ? `\n\n[End of document, ${window.totalChars} characters.]` : '';
  }
  return `\n\n[Truncated: characters ${window.offset} to ${window.nextOffset} of ${window.totalChars}. ${hint.replace('{offset}', String(window.nextOffset))}]`;
}

export function compact<T extends Record<string, unknown>>(record: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  ) as Partial<T>;
}

export function mdEscapeInline(text: string): string {
  return text.replace(/([\\`*_[\]])/g, '\\$1');
}
