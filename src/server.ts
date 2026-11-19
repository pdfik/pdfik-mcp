import { McpServer } from '@modelcontextprotocol/server';

import { PdfikApi } from './api.js';
import type { Config } from './config.js';
import { PdfikTools, registerTools } from './tools.js';
import { VERSION } from './version.js';

/** One server instance per connection (serveStdio calls this factory). */
export function buildServer(config: Config, fetchImpl: typeof fetch = globalThis.fetch): McpServer {
  const server = new McpServer({ name: 'pdfik', version: VERSION });
  registerTools(server, new PdfikTools(config, new PdfikApi(config, fetchImpl)));
  return server;
}
