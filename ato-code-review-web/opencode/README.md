# opencode 配置说明

本目录提供 `ato-code-review-web` 在 opencode 中使用的示例配置。

## 使用方式

1. 将 `opencode.example.json` 的 `agent` 配置合并到项目根目录的 `opencode.json`，或按需复制到全局配置。
2. 若 skill 安装路径不是 `./ato-code-review-web`，请调整每个 `prompt` 的 `{file:...}` 路径。
3. 在 opencode 中使用 `web-codereview-main` 作为主编排器。

**主编排 prompt 即整份 `SKILL.md`**。启动规则见 **§0**；子执行器统一使用 `prompts/*.md`。

## 续跑 / 重新检视

- 启动时**仅**检测 `.codereview/state.json`（不探测 `codereview/` 历史报告）
- 存在则问：续跑 / 重新检视
- 重新检视：`node scripts/reset-run.js`（保留 `memory.json`）

## Phase 1 六问

分支、检视深度、跳过低风险、是否 HTML、**每批最大行数**、是否深入分析疑问代码都必须有值；可以分多轮问，不要求一次性发完。用户跳过时用默认值：当前分支 / `master`、`critical_high_only`、`true`、`true`、`1200`、`true`。详见 `SKILL.md` §0.2。

## 项目记忆

- `.codereview/memory.json`：用户手动维护
- Phase 5 拉起专家前：`build-memory-context.js` → `MEMORY_BRIEF_PATH`
- 详见 `docs/memory-system.md`

## 并行执行约定

- `web-codereview-main`：读写 state、跑脚本、派发子执行器
- 同批次 `core` / `framework` / `reliability` / `security` 可并行
- `failed` 为终态；需要重跑时先按 `SKILL.md` 说明改回 `pending`
- `issue-curator` → `fix-advisor` 须串行

## 升级提示

合并 `opencode.example.json` 中新增子执行器；旧 `state.json` 启动时自动补字段（含 `max_lines_per_batch: 1200`）。
