// SPDX-License-Identifier: AGPL-3.0-or-later
// Prints the CHANGELOG.md section of one version, for the GitHub release body.
//
//   node scripts/release-notes.mjs 0.1.0

import { readFile } from 'node:fs/promises';

const version = (process.argv[2] ?? '').replace(/^v/, '');
const changelog = await readFile('CHANGELOG.md', 'utf8');
const lines = changelog.split('\n');
const start = lines.findIndex((line) => line.startsWith(`## ${version} `) || line === `## ${version}`);
if (!version || start === -1) {
  console.error(`CHANGELOG.md has no "## ${version}" section.`);
  process.exit(1);
}
const end = lines.findIndex((line, i) => i > start && line.startsWith('## '));
const body = lines.slice(start + 1, end === -1 ? undefined : end).join('\n').trim();
if (!body) {
  console.error(`The CHANGELOG.md section for ${version} is empty.`);
  process.exit(1);
}
console.log(body);
