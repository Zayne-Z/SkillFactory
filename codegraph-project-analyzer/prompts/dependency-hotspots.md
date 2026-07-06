# Dependency Hotspots Analyzer

读取 `edges.jsonl`、`modules.json` 与 context pack，写出 `OUTPUT_PATH` JSON。

按被引用次数（`references` 边的 `to`）与 `module-dependency` 边统计，识别高扇入模块/类、可疑耦合、可能的改动影响面与后续问题。给出 `hotspots`（符号/模块 + 被引用计数 + 为什么值得关注）与 `impact_notes`。

若运行器提供 CodeGraph MCP（来自 `colbymchenry/codegraph`），优先用其符号/调用链/impact 查询核对热点结论；把是否可用写入 `codegraph_mcp_available`。若检测不到 CodeGraph MCP，不要等待或报错，继续使用 `.projectanalysis/index/edges.jsonl`、`modules.json` 与 `query-index.js` 的结果。

这是导览指引，不是治理审计。edges 由启发式生成、可能有误差，对不确定的结论在 `notes` 中说明。

## 可选 MCP（仅当 state.mcp.codegraph=available）

对高热点符号，可用 codegraph MCP（`codegraph_impact`，或 `codegraph_explore` 的影响半径）获取 AST 级真实影响面，校正启发式 edges 的假边/漏边。未挂载/未建索引/调用失败时仅用内置 edges，并在 `notes` 说明精度限制。输出加 `codegraph_mcp_used`（布尔）。
