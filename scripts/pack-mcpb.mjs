// SPDX-License-Identifier: AGPL-3.0-or-later
// Assembles the MCPB bundle for Claude Desktop: manifest, the single-file
// server, README and LICENSE. No node_modules: the bundle is self-contained.

import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, rm } from 'node:fs/promises';

const stage = '.mcpb-build';
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
if (manifest.version !== pkg.version) {
  throw new Error(`manifest.json version ${manifest.version} differs from package.json ${pkg.version}`);
}

await rm(stage, { recursive: true, force: true });
await mkdir(`${stage}/server`, { recursive: true });
await copyFile('manifest.json', `${stage}/manifest.json`);
await copyFile('dist/leginova-mcp.mjs', `${stage}/server/leginova-mcp.mjs`);
await copyFile('README.md', `${stage}/README.md`);
await copyFile('LICENSE', `${stage}/LICENSE`);

const output = `leginova-${pkg.version}.mcpb`;
execFileSync('npx', ['mcpb', 'validate', `${stage}/manifest.json`], { stdio: 'inherit' });
execFileSync('npx', ['mcpb', 'pack', stage, output], { stdio: 'inherit' });
await rm(stage, { recursive: true, force: true });
console.log(`\n${output} ready: open it with Claude Desktop to install.`);
