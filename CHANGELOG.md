# Changelog

## 0.1.0 (2026-10-01)

First version.

- 14 read-only tools over the Leginova API: full-text and advanced search, title suggestions, codes (list, outline, article, section), consolidated texts, court decisions, JONC issues and items, Congress debates, yearly browsing, advanced-search catalogue.
- Code article lookup matches article numbers whatever their prefix (`L. 441-6` finds `Lp. 441-6`) and reports how: exact match, prefix variant, homonyms under another prefix, other-nature prefixes (never substituted), or not found with an explicit warning that absence is not evidence.
- Text of court decisions, scanned JONC acts and Congress debates extracted from the official PDFs, page by page and on demand.
- Base64 images embedded in texts replaced by a marker; tables converted to Markdown; legal text kept verbatim.
- Resources (usage guide, codes, articles, texts, decisions) and prompts (legal research, consolidated text analysis, article reference check, JONC watch).
- stdio and Streamable HTTP transports (MCP spec 2026-07-28 and 2025 clients), Host/Origin validation, health endpoint.
- Packaging: single-file bundle, MCPB bundle for Claude Desktop, Claude Code plugin and marketplace, Dockerfile. GitHub releases on `v*` tags publish the extension and the server under versioned names and under fixed names for `releases/latest/download/` links.
- Every reader puts the complete answer in `structuredContent` (Markdown text included, every metadata field), for clients that pass only that part to the model.
- `text_status` on every reader: `structured`, `pdf_text`, or `not_available` with a reason (`pdf_without_text_layer`, `pdf_not_found`, `pdf_too_large`, `download_failed`, `extraction_failed`). PDF problems no longer turn the whole call into an error, and `next_page` is only offered when a later page carries text.
- JONC acts expose `published_in_jonc_on`, `filing_authority`, `import_mode` and `pdf_scope` (`whole_issue` when Leginova serves the whole JONC issue instead of the act, with the printed page where the act starts); search results carry the JONC publication date.
- `leginova_list_codes` gives each code's filing authority (Etat, Nouvelle-Calédonie, Province) and version date.
