/**
 * API errors as one readable line: `[status] title — detail (docs link)`.
 *
 * pdf-api answers RFC 7807 problem documents, but `detail` takes four shapes:
 * - a string (most errors);
 * - the list of field errors of a 422 validation error (`loc`, `msg`, `type`);
 * - an object for the payment-method wall (402: `{error, message, add_card_url}`);
 * - and the 413 of the size limit is not RFC 7807 at all (`{error, detail}` or plain text).
 */

export class PdfikApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'PdfikApiError';
    this.status = status;
    this.code = code;
  }
}

const STATUS_TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  402: 'Payment Required',
  403: 'Forbidden',
  404: 'Not Found',
  410: 'Gone',
  413: 'Payload Too Large',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

// Anchors that exist on https://docs.pdfik.net/error-codes for a bare status (same list as the n8n node).
const STATUS_ANCHORS = new Set([400, 401, 402, 403, 404, 405, 409, 410, 413, 429, 500, 503, 504]);

function statusLink(status: number): string {
  const base = 'https://docs.pdfik.net/error-codes';
  if (status === 422) return `${base}#validation-error`;
  return STATUS_ANCHORS.has(status) ? `${base}#${status}` : `${base}#other-http-statuses`;
}

function validationMessage(items: unknown[]): string {
  const parts = items.map((item) => {
    if (item && typeof item === 'object') {
      const { loc, msg } = item as { loc?: unknown; msg?: unknown };
      const where = Array.isArray(loc) ? loc.filter((p) => p !== 'body').join('.') : '';
      const text = typeof msg === 'string' ? msg : '';
      return where ? `${where}: ${text}` : text;
    }
    return String(item);
  });
  return parts.filter(Boolean).join('; ');
}

function detailText(detail: unknown): string {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return validationMessage(detail);
  if (detail && typeof detail === 'object') {
    const d = detail as Record<string, unknown>;
    if (typeof d.message === 'string') return d.message;
    if (typeof d.detail === 'string') return d.detail;
    try {
      return JSON.stringify(detail);
    } catch {
      return '';
    }
  }
  return '';
}

/** Removes anything that looks like an API key from text that may reach the model. */
export function scrubKeys(text: string, apiKey?: string): string {
  let out = text;
  if (apiKey) out = out.split(apiKey).join('[api key]');
  return out.replace(/sk_(live|test)_[A-Za-z0-9_-]{6,}/g, '[api key]');
}

export function errorFromResponse(status: number, bodyText: string, apiKey?: string): PdfikApiError {
  let title = STATUS_TITLES[status] ?? `HTTP ${status}`;
  let detail = '';
  let code: string | undefined;
  let link = statusLink(status);

  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    body = undefined;
  }

  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const b = body as Record<string, unknown>;
    // The generic handler titles a non-string detail "HTTP Error": the status name says more.
    if (typeof b.title === 'string' && b.title && b.title !== 'HTTP Error') title = b.title;
    detail = detailText(b.detail);
    if (typeof b.error === 'string') code = b.error;
    else if (b.detail && typeof b.detail === 'object' && typeof (b.detail as Record<string, unknown>).error === 'string') {
      code = (b.detail as Record<string, string>).error;
    }
    if (typeof b.type === 'string' && /^https:\/\/docs\.pdfik\.net\//.test(b.type)) link = b.type;
  } else if (bodyText.trim()) {
    detail = bodyText.trim().slice(0, 500);
  }

  const message = scrubKeys(`[${status}] ${title}${detail && detail !== title ? ` — ${detail}` : ''} (${link})`, apiKey);
  return new PdfikApiError(status, message, code);
}
