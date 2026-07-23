# @pa/codegraph-mcp-wrapper

`@colbymchenry/codegraph` 的 MCP wrapper。当前版本为 `1.0.0`。

wrapper 代理 `codegraph serve --mcp`，并提供项目检查、自动初始化、后台初始化和阻塞等待工具。日志只写入 stderr，MCP stdout 始终保留给 JSON-RPC。底层 CodeGraph 默认固定为较保守的 `@colbymchenry/codegraph@1.3.0`，不会使用 `latest`。

## 项目选址模式

通过下面的配置在两种模式间切换：

```text
CODEGRAPH_PROJECT_SELECTION=working-directory|configured
```

优先级为 `--project-selection` > `CODEGRAPH_PROJECT_SELECTION` > 默认 `working-directory`。非法值会在启动时直接报错。

### working-directory（默认）

所有 `pa_codegraph_*` 和 wrapper 暴露的原生 `codegraph_*` 工具都必须传入：

```json
{ "working_directory": "/absolute/path/to/current/project/or/subdirectory" }
```

wrapper 先校验路径必须非空、绝对、存在且为目录，再按以下顺序解析最终项目根：

1. `git -C <working_directory> rev-parse --show-toplevel`，支持 worktree 和 submodule。
2. 非 Git 项目向上查找最近的 `pom.xml`、`package.json`、Gradle settings/build、`pyproject.toml`、`go.mod` 或 `Cargo.toml`。

该模式不使用 MCP Roots、MCP 启动 cwd、`--project-root` 或 `CODEGRAPH_PROJECT_ROOT`。缺少路径时返回 `status=needs_working_directory` 和 `confirmation_required=true`，不会执行检查或初始化。Agent 无法确定当前目录时应询问用户，不能拿会话启动目录或父目录索引代替。

### configured

该模式将 MCP 固定到一个明确仓库，工具调用无需传 `working_directory`：

```text
--project-root > CODEGRAPH_PROJECT_ROOT
```

两者都未配置时返回 `status=configured_project_root_missing`，不会回退到 cwd、MCP Roots或工具参数。只有显式选择 `configured` 后，wrapper 才会信任固定项目根。

## MCP 配置

推荐的默认配置。下面的 `mcpServers` 结构适用于使用该字段的客户端；OpenCode 应使用当前 `mcp`、`type: local` 和命令数组格式：

```json
{
  "mcpServers": {
    "codegraph": {
      "command": "npx",
      "args": ["-y", "--registry", "http://maven.paic.com.cn/repository/npm", "@pa/codegraph-mcp-wrapper@1.0.0", "serve", "--mcp"],
      "env": {
        "CODEGRAPH_PROJECT_SELECTION": "working-directory"
      }
    }
  }
}
```

固定仓库配置：

```json
{
  "mcpServers": {
    "codegraph": {
      "command": "npx",
      "args": [
        "-y",
        "--registry",
        "http://maven.paic.com.cn/repository/npm",
        "@pa/codegraph-mcp-wrapper@1.0.0",
        "serve",
        "--mcp",
        "--project-selection",
        "configured",
        "--project-root",
        "/absolute/path/to/project"
      ]
    }
  }
}
```

也可以用环境变量配置固定仓库：

```json
{
  "env": {
    "CODEGRAPH_PROJECT_SELECTION": "configured",
    "CODEGRAPH_PROJECT_ROOT": "/absolute/path/to/project"
  }
}
```

## 管理工具

- `pa_codegraph_check`：检查最终项目根，并通过 `codegraph status` 验证本地 `.codegraph/`。
- `pa_codegraph_ensure`：检查索引，缺失时初始化，并阻塞到可用、失败或超时。
- `pa_codegraph_init_start`：启动后台 `codegraph init`；`running` 仅表示已发起，必须继续调用 wait/status 确认完成。
- `pa_codegraph_init_wait`：启动或加入初始化，并阻塞等待结果。
- `pa_codegraph_init_status`：查询初始化状态。
- `pa_codegraph_init_skip`：仅为当前项目记录本次会话跳过初始化。

所有结果都会包含 `project_selection_mode`、`working_directory`、`project_root` 和 `resolution_method`。初始化状态、锁、skip 和 status 按最终项目根隔离。

原生 `codegraph_*` 工具不会向 Agent 暴露上游参数 `projectPath`。wrapper 转发前会删除 `working_directory`，并将解析后的项目根注入内部 `projectPath`。

wrapper 自身直接依赖固定的 `@colbymchenry/codegraph@1.3.0`，并优先复用这份依赖启动 MCP、status 和 init，避免每个操作重新通过 `npx` 解析包。只有显式覆盖为其他 `CODEGRAPH_PACKAGE` 或开发态缺少依赖时才回退 `npx`。

Agent 收到初始化失败或超时时只能通过 wrapper 的 wait/status 获取错误并按策略降级，不得搜索或执行目标项目 `node_modules`、`.bin` 或 npm cache 中的 CodeGraph。

## 1.0.0 行为保证

- MCP 通知、server request 和 client response 双向透传，双方使用相同 JSON-RPC ID 时不会互相覆盖。
- 管理工具提供稳定的 input/output schema 和只读/幂等 annotations；分页列举工具时只在第一页追加管理工具。
- `init_start`、`init_wait`、`init_status` 不把进程已发起等同于索引健康；完成后的索引被删除或失效会回退为 `failed`。
- 初始化锁会结合 owner PID 判断是否陈旧，长时间运行但 owner 仍存活的初始化不会被其他 wrapper 抢占。
- init/ensure 不会在缺少项目标记的目录执行，失败结果包含下一步动作且不会建议 Agent 绕过 wrapper。

## 环境变量

- `CODEGRAPH_PROJECT_SELECTION`：`working-directory` 或 `configured`。
- `CODEGRAPH_PROJECT_ROOT`：仅在 `configured` 模式生效的固定项目根。
- `CODEGRAPH_PACKAGE`：覆盖底层 npm 包，默认 `@colbymchenry/codegraph@1.3.0`；只接受带明确版本号的 npm 包，不接受 `latest`、其他标签、URL、路径、版本范围或 shell 字符。
- `CODEGRAPH_AUTO_INIT`：原生工具调用前是否自动初始化，默认开启。
- `CODEGRAPH_AUTO_INIT_MODE=before-serve`：仅在 `configured` 模式生效；其他模式明确跳过。
- `CODEGRAPH_INIT_WAIT_TIMEOUT_MS`：阻塞初始化默认超时，未设置时为 30 分钟。
- `CODEGRAPH_INIT_WAIT_POLL_MS`：阻塞轮询间隔，未设置时为 250 毫秒。
- `CODEGRAPH_INIT_START_SETTLE_MS`：后台启动后等待即时成功/失败信号的时间，默认 150 毫秒。
- `CODEGRAPH_INIT_LOCK_STALE_MS`：初始化锁进入陈旧检查的时间，默认 10 分钟；owner 进程仍存活时不会删除。
- `CODEGRAPH_WRAPPER_LOG`：可选日志文件路径。

## Windows

发布安装后 wrapper 优先用自身依赖中的 JavaScript shim，不需要 Agent 查找 `.cmd`。仅 `npx_fallback` 会通过 Windows shell 运行 `npx`；MCP 配置里的命令仍写 `npx`，不要改成 `npx.cmd`。

## CLI 代理

直接执行 wrapper CLI 时仍按 `--project-root`、`CODEGRAPH_PROJECT_ROOT`、当前 cwd 的顺序选择目录，不与 MCP 工具选址混用：

```bash
npx -y @pa/codegraph-mcp-wrapper@1.0.0 codegraph status
npx -y @pa/codegraph-mcp-wrapper@1.0.0 codegraph init
npx -y @pa/codegraph-mcp-wrapper@1.0.0 codegraph sync
```

发布到公司 npm 源后请固定明确版本，不要使用 `latest`。
