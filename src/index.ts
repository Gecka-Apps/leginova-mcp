// SPDX-License-Identifier: AGPL-3.0-or-later

import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { parseArgs } from 'node:util';
import {
  hostHeaderValidation,
  localhostHostValidation,
  localhostOriginValidation,
  originValidation,
  toNodeHandler,
} from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { loadConfig } from './config.js';
import { createDeps, createServer } from './server.js';
import { VERSION } from './version.js';

const HELP = `leginova-mcp ${VERSION}
MCP server for leginova.gouv.nc, the official portal of New Caledonian law.

Usage:
  leginova-mcp                      serve over stdio (Claude Desktop, Claude Code, any local client)
  leginova-mcp --http [options]     serve Streamable HTTP on /mcp

HTTP options:
  --port <n>            listening port (env PORT, default 3000)
  --host <addr>         bind address (env HOST, default 127.0.0.1)
  --allowed-hosts <h>   comma-separated Host names accepted when not bound to loopback
                        (env MCP_ALLOWED_HOSTS), e.g. leginova-mcp.example.nc
  --allowed-origins <h> comma-separated Origin host names accepted from browsers
                        (env MCP_ALLOWED_ORIGINS, defaults to the allowed hosts)

Environment:
  LEGINOVA_BASE_URL       default https://leginova.gouv.nc
  LEGINOVA_TIMEOUT_MS     per-request timeout, default 30000
  LEGINOVA_MAX_CONCURRENCY parallel requests to Leginova, default 4
  LEGINOVA_CACHE_MB       in-memory cache size, default 256
  LEGINOVA_CACHE_TTL_S    cache lifetime, default 3600
  LEGINOVA_MAX_PDF_MB     largest PDF downloaded for text extraction, default 80
`;

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      http: { type: 'boolean', default: false },
      port: { type: 'string' },
      host: { type: 'string' },
      'allowed-hosts': { type: 'string' },
      'allowed-origins': { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
    },
    allowPositionals: false,
  });
  if (values.help) {
    process.stdout.write(HELP);
    return;
  }
  if (values.version) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  const deps = createDeps(loadConfig());
  const factory = () => createServer(deps);

  if (!values.http) {
    const handle = serveStdio(factory);
    const stop = () => void handle.close().finally(() => process.exit(0));
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    console.error(`leginova-mcp ${VERSION} ready on stdio (${deps.config.baseUrl})`);
    return;
  }

  const host = values.host ?? process.env.HOST ?? '127.0.0.1';
  const port = Number.parseInt(values.port ?? process.env.PORT ?? '3000', 10);
  const allowedHosts = list(values['allowed-hosts'] ?? process.env.MCP_ALLOWED_HOSTS);
  const allowedOrigins = list(values['allowed-origins'] ?? process.env.MCP_ALLOWED_ORIGINS);
  const loopback = LOOPBACK.has(host);
  if (!loopback && allowedHosts.length === 0) {
    throw new Error(
      `Binding ${host} exposes the server beyond this machine: set --allowed-hosts (or MCP_ALLOWED_HOSTS) to the public host name(s) clients use.`,
    );
  }
  const checkHost = loopback ? localhostHostValidation() : hostHeaderValidation([...allowedHosts, ...LOOPBACK]);
  const checkOrigin = loopback
    ? localhostOriginValidation()
    : originValidation(allowedOrigins.length > 0 ? allowedOrigins : allowedHosts);

  const handler = createMcpHandler(factory, {
    onerror: (error) => console.error(`[mcp] ${error.message}`),
  });
  const mcp = toNodeHandler(handler);

  const server = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ status: 'ok', version: VERSION }));
      return;
    }
    if (path !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found. The MCP endpoint is /mcp.\n');
      return;
    }
    if (!checkHost(req, res) || !checkOrigin(req, res)) return;
    void mcp(req, res);
  });

  server.listen(port, host, () => {
    console.error(`leginova-mcp ${VERSION} listening on http://${host.includes(':') ? `[${host}]` : host}:${port}/mcp`);
  });
  const stop = () => {
    server.close();
    void handler.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
