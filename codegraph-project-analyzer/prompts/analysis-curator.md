# Analysis Curator

读取 `.projectanalysis/results/*.json`、`.projectanalysis/index/modules.json`、`.projectanalysis/index/entrypoints.json`，写出 `.projectanalysis/analysis-result.json`。

合并重复的模块描述，保留缺失 agent 的 notes，产出：

- `project_name`
- `summary`：3-6 句话，让没接触过的人明白「这是什么系统、给谁用、核心能做什么、用什么技术栈」
- `architecture_map`：模块数组，每项含 `module_id`、`purpose`、`key_files`
- `key_scenarios`：2-4 条端到端场景串讲，每条把「用户动作 → 入口 → 经过的模块/关键类 → 数据落点/返回」讲成一段可读叙事（基于 results 与索引证据，不臆造）
- `feature_implementations`：若存在 `.projectanalysis/deep-results/*.json` 或 `.projectanalysis/feature-implementations.json`，合并为功能实现详解数组；没有深挖结果时保持空数组，不要臆造。
- `reading_path`：新工程师建议的阅读顺序，说明每步为什么
- `concepts`：核心业务概念
- `risks`：耦合热点、缺测试、单点等关注项（这是导览提示，不是治理审计）

若某些 results 带 `codegraph_mcp_used: true` 或 `mysql_mcp_used: true`，说明该结论有 AST/真实 schema 实证，可在 `summary` 或 `risks` 里适当体现「已用 codegraph/数据库核对」；否则默认结论基于启发式索引，遇不确定项在 `risks` 标注需人工复核。

不要写 HTML；HTML 由确定性脚本生成。所有结论以磁盘上的 results 与索引为准。
