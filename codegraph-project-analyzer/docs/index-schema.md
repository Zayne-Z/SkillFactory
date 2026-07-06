# JSON Index Schema

V1 uses transparent JSON files instead of SQLite.

- `files.json`: project metadata, framework hints, file list, file types, sizes and line counts.
- `symbols.jsonl`: one JSON object per class, method, function or export.
- `edges.jsonl`: import, reference and module-dependency edges. `references` edges are filtered (target must be a class/export/function, name length ≥ 4, not in the common-name stoplist, and appear as a real usage — call / `new` / member access / type / inheritance) to reduce false positives; `module-dependency` edges are de-duplicated per direction.
- `entrypoints.json`: Spring mappings and Web routes.
- `modules.json`: module IDs, names, file lists and counts.
- `../context-packs/*.json`: small-context module packets for LLM workers. Each pack includes `code_outline` (per-file signature-level outline) so small-context models can reason about real code without loading whole files; `budget.max_chars` / `budget.truncated` record the enforced `--max-pack-chars` cap.
- `../deep-tasks.json`: resumable feature-implementation analysis plan. Tasks are fine-grained (`feature_implementation`, `entrypoint_flow`, `async_job`, `external_integration`, `state_storage`, `data_persistence`, `cleanup_lifecycle`, `error_retry`) and start as `pending` until the user chooses modules/tasks.
- `../deep-results/*.json`: one output per selected deep task, written by `prompts/feature-implementation.md`.
- `../feature-implementations.json`: merged deep-analysis output written by `scripts/merge-deep-results.js` and used to populate the final report's `feature_implementations` section.

Normalized IDs are intentionally simple and adapter-friendly. External enrichers map onto this schema without changing it: the AST-based `colbymchenry/codegraph` MCP can verify callers/callees/impact, and `@benborla29/mcp-server-mysql` can supply real DB schema. Both are optional — see `mcp-integration.md`.
