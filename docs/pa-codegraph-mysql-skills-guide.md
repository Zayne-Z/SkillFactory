# PA CodeGraph 与 MySQL 只读 Skill 原理手册

本文介绍两个可独立安装的 Skill：

- `pa-codegraph`：MCP 优先的 CodeGraph Gateway。优先路由公司 wrapper MCP，MCP 不可用时才降级到随附的 standalone CLI。
- `pa-mysql-readonly`：不要求用户配置常驻 MySQL MCP，通过一次性本地客户端安全检查 MySQL 结构和执行只读查询。

两者都负责识别任务、选择正确入口并约束执行流程，但运行模式不同。CodeGraph 需要常驻 MCP watcher 才能持续跟踪代码变化；MySQL Skill 则适合按请求启动一次性进程。

## 1. Skill 与 MCP 的关系

| 能力 | Skill | MCP |
|---|---|---|
| 主要作用 | 告诉 Agent 何时触发、如何路由和降级 | 向 Agent 暴露长期运行的工具 |
| 自动发现依据 | `SKILL.md` 的名称与描述 | 客户端 MCP 配置和工具 schema |
| CodeGraph 用法 | Gateway，先探测 wrapper MCP | 首选后端，提供 watcher 和共享 daemon |
| MySQL 用法 | 启动一次性只读客户端 | 只是 Skill 内部通信实现 |
| 失败处理 | 按 Skill 规则降级 | 由调用方决定 |

`pa-codegraph` 没有重新实现 CodeGraph。它为公司 wrapper MCP 增加自动触发、精确项目路径、初始化确认和 standalone 降级。`pa-mysql-readonly` 则为上游 MySQL MCP 增加 SQL 前置校验和强制只读配置。

## 2. 自动触发是怎样发生的

```text
用户提出任务
    ↓
客户端把已安装 Skill 的名称和 description 提供给 Agent
    ↓
Agent 判断任务意图是否匹配
    ↓
匹配时加载 SKILL.md
    ↓
按正文探测工具并执行确定性流程
```

### `pa-codegraph` 的触发范围

所有涉及代码的任务都应触发，包括：

- 理解仓库、模块、符号、调用链或架构；
- 修改一个或多个源码文件；
- 定位缺陷、排查异常或解释测试失败；
- 编写、运行或分析测试；
- 评估变更影响和受影响测试。

文档翻译、普通数据库查询、会议整理、图片处理和纯表格任务不触发。

触发 Skill 不代表每个任务都必须查询图。MCP 索引健康后，路径明确的简单改单文件任务可以交回 Agent 普通工具；调用链、架构和影响分析才优先使用 `explore`、`callers`、`impact` 等图工具。

### `pa-mysql-readonly` 的触发范围

应触发：查看库表字段、索引和外键，执行只读聚合或抽样，分析 `EXPLAIN`，核对代码实体和真实表结构。用户要求执行 MySQL 写操作时也触发，但只用于明确拒绝。

不应触发：明确属于 PostgreSQL、SQLite 等其他数据库，只讨论数据库理论，分析代码调用链，或处理 CSV/Excel 数据。

两个 Skill 都保留 `evals/trigger-evals.json`，用于开发期检查正反触发边界。自动触发仍取决于客户端是否支持并加载 Skill。

## 3. `pa-codegraph` Gateway 如何工作

### 3.1 后端优先级

```text
公司 CodeGraph wrapper MCP
    ↓ 不存在、连接失败或新配置尚未加载
standalone CLI
    ↓ 初始化、同步或查询失败
Agent 普通代码工具
```

只有同时存在 `pa_codegraph_check` 和 `pa_codegraph_ensure`，才认为公司 wrapper MCP 已加载。只有裸 `codegraph_*` 工具时仍视为未安装，不绕过 wrapper 使用。

### 3.2 精确确定当前项目

每次 CodeGraph 调用前，Agent 都必须重新确定当前目标项目的绝对路径：

1. 优先使用当前任务涉及的已打开文件和明确仓库路径；
2. 不能确定时询问用户；
3. 不使用会话启动目录、父目录 `.codegraph` 或 MCP Roots 猜测；
4. MCP 调用传 `working_directory`；standalone 调用传 `--project`。

wrapper 与 standalone 都会用 `git -C <path> rev-parse --show-toplevel` 识别 Git、worktree 和 submodule 根。非 Git 项目只向上寻找最近的 `package.json`、`pom.xml`、Gradle settings、`pyproject.toml`、`go.mod`、`Cargo.toml` 等项目标记，不向下扫描其他仓库。

### 3.3 wrapper MCP 路由

```text
pa_codegraph_check({ working_directory })
    ↓ 核对返回 project_root 是否为当前项目
索引健康
    ├─ 是：按任务需要调用图工具
    └─ 否：询问是否初始化
            ├─ 同意：pa_codegraph_ensure({ working_directory })，阻塞等待完成
            └─ 拒绝：pa_codegraph_init_skip({ working_directory })，交回普通工具
```

MCP 模式依赖 watcher 自动更新，不主动执行 CLI `sync`。初始化或查询失败时不得搜索目标项目 `node_modules`、`.bin`、npm cache 中的 CodeGraph，直接进入既定降级流程。

### 3.4 MCP 未安装时

Gateway 会先说明 wrapper MCP 提供的能力：

- 持续文件 watcher；
- 多次调用共享的 daemon；
- 文件陈旧状态提示；
- 自动维护实时图谱。

然后询问用户是否安装固定版本 MCP。用户同意后按 `references/mcp-installation.md` 使用客户端官方 CLI 增量注册，不覆盖完整配置。若客户端不能热加载，本次任务先降级 standalone，下次 reload 或新会话自动切换 MCP。

用户拒绝安装时仍可继续，但必须先说明 standalone 没有持续 watcher、外部修改只能在下一次前置 `sync` 时进入图谱，也没有 MCP 的逐文件陈旧提示。

### 3.5 standalone 同步与初始化

入口：

```bash
node "{SKILL_ROOT}/scripts/codegraph-skill.js" explore \
  --project "/absolute/path/order-service" \
  "OrderController 到支付落库的调用流程"
```

同一 Skill 任务第一次 standalone 图查询严格执行：

```text
精确解析项目根 → check/init → status → sync → query
```

缺少索引时，只要已确认该路径是代码项目，就阻塞运行 `init` 并在 `status` 健康后继续。用户明确要求“不创建 `.codegraph`”时使用 `--no-init` 并退出 CodeGraph 流程。

同一任务后续图查询带 `--skip-sync`，避免 `explore → callers → impact` 重复同步。若任务实际修改了源码，全部编辑完成后再独立运行一次：

```bash
node "{SKILL_ROOT}/scripts/codegraph-skill.js" sync --project "/absolute/path/order-service"
```

纯分析任务没有修改文件时不做结束同步。

### 3.6 安装固定版本 MCP

统一配置：

```text
registry: http://maven.paic.com.cn/repository/npm
wrapper: @pa/codegraph-mcp-wrapper@1.0.0
CodeGraph: @colbymchenry/codegraph@1.3.0
CODEGRAPH_PROJECT_SELECTION=working-directory
```

禁止使用 `latest` 和裸 CodeGraph MCP。首次注册前可以预热：

```bash
npx -y --registry http://maven.paic.com.cn/repository/npm @pa/codegraph-mcp-wrapper@1.0.0 --version
```

不同客户端的配置要点：

| 客户端 | 注册与超时 |
|---|---|
| Claude Code | 使用 `claude mcp add`；相关 MCP 超时字段使用毫秒 |
| Codex | 使用 `codex mcp add`；`startup_timeout_sec=60`、`tool_timeout_sec=1800` |
| OpenCode | 使用当前 `mcp`、`type: local` 和命令数组格式，不使用旧 `mcpServers` |
| OpenClaw | 使用 `openclaw mcp add` 后运行 `doctor --probe`；连接 60 秒、工具 1800 秒 |

安装后必须执行客户端对应的 list、probe 或 doctor。当前会话看不到 `pa_codegraph_check` 和 `pa_codegraph_ensure` 时，明确提示 reload 或重启。

## 4. `pa-mysql-readonly` 如何工作

### 4.1 完整调用链

```text
MySQL 结构或只读数据请求
    ↓
本地校验 action、SQL 和表名
    ├─ 写入、DDL、多语句、危险函数：立即拒绝
    └─ 合法只读请求：继续
    ↓
config status 检测用户级多连接配置
    ├─ 未配置或需选择：由 Skill 交互引导
    └─ ready：解析默认、临时覆盖或旧 MYSQL_* 环境变量
    ↓
将选中 profile 转换为 MYSQL_* 子进程环境
    ↓
覆盖全部写权限变量为 false
    ↓
npx -y @benborla29/mcp-server-mysql@2.0.9
    ↓
initialize → notifications/initialized → tool/resource call
    ↓
输出结果并关闭一次性进程
```

### 4.2 只读保护

| 层级 | 保护措施 |
|---|---|
| Skill 指令 | 只允许结构检查、聚合或安全抽样 |
| SQL 前置校验 | 只允许单条 `SELECT/SHOW/DESCRIBE/DESC/EXPLAIN/只读 WITH` |
| 危险模式拦截 | 拒绝写入、DDL、文件访问、锁、存储过程、延时函数和可执行注释 |
| MCP 环境变量 | 强制 INSERT、UPDATE、DELETE、DDL 和多库写入为 `false` |
| PII 保护 | 默认脱敏，禁止 `SELECT *` 和直接引用敏感列 |
| 数据库授权 | 要求数据库侧只读账号作为最终边界 |

危险 SQL 会在读取凭据、运行 `npx`、启动进程和连接数据库之前被拒绝。

### 4.3 多连接配置

默认配置文件为 `~/.pa-mysql-readonly/connections.json`，可通过 `PA_MYSQL_CONFIG_FILE` 指向其他用户级绝对路径。一个文件可保存多个命名 profile；第一个自动成为默认连接。

```text
--connection
→ PA_MYSQL_CONNECTION
→ 旧 MYSQL_* / MYSQL_CONNECTION_STRING
→ JSON defaultConnection
→ 唯一 profile
```

首次使用先执行 `config status --json`。未配置时，Skill 依次询问连接别名、字段或连接串、主机/端口/用户/数据库和凭据来源。默认只保存密码环境变量名；用户明确确认后才允许用 `--allow-inline-secret` 保存明文。

配置通过 stdin 写入，文件在 POSIX 下使用 `0600`，目录使用 `0700`。列表和状态只显示连接名称、模式与凭据来源，不显示主机、数据库、用户或秘密。保存后立即对新连接运行 `doctor`，失败时保留 profile 供后续修复。

单次切换使用 `--connection <name>`；持久切换使用 `config use --connection <name>`。原有 `MYSQL_*` 用户无需迁移，Skill 不会把环境变量中的密码自动写入 JSON。

### 4.4 常用命令

| 任务 | 命令 |
|---|---|
| 检查连接配置 | `config status --json` |
| 列出连接 | `config list --json` |
| 新增连接 | `config add --connection ... --stdin` |
| 切换默认连接 | `config use --connection ...` |
| 验证连接 | `doctor` |
| 查看数据库 | `databases` |
| 查看表 | `tables` |
| 查看字段 | `schema --table ...` |
| 查看索引 | `indexes --table ...` |
| 执行只读 SQL | `query --sql ...` 或 `query --stdin` |
| 查询执行计划 | `explain --sql ...` |

推荐顺序是 `config status → doctor → tables → schema/indexes → explain/query → 总结`。

JSON 支持字段 profile、`mysql://` / `mysql2://` URL 和上游 MySQL CLI 连接串。环境变量引用仍是推荐方式；直接提供含凭据连接串时，Skill 必须先说明对话记录和本地明文风险并再次确认。

## 5. 用量统计如何工作

CodeGraph Skill 不产生本地或远程自定义统计事件。公司平台通过 Skill 调用本身完成统计，MCP 与 standalone 的实际后端只记录在分析 notes 中。

MySQL Skill 保留既有旁路统计。事件只包含操作名、成功状态、耗时、客户端、平台和匿名安装标识，不包含 SQL、表名、连接信息或查询结果。默认日志位置为：

```text
~/.pa-skill-usage/events.jsonl
```

MySQL 集中统计可使用 `PA_SKILL_USAGE_ENDPOINT`、`PA_SKILL_USAGE_TOKEN` 和 `PA_SKILL_CLIENT`。统计失败不会改变原查询结果；`PA_SKILL_TELEMETRY=off` 可关闭 MySQL 自定义统计。

## 6. Windows 与依赖版本

两个入口都使用 Node.js 原生 `path` API，并在 `win32` 平台通过 Windows shell 启动 `npx`。运行前确认 `node`、`npx` 已加入 `PATH`，CodeGraph 项目建议安装 Git for Windows。

PowerShell 示例：

```powershell
node "{SKILL_ROOT}\scripts\codegraph-skill.js" check --project "C:\work\order-service"
node "{SKILL_ROOT}\scripts\mysql-skill.js" config status --json
node "{SKILL_ROOT}\scripts\mysql-skill.js" doctor
```

MySQL JSON 默认位于当前用户主目录。POSIX 会强制明文配置为 `0600`；Windows 保存明文时会提示检查文件 ACL，生产连接仍推荐环境变量引用。

两个 Skill 都要求精确 npm 版本，不接受标签、版本范围、URL 或本地路径。公司镜像使用其他已审批版本时，只能通过以下环境变量显式覆盖为完整版本号：

```text
PA_CODEGRAPH_WRAPPER_PACKAGE=@pa/codegraph-mcp-wrapper@x.y.z
PA_MYSQL_MCP_PACKAGE=@benborla29/mcp-server-mysql@x.y.z
```

## 7. 与项目分析 Skill 的配合

`codegraph-project-analyzer` 的增强优先级是：

```text
CodeGraph wrapper MCP → CodeGraph standalone → 内置 JSON 索引/普通工具
MySQL standalone → 已配置 MySQL MCP或内置分析
```

通过 Gateway 获得 CodeGraph 能力时，`mcp.codegraph_source=skill` 保持不变；实际使用 `mcp` 或 `standalone` 记录在 notes。MySQL Skill 先解析用户级 profile，但不得把连接名称或端点写入分析状态。任一增强失败时，项目分析主流程仍继续。

## 8. `evals/` 是否需要保留

`evals/` 是 Skill 的开发期回归数据，不是运行时依赖：

- `evals/evals.json` 验证工具调用、路由、同步和安全边界；
- `evals/trigger-evals.json` 验证该触发和不该触发的场景；
- 运行时脚本不会读取这些文件；
- 生成的 `.skill` 归档中不包含测试数据。

源码仓库应保留 `evals/`，方便升级流程后回归。分发 `.skill` 包时不需要额外携带。

## 9. 当前验证范围

自动测试覆盖：

- CodeGraph MCP 探测规则、固定版本和客户端配置文档；
- standalone 绝对路径、Git 根、父目录索引隔离、阻塞初始化和超时；
- 首次查询 `init/status → sync → query`、后续 `--skip-sync` 和显式结束同步；
- CodeGraph 不再生成自定义统计；
- MySQL 多连接配置、选择优先级、完整握手、只读 SQL、安全环境变量、超时和脱敏；
- Windows shell、触发正反例、Skill 规范和归档内容。

部署环境还需验证公司 npm 镜像已同步固定版本、各客户端已刷新 Skill/MCP，并使用只读测试账号验证 MySQL 网络、TLS 与授权。

上游参考：

- [CodeGraph 官方 README](https://github.com/colbymchenry/codegraph/blob/main/README.md)
- [MCP Server for MySQL](https://github.com/benborla/mcp-server-mysql)
