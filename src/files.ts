import { constants as fsConstants } from 'node:fs';
import { mkdir, open, realpath } from 'node:fs/promises';
import path from 'node:path';

const EXTENSIONS: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
};

export function extensionFor(contentType: string): string {
  return EXTENSIONS[contentType] ?? '.bin';
}

/**
 * A safe base name: whatever directory parts the model or a page put into the name are
 * dropped, control and reserved characters replaced, and the extension forced to the
 * output's real type. Never empty, never a dot-file, at most 120 characters.
 */
export function safeFileName(requested: string | undefined, jobId: string, contentType: string): string {
  const ext = extensionFor(contentType);
  let base = (requested ?? '').split(/[\\/]/).pop() ?? '';
  base = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').trim();
  base = base.replace(/^\.+/, '');
  if (base.toLowerCase().endsWith(ext)) base = base.slice(0, -ext.length);
  base = base.replace(/\.+$/, '').slice(0, 120);
  if (!base) base = jobId || 'pdfik-output';
  // On Windows these name devices, not files ("NUL.pdf" writes nowhere).
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i.test(base)) base = `pdfik-${base}`;
  return base + ext;
}

/**
 * Writes the file into the output directory without ever overwriting: `name.pdf`,
 * then `name-1.pdf`, `name-2.pdf`, ... (O_EXCL). The directory's real path is resolved
 * after creation and the final path is checked to stay inside it.
 */
export async function writeOutput(outputDir: string, fileName: string, bytes: Uint8Array): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  const root = await realpath(outputDir);
  const ext = path.extname(fileName);
  const stem = fileName.slice(0, fileName.length - ext.length);

  for (let n = 0; n < 1000; n++) {
    const candidate = path.join(root, n === 0 ? fileName : `${stem}-${n}${ext}`);
    const relative = path.relative(root, candidate);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Refusing to write outside the output directory');
    }
    let handle;
    try {
      handle = await open(candidate, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o644);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue;
      throw err;
    }
    try {
      await handle.writeFile(bytes);
    } finally {
      await handle.close();
    }
    return candidate;
  }
  throw new Error(`Could not find a free file name for ${fileName} in the output directory`);
}
