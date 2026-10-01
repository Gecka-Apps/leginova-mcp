// SPDX-License-Identifier: AGPL-3.0-or-later
// Keeps the version number identical in every file that carries it.
//
//   node scripts/version.mjs check [vX.Y.Z]   fails on any mismatch, or with the given tag
//   node scripts/version.mjs set X.Y.Z        writes the version everywhere
//   node scripts/version.mjs pin X.Y.Z SHA256 pins the released plugin archive in the marketplace

import { readFile, writeFile } from 'node:fs/promises';

const REPOSITORY = 'Gecka-Apps/leginova-mcp';
const pluginArchiveUrl = (version) =>
  `https://github.com/${REPOSITORY}/releases/download/v${version}/leginova-claude-plugin-${version}.zip`;

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const json = (path, get, set) => ({
  path,
  read: async () => get(JSON.parse(await readFile(path, 'utf8'))),
  write: async (version) => {
    const data = JSON.parse(await readFile(path, 'utf8'));
    set(data, version);
    await writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
  },
});

const FILES = [
  json('package.json', (d) => d.version, (d, v) => (d.version = v)),
  json(
    'package-lock.json',
    (d) => d.packages?.['']?.version,
    (d, v) => {
      d.version = v;
      d.packages[''].version = v;
    },
  ),
  json('manifest.json', (d) => d.version, (d, v) => (d.version = v)),
  json('claude-plugin/.claude-plugin/plugin.json', (d) => d.version, (d, v) => (d.version = v)),
  json(
    '.claude-plugin/marketplace.json',
    (d) => {
      const entry = d.plugins[0];
      // A version whose archive URL names another version reads as a mismatch.
      return entry.source?.url === pluginArchiveUrl(entry.version) ? entry.version : `${entry.version} (archive ${entry.source?.url})`;
    },
    (d, v) => {
      d.plugins[0].version = v;
      // The archive of a new version is published by the release workflow,
      // which then pins its digest with the `pin` command.
      d.plugins[0].source = { source: 'archive', url: pluginArchiveUrl(v) };
    },
  ),
  {
    path: 'src/version.ts',
    read: async () => /VERSION = '([^']+)'/.exec(await readFile('src/version.ts', 'utf8'))?.[1],
    write: async (version) => {
      const source = await readFile('src/version.ts', 'utf8');
      await writeFile('src/version.ts', source.replace(/VERSION = '[^']+'/, `VERSION = '${version}'`));
    },
  },
];

const [command, argument] = process.argv.slice(2);

if (command === 'set') {
  if (!SEMVER.test(argument ?? '')) throw new Error(`"${argument}" is not a semver version (X.Y.Z)`);
  for (const file of FILES) await file.write(argument);
  console.log(`Version set to ${argument} in ${FILES.map((f) => f.path).join(', ')}.`);
  console.log('Add its section to CHANGELOG.md before tagging.');
} else if (command === 'pin') {
  const digest = process.argv[4] ?? '';
  if (!SEMVER.test(argument ?? '') || !/^[0-9a-f]{64}$/.test(digest)) throw new Error('Usage: pin X.Y.Z <sha256>');
  const path = '.claude-plugin/marketplace.json';
  const data = JSON.parse(await readFile(path, 'utf8'));
  const entry = data.plugins[0];
  if (entry.version !== argument) {
    console.log(`${path} lists version ${entry.version}, not ${argument}: nothing to pin.`);
  } else {
    entry.source = { source: 'archive', url: pluginArchiveUrl(argument), sha256: digest };
    await writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
    console.log(`Pinned leginova-claude-plugin-${argument}.zip (${digest}).`);
  }
} else if (command === 'check') {
  const found = await Promise.all(FILES.map(async (f) => [f.path, await f.read()]));
  const expected = argument ? argument.replace(/^v/, '') : found[0][1];
  const wrong = found.filter(([, v]) => v !== expected);
  if (wrong.length > 0) {
    for (const [path, v] of wrong) console.error(`${path}: ${v ?? 'missing'} (expected ${expected})`);
    process.exit(1);
  }
  console.log(`Version ${expected} is consistent across ${found.length} files.`);
} else {
  console.error('Usage: node scripts/version.mjs check [vX.Y.Z] | set X.Y.Z | pin X.Y.Z SHA256');
  process.exit(2);
}
