import { randomUUID } from 'node:crypto';

import type { Config } from './config.js';
import { errorFromResponse, PdfikApiError, scrubKeys } from './errors.js';
import { CLIENT_HEADER } from './version.js';

/** A sync (`wait: true`) request is held up to ~45 s server-side; leave room for the transfer. */
/**
 * The profile warning out of a 202 `detail`: pdf-api appends it to the queued sentence
 * ("Job successfully sent to processing queue. <warning>"). Undefined when nothing is left.
 */
export function profileWarning(detail: unknown): string | undefined {
  if (typeof detail !== 'string') return undefined;
  const rest = detail.replace(/^Job successfully sent to processing queue\.\s*/, '').trim();
  return rest || undefined;
}

const SYNC_TIMEOUT_MS = 70_000;
const REQUEST_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;

export interface FileResult {
  jobId: string;
  bytes: Uint8Array;
  contentType: string;
  warning?: string;
}

export interface QueuedResult {
  jobId: string;
  status: string;
  detail?: string;
}

/**
 * The few PDFik API calls the tools need — no dependency on the SDK. Every request names
 * this server in X-PDFik-Client. The key is sent only to the configured API origin.
 */
export class PdfikApi {
  constructor(
    private readonly config: Config,
    private readonly fetchImpl: typeof fetch = globalThis.fetch
  ) {}

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      'X-API-Key': this.config.apiKey,
      'X-PDFik-Client': CLIENT_HEADER,
      Accept: 'application/json, application/pdf, image/png, image/jpeg',
      ...extra,
    };
  }

  private async send(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.apiUrl}${path}`, {
        ...init,
        // A redirect could carry the key header to another host: never follow one.
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      throw new PdfikApiError(0, scrubKeys(`[network] Could not reach the PDFik API — ${reason}`, this.config.apiKey), 'NETWORK_ERROR');
    }
    if (response.status >= 300) {
      const text = await response.text().catch(() => '');
      throw errorFromResponse(response.status, text, this.config.apiKey);
    }
    return response;
  }

  async getJson<T>(path: string): Promise<T> {
    const response = await this.send(path, { method: 'GET', headers: this.headers() }, REQUEST_TIMEOUT_MS);
    return (await response.json()) as T;
  }

  /**
   * Creates a job. A fresh Idempotency-Key per call: our keys are account-wide and never
   * expire, so a key reused across calls would hand back someone's earlier document.
   */
  async create(path: string, body: Record<string, unknown>, wait: boolean): Promise<FileResult | QueuedResult> {
    const response = await this.send(
      path,
      {
        method: 'POST',
        headers: this.headers({ 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }),
        body: JSON.stringify({ ...body, wait }),
      },
      wait ? SYNC_TIMEOUT_MS : REQUEST_TIMEOUT_MS
    );
    const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (response.status === 202 || contentType === 'application/json') {
      const data = (await response.json()) as { job_id: string; status: string; detail?: string };
      return { jobId: data.job_id, status: data.status, detail: data.detail };
    }
    return {
      jobId: response.headers.get('x-pdfik-job-id') ?? '',
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentType,
      warning: response.headers.get('x-pdfik-warning') ?? undefined,
    };
  }

  async download(jobId: string): Promise<FileResult> {
    const response = await this.send(
      `/jobs/${encodeURIComponent(jobId)}/download`,
      { method: 'GET', headers: this.headers() },
      DOWNLOAD_TIMEOUT_MS
    );
    return {
      jobId,
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentType: (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase(),
    };
  }
}

export function isFile(result: FileResult | QueuedResult): result is FileResult {
  return (result as FileResult).bytes !== undefined;
}
