# PDFik MCP server

Turn a URL/HTML/Markdown into a PDF or a screenshot, or build a Factur-X / ZUGFeRD
e-invoice, by asking your AI assistant — Claude Desktop, Claude Code, Cursor or any other
MCP client. The server runs on your computer, calls the [PDFik API](https://docs.pdfik.net)
with your key and saves the files in a folder on your disk; the assistant gets the path.

- Every PDFik plan, Free included. Test mode is free.
- Files are saved locally (default `~/Downloads/PDFik`); nothing is returned to the chat
  as bytes except a small preview of a screenshot.
- Your API key stays in the server's environment. It is never a tool argument and never
  appears in a tool result.

Full guide: https://docs.pdfik.net/integrations/mcp

## Requirements

- Node.js 22 or newer
- A PDFik API key — create one at https://pdfik.net/dashboard/api-keys

## Set up

### Claude Code

```bash
claude mcp add pdfik --env PDFIK_API_KEY=sk_live_YOUR_API_KEY -- npx -y @pdfik/mcp@0.1.0
```

### Claude Desktop, Cursor and other clients

Add the server to the client's MCP configuration (`claude_desktop_config.json`,
`~/.cursor/mcp.json`, ...):

```json
{
  "mcpServers": {
    "pdfik": {
      "command": "npx",
      "args": ["-y", "@pdfik/mcp@0.1.0"],
      "env": {
        "PDFIK_API_KEY": "sk_live_YOUR_API_KEY"
      }
    }
  }
}
```

Claude Desktop users can also install the `.mcpb` file from the
[latest release](https://github.com/pdfik/pdfik-mcp/releases) and enter the key when asked.

### Settings

| Variable | Required | Meaning |
| :-- | :-- | :-- |
| `PDFIK_API_KEY` | yes | Your PDFik API key |
| `PDFIK_OUTPUT_DIR` | no | Folder for saved files (default `~/Downloads/PDFik`) |
| `PDFIK_TEST_MODE` | no | `1` makes every job a free test job with sample output |
| `PDFIK_API_URL` | no | API address (default `https://api.pdfik.net`) |

## Tools

| Tool | What it does |
| :-- | :-- |
| `url_to_pdf` | Renders a public web page to PDF (paper format, margins, header/footer, watermark, compression, scale; optional Factur-X e-invoice) |
| `html_to_pdf` | Renders HTML markup (up to 512 KiB; sanitized) to PDF |
| `markdown_to_pdf` | Renders Markdown (CommonMark + GFM tables) to PDF |
| `url_to_image` | Captures a web page as PNG or JPEG |
| `html_to_image` | Captures HTML markup as PNG or JPEG |
| `einvoice_to_pdf` | Builds a Factur-X / ZUGFeRD PDF/A-3 from CII invoice XML |
| `get_job` | Status of a job |
| `download_job` | Saves the output of a finished job (at most 3 downloads, for 24 hours) |
| `get_account` | Plan, quota window, usage and limits of your key — creates nothing |

By default a tool waits for the render (up to about 45 seconds) and saves the file. Pass
`wait: false` for long renders: the tool returns a job id, then `get_job` and
`download_job` finish the work.

## Examples

- "Make a PDF of https://example.com in A4 landscape."
- "Turn this Markdown into a PDF called notes."
- "Take a 1280x800 screenshot of https://example.com."
- "How many documents do I have left this month on PDFik?"

## Limits

- 150 MB per output file; per-plan quotas and rate limits as on https://pdfik.net/pricing.
- Generated files are stored on our side for 24 hours (or delivered only to your disk).

## Privacy

The server sends what you ask it to render to the PDFik API and nothing else. See the
[privacy policy](https://docs.pdfik.net/legal/privacy).

## License

MIT
