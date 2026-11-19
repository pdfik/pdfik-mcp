# PDFik plugin for Cursor

Adds the PDFik MCP server to Cursor: ask the agent to turn a URL/HTML/Markdown into a
PDF or a screenshot, or to build a Factur-X / ZUGFeRD e-invoice from invoice XML. Files
are saved in `~/Downloads/PDFik` on your computer and the agent gets the path.

## Setup

1. Create an API key at https://pdfik.net/dashboard/api-keys (every plan, Free included).
2. Set `PDFIK_API_KEY` in the environment Cursor starts from, then install the plugin.
   The key is never part of a prompt or a tool result.

Requires Node.js 22 or newer (the server runs with `npx`).

## What it can do

PDF from a URL, HTML or Markdown; PNG/JPEG screenshots; Factur-X e-invoices; job status
and downloads; your plan, usage and limits. Guide: https://docs.pdfik.net/integrations/mcp

## Privacy Policy

The plugin sends only what you ask it to render to the PDFik API.
Generated files are kept on our side for at most 24 hours. Full policy:
https://docs.pdfik.net/legal/privacy

## License

MIT
