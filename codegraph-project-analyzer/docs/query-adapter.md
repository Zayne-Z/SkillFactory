# Query Adapter And MCP

The query layer reads `.projectanalysis/index` and exposes stable capabilities:

- `find_symbol`
- `get_module_map`
- `get_entrypoints`
- `trace_callers`
- `trace_callees`
- `get_context_pack`
- `find_impact_area`

CLI example:

```text
node "{SKILL_ROOT}/scripts/query-index.js" find_symbol --index ".projectanalysis/index" --query "OrderService"
```

MCP stdio example:

```text
node "{SKILL_ROOT}/scripts/mcp-server.js" --index ".projectanalysis/index"
```

The MCP server is dependency-free and implements `initialize`, `tools/list`, and `tools/call` over newline-delimited JSON-RPC messages.
