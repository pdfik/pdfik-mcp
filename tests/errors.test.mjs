import assert from 'node:assert/strict';
import { test } from 'node:test';

import { errorFromResponse, scrubKeys } from '../dist/errors.js';

const KEY = 'sk_live_YOUR_API_KEY';

test('an RFC 7807 string detail keeps its title and docs link', () => {
  const e = errorFromResponse(401, JSON.stringify({ type: 'https://docs.pdfik.net/error-codes#401', title: 'Invalid API key', status: 401, detail: 'Invalid API key' }));
  assert.equal(e.message, '[401] Invalid API key (https://docs.pdfik.net/error-codes#401)');
  assert.equal(e.status, 401);
});

test('a 422 validation list names each field', () => {
  const body = { type: 'https://docs.pdfik.net/error-codes#validation-error', title: 'Unprocessable Entity - Request Validation Error', status: 422,
    detail: [{ loc: ['body', 'options', 'scale'], msg: 'options.scale must be between 0.5 and 2.0', type: 'value_error' }] };
  const e = errorFromResponse(422, JSON.stringify(body));
  assert.match(e.message, /^\[422\] Unprocessable Entity - Request Validation Error — options\.scale: options\.scale must be between 0\.5 and 2\.0 \(https:\/\/docs\.pdfik\.net\/error-codes#validation-error\)$/);
});

test('the 402 payment-method wall object gives its message and code', () => {
  const body = { type: 'https://docs.pdfik.net/error-codes#402', title: 'HTTP Error', status: 402,
    detail: { error: 'PAYMENT_METHOD_REQUIRED', message: 'No active payment method on file.', add_card_url: 'https://pdfik.net/dashboard/billing' } };
  const e = errorFromResponse(402, JSON.stringify(body));
  assert.equal(e.message, '[402] Payment Required — No active payment method on file. (https://docs.pdfik.net/error-codes#402)');
  assert.equal(e.code, 'PAYMENT_METHOD_REQUIRED');
});

test('a non-RFC 413 body and plain text still read well', () => {
  assert.match(errorFromResponse(413, JSON.stringify({ error: 'PAYLOAD_TOO_LARGE', detail: 'Request body exceeds 5 MB' })).message,
    /^\[413\] Payload Too Large — Request body exceeds 5 MB \(https:\/\/docs\.pdfik\.net\/error-codes#413\)$/);
  assert.match(errorFromResponse(502, '<html>bad gateway</html>').message,
    /^\[502\] Bad Gateway — <html>bad gateway<\/html> \(https:\/\/docs\.pdfik\.net\/error-codes#other-http-statuses\)$/);
});

test('a foreign docs link is never passed on', () => {
  const e = errorFromResponse(400, JSON.stringify({ type: 'https://evil.example/x', title: 'Bad', status: 400, detail: 'x' }));
  assert.match(e.message, /\(https:\/\/docs\.pdfik\.net\/error-codes#400\)$/);
});

test('keys never reach a message', () => {
  assert.equal(scrubKeys(`key ${KEY} and ${'sk_' + 'test_abcdefgh123'}`, KEY), 'key [api key] and [api key]');
  const e = errorFromResponse(400, JSON.stringify({ title: 'Bad', status: 400, detail: `echo ${KEY}` }), KEY);
  assert.ok(!e.message.includes(KEY));
});
