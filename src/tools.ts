import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import { isFile, PdfikApi, profileWarning, type FileResult } from './api.js';
import type { Config } from './config.js';
import { PdfikApiError, scrubKeys } from './errors.js';
import { safeFileName, writeOutput } from './files.js';

/**
 * Tool descriptions state what a tool does — no instructions to the model. Deliberately
 * absent from every tool: `delivery`, `webhook_url` and `auth` (a prompt-injected page
 * could use them to send output or credentials elsewhere). The API key never appears in
 * an argument or a result.
 */

/** Largest inline image preview, base64-encoded (larger screenshots break some clients). */
const PREVIEW_MAX_BASE64 = 250 * 1024;

const JOB_ID = z.string().regex(/^[0-9a-fA-F-]{36}$/, 'a job id is a UUID');

const margin = z
  .object({
    top: z.string().optional(),
    right: z.string().optional(),
    bottom: z.string().optional(),
    left: z.string().optional(),
  })
  .describe('Page margins with a unit, e.g. "10mm", "0.5in", "20px"');

const pdfOptions = z
  .object({
    format: z.enum(['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'Letter', 'Legal', 'Tabloid', 'Ledger']).optional().describe('Paper format (default A4)'),
    landscape: z.boolean().optional(),
    margin: margin.optional(),
    print_background: z.boolean().optional().describe('Print CSS backgrounds (default true)'),
    display_header_footer: z.boolean().optional(),
    header_template: z.string().max(10000).optional().describe('HTML for the page header; classes pageNumber, totalPages, date, title, url'),
    footer_template: z.string().max(10000).optional().describe('HTML for the page footer; same classes as the header'),
    watermark: z
      .object({
        text: z.string(),
        color: z.string().optional(),
        font_size: z.string().optional(),
        rotation_degrees: z.number().int().optional(),
      })
      .optional(),
    // No user_password (owner 2026-11-19): a tool argument is part of the conversation, so a
    // PDF password would reach the AI provider and the chat history. The API and SDKs keep it.
    compression: z
      .object({
        level: z.number().int().min(1).max(9).optional(),
        image_quality: z.number().int().min(1).max(100).optional(),
      })
      .optional(),
    scale: z.number().min(0.5).max(2).optional(),
  })
  .describe('PDF options');

const renderOptions = z
  .object({
    page_load_timeout_ms: z.number().int().min(0).max(60000).optional(),
    wait_until: z.enum(['load', 'domcontentloaded', 'networkidle', 'commit']).optional(),
    wait_for_selector: z.string().optional().describe('CSS selector to wait for before rendering'),
    wait_after_load_ms: z.number().int().min(0).max(10000).optional(),
  })
  .describe('Browser rendering options');

const einvoiceOption = z
  .object({
    profile: z.enum(['minimum', 'basicwl', 'basic', 'en16931', 'extended']).optional().describe('Factur-X profile the XML declares (default en16931)'),
    xml: z.string().describe('UN/CEFACT CII invoice XML to embed as factur-x.xml'),
  })
  .describe('Turn the PDF into a Factur-X e-invoice (PDF/A-3 with the XML embedded)');

const imageOptions = z
  .object({
    format: z.enum(['png', 'jpeg']).optional().describe('Image format (default png)'),
    full_page: z.boolean().optional().describe('Capture the whole scrollable page, clipped at 8192 px'),
    quality: z.number().int().min(1).max(100).optional().describe('JPEG quality'),
    viewport: z
      .object({
        width: z.number().int().min(320).max(1920),
        height: z.number().int().min(320).max(8192),
      })
      .optional()
      .describe('Browser window size in CSS pixels (default 1024x768)'),
  })
  .describe('Screenshot options');

const common = {
  filename: z.string().max(200).optional().describe('File name for the saved output (the extension follows the output type)'),
  test: z.boolean().optional().describe('Test mode: free sample output, nothing charged'),
  wait: z
    .boolean()
    .optional()
    .describe('true (default): wait up to ~45 s and save the file; false: return the job id at once, then use get_job and download_job'),
};

const fileOutput = {
  job_id: z.string(),
  status: z.string().optional(),
  path: z.string().optional(),
  bytes: z.number().optional(),
  test: z.boolean(),
  warning: z.string().optional(),
};

const CREATE_ANNOTATIONS = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

type ToolResult = CallToolResult;
type Content = CallToolResult['content'];

function compact<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

export function toolError(err: unknown, apiKey: string): ToolResult {
  let text: string;
  if (err instanceof PdfikApiError) {
    text = err.message;
    if (err.code === 'SYNC_TIMEOUT') {
      text += ' The job was cancelled and nothing was charged; for long renders call the tool again with wait: false and then use get_job and download_job.';
    }
  } else {
    text = `PDFik MCP error: ${err instanceof Error ? err.message : String(err)}`;
  }
  return { isError: true, content: [{ type: 'text', text: scrubKeys(text, apiKey) }] };
}

export class PdfikTools {
  constructor(
    private readonly config: Config,
    private readonly api: PdfikApi
  ) {}

  private isTest(requested: boolean | undefined): boolean {
    return this.config.forceTest || requested === true;
  }

  async saveFile(file: FileResult, filename: string | undefined, test: boolean, preview: boolean): Promise<ToolResult> {
    const name = safeFileName(filename, file.jobId, file.contentType);
    const saved = await writeOutput(this.config.outputDir, name, file.bytes);
    const lines = [`Saved ${saved} (${file.bytes.length} bytes, job ${file.jobId}${test ? ', test mode: sample output' : ''}).`];
    if (file.warning) lines.push(`Note: ${file.warning}`);
    const content: Content = [
      { type: 'text', text: lines.join('\n') },
      { type: 'resource_link', uri: pathToFileURL(saved).href, name: path.basename(saved), mimeType: file.contentType },
    ];
    if (preview && file.contentType.startsWith('image/')) {
      const data = Buffer.from(file.bytes).toString('base64');
      if (data.length <= PREVIEW_MAX_BASE64) content.push({ type: 'image', data, mimeType: file.contentType });
    }
    return {
      content,
      structuredContent: compact({ job_id: file.jobId, path: saved, bytes: file.bytes.length, test, warning: file.warning }),
    };
  }

  async create(
    endpoint: string,
    body: Record<string, unknown>,
    args: { filename?: string; test?: boolean; wait?: boolean },
    preview = false
  ): Promise<ToolResult> {
    const test = this.isTest(args.test);
    const wait = args.wait !== false;
    try {
      const result = await this.api.create(endpoint, compact({ ...body, test: test || undefined }), wait);
      if (!isFile(result)) {
        // minimum/basicwl e-invoices: the profile warning rides `detail` on the 202.
        const warning =
          endpoint === '/einvoice-to-pdf' && ['minimum', 'basicwl'].includes(String(body.profile)) ? profileWarning(result.detail) : undefined;
        return {
          content: [
            {
              type: 'text',
              text: `Job ${result.jobId} is ${result.status}. Check it with get_job; when it is done, save the file with download_job.`,
            },
          ],
          structuredContent: compact({ job_id: result.jobId, status: result.status, test, warning }),
        };
      }
      return await this.saveFile(result, args.filename, test, preview);
    } catch (err) {
      return toolError(err, this.config.apiKey);
    }
  }

  async getJob(jobId: string): Promise<ToolResult> {
    try {
      const job = await this.api.getJson<Record<string, unknown>>(`/jobs/${encodeURIComponent(jobId)}`);
      return { content: [{ type: 'text', text: JSON.stringify(job, null, 2) }], structuredContent: job };
    } catch (err) {
      return toolError(err, this.config.apiKey);
    }
  }

  async downloadJob(jobId: string, filename: string | undefined): Promise<ToolResult> {
    try {
      const job = await this.api.getJson<{ status?: string; test?: boolean; error_code?: string }>(`/jobs/${encodeURIComponent(jobId)}`);
      if (job.status !== 'done') {
        // Checked first: a download attempt is spent only on a finished job.
        const why = job.status === 'failed' ? `failed (${job.error_code ?? 'unknown error'})` : `still ${job.status}`;
        return { isError: true, content: [{ type: 'text', text: `Job ${jobId} is ${why}; there is no file to download.` }] };
      }
      const file = await this.api.download(jobId);
      return await this.saveFile(file, filename, job.test === true, false);
    } catch (err) {
      return toolError(err, this.config.apiKey);
    }
  }

  async getAccount(): Promise<ToolResult> {
    try {
      const account = await this.api.getJson<Record<string, unknown>>('/account');
      return { content: [{ type: 'text', text: JSON.stringify(account, null, 2) }], structuredContent: account };
    } catch (err) {
      return toolError(err, this.config.apiKey);
    }
  }
}

export function registerTools(server: McpServer, tools: PdfikTools): void {
  server.registerTool(
    'url_to_pdf',
    {
      title: 'URL to PDF',
      description:
        'Renders a public web page to PDF with PDFik and saves the file in the output folder. Returns the saved path. Uses one document of the PDFik quota unless test mode is on.',
      inputSchema: z.object({
        url: z.string().url().max(8192).describe('Public http(s) URL of the page'),
        options: pdfOptions.optional(),
        render: renderOptions.optional(),
        einvoice: einvoiceOption.optional(),
        ...common,
      }),
      outputSchema: z.object(fileOutput),
      annotations: CREATE_ANNOTATIONS,
    },
    async (args) =>
      tools.create(
        '/url-to-pdf',
        compact({
          url: args.url,
          options: args.options,
          render: args.render,
          einvoice: args.einvoice ? { format: 'factur-x', ...args.einvoice } : undefined,
        }),
        args
      )
  );

  server.registerTool(
    'html_to_pdf',
    {
      title: 'HTML to PDF',
      description:
        'Renders HTML markup (up to 512 KiB; sanitized by the API: scripts and styles are removed) to PDF and saves the file in the output folder.',
      inputSchema: z.object({
        html: z.string().min(1).max(524288).describe('HTML markup'),
        options: pdfOptions.optional(),
        render: renderOptions.optional(),
        einvoice: einvoiceOption.optional(),
        ...common,
      }),
      outputSchema: z.object(fileOutput),
      annotations: CREATE_ANNOTATIONS,
    },
    async (args) =>
      tools.create(
        '/html-to-pdf',
        compact({
          html: args.html,
          options: args.options,
          render: args.render,
          einvoice: args.einvoice ? { format: 'factur-x', ...args.einvoice } : undefined,
        }),
        args
      )
  );

  server.registerTool(
    'markdown_to_pdf',
    {
      title: 'Markdown to PDF',
      description:
        'Renders Markdown (CommonMark with GFM tables; up to 100,000 characters; raw HTML is escaped) to PDF and saves the file in the output folder.',
      inputSchema: z.object({
        markdown: z.string().min(1).max(100000).describe('Markdown text'),
        options: pdfOptions.optional(),
        render: renderOptions.optional(),
        ...common,
      }),
      outputSchema: z.object(fileOutput),
      annotations: CREATE_ANNOTATIONS,
    },
    async (args) => tools.create('/markdown-to-pdf', compact({ markdown: args.markdown, options: args.options, render: args.render }), args)
  );

  server.registerTool(
    'url_to_image',
    {
      title: 'URL to image',
      description:
        'Captures a public web page as a PNG or JPEG screenshot and saves it in the output folder. A small preview is attached when the image is small enough.',
      inputSchema: z.object({
        url: z.string().url().max(8192).describe('Public http(s) URL of the page'),
        options: imageOptions.optional(),
        render: renderOptions.optional(),
        ...common,
      }),
      outputSchema: z.object(fileOutput),
      annotations: CREATE_ANNOTATIONS,
    },
    async (args) =>
      tools.create('/url-to-image', compact({ url: args.url, options: args.options, render: args.render }), args, args.options?.full_page !== true)
  );

  server.registerTool(
    'html_to_image',
    {
      title: 'HTML to image',
      description: 'Captures HTML markup (sanitized by the API) as a PNG or JPEG image and saves it in the output folder.',
      inputSchema: z.object({
        html: z.string().min(1).max(524288).describe('HTML markup'),
        options: imageOptions.optional(),
        render: renderOptions.optional(),
        ...common,
      }),
      outputSchema: z.object(fileOutput),
      annotations: CREATE_ANNOTATIONS,
    },
    async (args) =>
      tools.create('/html-to-image', compact({ html: args.html, options: args.options, render: args.render }), args, args.options?.full_page !== true)
  );

  server.registerTool(
    'einvoice_to_pdf',
    {
      title: 'E-invoice to PDF',
      description:
        'Builds a Factur-X / ZUGFeRD e-invoice (PDF/A-3 with the XML embedded) from UN/CEFACT CII invoice XML and saves it in the output folder. The XML is validated against the profile first. Profiles minimum and basicwl are not a complete legal invoice; the result then carries a warning.',
      inputSchema: z.object({
        xml: z.string().min(1).describe('UN/CEFACT Cross-Industry-Invoice XML'),
        profile: z.enum(['minimum', 'basicwl', 'basic', 'en16931', 'extended']).optional().describe('Profile the XML declares (default en16931)'),
        template_id: z.string().optional().describe('Id of a saved invoice template (default: the account default)'),
        ...common,
      }),
      outputSchema: z.object(fileOutput),
      annotations: CREATE_ANNOTATIONS,
    },
    async (args) => tools.create('/einvoice-to-pdf', compact({ xml: args.xml, profile: args.profile, template_id: args.template_id }), args)
  );

  server.registerTool(
    'get_job',
    {
      title: 'Get job',
      description: 'Returns the status of a PDFik job: queued, rendering, uploading, done or failed (with its error code).',
      inputSchema: z.object({ job_id: JOB_ID }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) => tools.getJob(args.job_id)
  );

  server.registerTool(
    'download_job',
    {
      title: 'Download job',
      description:
        'Saves the output of a finished job in the output folder. Each file can be downloaded at most 3 times and for 24 hours after it finished.',
      inputSchema: z.object({
        job_id: JOB_ID,
        filename: common.filename,
      }),
      outputSchema: z.object(fileOutput),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => tools.downloadJob(args.job_id, args.filename)
  );

  server.registerTool(
    'get_account',
    {
      title: 'Get account',
      description: "Returns the PDFik plan, current quota window, usage in it and limits of the configured API key. Creates nothing and charges nothing.",
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async () => tools.getAccount()
  );
}
