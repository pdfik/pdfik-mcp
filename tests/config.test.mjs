import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { ConfigError, DEFAULT_API_URL, loadConfig } from '../dist/config.js';

const KEY = 'sk_live_YOUR_API_KEY';

test('the key is required and must look like a PDFik key', () => {
  assert.throws(() => loadConfig({}), ConfigError);
  assert.throws(() => loadConfig({ PDFIK_API_KEY: 'hunter2' }), ConfigError);
});

test('defaults: production API, ~/Downloads/PDFik, real jobs', () => {
  const c = loadConfig({ PDFIK_API_KEY: KEY });
  assert.equal(c.apiUrl, DEFAULT_API_URL);
  assert.equal(c.outputDir, path.join(os.homedir(), 'Downloads', 'PDFik'));
  assert.equal(c.forceTest, false);
});

test('a leading ~ in the output folder is the home folder', () => {
  assert.equal(loadConfig({ PDFIK_API_KEY: KEY, PDFIK_OUTPUT_DIR: '~/Documents/pdf' }).outputDir, path.join(os.homedir(), 'Documents', 'pdf'));
  assert.equal(loadConfig({ PDFIK_API_KEY: KEY, PDFIK_OUTPUT_DIR: '~' }).outputDir, os.homedir());
});

test('plain http only to localhost; test mode by env', () => {
  assert.throws(() => loadConfig({ PDFIK_API_KEY: KEY, PDFIK_API_URL: 'http://api.example.com' }), ConfigError);
  assert.equal(loadConfig({ PDFIK_API_KEY: KEY, PDFIK_API_URL: 'http://localhost:8000/' }).apiUrl, 'http://localhost:8000');
  assert.equal(loadConfig({ PDFIK_API_KEY: KEY, PDFIK_TEST_MODE: '1' }).forceTest, true);
});
