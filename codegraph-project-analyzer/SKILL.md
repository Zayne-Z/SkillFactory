---
name: codegraph-project-analyzer
description: >-
  Use when the user asks to analyze, understand, map, document, onboard to, or create an architecture/project guide for an existing Java, Spring, Vue, React, or Web codebase. Also use for full-project analysis, code map, project index, AI-readable repo index, human-readable project documentation, small-context model code understanding, CodeGraph-assisted repository analysis, VS Code Builder, or opencode project analysis.
---

# Codegraph Project Analyzer · 主编排工作流

本 Skill 用于把 Java Spring、Vue/React 等 Web 项目分析成两类交付物：

- 人看的 `project-analysis/report_<project>_<date>.md` 与 `.html`
- 人看的深挖手册 `project-analysis/report_<project>_full_<date>.md` 与 `.html`（用户选择后生成）
- AI 用的 `.projectanalysis/index/*.json(l)`、`.projectanalysis/context-packs/*.json`、`.projectanalysis/deep-tasks.json`、`.projectanalysis/deep-results/*.json`、`.projectanalysis/analysis-result.json`

### 核心边界

- **主编排器不做深度分析。** 它只负责状态机、脚本执行、子执行器调度、故障恢复与最终校验。一切事实产物以磁盘文件为准，不以聊天内容为准。
- **首次运行先出项目导览。** 不要一开始深挖全仓。先生成 overview 报告和模块地图，再询问用户是否继续深挖、选择哪些模块/任务，或分析全部。
- **深挖任务可续跑。** 功能实现详解由 `.projectanalysis/deep-tasks.json` 驱动，任务粒度可细到入口链路、后台线程、外部接口、Redis/缓存、数据落库、临时表清理、重试补偿。每个任务独立写 `.projectanalysis/deep-results/*.json`。
- **主流程零 MCP 依赖。** `inventory → JSON 索引 → context packs → overview → deep task planning → report` 的必经路径不依赖任何 MCP。没有 MCP 客户端时全流程仍须完整跑通。
- **CodeGraph 是推荐增强，不是硬依赖。** 内置 JSON 索引是 baseline；`pa-codegraph` Gateway Skill 优先路由公司 wrapper MCP，未连接时再降级固定版本 standalone CLI。两种入口都不可用时继续主流程。
- **外部增强必须可降级。** CodeGraph 使用 MCP 优先、standalone 降级；MySQL 仍优先使用 `pa-mysql-readonly` standalone Skill。检测不到任一增强或调用不可用时都要继续，不得让报告生成失败。探测与降级规则见 `docs/mcp-integration.md`。

## 0. 启动清单

1. 检查 Node.js 可用：

```text
node --version
```

2. 若 `.projectanalysis/state.json` 存在，先问用户续跑或重新分析。completed 也必须先问，不得直接交付旧报告。
3. 若重新分析，运行：

```text
node "{SKILL_ROOT}/scripts/reset-run.js"
```

4. 初始化 state：

```text
node "{SKILL_ROOT}/scripts/update-state.js" --init --checkpoint phase0_init
```

## 1. scope_confirm：范围确认

在 `scope.user_confirmed !== true` 时，只做范围确认，不进入扫描：

- 分析模式：V1 默认 `full_project`
- 技术栈：默认 Java + Web
- 交付物：默认 Markdown + HTML + JSON 索引
- 索引存储：V1 默认 `json`
- context pack 上限：默认 `6000` 字符
- CodeGraph 策略：默认 `codegraph-first`（自动检查当前项目，缺索引时阻塞初始化）

确认后写盘：

```text
node "{SKILL_ROOT}/scripts/update-state.js" --set scope.user_confirmed=true --phase environment_check --checkpoint scope_confirmed
```

## 2. 状态机

`current_phase` 固定流转：

`scope_confirm -> environment_check -> inventory -> graph_index -> module_planning -> overview_analysis -> overview_rendering -> deep_scope_confirm -> deep_task_planning -> deep_parallel_analysis -> deep_synthesis -> final_rendering -> completed`

每个阶段完成后必须用 `scripts/update-state.js` 写 `.projectanalysis/state.json`。

## 3. environment_check：环境、MCP 与 CodeGraph 策略

范围确认后进入本阶段，做三件事：

1. 确认 `node --version` 可用（不可用则停下报告用户）。
2. 确认 `options.codegraph_policy`，默认 `codegraph-first`。允许值：
   - `no-codegraph`：不尝试外部 CodeGraph，只跑内置 JSON 索引。
   - `codegraph-enhanced`：只在已有 `.codegraph/` 或 CodeGraph 已可用时增强，不等待初始化。
   - `codegraph-first`：通过 `pa-codegraph` Gateway 检测 wrapper MCP；缺失时询问安装并可降级 standalone。项目缺索引时初始化并等待完成，再继续分析。
   - `ask`：需要用户控制是否创建索引时使用。缺索引时询问用户；用户确认后走 `codegraph-first`，拒绝则走 `no-codegraph`。
3. **探测可选增强**：按 CodeGraph Gateway 与 MySQL standalone 的规则判定并落盘：
   - `{PROJECT_ROOT}` 必须取 scope_confirm 已确认的当前项目绝对路径。不得拿 agent 启动目录、父目录或上次分析的仓库代替；
   - 若运行时提供 `pa-codegraph` Skill，按其 Gateway 流程先检测同时存在的 `pa_codegraph_check` / `pa_codegraph_ensure`。MCP 可用时先检查并核对返回项目根；不可用时询问安装，未加载或拒绝安装时才调用 standalone。成功后写 `mcp.codegraph_source=skill`，并在 notes 记录 `codegraph_backend=mcp|standalone`；
   - 若运行时提供 `pa-mysql-readonly` Skill，先调用 `config status --json`。`ready` 后按选中连接调用 `doctor/tables/schema/query`，并写 `mcp.mysql_source=skill`；`unconfigured` 或 `selection_required` 时询问用户是否配置或选择，用户拒绝则标记不可用。连接配置和凭据不进入 state/report；
   - 没有 `pa-codegraph` Skill 时可直接探测公司 wrapper MCP。必须同时存在 `pa_codegraph_check` 和 `pa_codegraph_ensure`；只有裸 `codegraph_*` 不视为可用。默认按 `working-directory` 模式传 `working_directory: "{PROJECT_ROOT}"`，并写 `mcp.codegraph_source=mcp`。不得传旧的 `project_root` / `projectPath`；
   - 先调用 `pa_codegraph_check` 并核对项目根。索引缺失时按策略征得用户同意，再调用 `pa_codegraph_ensure` 一次完成精确检查、自动初始化和阻塞等待；只有 `status=completed` 且 `initialization_complete=true` 才继续；
   - wrapper 初始化失败、超时或返回 `failed` 时，Gateway 可降级到随附 standalone CLI；standalone 仍失败时记录错误并继续内置流程。严禁搜索或执行目标项目 `node_modules`、`.bin`、npm cache 中的 CodeGraph；
   - wrapper 返回 `confirmation_required=true` 时，暂停 CodeGraph 步骤并询问用户“当前要分析的项目是否为 `<candidate>`？”。确认后用该绝对路径重试；不得继续接受父目录的 healthy 状态；
   - Gateway 通过 wrapper MCP 或固定版本 standalone 成功查询当前项目 → `mcp.codegraph=available`，否则 `unavailable`；
   - standalone `pa-mysql-readonly doctor` 成功，或见到 `mysql_query` / `mysql://tables` → `mcp.mysql=available`，否则 `unavailable`；
   - 无法判定时保守写 `unavailable`。探测本身出错也不得中断流程。

```text
node "{SKILL_ROOT}/scripts/update-state.js" --set mcp.codegraph=available --set mcp.codegraph_source=skill --set mcp.mysql=unavailable --set mcp.mysql_source=none --phase inventory --checkpoint env_checked
```

> codegraph 仅在目标项目已建 `.codegraph/` 索引时才返回图数据。`codegraph-first` 会在进入 inventory 前等待初始化完成；`codegraph-enhanced` 不等待；`ask` 必须尊重用户选择。未建索引且未初始化时等同 `unavailable`，退回内置 JSON 索引。

### CodeGraph 策略执行细则

- `no-codegraph`：写 `mcp.codegraph=unavailable`，继续。
- `codegraph-enhanced`：通过 Gateway 先检查 wrapper MCP，必要时检查 standalone 现有索引；不得初始化。已有健康索引且可查询才写 `available`，否则继续内置流程。
- `codegraph-first`：通过 Gateway 优先调用 wrapper `pa_codegraph_ensure({ working_directory: "{PROJECT_ROOT}" })`；MCP 不可用时询问安装，然后允许 standalone 自动初始化、同步和查询。失败或超时则写 `unavailable` 并继续。
- `ask`：通过 Gateway 检查目标项目；缺索引时询问用户。确认后初始化；拒绝时 MCP 调用 `pa_codegraph_init_skip`，standalone 后续带 `--no-init`，然后继续内置流程。该策略覆盖 standalone 的默认自动初始化。

## 4. 确定性脚本阶段

### inventory

```text
node "{SKILL_ROOT}/scripts/build-inventory.js" --root "{PROJECT_ROOT}" --output ".projectanalysis/index/files.json"
```

产物：`.projectanalysis/index/files.json`

### graph_index

```text
node "{SKILL_ROOT}/scripts/build-json-index.js" --files ".projectanalysis/index/files.json" --output-dir ".projectanalysis/index" --max-pack-chars 6000
```

`--max-pack-chars` 控制每个 context pack 的 `code_outline` 预算（默认 6000），确保 pack 适配小上下文模型；超出时按被引用热度优先保留并标记 `budget.truncated`。

产物：

- `.projectanalysis/index/files.json`
- `.projectanalysis/index/symbols.jsonl`
- `.projectanalysis/index/edges.jsonl`（`references` 边经停用词/最小长度/真实用法过滤，`module-dependency` 已去重）
- `.projectanalysis/index/entrypoints.json`
- `.projectanalysis/index/modules.json`
- `.projectanalysis/context-packs/*.json`（含 `code_outline` 签名大纲，供小上下文模型直接理解）

## 5. module_planning：模块规划

`graph_index` 之后、并行分析之前，读取 `modules.json` 决定分析粒度：

- 模块过多时（如上百个 Java 包），按目录层级/分层（controller/service/domain/web）聚合成“人类视角模块”，控制 context pack 与子执行器数量；
- 标记入口密度高、被引用热度高的模块为优先分析对象；
- 规划结果可写入 state 的 `notes`，供并行阶段与 curator 参考。

## 6. overview_analysis：首次导览分析

首次导览只回答“这个项目是什么、有哪些模块、入口在哪里、先读哪里”。不要深挖每个功能实现。

`overview_analysis` 阶段可并行拉起这些子执行器；每个子执行器默认读取索引、context pack（含 `code_outline`）和自己的 prompt，并写固定 JSON。**当仅凭 pack 无法确认关键逻辑时，允许用 Read 打开 pack 中列出的 1-3 个最重要源文件核对**（禁止把全仓源码塞进对话）：

| agent | prompt | output | 可选增强（可用时） |
|-------|--------|--------|--------|
| `module_summaries` | `prompts/module-summarizer.md` | `.projectanalysis/results/module-summaries.json` | codegraph：核对关键调用流 |
| `entrypoints_routes` | `prompts/entrypoints-routes.md` | `.projectanalysis/results/entrypoints-routes.json` | codegraph：核对入口→处理器调用链 |
| `domain_data_model` | `prompts/domain-data-model.md` | `.projectanalysis/results/domain-data-model.json` | mysql：真实表结构/外键 |
| `dependency_hotspots` | `prompts/dependency-hotspots.md` | `.projectanalysis/results/dependency-hotspots.json` | codegraph：`codegraph_impact` 影响面 |
| `config_runtime` | `prompts/config-runtime.md` | `.projectanalysis/results/config-runtime.json` | mysql：核对数据源/连接 |
| `reading_path` | `prompts/reading-path.md` | `.projectanalysis/results/reading-path.json` | —（消费其它 agent 结果） |

子执行器读到 `state.mcp.*=available` 才尝试对应增强来源；CodeGraph 按 notes 中的 `codegraph_backend=mcp|standalone` 使用 Gateway 已选后端。调用失败即视为不可用、退回内置索引，并在兼容字段 `codegraph_mcp_used` / `mysql_mcp_used` 中记录是否实际使用。

并行前统一标记 `in_progress`，完成后按输出 JSON 合法性标记 `completed`。失败最多重试 2 次，仍失败则 `failed`，由 curator 记录缺口。

## 7. overview_rendering：导览报告与深挖任务清单

overview 子执行器完成后，拉起 `analysis-curator` 写 `.projectanalysis/analysis-result.json`，再渲染导览报告。随后运行：

```text
node "{SKILL_ROOT}/scripts/plan-deep-tasks.js" --index ".projectanalysis/index" --output ".projectanalysis/deep-tasks.json"
```

`deep-tasks.json` 必须列出所有可深挖任务，状态初始为 `pending`，选择状态为 `awaiting_user`。任务类型包括：

- `feature_implementation`：功能实现详解
- `entrypoint_flow`：入口到落库/返回的链路
- `async_job`：后台线程、异步执行、循环任务
- `external_integration`：外部接口、SDK、第三方服务
- `state_storage`：Redis、缓存、临时状态、状态字段
- `data_persistence`：Mapper、Repository、SQL、事务边界
- `cleanup_lifecycle`：定时清理、临时表清理、过期策略
- `error_retry`：异常、重试、幂等、补偿

渲染导览 Markdown：

```text
node "{SKILL_ROOT}/scripts/render-report-md.js" --analysis ".projectanalysis/analysis-result.json" --index ".projectanalysis/index" --template "{SKILL_ROOT}/templates/report-template.md" --out "project-analysis/report_PROJECT_overview_DATE.md"
```

再渲染 HTML：

```text
node "{SKILL_ROOT}/scripts/render-report-html.js" --md "project-analysis/report_PROJECT_overview_DATE.md" --shell "{SKILL_ROOT}/templates/report-shell.html" --out "project-analysis/report_PROJECT_overview_DATE.html"
```

## 8. deep_scope_confirm：询问用户是否深挖

导览报告完成后停下，向用户说明已生成模块地图和 `deep-tasks.json`，然后询问：

- `全部`：分析全部模块/任务；
- `只分析 1,3,5`：按任务序号；
- `只分析 module-order,payment`：按模块；
- `跳过`：只保留导览报告，后续可续跑。

用户选择后写入 `state.deep_analysis` 与 `deep-tasks.json.selection`。未得到用户选择前，不进入 `deep_parallel_analysis`。

选择写盘使用确定性脚本：

```text
node "{SKILL_ROOT}/scripts/select-deep-tasks.js" --tasks ".projectanalysis/deep-tasks.json" --all
node "{SKILL_ROOT}/scripts/select-deep-tasks.js" --tasks ".projectanalysis/deep-tasks.json" --module "module-order"
node "{SKILL_ROOT}/scripts/select-deep-tasks.js" --tasks ".projectanalysis/deep-tasks.json" --task "1,3,5"
node "{SKILL_ROOT}/scripts/select-deep-tasks.js" --tasks ".projectanalysis/deep-tasks.json" --skip
```

## 9. deep_parallel_analysis：功能实现详解

根据用户选择，从 `deep-tasks.json` 中取 `pending` 任务分批执行。默认 `task_batch_size=5`，每批可并行。每个任务使用 `prompts/feature-implementation.md`，输出到任务声明的 `.projectanalysis/deep-results/*.json`。

任务完成规则：

- 成功：写结果 JSON，任务标记 `completed`。
- 失败：`attempts += 1`，最多重试 2 次；仍失败标记 `failed`。
- 中断续跑：读取 `deep-tasks.json`，跳过 `completed`，继续 `pending` / 可重试 `failed`。

深挖结果必须包含 `feature_implementations` 所需字段：入口、后台线程/异步、外部接口、Redis/缓存/临时表状态、数据落点、清理任务、关键代码、证据和置信度。没有证据的结论写入 `open_questions`。

## 10. deep_synthesis 与 final_rendering

用户选择的深挖任务完成后，合并 `.projectanalysis/deep-results/*.json` 为：

- `.projectanalysis/feature-implementations.json`
- `.projectanalysis/analysis-result.json` 的 `feature_implementations`

使用确定性脚本：

```text
node "{SKILL_ROOT}/scripts/merge-deep-results.js" --analysis ".projectanalysis/analysis-result.json" --results-dir ".projectanalysis/deep-results" --output ".projectanalysis/feature-implementations.json"
```

然后重新运行 Markdown/HTML 渲染，生成 full 报告。HTML 子执行器仅作兜底；不得让 AI 直接写完整 HTML 作为主路径。

## 11. 查询适配器与外部增强

本节是可选增强，不参与主流程完成判定。详细配置、探测、降级与安全规则见 `docs/mcp-integration.md`。

### 11.1 内置查询适配器（本 Skill 自带，无外部依赖）

CLI 查询：

```text
node "{SKILL_ROOT}/scripts/query-index.js" find_symbol --index ".projectanalysis/index" --query "OrderService"
```

stdio MCP 适配器：

```text
node "{SKILL_ROOT}/scripts/mcp-server.js" --index ".projectanalysis/index"
```

稳定工具名：`find_symbol`、`get_module_map`、`get_entrypoints`、`trace_callers`、`trace_callees`、`get_context_pack`、`find_impact_area`。

### 11.2 Gateway / Standalone Skill 增强

- **`pa-codegraph`**：优先使用公司 wrapper MCP 的实时 watcher；MCP 未安装、连接失败或当前会话尚未加载时，降级固定版本 wrapper CLI。standalone 第一次查询前自动同步，同一任务后续查询带 `--skip-sync`，实际改码后再执行一次 `sync`。
- **`pa-mysql-readonly`**：无需 MCP 配置，通过用户级多连接 JSON 或旧 `MYSQL_*` 环境变量选择连接，再用一次性本地客户端读取 `mysql://tables` 或执行只读 SQL；脚本层强制关闭写权限并拒绝写语句。用于对齐真实 schema。
- CodeGraph Skill 不发送自定义统计；MySQL Skill 的既有旁路统计不影响分析。

### 11.3 外部 MCP 增强

- **CodeGraph wrapper MCP**：Gateway 的首选后端。必须使用 `@pa/codegraph-mcp-wrapper@1.0.0` 和默认 `working-directory` 模式；裸 `colbymchenry/codegraph` MCP 不受支持。每次调用传当前项目绝对路径，无法确定目录时必须询问用户；未挂载时按 §11.2 降级 standalone。
- **MySQL MCP（`@benborla29/mcp-server-mysql`）**：资源 `mysql://tables` 浏览表结构 + 只读 `mysql_query`（`SHOW TABLES`/`DESCRIBE`/带 `LIMIT` 的 `SELECT`）。用于对齐真实数据模型；不可用时降级到代码侧（entity/mapper/SQL/配置）推断。只用只读账号，不把原始业务数据写入报告。
