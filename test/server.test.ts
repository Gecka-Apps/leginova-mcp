// SPDX-License-Identifier: AGPL-3.0-or-later

import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createDeps, createServer } from '../src/server.js';

// Protocol-level checks with no network: an unroutable base URL makes any
// accidental call fail fast instead of reaching leginova.gouv.nc.
const deps = createDeps({ ...loadConfig({ LEGINOVA_BASE_URL: 'http://127.0.0.1:9' }), retries: 0, timeoutMs: 500 });
const client = new Client({ name: 'test', version: '0.0.0' });

beforeAll(async () => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer(deps).connect(serverSide);
  await client.connect(clientSide);
});

afterAll(async () => {
  await client.close();
});

describe('tool surface', () => {
  it('exposes namespaced, read-only tools with descriptions', async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBe(14);
    for (const tool of tools) {
      expect(tool.name).toMatch(/^leginova_[a-z_]+$/);
      expect(tool.description?.length).toBeGreaterThan(60);
      expect(tool.title).toBeTruthy();
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: true });
    }
  });

  it('does not offer the literal article-number field of the advanced search', async () => {
    const result = await client.callTool({
      name: 'leginova_advanced_search',
      arguments: { target: 'codes', conditions: [{ operator: 'ET', term: '441-6', scope: 'NUMERO_ARTICLE' }] },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as { text: string }[])[0]!.text;
    expect(text).toMatch(/leginova_get_code_article/);
  });

  it('turns network failures into actionable tool errors', async () => {
    const result = await client.callTool({ name: 'leginova_list_codes', arguments: {} });
    expect(result.isError).toBe(true);
    expect((result.content as { text: string }[])[0]!.text).toMatch(/unreachable|retry/i);
  });

  it('ships server instructions about prefixes and empty results', () => {
    const instructions = client.getInstructions() ?? '';
    expect(instructions).toMatch(/Lp\. 441-6/);
    expect(instructions).toMatch(/Absence is not evidence/);
  });
});

describe('resources and prompts', () => {
  it('serves the usage guide', async () => {
    const result = await client.readResource({ uri: 'leginova://guide' });
    const content = result.contents[0] as { text: string };
    expect(content.text).toMatch(/# Using Leginova/);
  });

  it('lists the research prompts', async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual([
      'analyze_consolidated_text',
      'code_article_check',
      'jonc_watch',
      'legal_research',
    ]);
  });
});
