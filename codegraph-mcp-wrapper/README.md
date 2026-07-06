# @pa/codegraph-mcp-wrapper

Internal MCP wrapper for `@colbymchenry/codegraph`.

It resolves the target project, proxies `codegraph serve --mcp`, and adds PA management tools for user-confirmed background initialization. Wrapper logs go to stderr so MCP stdout stays reserved for JSON-RPC.

```json
{
  "mcpServers": {
    "codegraph": {
      "command": "npx",
      "args": ["-y", "@pa/codegraph-mcp-wrapper@latest", "serve", "--mcp"],
      "env": {
        "CODEGRAPH_PROJECT_ROOT": "/absolute/path/to/project",
        "NPM_CONFIG_REGISTRY": "https://your-company-npm-registry.example.com"
      }
    }
  }
}
```

Environment:

- `CODEGRAPH_PROJECT_ROOT`: explicit project root.
- `CODEGRAPH_PACKAGE`: underlying CodeGraph package, default `@colbymchenry/codegraph@latest`.
- `CODEGRAPH_AUTO_INIT_MODE=before-serve`: legacy small-project mode that runs `codegraph init` before MCP starts. Default mode does not block MCP startup.
- `CODEGRAPH_WRAPPER_LOG`: optional log file path, resolved from the project root when relative.

PA management tools exposed through MCP:

- `pa_codegraph_check`: check whether the project looks like a code repository and whether `.codegraph/` exists.
- `pa_codegraph_init_start`: after user confirmation, spawn a background child process for `codegraph init`.
- `pa_codegraph_init_status`: poll background initialization status.
- `pa_codegraph_init_skip`: record that the user chose not to initialize CodeGraph for this session.

Background initialization is a child process, not a thread. The wrapper keeps the MCP proxy running while the child process builds the index.

Recommended agent policy:

1. Call `pa_codegraph_check`.
2. If it returns `recommend_init_prompt=true`, ask the user or follow the project policy.
3. On approval, call `pa_codegraph_init_start` and poll `pa_codegraph_init_status`.
4. On decline, call `pa_codegraph_init_skip` and continue without CodeGraph enhancement.

CLI fallback for agents:

```bash
npx -y @pa/codegraph-mcp-wrapper@latest codegraph status
npx -y @pa/codegraph-mcp-wrapper@latest codegraph init
npx -y @pa/codegraph-mcp-wrapper@latest codegraph sync
```

Do not rely on a global `codegraph` binary when the wrapper is launched through MCP `npx`; use the proxy command above.
