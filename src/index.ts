#!/usr/bin/env node
// PDFik MCP server over stdio. stdout is the JSON-RPC channel: every diagnostic goes to
// stderr, and nothing here ever prints the API key.
import { serveStdio } from '@modelcontextprotocol/server/stdio';

import { ConfigError, loadConfig } from './config.js';
import { buildServer } from './server.js';
import { VERSION } from './version.js';

let config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(`pdfik-mcp: ${err.message}`);
    process.exit(1);
  }
  throw err;
}

const handle = serveStdio(() => buildServer(config));
console.error(`pdfik-mcp ${VERSION} ready on stdio (files go to ${config.outputDir})`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void handle.close();
  });
}
