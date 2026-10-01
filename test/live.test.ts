// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Client } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectBundled, textOf } from './helpers.js';

// Runs the bundled server against leginova.gouv.nc. Opt-in (npm run test:live)
// because it depends on the network and on the live corpus.
const live = process.env.LEGINOVA_LIVE === '1';
const COMMERCE = 'code-de-commerce-applicable-en-nouvelle-caledonie';

describe.runIf(live)('live Leginova', () => {
  let client: Client;

  beforeAll(async () => {
    client = await connectBundled();
  }, 30_000);

  afterAll(async () => {
    await client?.close();
  });

  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    return { result, text: textOf(result), data: result.structuredContent as Record<string, unknown> | undefined };
  };

  it('resolves the metropolitan L. 441-6 to Lp. 441-6 and flags it', async () => {
    const { data, text } = await call('leginova_get_code_article', { code_slug: COMMERCE, article_number: 'L. 441-6' });
    expect(data?.match_status).toBe('prefix_variant');
    expect((data?.article as { number: string }).number).toBe('Lp. 441-6');
    expect(text).toMatch(/L\. 441-6 does not exist/);
    expect(text).toMatch(/conditions générales de vente/);
  }, 60_000);

  it('finds L. 441-6 without being told the code', async () => {
    const { data } = await call('leginova_get_code_article', { article_number: 'L. 441-6' });
    expect((data?.article as { code_slug: string }).code_slug).toBe(COMMERCE);
  }, 120_000);

  it('warns that L. 450-1 and Lp. 450-1 are two different articles', async () => {
    const { data } = await call('leginova_get_code_article', { code_slug: COMMERCE, article_number: 'L. 450-1' });
    expect(data?.match_status).toBe('exact');
    expect(String(data?.notice)).toMatch(/Lp\. 450-1/);
  }, 60_000);

  it('searches case law with facets', async () => {
    const { data } = await call('leginova_search', { query: 'bail commercial', scope: 'jurisprudence', page_size: 3, include_facets: true });
    expect(Number(data?.total)).toBeGreaterThan(10);
    expect((data?.facets as unknown[]).length).toBeGreaterThan(0);
  }, 30_000);

  it('reads a decision from its PDF', async () => {
    const { text } = await call('leginova_get_jurisprudence', { slug: 'cour-de-cassation-arret-13-15646-2014-11-04', max_chars: 3000 });
    expect(text).toMatch(/LA COUR DE CASSATION/);
  }, 60_000);

  it('reads a metadata-only State act from its PDF, with its JONC publication date in structuredContent', async () => {
    // Loi n° 2004-575 (LCEN), published in JONC n° 7908 of 2005-11-22.
    const { data } = await call('leginova_get_jonc_item', { kind: 'acte', id: 1152852, jonc_numero: '7908', page_start: 1, page_end: 1 });
    expect(data).toMatchObject({
      text_status: 'pdf_text',
      published_in_jonc_on: '2005-11-22',
      filing_authority: 'Etat',
      pdf_scope: 'act',
      import_mode: 'LIGHT',
      next_page: 2,
    });
    expect(String(data?.text)).toMatch(/confiance dans l'économie numérique/);
  }, 60_000);

  it('says a scanned whole-issue PDF has no text instead of inviting page-by-page retries', async () => {
    const { data } = await call('leginova_get_jonc_item', { kind: 'acte', id: 1083053, jonc_numero: '6742', page_start: 1, page_end: 1 });
    expect(data).toMatchObject({
      text_status: 'not_available',
      text_unavailable_reason: 'pdf_without_text_layer',
      pdf_scope: 'whole_issue',
      printed_page_in_jonc: 3331,
    });
    expect(data?.next_page).toBeUndefined();
  }, 120_000);

  it('lists codes with their filing authority', async () => {
    const { data } = await call('leginova_list_codes', {});
    const codes = data?.codes as { slug: string; filing_authority?: string }[];
    const authority = (slug: string) => codes.find((c) => c.slug === slug)?.filing_authority;
    expect(codes).toHaveLength(31);
    expect(authority('code-de-la-consommation-applicable-en-nouvelle-caledonie')).toBe('Etat');
    expect(authority('code-de-la-consommation-de-nouvelle-caledonie')).toBe('Nouvelle-Calédonie');
    expect(authority('code-civil-applicable-en-nouvelle-caledonie')).toBe('Nouvelle-Calédonie');
  }, 120_000);

  it('puts the whole answer in structuredContent for every reader', async () => {
    const readers: [string, Record<string, unknown>][] = [
      ['leginova_get_code_article', { code_slug: COMMERCE, article_number: 'L. 441-6' }],
      ['leginova_get_code_outline', { code_slug: COMMERCE, depth: 1 }],
      ['leginova_get_texte_consolide', { id: 8848, max_chars: 3000 }],
      ['leginova_get_jurisprudence', { slug: 'cour-de-cassation-arret-13-15646-2014-11-04', max_chars: 3000 }],
      ['leginova_get_jonc', { numero: '10068' }],
    ];
    for (const [name, args] of readers) {
      const { text, data } = await call(name, args);
      expect(data?.text, name).toBe(text);
    }
  }, 120_000);
});
