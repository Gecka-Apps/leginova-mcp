// SPDX-License-Identifier: AGPL-3.0-or-later

import { type McpServer, completable } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { Deps } from './tools/common.js';

const user = (text: string) => ({ role: 'user' as const, content: { type: 'text' as const, text } });

export function registerPrompts(server: McpServer, deps: Deps): void {
  const { api } = deps;

  server.registerPrompt(
    'legal_research',
    {
      title: 'Research a question of New Caledonian law',
      description: 'Finds, reads and cites the applicable texts, codes and decisions on Leginova',
      argsSchema: z.object({
        question: z.string().describe('The legal question, in any language'),
        as_of: z.string().optional().describe('Date the answer must hold at (YYYY-MM-DD), if not today'),
      }),
    },
    ({ question, as_of }) => ({
      messages: [
        user(
          [
            `Research this question of New Caledonian law using the Leginova tools: ${question}`,
            as_of ? `The answer must reflect the law as of ${as_of}.` : '',
            '',
            'Method:',
            '1. Identify who holds the competence (State, New Caledonia, province) and which collections matter.',
            '2. Search in French with several phrasings (leginova_search, then leginova_advanced_search if needed). Look up any article number with leginova_get_code_article and report its match_status.',
            '3. Open and read every source you rely on; do not answer from snippets.',
            '4. For each rule, give: the provision (number as Leginova prints it), a verbatim French quote, the version date, and the official URL.',
            '5. Add relevant case law when found.',
            '6. End with what you searched and could not find. Never state that no rule exists because Leginova returned nothing; point to Légifrance for State law when relevant.',
          ]
            .filter(Boolean)
            .join('\n'),
        ),
      ],
    }),
  );

  server.registerPrompt(
    'analyze_consolidated_text',
    {
      title: 'Analyze a consolidated text',
      description: 'Summary, structure, amendment history and implementing texts of one consolidated text',
      argsSchema: z.object({ id: z.string().describe('Consolidated text id') }),
    },
    ({ id }) => ({
      messages: [
        user(
          [
            `Analyze the consolidated text ${id} on Leginova.`,
            'Call leginova_get_texte_consolide with mode "outline", then mode "full" (continue with offset until the end).',
            'Produce: its purpose and scope; the structure; the key obligations, rights and sanctions with article references;',
            'the amendment history in chronological order; implementing texts; and the consolidation date with the official URL.',
          ].join(' '),
        ),
      ],
    }),
  );

  server.registerPrompt(
    'code_article_check',
    {
      title: 'Check a code article reference',
      description: 'Verifies that an article reference exists in a New Caledonian code and returns its current text',
      argsSchema: z.object({
        reference: z.string().describe('Article reference as written in the document, e.g. "article L. 441-6 du code de commerce"'),
        code_slug: completable(z.string().optional(), async (value) => {
          const needle = (value ?? '').toLowerCase();
          return (await api.codes()).map((c) => c.slug).filter((slug) => slug.includes(needle)).slice(0, 50);
        }).describe('Code slug, if known'),
      }),
    },
    ({ reference, code_slug }) => ({
      messages: [
        user(
          [
            `Check this reference against Leginova: "${reference}".`,
            code_slug ? `The code is ${code_slug}.` : 'Identify the code (leginova_list_codes); if unsure, search all codes.',
            'Use leginova_get_code_article with article_number. Report: the match_status; the number under which Leginova publishes the article',
            '(e.g. Lp. instead of L.); any homonym under another prefix; the verbatim current text; the version date; the official URL.',
            'If the status is not_found or other_prefix_only, relay the notice and list what was checked; do not conclude that the provision does not exist.',
          ].join(' '),
        ),
      ],
    }),
  );

  server.registerPrompt(
    'jonc_watch',
    {
      title: 'Journal officiel watch',
      description: 'Summarizes what was published in the JONC over a period, optionally on a topic',
      argsSchema: z.object({
        from: z.string().describe('Start date, YYYY-MM-DD'),
        to: z.string().describe('End date, YYYY-MM-DD'),
        topic: z.string().optional().describe('Optional topic, in French'),
      }),
    },
    ({ from, to, topic }) => ({
      messages: [
        user(
          [
            `Summarize the acts published in the Journal officiel de la Nouvelle-Calédonie between ${from} and ${to}${topic ? ` about "${topic}"` : ''}.`,
            topic
              ? `Use leginova_advanced_search with target "actes", date_from ${from}, date_to ${to}, and keywords for the topic.`
              : `Use leginova_browse {collection: "jonc", year} for the years concerned and open the issues of the period with leginova_get_jonc.`,
            'Group the acts by issuing authority and type, give one line per act (nature, number, date, object) with its URL, and flag lois du pays, errata and texts amending codes.',
          ].join(' '),
        ),
      ],
    }),
  );
}
