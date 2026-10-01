// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { normalizeHit } from '../src/format/hits.js';
import { highlightToMarkdown, htmlToMarkdown } from '../src/format/html.js';
import { joinTextItems } from '../src/format/pdf.js';
import { isoDate, sliceText } from '../src/format/text.js';
import { SiteUrls, isModernJoncNumber } from '../src/format/urls.js';

const urls = new SiteUrls('https://leginova.gouv.nc');

describe('htmlToMarkdown', () => {
  it('collapses embedded base64 images to a marker', () => {
    const html = `<p>Voir le plan :</p><p><img src="data:image/png;base64,${'A'.repeat(50_000)}"></p>`;
    const md = htmlToMarkdown(html);
    expect(md.length).toBeLessThan(200);
    expect(md).toContain('[image omitted');
  });

  it('turns header-less tables into GFM tables', () => {
    const html =
      '<table><colgroup><col><col></colgroup><tbody><tr><td><p><strong>Services</strong></p></td><td><p>Redevance</p></td></tr>' +
      '<tr><td><p>Prise de vue</p></td><td><p>50 000 XPF | demi-journée</p></td></tr></tbody></table>';
    expect(htmlToMarkdown(html)).toBe(
      '| **Services** | Redevance |\n| --- | --- |\n| Prise de vue | 50 000 XPF \\| demi-journée |',
    );
  });

  it('keeps legal text verbatim, without Markdown escapes', () => {
    expect(htmlToMarkdown('<p>IV. - Les conditions de règlement</p><p>1. Premier point</p>')).toBe(
      'IV. - Les conditions de règlement\n\n1. Premier point',
    );
  });

  it('replaces non-breaking spaces', () => {
    expect(htmlToMarkdown('<p>Lp.&nbsp;331-3</p>')).toBe('Lp. 331-3');
  });
});

describe('highlightToMarkdown', () => {
  it('keeps the space between adjacent highlighted words', () => {
    expect(highlightToMarkdown('un <mark>bail</mark> <mark>commercial</mark> conclu')).toBe('un **bail commercial** conclu');
  });
});

describe('isoDate', () => {
  it.each([
    ['28/09/2026', '2026-09-28'],
    ['2026-09-28', '2026-09-28'],
    ['2020-07-02T00:00:00', '2020-07-02'],
    [null, undefined],
  ])('%s', (input, expected) => {
    expect(isoDate(input)).toBe(expected);
  });
});

describe('sliceText', () => {
  const text = Array.from({ length: 50 }, (_, i) => `Paragraphe ${i} ${'x'.repeat(80)}`).join('\n\n');

  it('cuts on a paragraph break and chains through the whole text', () => {
    let offset = 0;
    let rebuilt = '';
    let rounds = 0;
    for (;;) {
      const window = sliceText(text, offset, 1000);
      rebuilt += window.text;
      rounds++;
      if (window.nextOffset === undefined) break;
      expect(text.slice(window.nextOffset, window.nextOffset + 2)).toBe('\n\n');
      offset = window.nextOffset;
    }
    expect(rebuilt).toBe(text);
    expect(rounds).toBeGreaterThan(4);
  });
});

describe('joinTextItems', () => {
  it('adds the space pdf.js leaves out between fragments of one line', () => {
    const items = [
      { str: 'JOURNAL OFFICIEL', transform: [1, 0, 0, 1, 100, 700], width: 90, height: 10 },
      { str: 'DE LA NOUVELLE-CALEDONIE', transform: [1, 0, 0, 1, 195, 700], width: 120, height: 10, hasEOL: true },
      { str: '31 décembre 2020', transform: [1, 0, 0, 1, 100, 680], width: 70, height: 10 },
      { str: '21566', transform: [1, 0, 0, 1, 400, 680], width: 20, height: 10 },
    ];
    expect(joinTextItems(items)).toBe('JOURNAL OFFICIEL DE LA NOUVELLE-CALEDONIE\n31 décembre 2020 21566');
  });

  it('starts a new line on a vertical jump without EOL flag', () => {
    const items = [
      { str: 'Vu la loi', transform: [1, 0, 0, 1, 100, 700], width: 40, height: 10 },
      { str: 'organique', transform: [1, 0, 0, 1, 100, 688], width: 40, height: 10 },
    ];
    expect(joinTextItems(items)).toBe('Vu la loi\norganique');
  });
});

describe('normalizeHit', () => {
  it('links a code article result to the prefix-tolerant reader', () => {
    const hit = normalizeHit(
      {
        type: { id: 'ARTICLE_CODE' },
        nomCode: 'Code du travail de Nouvelle-Calédonie',
        slugCode: 'code-du-travail-de-nouvelle-caledonie',
        slugArticle: 'partie-legislative-article-lp-122-13',
        headlineNumero: 'Lp. 122-13',
        headlineContenu: 'un <mark>licenciement</mark> pour motif économique',
      },
      urls,
    );
    expect(hit).toMatchObject({
      kind: 'ARTICLE_CODE',
      title: 'Article Lp. 122-13',
      url: 'https://leginova.gouv.nc/codes/code-du-travail-de-nouvelle-caledonie/article/partie-legislative-article-lp-122-13',
      snippet: 'un **licenciement** pour motif économique',
      next: { tool: 'leginova_get_code_article' },
    });
  });

  it('builds JONC URLs for both numbering schemes', () => {
    expect(isModernJoncNumber('2026-00020')).toBe(true);
    expect(isModernJoncNumber('10068')).toBe(false);
    expect(urls.joncItem('10068', 'acte', 5)).toBe('https://leginova.gouv.nc/jonc/sommaire-analytique/10068/acte/5');
    expect(urls.joncItem('2026-00020', 'acte', 5)).toBe('https://leginova.gouv.nc/jonc/contenu/2026-00020');
  });
});
