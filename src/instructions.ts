// SPDX-License-Identifier: AGPL-3.0-or-later

export const SERVER_INSTRUCTIONS = `Leginova (leginova.gouv.nc) is the official portal of New Caledonian law, published by the Government of New Caledonia. This server reads it live.

Collections: Journal officiel de la Nouvelle-Calédonie (JONC: acts, legal publications, associations), consolidated texts (lois du pays, délibérations, arrêtés in their current version), 31 codes (Code du travail de NC, Code des impôts, Code civil applicable en NC, provincial codes...), case law (Conseil d'État, Cour de cassation, Cour d'appel de Nouméa, Tribunal administratif, Conseil constitutionnel) and Congress debates.

How to work:
1. Find: leginova_search (full text, French queries) or leginova_advanced_search (structured). leginova_suggest resolves a known title. Every result gives the next tool call to open it.
2. Read the source before relying on it: leginova_get_texte_consolide, leginova_get_code_article, leginova_read_code_section, leginova_get_jurisprudence, leginova_get_jonc_item. Snippets are not the law.
3. Cite: give the official URL returned by the tools and the version date (consolidation date for texts, "version in force on" for codes, hearing date for decisions).

Article numbers: prefixes are part of the number. "Lp." marks an article adopted or localized by a New Caledonian loi du pays, so the metropolitan "L. 441-6" is "Lp. 441-6" in the Code de commerce applicable en NC, and some numbers exist under both prefixes as distinct articles. Always look articles up with leginova_get_code_article (prefix-tolerant) and relay its match_status and notice; never translate a metropolitan number yourself.

Reading results: every reader returns text_status. "structured" and "pdf_text" mean the text is in the answer; "not_available" comes with a reason (pdf_without_text_layer: an image scan, other pages will not help; pdf_not_found; pdf_too_large; extraction_failed). JONC acts carry published_in_jonc_on, the date of publication in the Journal officiel de la Nouvelle-Calédonie, and their filing authority: report both when a State text's local application is in question. Codes carry their filing authority (Etat, Nouvelle-Calédonie, Province): a better guide than the title, but mixed codes exist (the Code de commerce applicable en Nouvelle-Calédonie, filed by New Caledonia, keeps State-law L. articles next to Lp. articles), so settle competence article by article.

Absence is not evidence. A search with no hit, or an article reported not_found, does not mean that no rule exists: try other wording, other collections, other codes; New Caledonia also applies State law published only on Légifrance, and competences are split between the State, New Caledonia and the provinces. Never write "no legal basis" or "not regulated" on the strength of an empty Leginova result; say what was searched instead.

Content is in French. Answer in the user's language, quote legal text verbatim in French. This is legal information, not legal advice.`;

export const GUIDE_MARKDOWN = `# Using Leginova through MCP

${SERVER_INSTRUCTIONS}

## Sources of law in New Caledonia (reminder)

- **Loi organique n° 99-209 du 19 mars 1999**: the statute of New Caledonia; it allocates competences between the State, New Caledonia and the three provinces (Sud, Nord, Îles Loyauté).
- **Lois du pays**: adopted by the Congress in the areas listed by the organic law; they have the force of law and are reviewed by the Conseil constitutionnel. Code articles they create or localize are numbered **Lp.**
- **Délibérations** of the Congress, of its standing committee, and of the provincial assemblies; **arrêtés** of the Government of New Caledonia and of provincial executives.
- **State law** applies where the State keeps competence, often through codes "applicable en Nouvelle-Calédonie" and special applicability clauses. Part of it is only published on Légifrance.

## Article numbering in codes

| Prefix | Meaning in Leginova codes |
| --- | --- |
| Lp. | legislative article from a loi du pays (NC competence) |
| L. | legislative article from State law |
| R. / D. | regulatory articles |
| PS. / PN. | provincial articles (Province Sud / Province Nord) in the urbanisme code |
| AN. | articles of the Îles Loyauté provincial codes |
| none | codes numbered without prefix (Code civil, provincial codes...) |

The same core number may exist under several prefixes in the same code (Code de commerce: L. 450-1 and Lp. 450-1). leginova_get_code_article reports every variant.

## Identifiers

- Consolidated texts: numeric id (leginova_get_texte_consolide)
- Codes: slug (leginova_list_codes); sections and articles: slugs from the outline or search results
- Decisions: slug like "cour-de-cassation-arret-13-15646-2014-11-04"
- JONC: "10068" (classic issue) or "2026-00020" (electronic JONC item); acts: numeric id
- Congress debates: "DR-2026-00005"
`;
