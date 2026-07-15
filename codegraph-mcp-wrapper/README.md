# @pa/codegraph-mcp-wrapper

Internal MCP wrapper for `@colbymchenry/codegraph`.

It resolves the target project, proxies `codegraph serve --mcp`, and adds PA management tools for user-confirmed background or blocking initialization. Wrapper logs go to stderr so MCP stdout stays reserved for JSON-RPC.

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
- `CODEGRAPH_PACKAGE`: underlying CodeGraph package, default `@colbymchenry/codegraph@1.3.0`.
- `CODEGRAPH_AUTO_INIT_MODE=before-serve`: legacy small-project mode that runs `codegraph init` before MCP starts. Default mode does not block MCP startup.
- `CODEGRAPH_INIT_WAIT_TIMEOUT_MS`: default timeout for `pa_codegraph_init_wait`, 30 minutes when unset.
- `CODEGRAPH_INIT_WAIT_POLL_MS`: polling interval used by `pa_codegraph_init_wait`, 250 ms when unset.
- `CODEGRAPH_WRAPPER_LOG`: optional log file path, resolved from the project root when relative.

Project root resolution is intentionally strict: `--project-root` → `CODEGRAPH_PROJECT_ROOT` → the wrapper process's exact cwd. The wrapper never walks into parent directories implicitly, so a parent repository's `.codegraph/` cannot be mistaken for the current project's index.

Windows note: the wrapper runs `npx` through the Windows shell internally because npm shims are `.cmd` files. Do not replace the MCP command with `npx.cmd`; keep the normal config command as `npx`.

Windows fix floor: use `@pa/codegraph-mcp-wrapper@0.3.2` or newer. If the agent log still mentions `spawn("npx.cmd", ...)`, it is running an older published/cached wrapper. Verify with:

```bash
npx -y @pa/codegraph-mcp-wrapper@0.3.2 --version
```

Exact-cwd project isolation and blocking initialization require `@pa/codegraph-mcp-wrapper@0.4.0` or newer.

After publishing to the company registry, prefer pinning the fixed version once to flush ambiguity:

```json
{
  "mcpServers": {
    "codegraph": {
      "command": "npx",
      "args": ["-y", "@pa/codegraph-mcp-wrapper@0.4.0", "serve", "--mcp"]
    }
  }
}
```

PA management tools exposed through MCP:

- `pa_codegraph_check`: check only the resolved project root and verify a local `.codegraph/` with `codegraph status`.
- `pa_codegraph_init_start`: after user confirmation, spawn a background child process for `codegraph init`.
- `pa_codegraph_init_wait`: start or join initialization and block the tool call until completion, failure, or timeout.
- `pa_codegraph_init_status`: poll background initialization status.
- `pa_codegraph_init_skip`: record that the user chose not to initialize CodeGraph for this session.

Background initialization is a child process, not a thread. The wrapper keeps the MCP proxy running while the child process builds the index.

Recommended agent policy:

1. Call `pa_codegraph_check`.
2. If it returns `recommend_init_prompt=true`, ask the user or follow the project policy.
3. On approval, call `pa_codegraph_init_wait` when later work requires a ready index. Use `pa_codegraph_init_start` plus `pa_codegraph_init_status` only when initialization should remain in the background.
4. On decline, call `pa_codegraph_init_skip` and continue without CodeGraph enhancement.

CLI fallback for agents:

```bash
npx -y @pa/codegraph-mcp-wrapper@latest codegraph status
npx -y @pa/codegraph-mcp-wrapper@latest codegraph init
npx -y @pa/codegraph-mcp-wrapper@latest codegraph sync
```

Do not rely on a global `codegraph` binary when the wrapper is launched through MCP `npx`; use the proxy command above.
