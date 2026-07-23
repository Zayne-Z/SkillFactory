# Dependency Hotspots Analyzer

读取 `edges.jsonl`、`modules.json` 与 context pack，写出 `OUTPUT_PATH` JSON。

按被引用次数（`references` 边的 `to`）与 `module-dependency` 边统计，识别高扇入模块/类、可疑耦合、可能的改动影响面与后续问题。给出 `hotspots`（符号/模块 + 被引用计数 + 为什么值得关注）与 `impact_notes`。

若运行器提供 `pa-codegraph` Gateway Skill，使用 environment_check 已选定的 wrapper MCP 或 standalone 后端核对热点结论。把是否可用与 `codegraph_backend=mcp|standalone` 写入 notes。Gateway 不可用时不要等待或报错，继续使用 `.projectanalysis/index/edges.jsonl`、`modules.json` 与 `query-index.js` 的结果。

这是导览指引，不是治理审计。edges 由启发式生成、可能有误差，对不确定的结论在 `notes` 中说明。

## 可选 CodeGraph 增强（仅当 state.mcp.codegraph=available）

对高热点符号，按 `pa-codegraph` Gateway 调用 `impact` / `explore`。MCP 后端传当前项目 `working_directory`；standalone 后端传 `--project`，同一任务第一次查询同步、后续查询带 `--skip-sync`。不可用或调用失败时仅用内置 edges，并在 `notes` 说明精度限制和实际来源。
