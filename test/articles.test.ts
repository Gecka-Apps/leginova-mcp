// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { buildCodeIndex, lookupInIndex, normalizeCore, parseArticleNumber } from '../src/articles.js';
import type { CodeNode } from '../src/client/types.js';

const article = (id: number, numero: string, slug: string): CodeNode => ({
  id,
  numero,
  slug,
  type: { id: 'ARTICLE', libelle: 'Article' },
});

// Mirrors the Code de commerce applicable en Nouvelle-Calédonie: 441-6 exists
// only as Lp., 450-1 exists as L., Lp. and R.
const commerce: CodeNode = {
  id: 1,
  titre: 'Code de commerce applicable en Nouvelle-Calédonie',
  type: { id: 'CODE', libelle: 'Code' },
  children: [
    {
      id: 2,
      type: { id: 'PARTIE', libelle: 'Partie' },
      titre: 'Partie législative',
      slug: 'partie-legislative',
      children: [
        article(10, 'Lp. 441-6', 'lp-441-6'),
        article(11, 'L. 450-1', 'l-450-1'),
        article(12, 'Lp. 450-1', 'lp-450-1'),
        article(13, 'L. 123-4', 'l-123-4'),
      ],
    },
    {
      id: 3,
      type: { id: 'PARTIE', libelle: 'Partie' },
      titre: 'Partie réglementaire',
      slug: 'partie-reglementaire',
      children: [article(20, 'R. 450-1', 'r-450-1'), article(21, 'R. 123-4', 'r-123-4')],
    },
  ],
};

const civil: CodeNode = {
  id: 4,
  titre: 'Code civil applicable en Nouvelle-Calédonie',
  type: { id: 'CODE', libelle: 'Code' },
  children: [article(30, '1er', 'article-1er'), article(31, '2276', 'article-2276'), article(32, 'Lp. 2276', 'lp-2276')],
};

const index = buildCodeIndex(commerce, 'code-de-commerce');
const civilIndex = buildCodeIndex(civil, 'code-civil');

describe('parseArticleNumber', () => {
  it.each([
    ['L. 441-6', 'L', '441-6'],
    ['Lp. 441-6', 'Lp', '441-6'],
    ['lp 441-6', 'Lp', '441-6'],
    ['LP.441-6', 'Lp', '441-6'],
    ['L.441-6', 'L', '441-6'],
    ['article L. 441-6', 'L', '441-6'],
    ['art. R. 4211-1', 'R', '4211-1'],
    ['AN.7', 'AN', '7'],
    ['PS. 112-3', 'PS', '112-3'],
    ['441 - 6', null, '441-6'],
    ['1er', null, '1'],
    ['Lp. 5 bis', 'Lp', '5 bis'],
    ['L. 441‑6', 'L', '441-6'],
  ])('%s', (input, prefix, core) => {
    expect(parseArticleNumber(input)).toMatchObject({ prefix, core });
  });

  it('folds ordinal suffixes', () => {
    expect(normalizeCore('1er')).toBe('1');
    expect(normalizeCore('1ère')).toBe('1');
  });
});

describe('lookupInIndex', () => {
  it('finds the Lp. article when the metropolitan L. number is asked, and says so', () => {
    const result = lookupInIndex(index, parseArticleNumber('L. 441-6'));
    expect(result.status).toBe('prefix_variant');
    expect(result.match?.numero).toBe('Lp. 441-6');
    expect(result.notice).toMatch(/L\. 441-6 does not exist/);
    expect(result.notice).toMatch(/Lp\. 441-6/);
  });

  it('returns the exact article and warns about a same-family homonym', () => {
    const result = lookupInIndex(index, parseArticleNumber('L. 450-1'));
    expect(result.status).toBe('exact');
    expect(result.match?.numero).toBe('L. 450-1');
    expect(result.notice).toMatch(/Lp\. 450-1, a different article/);
    expect(result.candidates.map((c) => c.numero)).toEqual(['L. 450-1', 'Lp. 450-1', 'R. 450-1']);
  });

  it('never substitutes a prefix of another nature', () => {
    const result = lookupInIndex(index, parseArticleNumber('D. 441-6'));
    expect(result.status).toBe('other_prefix_only');
    expect(result.match).toBeUndefined();
    expect(result.notice).toMatch(/NOT substituted/);
    expect(result.notice).toMatch(/NOT evidence/);
  });

  it('reports ambiguity for an unprefixed number shared by several articles', () => {
    const result = lookupInIndex(index, parseArticleNumber('450-1'));
    expect(result.status).toBe('ambiguous');
    expect(result.match).toBeUndefined();
    expect(result.candidates).toHaveLength(3);
  });

  it('resolves an unprefixed number carried by a single article', () => {
    const result = lookupInIndex(index, parseArticleNumber('441-6'));
    expect(result.status).toBe('unique_unprefixed');
    expect(result.match?.numero).toBe('Lp. 441-6');
  });

  it('never returns a bare not-found', () => {
    const result = lookupInIndex(index, parseArticleNumber('L. 999-9'));
    expect(result.status).toBe('not_found');
    expect(result.notice).toMatch(/under any prefix/);
    expect(result.notice).toMatch(/NOT evidence that no legal basis exists/);
  });

  it('matches "1er" against "1" in codes numbered without prefix', () => {
    expect(lookupInIndex(civilIndex, parseArticleNumber('article 1')).match?.numero).toBe('1er');
    expect(lookupInIndex(civilIndex, parseArticleNumber('1er')).status).toBe('unique_unprefixed');
  });

  it('keeps an unprefixed number distinct from its Lp. homonym', () => {
    const result = lookupInIndex(civilIndex, parseArticleNumber('2276'));
    expect(result.status).toBe('ambiguous');
    const lp = lookupInIndex(civilIndex, parseArticleNumber('Lp. 2276'));
    expect(lp.status).toBe('exact');
    expect(lp.notice).toMatch(/2276/);
  });

  it('records where each article sits in the code', () => {
    const result = lookupInIndex(index, parseArticleNumber('R. 450-1'));
    expect(result.match?.path).toEqual(['Partie - Partie réglementaire']);
  });
});
