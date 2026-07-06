# HTML Report Fallback

This prompt is only for fallback when `scripts/render-report-html.js` fails.

Inputs:

- `REPORT_MD_PATH`
- `HTML_TEMPLATE_PATH`
- `HTML_REPORT_PATH`

Convert the Markdown report into the fixed shell template without inventing content. The output must be a complete standalone HTML file ending with:

`<!-- codegraph-project-analyzer-html-end -->`
