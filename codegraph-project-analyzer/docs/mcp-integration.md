# 可选 CodeGraph Gateway / MySQL 增强

`codegraph-project-analyzer` 的主流程**不依赖任何外部 MCP**，必经路径始终是：

`build-inventory.js -> build-json-index.js -> context packs -> analysis-result.json -> Markdown -> HTML`

外部能力只是**可选增强**：`pa-codegraph` Gateway 优先使用公司 wrapper MCP，未连接时降级 standalone CLI；`pa-mysql-readonly` 仍使用一次性本地入口。都不可用就按内置确定性索引继续。CodeGraph 推荐用于大仓、小上下文模型、需要真实调用链/影响面的项目分析；不是硬依赖。

> 命名区分：本 Skill 自带的 `scripts/mcp-server.js` 暴露的是 `find_symbol`/`trace_callers` 等**内置**能力（读 `.projectanalysis/index`）；下文的 CodeGraph MCP 指公司 `@pa/codegraph-mcp-wrapper`，两者不是同一个东西。

## 推荐入口

- `pa-codegraph`：先检测同时存在的 `pa_codegraph_check` / `pa_codegraph_ensure`，使用 wrapper MCP 的 watcher 和实时索引；MCP 未安装、失败或当前会话尚未加载时，才通过 `scripts/codegraph-skill.js` 降级固定版本 CLI。
- `pa-mysql-readonly`：先检测用户级多连接 JSON 或旧 `MYSQL_*` 环境变量，再通过 `scripts/mysql-skill.js` 启动一次性 MySQL MCP 子进程。用户不配置常驻 MCP，写权限在子进程环境和 SQL 发送前同时关闭。
- CodeGraph Skill 不发送自定义统计；MySQL Skill 保留既有旁路统计。

## 探测约定（graceful degradation）

在 `environment_check` 阶段，主编排器按 Gateway 流程判断 CodeGraph，并独立判断 MySQL Skill/MCP，随后写入 state：

- `mcp.codegraph`：`available` / `unavailable`
- `mcp.mysql`：`available` / `unavailable`
- `mcp.codegraph_source` / `mcp.mysql_source`：`skill`、`mcp`、降级来源或 `none`

判定为 `unavailable` 的情形都必须**跳过对应 MCP、不报错**：

- Gateway 的 wrapper MCP 与 standalone 都不可用；只有裸 `codegraph_*` 不算 wrapper 可用；
- codegraph 已挂载但目标项目没有 `.codegraph/` 索引，且 `codegraph_policy` 不要求初始化或用户拒绝初始化；
- mysql 已挂载，但连接失败 / 无只读账号。

每个用到 MCP 的子执行器都要在自己的输出 JSON 里记录 `codegraph_mcp_used` / `mysql_mcp_used`（布尔），便于 curator 说明结论来源。

## CodeGraph Gateway

基于 tree-sitter 的 AST 级代码知识图谱，可弥补内置正则索引的精度短板（真实调用者/被调者/影响半径）。

**首选后端**：公司 `@pa/codegraph-mcp-wrapper@1.0.0` 的 `working-directory` 模式。wrapper 使用固定的 `@colbymchenry/codegraph@1.3.0` 并代理 `serve --mcp`，提供 watcher、共享后台服务和逐文件陈旧提示。Agent 每次调用都传当前目标目录绝对路径 `working_directory`；无法确定时询问用户。

只有裸 `codegraph_*`、没有 `pa_codegraph_check` / `pa_codegraph_ensure` 时不使用该 MCP。Gateway 先询问安装 wrapper；用户拒绝、连接失败或新配置尚未加载时，使用随附 standalone CLI 完成本次任务。

**工具**：默认只暴露 `codegraph_explore`（勘察 / 流程分析 / 符号源码 / 影响半径 / 关系图，一个工具覆盖大部分需求）。其余 `codegraph_search`、`codegraph_node`、`codegraph_callers`、`codegraph_callees`、`codegraph_impact`、`codegraph_files`、`codegraph_status` 默认不列出，可用环境变量 `CODEGRAPH_MCP_TOOLS=explore,search,callers,callees,impact` 开启。

**推荐用途**（可用时）：

- 用 `codegraph_explore` / `codegraph_callers` / `codegraph_callees` 校正内置 `edges.jsonl` 的调用关系，减少正则假边；
- 用 `codegraph_impact` 增强 `dependency-hotspots` 的影响面分析；
- 大仓中减少子执行器直接 Read 源码的次数。

**standalone 降级**：缺索引时按策略初始化；同一任务第一次图查询前执行 `sync`，后续查询带 `--skip-sync`。若任务修改源码，结束时再执行一次 `sync`。降级前必须说明没有持续 watcher、共享 daemon 和逐文件陈旧提示。

**两种后端都不可用时**：继续用 `.projectanalysis/index` 与 `scripts/query-index.js`，并在输出里标 `codegraph_mcp_used: false`。

## `codegraph_policy`

`options.codegraph_policy` 控制 CodeGraph 生命周期：

- `no-codegraph`：始终跳过外部 CodeGraph，只用内置 JSON 索引。
- `codegraph-enhanced`：只在已有 `.codegraph/` 且 Gateway 任一后端可查询时使用；不初始化。
- `codegraph-first`：MCP 优先，缺失时询问安装并允许 standalone 降级；缺索引时阻塞初始化。
- `ask`：缺索引时询问用户；确认后初始化，拒绝则调用 MCP skip 或 standalone `--no-init` 并继续。

推荐默认 `codegraph-first`，让 wrapper 自动检查当前项目并阻塞初始化。需要用户控制是否创建索引时再显式选择 `ask`。

### `@pa/codegraph-mcp-wrapper` 1.0.0 行为

- 项目选址由 `--project-selection` > `CODEGRAPH_PROJECT_SELECTION` > 默认 `working-directory` 决定；非法值在启动时失败。
- `working-directory` 模式下，每个管理工具和原生工具都要求绝对路径 `working_directory`。wrapper 优先用 `git rev-parse --show-toplevel` 解析 Git 根，非 Git 项目再向上寻找最近的项目标记。
- 该模式不使用 MCP Roots、MCP 启动 cwd、`--project-root` 或 `CODEGRAPH_PROJECT_ROOT`。缺路径时返回 `needs_working_directory` 和 `confirmation_required=true`；Agent 必须询问用户，不能接受父目录的 healthy 索引。
- `configured` 模式下，固定项目优先级为 `--project-root` > `CODEGRAPH_PROJECT_ROOT`。缺配置时返回 `configured_project_root_missing`，不回退 cwd 或调用参数。
- `pa_codegraph_ensure` 在一个调用内完成精确检查、缺失初始化和阻塞等待。所有初始化状态按项目绝对路径隔离。
- 原生 `codegraph_*` schema 隐藏上游 `projectPath`。wrapper 删除 `working_directory` 后注入解析出的内部 `projectPath`；若目标项目缺索引且未关闭自动初始化，会先阻塞初始化再转发。
- 默认底层包固定为 `@colbymchenry/codegraph@1.3.0`，部署时不使用标签或版本范围。
- 默认启动不执行 `codegraph init`，避免大仓阻塞 MCP 握手。
- 通过 `pa_codegraph_check({ working_directory })` 检测是否是代码仓库，并仅在解析后的项目根本地存在 `.codegraph/` 时执行 `codegraph status`；目录存在但状态失败仍视为未完成初始化。
- 用户确认后调用 `pa_codegraph_ensure({ working_directory })`；它会启动或加入当前项目初始化，并阻塞到完成、失败或超时。Gateway 不使用仅表示后台已发起的 `pa_codegraph_init_start` 作为完成信号。
- 用户拒绝时调用 `pa_codegraph_init_skip`，显式记录本次不初始化。
- 初始化日志只写 stderr 或 `CODEGRAPH_WRAPPER_LOG`，不会污染 MCP stdout。
- 初始化失败时只影响 CodeGraph 增强；Gateway 先尝试固定 standalone，仍失败则回到内置索引。
- wrapper 失败、超时或返回 `failed` 时不得搜索目标项目 `node_modules` / `.bin` 或 npm cache 中的 CodeGraph。
- 1.0.0 会双向透传 MCP 通知和 server request，动态 schema 同时描述输入与输出；完成后的索引失效会由 status 降级为 `failed`。
- 初始化锁同时检查 owner PID，长时间运行但 owner 存活的任务不会因超过 stale 时间被其他 wrapper 抢占。

可选环境变量：

- `CODEGRAPH_PROJECT_SELECTION`：`working-directory` 或 `configured`，默认前者。
- `CODEGRAPH_PROJECT_ROOT`：仅在 `configured` 模式生效的固定项目根。
- `CODEGRAPH_PACKAGE`：底层包默认固定 `@colbymchenry/codegraph@1.3.0`。部署配置不应覆盖，也不得使用 `latest`；仅接受带明确版本号的 npm 包。
- `CODEGRAPH_AUTO_INIT_MODE=before-serve`：仅在 `configured` 模式且固定根有效时执行；其他模式明确跳过。
- `CODEGRAPH_INIT_WAIT_TIMEOUT_MS`：阻塞初始化默认超时，未设置时为 30 分钟；也可由工具参数 `timeout_ms` 覆盖。
- `CODEGRAPH_INIT_WAIT_POLL_MS`：阻塞初始化状态轮询间隔，未设置时为 250 ms。
- `CODEGRAPH_WRAPPER_LOG`：额外日志文件路径。

## MySQL Skill 与 MCP 回退（`@benborla29/mcp-server-mysql`）

用真实数据库 schema 讲透数据模型，只在配置了**只读**账号时使用。

**首选入口**：`pa-mysql-readonly` 1.1.0。环境检查先调用 `config status --json`：

- `ready`：对选中连接运行 `doctor`，成功后再调用 `tables/schema/query`；
- `unconfigured`：询问用户是否按 Skill 引导新增字段 profile 或连接串；
- `selection_required`：让用户选择本次 `--connection` 或持久 `config use`；
- 用户拒绝、配置无效或连接失败：标记 `mcp.mysql=unavailable`，继续代码侧分析。

连接默认保存在 `~/.pa-mysql-readonly/connections.json`，也可由 `PA_MYSQL_CONFIG_FILE` 指向其他用户级绝对路径。密码优先使用环境变量引用；不得把 profile、连接别名、主机、数据库或凭据写入分析 state/report。旧 `MYSQL_*` 配置继续兼容。

**工具 / 资源**：

- 资源 `mysql://tables`：列出所有表及列元数据；
- 工具 `mysql_query`：执行只读 SQL（默认只读，写操作需显式打开环境开关——本 Skill 一律不开）。常用 `SHOW TABLES`、`DESCRIBE <table>`、少量带 `LIMIT` 的 `SELECT` 采样。

**推荐用途**（可用时）：增强 `domain-data-model` 与 `config-runtime`——把代码里的 entity/mapper 与真实表结构、外键关系对齐。

**不可用时**：从 Java entity、mapper/XML、SQL 字符串、配置文件与 context pack 推断数据模型，并标 `mysql_mcp_used: false`。

## 安全约束

- 只用只读数据库账号；保持所有写操作环境开关关闭。
- 绝不在分析产物里向用户索取密钥；不把原始表数据写进最终报告（除非明确需要且脱敏安全）。
- MySQL MCP 自带 PII 脱敏，但仍以“不落库业务数据到报告”为默认。

## CodeGraph MCP 配置原则

Gateway 只接受公司 wrapper，并固定以下参数：

```text
registry: http://maven.paic.com.cn/repository/npm
package: @pa/codegraph-mcp-wrapper@1.0.0
project selection: working-directory
CodeGraph: 1.3.0（由 wrapper 固定）
```

不要使用 `latest`，也不要把裸 `codegraph serve --mcp` 配置为 Gateway 后端。各客户端的正式注册命令、超时单位与验证命令见 `pa-codegraph/references/mcp-installation.md`。

以下是采用 `mcpServers` 格式客户端的示意配置；OpenCode 必须改用当前的 `mcp`、`type: local` 和命令数组格式：

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

固定仓库场景改为：

```json
{
  "mcpServers": {
    "codegraph": {
      "command": "npx",
      "args": ["-y", "--registry", "http://maven.paic.com.cn/repository/npm", "@pa/codegraph-mcp-wrapper@1.0.0", "serve", "--mcp"],
      "env": {
        "CODEGRAPH_PROJECT_SELECTION": "configured",
        "CODEGRAPH_PROJECT_ROOT": "/absolute/path/to/project"
      }
    }
  }
}
```

`configured` 仅适合一个 MCP 实例永久绑定单仓库的场景。Gateway 默认使用 `working-directory`，每次调用重新传当前项目绝对路径，以免客户端启动目录或外层工作区被误认为目标仓库。
