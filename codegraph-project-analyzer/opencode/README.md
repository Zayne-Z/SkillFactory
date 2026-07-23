# opencode 使用说明

将 `opencode.example.json` 中的 agent 配置合并到项目 opencode 配置。主 agent 读取 `../SKILL.md` 并按状态机执行。

关键约定：

- 主编排器只维护 `.projectanalysis/state.json` 与阶段推进。
- 子执行器 prompt 来自 `prompts/*.md`。
- `prompts/analysis-curator.md` 是串行合成入口，负责生成 `.projectanalysis/analysis-result.json`。
- 首次运行先生成 overview 报告和 `.projectanalysis/deep-tasks.json`，然后在 `deep_scope_confirm` 询问用户是否深挖。
- 深挖使用 `prompts/feature-implementation.md`，按 `.projectanalysis/deep-tasks.json` 分批写 `.projectanalysis/deep-results/*.json`。
- HTML 报告优先由 `scripts/render-report-html.js` 生成；`prompts/report-html.md` 仅作失败兜底。
- 安装 `pa-codegraph` Gateway 与 `pa-mysql-readonly` Skill。CodeGraph 优先使用 `opencode.example.json` 中的公司 wrapper MCP，以获得实时 watcher；MCP 不可用时 Gateway 才降级 standalone。MySQL 由 Skill 管理用户级多连接配置并启动一次性只读 MCP，不写入 OpenCode 配置。检测不到增强时静默降级，详见 `../docs/mcp-integration.md`。

示例命令：

```text
node "{SKILL_ROOT}/scripts/build-inventory.js" --root "{PROJECT_ROOT}" --output ".projectanalysis/index/files.json"
```

`opencode.example.json` 使用当前 OpenCode 的 `mcp` / `type: local` / 命令数组格式，并展示默认 `working-directory` 模式。固定单仓库时可将 CodeGraph 的 `environment` 改为：

```json
{
  "CODEGRAPH_PROJECT_SELECTION": "configured",
  "CODEGRAPH_PROJECT_ROOT": "/absolute/path/to/project"
}
```
