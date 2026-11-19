import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { PdfikApi } from '../dist/api.js';
import { PdfikTools, registerTools } from '../dist/tools.js';
import { CLIENT_HEADER } from '../dist/version.js';

const KEY = 'sk_live_YOUR_API_KEY';
const JOB = '550e8400-e29b-41d4-a716-446655440000';

async function config(extra = {}) {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'pdfik-mcp-'));
  return { apiKey: KEY, apiUrl: 'https://api.pdfik.net', outputDir, forceTest: false, ...extra };
}

/** A fetch that records every call and answers from `answers` in order. */
function fakeFetch(answers) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
    const next = answers.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  fn.calls = calls;
  return fn;
}

const pdf = (jobId = JOB, headers = {}) =>
  new Response(new Uint8Array([37, 80, 68, 70]), { status: 200, headers: { 'content-type': 'application/pdf', 'x-pdfik-job-id': jobId, ...headers } });
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('every request names the server, sends the key only as a header and never follows redirects', async () => {
  const fetch = fakeFetch([json(200, { plan: 'free' })]);
  await new PdfikApi(await config(), fetch).getJson('/account');
  const { url, init } = fetch.calls[0];
  assert.equal(url, 'https://api.pdfik.net/account');
  assert.equal(init.headers['X-PDFik-Client'], CLIENT_HEADER);
  assert.equal(init.headers['X-API-Key'], KEY);
  assert.equal(init.redirect, 'manual');
  assert.ok(!url.includes(KEY));
});

test('each create sends a fresh Idempotency-Key and wait as asked', async () => {
  const fetch = fakeFetch([pdf(), json(202, { job_id: JOB, status: 'queued' })]);
  const api = new PdfikApi(await config(), fetch);
  await api.create('/url-to-pdf', { url: 'https://example.com' }, true);
  await api.create('/url-to-pdf', { url: 'https://example.com' }, false);
  const [a, b] = fetch.calls;
  assert.notEqual(a.init.headers['Idempotency-Key'], b.init.headers['Idempotency-Key']);
  assert.equal(a.body.wait, true);
  assert.equal(b.body.wait, false);
});

test('a sync render is saved and returned as a path, a resource link and structured content', async () => {
  const cfg = await config();
  const tools = new PdfikTools(cfg, new PdfikApi(cfg, fakeFetch([pdf()])));
  const result = await tools.create('/url-to-pdf', { url: 'https://example.com' }, { filename: 'example' });
  assert.equal(result.isError, undefined);
  const saved = result.structuredContent.path;
  assert.equal(path.dirname(saved), await realpath(cfg.outputDir));
  assert.equal(path.basename(saved), 'example.pdf');
  assert.deepEqual([...(await readFile(saved))], [37, 80, 68, 70]);
  const link = result.content.find((c) => c.type === 'resource_link');
  assert.equal(fileURLToPath(link.uri), saved);
  assert.equal(result.structuredContent.job_id, JOB);
  assert.equal(result.structuredContent.test, false);
});

test('PDFIK_TEST_MODE forces test jobs even when the model asks for a real one', async () => {
  const cfg = await config({ forceTest: true });
  const fetch = fakeFetch([pdf()]);
  await new PdfikTools(cfg, new PdfikApi(cfg, fetch)).create('/html-to-pdf', { html: '<p>x</p>' }, { test: false });
  assert.equal(fetch.calls[0].body.test, true);
});

test('wait:false returns the job id and saves nothing', async () => {
  const cfg = await config();
  const fetch = fakeFetch([json(202, { job_id: JOB, status: 'queued' })]);
  const result = await new PdfikTools(cfg, new PdfikApi(cfg, fetch)).create('/url-to-pdf', { url: 'https://example.com' }, { wait: false });
  assert.deepEqual(result.structuredContent, { job_id: JOB, status: 'queued', test: false });
});

test('an API error is an isError result with the readable line, never the key', async () => {
  const cfg = await config();
  const fetch = fakeFetch([
    json(503, {
      type: 'https://docs.pdfik.net/error-codes#sync-timeout',
      title: 'Service Unavailable - Render Did Not Finish In Time',
      status: 503,
      error: 'SYNC_TIMEOUT',
      detail: `held ${KEY}`,
    }),
  ]);
  const result = await new PdfikTools(cfg, new PdfikApi(cfg, fetch)).create('/url-to-pdf', { url: 'https://example.com' }, {});
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /^\[503\] Service Unavailable - Render Did Not Finish In Time/);
  assert.match(result.content[0].text, /wait: false/);
  assert.ok(!JSON.stringify(result).includes(KEY));
});

test('wait:false on a Minimum e-invoice returns the profile warning without the queued sentence', async () => {
  const cfg = await config();
  const detail = "Job successfully sent to processing queue. Profile 'minimum' does not carry a complete invoice: the embedded XML is accompanying data only and is NOT a legally sufficient e-invoice in DE/FR. Use 'basic', 'en16931' or 'extended' for a full invoice.";
  const fetch = fakeFetch([json(202, { job_id: JOB, status: 'queued', detail })]);
  const result = await new PdfikTools(cfg, new PdfikApi(cfg, fetch)).create('/einvoice-to-pdf', { xml: '<x/>', profile: 'minimum' }, { wait: false });
  assert.equal(result.structuredContent.warning, "Profile 'minimum' does not carry a complete invoice: the embedded XML is accompanying data only and is NOT a legally sufficient e-invoice in DE/FR. Use 'basic', 'en16931' or 'extended' for a full invoice.");
});

test('a network failure is an isError result too', async () => {
  const cfg = await config();
  const result = await new PdfikTools(cfg, new PdfikApi(cfg, fakeFetch([new TypeError('fetch failed')]))).getAccount();
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /^\[network\]/);
});

test('download_job checks the status first and spends no attempt on an unfinished job', async () => {
  const cfg = await config();
  const fetch = fakeFetch([json(200, { status: 'rendering' })]);
  const result = await new PdfikTools(cfg, new PdfikApi(cfg, fetch)).downloadJob(JOB, undefined);
  assert.equal(result.isError, true);
  assert.equal(fetch.calls.length, 1);
});

test('a small screenshot comes with an inline preview', async () => {
  const cfg = await config();
  const png = new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { 'content-type': 'image/png', 'x-pdfik-job-id': JOB } });
  const result = await new PdfikTools(cfg, new PdfikApi(cfg, fakeFetch([png]))).create('/url-to-image', { url: 'https://example.com' }, {}, true);
  assert.ok(result.content.some((c) => c.type === 'image' && c.mimeType === 'image/png'));
});

test('the registered tools are exactly the documented nine, and none takes delivery, webhook_url or auth', async () => {
  const registered = {};
  registerTools(
    {
      registerTool: (name, cfg) => {
        registered[name] = cfg;
      },
    },
    new PdfikTools(await config(), {})
  );
  assert.deepEqual(Object.keys(registered).sort(), [
    'download_job',
    'einvoice_to_pdf',
    'get_account',
    'get_job',
    'html_to_image',
    'html_to_pdf',
    'markdown_to_pdf',
    'url_to_image',
    'url_to_pdf',
  ]);
  for (const [name, cfg] of Object.entries(registered)) {
    const keys = cfg.inputSchema ? Object.keys(cfg.inputSchema.shape) : [];
    for (const forbidden of ['delivery', 'webhook_url', 'auth', 'api_key']) {
      assert.ok(!keys.includes(forbidden), `${name} must not take ${forbidden}`);
    }
    assert.ok(cfg.annotations, `${name} has annotations`);
    assert.ok(!/you (must|should)|ignore previous/i.test(cfg.description), `${name}: descriptions state facts only`);
  }
  assert.equal(registered.get_account.annotations.readOnlyHint, true);
  assert.equal(registered.url_to_pdf.annotations.readOnlyHint, false);
});

test('no tool takes a PDF password, and one passed anyway never reaches the API', async () => {
  // A tool argument is part of the conversation: a password would reach the AI provider and the
  // chat history (owner 2026-11-19). The API and the SDKs keep the option.
  const registered = {};
  registerTools({ registerTool: (name, cfg) => { registered[name] = cfg; } }, new PdfikTools(await config(), {}));
  for (const [name, cfg] of Object.entries(registered)) {
    const options = cfg.inputSchema && cfg.inputSchema.shape.options;
    if (!options) continue;
    const shape = options.unwrap().shape;
    assert.ok(!('user_password' in shape), `${name} must not take options.user_password`);
  }
  const parsed = registered.url_to_pdf.inputSchema.parse({ url: 'https://example.com', options: { user_password: 'secret', scale: 1 } });
  assert.ok(!('user_password' in parsed.options), 'an unknown password is stripped before the request is built');
});
