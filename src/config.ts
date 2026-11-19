import os from 'node:os';
import path from 'node:path';

export const DEFAULT_API_URL = 'https://api.pdfik.net';

export interface Config {
  apiKey: string;
  apiUrl: string;
  outputDir: string;
  /** PDFIK_TEST_MODE=1: every job is a free test job (sample output, nothing charged). */
  forceTest: boolean;
}

export class ConfigError extends Error {}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Reads the configuration from the environment only. The API key never comes from a
 * tool argument: credentials must not live in the model's context.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const apiKey = (env.PDFIK_API_KEY ?? '').trim();
  if (!apiKey) {
    throw new ConfigError(
      'PDFIK_API_KEY is not set. Create a key at https://pdfik.net/dashboard/api-keys and pass it to this server as the PDFIK_API_KEY environment variable.'
    );
  }
  if (!/^sk_(live|test)_[A-Za-z0-9_-]+$/.test(apiKey)) {
    throw new ConfigError('PDFIK_API_KEY does not look like a PDFik API key (sk_live_... or sk_test_...).');
  }

  const apiUrl = (env.PDFIK_API_URL || DEFAULT_API_URL).trim().replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(apiUrl);
  } catch {
    throw new ConfigError(`PDFIK_API_URL is not an absolute URL: ${apiUrl}`);
  }
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && LOOPBACK.has(parsed.hostname))) {
    // The key travels in a header: never over plain http to a remote host.
    throw new ConfigError('PDFIK_API_URL must use https (plain http is accepted only for localhost).');
  }

  // A leading "~" means the home folder (the docs write the default as ~/Downloads/PDFik).
  const requestedDir = env.PDFIK_OUTPUT_DIR?.trim().replace(/^~(?=$|[\\/])/, os.homedir());
  const outputDir = path.resolve(requestedDir || path.join(os.homedir(), 'Downloads', 'PDFik'));

  return {
    apiKey,
    apiUrl,
    outputDir,
    forceTest: env.PDFIK_TEST_MODE === '1' || env.PDFIK_TEST_MODE?.toLowerCase() === 'true',
  };
}
