# 可选 MCP 增强（codegraph / mysql）

`codegraph-project-analyzer` 的主流程**不依赖任何外部 MCP**，必经路径始终是：

`build-inventory.js -> build-json-index.js -> context packs -> analysis-result.json -> Markdown -> HTML`

外部 MCP 只是**可选增强**：检测到就用来提高精度，检测不到就按内置确定性索引继续，主流程不受影响。CodeGraph 推荐用于大仓、小上下文模型、需要真实调用链/影响面的项目分析；不是硬依赖。

> 命名区分：本 Skill 自带的 `scripts/mcp-server.js` 暴露的是 `find_symbol`/`trace_callers` 等**内置**能力（读 `.projectanalysis/index`）；下文的 `codegraph` 指外部 MCP `colbymchenry/codegraph`，两者不是同一个东西。

## 探测约定（graceful degradation）

在 `environment_check` 阶段，主编排器判断当前 agent runtime 是否挂载了这两个 MCP，并写入 state：

- `mcp.codegraph`：`available` / `unavailable`
- `mcp.mysql`：`available` / `unavailable`

判定为 `unavailable` 的情形都必须**跳过对应 MCP、不报错**：

- runtime 未挂载该 MCP，或 `tools/list` 里没有对应工具；
- codegraph 已挂载但目标项目没有 `.codegraph/` 索引，且 `codegraph_policy` 不要求初始化或用户拒绝初始化；
- mysql 已挂载，但连接失败 / 无只读账号。

每个用到 MCP 的子执行器都要在自己的输出 JSON 里记录 `codegraph_mcp_used` / `mysql_mcp_used`（布尔），便于 curator 说明结论来源。

## CodeGraph MCP（`colbymchenry/codegraph`）

基于 tree-sitter 的 AST 级代码知识图谱，可弥补内置正则索引的精度短板（真实调用者/被调者/影响半径）。

**推荐接入**：公司内网发布 `@pa/codegraph-mcp-wrapper` 后，用户只需配置 MCP。wrapper 会使用默认的 `@colbymchenry/codegraph@1.3.0` 并立即代理真正的 `serve --mcp`，同时额外暴露 `pa_codegraph_check` / `pa_codegraph_init_start` / `pa_codegraph_init_wait` / `pa_codegraph_init_status` / `pa_codegraph_init_skip`。目标项目缺少健康的本地 `.codegraph/` 时，agent 按 `options.codegraph_policy` 决定是否初始化。

裸接入时，目标项目需先建索引，否则 MCP 工具不返回图数据。上游当前推荐命令是 `codegraph init`，它会创建 `.codegraph/` 并构建完整 graph；之后 CodeGraph 默认 auto-sync。

**工具**：默认只暴露 `codegraph_explore`（勘察 / 流程分析 / 符号源码 / 影响半径 / 关系图，一个工具覆盖大部分需求）。其余 `codegraph_search`、`codegraph_node`、`codegraph_callers`、`codegraph_callees`、`codegraph_impact`、`codegraph_files`、`codegraph_status` 默认不列出，可用环境变量 `CODEGRAPH_MCP_TOOLS=explore,search,callers,callees,impact` 开启。

**推荐用途**（可用时）：

- 用 `codegraph_explore` / `codegraph_callers` / `codegraph_callees` 校正内置 `edges.jsonl` 的调用关系，减少正则假边；
- 用 `codegraph_impact` 增强 `dependency-hotspots` 的影响面分析；
- 大仓中减少子执行器直接 Read 源码的次数。

**不可用时**：继续用 `.projectanalysis/index` 与 `scripts/query-index.js`，并在输出里标 `codegraph_mcp_used: false`。

## `codegraph_policy`

`options.codegraph_policy` 控制 CodeGraph 生命周期：

- `no-codegraph`：始终跳过外部 CodeGraph，只用内置 JSON 索引。
- `codegraph-enhanced`：只在已有 `.codegraph/` 且 MCP 可查询时使用；不等待初始化。
- `codegraph-first`：检测到 wrapper 且缺索引时，阻塞等待初始化完成后再进入 inventory；失败或超时则降级。
- `ask`：默认。缺索引时询问用户；用户确认则按 `codegraph-first`，拒绝则调用 `pa_codegraph_init_skip` 并继续。

推荐默认 `ask`。对大仓、DeepSeek Flash 等小上下文模型、或要求准确调用链的分析，可在范围确认时设置 `codegraph-first`。

### `@pa/codegraph-mcp-wrapper` 行为

- 项目根定位优先级：`--project-root` → `CODEGRAPH_PROJECT_ROOT` → MCP 进程的精确 cwd。wrapper 不再向父目录搜索，避免误用外层仓库的 `.codegraph/`。
- 默认底层包：`@colbymchenry/codegraph@1.3.0`。如需升级或回退，使用 `CODEGRAPH_PACKAGE` 覆盖。
- 默认启动不执行 `codegraph init`，避免大仓阻塞 MCP 握手。
- 通过 `pa_codegraph_check` 检测是否是代码仓库，并仅在项目根本地存在 `.codegraph/` 时执行 `codegraph status`；目录存在但状态失败仍视为未完成初始化。
- 用户确认后调用 `pa_codegraph_init_start`，wrapper 会 spawn 后台子进程执行 `codegraph init` 并立即返回；Skill 可用 `pa_codegraph_init_status` 轮询并等待完成。
- 后续步骤强依赖 CodeGraph 时调用 `pa_codegraph_init_wait`，它会启动或加入现有初始化并阻塞到完成、失败或超时。旧版 wrapper 则回退到 `pa_codegraph_init_start` + `pa_codegraph_init_status` 轮询。
- 用户拒绝时调用 `pa_codegraph_init_skip`，显式记录本次不初始化。
- 初始化日志只写 stderr 或 `CODEGRAPH_WRAPPER_LOG`，不会污染 MCP stdout。
- 初始化失败时只影响 CodeGraph 增强；主 Skill 仍按“外部 MCP 不可用”降级。

可选环境变量：

- `CODEGRAPH_PROJECT_ROOT`：显式项目根。
- `CODEGRAPH_PACKAGE`：覆盖底层包，默认 `@colbymchenry/codegraph@1.3.0`。
- `CODEGRAPH_AUTO_INIT_MODE=before-serve`：兼容旧的小项目模式，MCP 启动前同步执行 `codegraph init`；大仓不推荐。
- `CODEGRAPH_INIT_WAIT_TIMEOUT_MS`：阻塞初始化默认超时，未设置时为 30 分钟；也可由工具参数 `timeout_ms` 覆盖。
- `CODEGRAPH_INIT_WAIT_POLL_MS`：阻塞初始化状态轮询间隔，未设置时为 250 ms。
- `CODEGRAPH_WRAPPER_LOG`：额外日志文件路径。

## MySQL MCP（`@benborla29/mcp-server-mysql`）

用真实数据库 schema 讲透数据模型，只在配置了**只读**账号时使用。

**工具 / 资源**：

- 资源 `mysql://tables`：列出所有表及列元数据；
- 工具 `mysql_query`：执行只读 SQL（默认只读，写操作需显式打开环境开关——本 Skill 一律不开）。常用 `SHOW TABLES`、`DESCRIBE <table>`、少量带 `LIMIT` 的 `SELECT` 采样。

**推荐用途**（可用时）：增强 `domain-data-model` 与 `config-runtime`——把代码里的 entity/mapper 与真实表结构、外键关系对齐。

**不可用时**：从 Java entity、mapper/XML、SQL 字符串、配置文件与 context pack 推断数据模型，并标 `mysql_mcp_used: false`。

## 安全约束

- 只用只读数据库账号；保持所有写操作环境开关关闭。
- 绝不在分析产物里向用户索取密钥；不把原始表数据写进最终报告（除非明确需要且脱敏安全）。
- MySQL MCP 自带 PII 脱敏，但仍以“不落库业务数据到报告”为默认。

## 示例 MCP 配置

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
    },
    "mcp_server_mysql": {
      "command": "npx",
      "args": ["-y", "@benborla29/mcp-server-mysql"],
      "env": {
        "MYSQL_HOST": "127.0.0.1",
        "MYSQL_PORT": "3306",
        "MYSQL_USER": "readonly_user",
        "MYSQL_PASS": "replace_with_secret",
        "MYSQL_DB": "app_db"
      }
    }
  }
}
```

高级用户也可以绕过 wrapper，手动运行 `codegraph init` 后配置：

```json
{
  "mcpServers": {
    "codegraph": {
      "command": "codegraph",
      "args": ["serve", "--mcp"]
    }
  }
}
```
