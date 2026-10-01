// SPDX-License-Identifier: AGPL-3.0-or-later
// Bundles the server into one ESM file with no runtime dependency, so it runs
// from `npx`, from an MCPB bundle or from a bare `node dist/leginova-mcp.mjs`.

import { chmod, copyFile, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';

const outfile = 'dist/leginova-mcp.mjs';

await build({
  entryPoints: ['src/index.ts'],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  legalComments: 'linked',
  sourcemap: false,
  minifySyntax: true,
  banner: {
    js: [
      '#!/usr/bin/env node',
      "import { createRequire as __createRequire } from 'node:module';",
      'const require = __createRequire(import.meta.url);',
    ].join('\n'),
  },
  logLevel: 'info',
});

await chmod(outfile, 0o755);

// The Claude Code plugin is installed by copying its own directory, so it
// carries its own copy of the bundle.
await mkdir('claude-plugin/server', { recursive: true });
await copyFile(outfile, 'claude-plugin/server/leginova-mcp.mjs');
