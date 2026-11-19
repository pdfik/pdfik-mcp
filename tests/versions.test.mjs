import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { VERSION, CLIENT_HEADER } from '../dist/version.js';

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));

test('one version everywhere a client or a registry reads it', () => {
  const pkg = read('package.json');
  const server = read('server.json');
  const manifest = read('manifest.json');
  const plugin = read('plugin/.claude-plugin/plugin.json');
  const pluginMcp = read('plugin/.mcp.json');
  const cursor = read('cursor/.cursor-plugin/plugin.json');
  const cursorMcp = read('cursor/mcp.json');
  const marketplace = read('.claude-plugin/marketplace.json');

  assert.equal(VERSION, pkg.version);
  assert.equal(CLIENT_HEADER, `mcp/${pkg.version}`);
  assert.equal(server.version, pkg.version);
  for (const p of server.packages) assert.equal(p.version, pkg.version);
  assert.ok(server.packages.find((p) => p.registryType === 'mcpb').identifier.includes(`/v${pkg.version}/`));
  assert.equal(server.name, pkg.mcpName);
  assert.equal(manifest.version, pkg.version);
  assert.equal(plugin.version, pkg.version);
  assert.equal(cursor.version, pkg.version);
  assert.equal(marketplace.plugins[0].version, pkg.version);
  // Plugins pin the exact published version: never `@latest`.
  assert.deepEqual(pluginMcp.mcpServers.pdfik.args, ['-y', `@pdfik/mcp@${pkg.version}`]);
  assert.deepEqual(cursorMcp.mcpServers.pdfik.args, ['-y', `@pdfik/mcp@${pkg.version}`]);
});

test('the manifests list exactly the tools the server registers', async () => {
  const { registerTools, PdfikTools } = await import('../dist/tools.js');
  const names = [];
  registerTools({ registerTool: (name) => names.push(name) }, new PdfikTools({}, {}));
  assert.deepEqual(read('manifest.json').tools.map((t) => t.name).sort(), names.sort());
});

test('the API key is only ever a secret input, never a value', () => {
  const manifest = read('manifest.json');
  assert.equal(manifest.user_config.api_key.sensitive, true);
  const server = read('server.json');
  const keyVar = server.packages[0].environmentVariables.find((v) => v.name === 'PDFIK_API_KEY');
  assert.equal(keyVar.isSecret, true);
  for (const p of ['plugin/.mcp.json', 'cursor/mcp.json', 'manifest.json', 'server.json']) {
    assert.ok(!/sk_(live|test)_[A-Za-z0-9]{8,}/.test(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')), p);
  }
});
