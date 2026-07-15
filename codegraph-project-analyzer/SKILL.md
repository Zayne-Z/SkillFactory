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
- **CodeGraph 是推荐增强，不是硬依赖。** 内置 JSON 索引是 baseline；`colbymchenry/codegraph` 用于大仓/小上下文/高精度调用链场景。默认通过 `@pa/codegraph-mcp-wrapper` 接入，按 `options.codegraph_policy` 决定是否先初始化并等待。检测不到或初始化失败时继续主流程。
- **外部 MCP 必须可降级。** 检测到 CodeGraph 就用它校正调用链/影响面；检测到 `@benborla29/mcp-server-mysql` 就用真实 schema 增强数据模型分析。任一 MCP 不可用时都要继续，不得让报告生成失败。探测与降级规则见 `docs/mcp-integration.md`。

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
- CodeGraph 策略：默认 `ask`

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
2. 确认 `options.codegraph_policy`，默认 `ask`。允许值：
   - `no-codegraph`：不尝试外部 CodeGraph，只跑内置 JSON 索引。
   - `codegraph-enhanced`：只在已有 `.codegraph/` 或 CodeGraph 已可用时增强，不等待初始化。
   - `codegraph-first`：检测到 wrapper 且项目缺索引时，先初始化并等待完成，再继续分析；适合大仓、小上下文、要求调用链准确的任务。
   - `ask`：默认。缺索引时询问用户；用户确认后走 `codegraph-first`，拒绝则走 `no-codegraph`。
3. **探测可选 MCP**：检查当前 agent runtime 的可用工具，判定并落盘：
   - 见到 `pa_codegraph_check` 表示使用 wrapper；按策略调用 `pa_codegraph_check`、`pa_codegraph_init_wait`（优先阻塞等待）、`pa_codegraph_init_start` / `pa_codegraph_init_status`（旧版回退）、`pa_codegraph_init_skip`；
   - 见到 `codegraph_*` 工具（如 `codegraph_explore`）且索引可用 → `mcp.codegraph=available`，否则 `unavailable`；
   - 见到 `mysql_query` 工具或 `mysql://tables` 资源 → `mcp.mysql=available`，否则 `unavailable`；
   - 无法判定时保守写 `unavailable`。探测本身出错也不得中断流程。

```text
node "{SKILL_ROOT}/scripts/update-state.js" --set mcp.codegraph=available --set mcp.mysql=unavailable --phase inventory --checkpoint env_checked
```

> codegraph 仅在目标项目已建 `.codegraph/` 索引时才返回图数据。`codegraph-first` 会在进入 inventory 前等待初始化完成；`codegraph-enhanced` 不等待；`ask` 必须尊重用户选择。未建索引且未初始化时等同 `unavailable`，退回内置 JSON 索引。

### CodeGraph 策略执行细则

- `no-codegraph`：写 `mcp.codegraph=unavailable`，继续。
- `codegraph-enhanced`：若已有 `codegraph_*` 且可查询，写 `available`；否则写 `unavailable`，继续。
- `codegraph-first`：若有 wrapper 工具且 `pa_codegraph_check.recommend_init_prompt=true`，优先调用 `pa_codegraph_init_wait` 并只在返回 `status=completed` 后继续；若没有该工具，则调用 `pa_codegraph_init_start` 并轮询 `pa_codegraph_init_status`。失败或超时则写 `unavailable` 并继续。
- `ask`：若 `pa_codegraph_check.recommend_init_prompt=true`，询问用户“是否先初始化 CodeGraph 并等待完成，以减少后续读源码 token 并提高调用链准确性？”；确认后按 `codegraph-first` 等待完成，拒绝后调用 `pa_codegraph_init_skip` 并继续。

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

| agent | prompt | output | 可选 MCP（可用时） |
|-------|--------|--------|--------|
| `module_summaries` | `prompts/module-summarizer.md` | `.projectanalysis/results/module-summaries.json` | codegraph：核对关键调用流 |
| `entrypoints_routes` | `prompts/entrypoints-routes.md` | `.projectanalysis/results/entrypoints-routes.json` | codegraph：核对入口→处理器调用链 |
| `domain_data_model` | `prompts/domain-data-model.md` | `.projectanalysis/results/domain-data-model.json` | mysql：真实表结构/外键 |
| `dependency_hotspots` | `prompts/dependency-hotspots.md` | `.projectanalysis/results/dependency-hotspots.json` | codegraph：`codegraph_impact` 影响面 |
| `config_runtime` | `prompts/config-runtime.md` | `.projectanalysis/results/config-runtime.json` | mysql：核对数据源/连接 |
| `reading_path` | `prompts/reading-path.md` | `.projectanalysis/results/reading-path.json` | —（消费其它 agent 结果） |

子执行器读到 `state.mcp.*=available` 才尝试对应 MCP；调用失败即视为不可用、退回内置索引，并在输出里记 `codegraph_mcp_used` / `mysql_mcp_used`。

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

## 11. 查询适配器与 MCP

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

### 11.2 外部 MCP 增强（可用时）

- **CodeGraph MCP（`colbymchenry/codegraph`）**：默认工具 `codegraph_explore`（勘察/流程/影响半径），可选开启 `codegraph_search`/`codegraph_callers`/`codegraph_callees`/`codegraph_impact` 等。用于核对调用链与影响面。推荐 MCP 配置使用 `@pa/codegraph-mcp-wrapper@latest`，由 wrapper 先代理原生工具，再通过 `pa_codegraph_check` / `pa_codegraph_init_wait` 支持阻塞初始化，或通过 `pa_codegraph_init_start` / `pa_codegraph_init_status` 支持后台初始化；未挂载或初始化失败时降级到 §11.1 的内置 JSON index。
- **MySQL MCP（`@benborla29/mcp-server-mysql`）**：资源 `mysql://tables` 浏览表结构 + 只读 `mysql_query`（`SHOW TABLES`/`DESCRIBE`/带 `LIMIT` 的 `SELECT`）。用于对齐真实数据模型；不可用时降级到代码侧（entity/mapper/SQL/配置）推断。只用只读账号，不把原始业务数据写入报告。
