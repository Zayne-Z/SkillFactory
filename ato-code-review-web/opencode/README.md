# opencode 配置说明

本目录提供 `ato-code-review-web` 在 opencode 中使用的示例配置。

## 使用方式

1. 将 `opencode.example.json` 的 `agent` 配置合并到项目根目录的 `opencode.json`，或按需复制到全局配置。
2. 若 skill 安装路径不是 `./ato-code-review-web`，请调整每个 `prompt` 的 `{file:...}` 路径。
3. 在 opencode 中使用 `web-codereview-main` 作为主编排 agent。

## 并行执行约定

- `web-codereview-main` 是 primary agent，负责读写 `.codereview/state.json`、运行脚本、并通过 Task 工具调用子 agent。
- `web-codereview-review-core`、`web-codereview-review-framework`、`web-codereview-review-reliability`、`web-codereview-review-security` 是 subagent；同一批次内可以并行执行。
- 每个 subagent 只写自己的 `OUTPUT_PATH`，例如 `.codereview/results/batch-001-core.json`，避免并行写冲突。
- `fix-advisor` 必须等同批次所有适用检视专家完成后再运行。

