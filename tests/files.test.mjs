import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { safeFileName, writeOutput } from '../dist/files.js';

const JOB = '550e8400-e29b-41d4-a716-446655440000';

test('names lose every directory part and get the real extension', () => {
  assert.equal(safeFileName('../../etc/passwd', JOB, 'application/pdf'), 'passwd.pdf');
  assert.equal(safeFileName('..\\..\\Windows\\win.ini', JOB, 'application/pdf'), 'win.ini.pdf');
  assert.equal(safeFileName('report.pdf', JOB, 'application/pdf'), 'report.pdf');
  assert.equal(safeFileName('shot.png', JOB, 'image/jpeg'), 'shot.png.jpg');
  assert.equal(safeFileName('.bashrc', JOB, 'application/pdf'), 'bashrc.pdf');
  assert.equal(safeFileName('a<b>:c|d?e*', JOB, 'application/pdf'), 'a_b__c_d_e_.pdf');
  assert.equal(safeFileName('', JOB, 'image/png'), `${JOB}.png`);
  assert.equal(safeFileName(undefined, JOB, 'application/pdf'), `${JOB}.pdf`);
  assert.equal(safeFileName('...', JOB, 'application/pdf'), `${JOB}.pdf`);
  assert.equal(safeFileName('NUL', JOB, 'application/pdf'), 'pdfik-NUL.pdf');
  assert.equal(safeFileName('com1.txt', JOB, 'application/pdf'), 'pdfik-com1.txt.pdf');
  assert.ok(safeFileName('x'.repeat(500), JOB, 'application/pdf').length <= 124);
});

test('a file is never overwritten and always lands inside the output folder', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pdfik-mcp-'));
  const out = path.join(dir, 'nested', 'out');
  const first = await writeOutput(out, 'doc.pdf', new Uint8Array([1]));
  const second = await writeOutput(out, 'doc.pdf', new Uint8Array([2]));
  assert.equal(path.basename(first), 'doc.pdf');
  assert.equal(path.basename(second), 'doc-1.pdf');
  assert.deepEqual([...(await readFile(first))], [1]);
  assert.deepEqual((await readdir(out)).sort(), ['doc-1.pdf', 'doc.pdf']);
  await assert.rejects(writeOutput(out, '../escape.pdf', new Uint8Array([3])));
});
