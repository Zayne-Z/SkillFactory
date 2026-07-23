# CodeGraph Wrapper MCP 安装参考

仅在用户确认安装后使用本页。先确定当前客户端；无法判断时询问用户。配置名称统一使用 `codegraph`，版本和 registry 固定为：

```text
@pa/codegraph-mcp-wrapper@1.0.0
http://maven.paic.com.cn/repository/npm
CODEGRAPH_PROJECT_SELECTION=working-directory
```

禁止 `latest`，不要配置裸 `@colbymchenry/codegraph serve --mcp`。

## 安装前预热

预热可提前下载固定包，减少客户端第一次握手耗时：

```bash
npx -y --registry http://maven.paic.com.cn/repository/npm @pa/codegraph-mcp-wrapper@1.0.0 --version
```

Windows PowerShell 使用同一条单行命令，不要把 `npx` 改成 `npx.cmd`。

## Claude Code

按 [Claude Code MCP 文档](https://code.claude.com/docs/en/mcp)，优先用官方 CLI 添加用户级 stdio MCP：

```bash
claude mcp add --env CODEGRAPH_PROJECT_SELECTION=working-directory --transport stdio --scope user codegraph -- npx -y --registry http://maven.paic.com.cn/repository/npm @pa/codegraph-mcp-wrapper@1.0.0 serve --mcp
```

验证：

```bash
claude mcp get codegraph
claude mcp list
```

长时间初始化需要在该 server 条目设置 `"timeout": 1800000`，单位是毫秒。启动 Claude Code 时可设置 `MCP_TIMEOUT=60000`，同样是毫秒。新开会话或在 `/mcp` 中确认连接和工具列表。

## Codex CLI / Codex IDE

按 [Codex MCP 文档](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)，使用官方 CLI 注册：

```bash
codex mcp add codegraph --env CODEGRAPH_PROJECT_SELECTION=working-directory -- npx -y --registry http://maven.paic.com.cn/repository/npm @pa/codegraph-mcp-wrapper@1.0.0 serve --mcp
```

在 `~/.codex/config.toml` 对应表中保留 CLI 写入内容并补充：

```toml
[mcp_servers.codegraph]
startup_timeout_sec = 60
tool_timeout_sec = 1800
```

验证：

```bash
codex mcp list
```

Codex TUI 使用 `/mcp` 查看状态；IDE 配置后重启扩展。

## OpenCode

按 [OpenCode MCP 文档](https://thdxr.dev.opencode.ai/docs/mcp-servers/)，将下面条目合并到当前 OpenCode 配置的 `mcp` 对象；不要使用旧字段 `mcpServers`：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "codegraph": {
      "type": "local",
      "command": [
        "npx",
        "-y",
        "--registry",
        "http://maven.paic.com.cn/repository/npm",
        "@pa/codegraph-mcp-wrapper@1.0.0",
        "serve",
        "--mcp"
      ],
      "enabled": true,
      "environment": {
        "CODEGRAPH_PROJECT_SELECTION": "working-directory"
      }
    }
  }
}
```

也可运行 `opencode mcp add` 进入官方交互式添加流程。配置后新开 OpenCode 会话并确认 CodeGraph 工具可见。

## OpenClaw

按 [OpenClaw MCP 文档](https://docs.openclaw.ai/cli/mcp)，使用 OpenClaw 自身的 MCP registry 增量添加 stdio 定义。`--connect-timeout` 和 `--timeout` 的单位都是秒：

```bash
openclaw mcp add codegraph --command npx --arg -y --arg --registry --arg http://maven.paic.com.cn/repository/npm --arg @pa/codegraph-mcp-wrapper@1.0.0 --arg serve --arg --mcp --env CODEGRAPH_PROJECT_SELECTION=working-directory --connect-timeout 60 --timeout 1800
```

验证并刷新：

```bash
openclaw mcp doctor codegraph --probe
openclaw mcp reload
```

OpenClaw 必须使用会暴露 MCP 工具的 `coding` 或 `messaging` profile；`minimal` profile 不会显示这些工具。若运行 MCP 的是另一个 Gateway/Agent 进程，还需要重启对应进程。

## 判定安装完成

配置文件存在并不代表当前会话已经可用。只有 Agent 的工具目录中同时出现 `pa_codegraph_check` 和 `pa_codegraph_ensure`，并且 `pa_codegraph_check` 能成功返回，才视为 wrapper MCP 已安装并连接。
