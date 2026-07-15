# opencode 使用说明

将 `opencode.example.json` 中的 agent 配置合并到项目 opencode 配置。主 agent 读取 `../SKILL.md` 并按状态机执行。

关键约定：

- 主编排器只维护 `.projectanalysis/state.json` 与阶段推进。
- 子执行器 prompt 来自 `prompts/*.md`。
- `prompts/analysis-curator.md` 是串行合成入口，负责生成 `.projectanalysis/analysis-result.json`。
- 首次运行先生成 overview 报告和 `.projectanalysis/deep-tasks.json`，然后在 `deep_scope_confirm` 询问用户是否深挖。
- 深挖使用 `prompts/feature-implementation.md`，按 `.projectanalysis/deep-tasks.json` 分批写 `.projectanalysis/deep-results/*.json`。
- HTML 报告优先由 `scripts/render-report-html.js` 生成；`prompts/report-html.md` 仅作失败兜底。
- `opencode.example.json` 里的 `codegraph` 与 `mcp_server_mysql` 为可选增强：在 `environment_check` 探测并写入 `state.mcp.*`，检测不到则静默降级，主流程不依赖它们。`codegraph` 默认使用 `@pa/codegraph-mcp-wrapper@latest`，会先连接 MCP；若缺少健康的本地 `.codegraph/`，agent 按 `options.codegraph_policy` 决定询问、阻塞等待初始化、后台初始化或跳过。用户拒绝时调用 `pa_codegraph_init_skip`。详见 `../docs/mcp-integration.md`。

示例命令：

```text
node "{SKILL_ROOT}/scripts/build-inventory.js" --root "{PROJECT_ROOT}" --output ".projectanalysis/index/files.json"
```
