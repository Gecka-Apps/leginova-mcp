// SPDX-License-Identifier: AGPL-3.0-or-later

import { McpServer } from '@modelcontextprotocol/server';
import { ArticleIndex } from './articles.js';
import { LeginovaApi } from './client/api.js';
import { HttpClient } from './client/http.js';
import type { Config } from './config.js';
import { SiteUrls } from './format/urls.js';
import { SERVER_INSTRUCTIONS } from './instructions.js';
import { registerPrompts } from './prompts.js';
import { registerResources } from './resources.js';
import { registerBrowseTools } from './tools/browse.js';
import { registerCodeTools } from './tools/codes.js';
import type { Deps } from './tools/common.js';
import { registerDocumentTools } from './tools/documents.js';
import { registerSearchTools } from './tools/search.js';
import { registerTexteTools } from './tools/textes.js';
import { VERSION } from './version.js';

/** Long-lived state shared by every server instance: HTTP client, cache, article indexes. */
export function createDeps(config: Config): Deps {
  const api = new LeginovaApi(new HttpClient(config));
  return { config, api, urls: new SiteUrls(config.baseUrl), articles: new ArticleIndex(api) };
}

/** Builds one MCP server. Cheap: transports call it per connection (stdio) or per request (HTTP). */
export function createServer(deps: Deps): McpServer {
  const server = new McpServer(
    {
      name: 'leginova',
      title: 'Leginova: droit de la Nouvelle-Calédonie',
      version: VERSION,
      websiteUrl: 'https://leginova.gouv.nc',
      description: 'Official law of New Caledonia: JONC, codes, consolidated texts, case law, Congress debates',
    },
    { instructions: SERVER_INSTRUCTIONS },
  );
  registerSearchTools(server, deps);
  registerCodeTools(server, deps);
  registerTexteTools(server, deps);
  registerDocumentTools(server, deps);
  registerBrowseTools(server, deps);
  registerResources(server, deps);
  registerPrompts(server, deps);
  return server;
}
