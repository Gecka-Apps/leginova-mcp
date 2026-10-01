// SPDX-License-Identifier: AGPL-3.0-or-later

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

export async function connectBundled(env: Record<string, string> = {}): Promise<Client> {
  const client = new Client({ name: 'leginova-test', version: '0.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['dist/leginova-mcp.mjs'],
    env: { ...process.env, ...env } as Record<string, string>,
    stderr: 'ignore',
  });
  await client.connect(transport);
  return client;
}

export function textOf(result: { content?: unknown }): string {
  const blocks = (result.content ?? []) as { type: string; text?: string }[];
  return blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n');
}
