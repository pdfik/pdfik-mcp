# Changelog

All notable changes to `@pdfik/mcp` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

## [0.1.0] — unreleased

### Added
- First release: tools `url_to_pdf`, `html_to_pdf`, `markdown_to_pdf`, `url_to_image`,
  `html_to_image`, `einvoice_to_pdf`, `get_job`, `download_job`, `get_account` over stdio,
  for both MCP protocol generations.
- Files are saved under `PDFIK_OUTPUT_DIR` (default `~/Downloads/PDFik`), never
  overwritten; results carry the path and a `file://` resource link.
