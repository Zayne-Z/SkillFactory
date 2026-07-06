# opencode 配置说明

本目录提供 `ato-code-review-java` 在 opencode 中使用示例配置。

## 使用方式

1. 将 `opencode.example.json` 的 `agent` 配置合并到项目根目录的 `opencode.json`，或按需复制到全局配置。
2. 若 skill 安装路径不是 `./ato-code-review-java`，请调整每个 `prompt` 的 `{file:...}` 路径。
3. 在 opencode 中使用 `java-codereview-main` 作为主编排器。

**主编排 prompt 即整份 `SKILL.md`**。启动规则集中在 `SKILL.md` 开头的 **§0 主编排启动清单**；子执行器统一使用 `prompts/*.md`。

改 `SKILL.md` 或 `opencode.json` 后请**新开一轮 opencode 对话**（同一会话不会自动刷新 system prompt）。

## 续跑 / 重新检视

- 启动时**仅**检测 `.codereview/state.json`（不探测 `codereview/` 历史报告）
- 存在则问：续跑 / 重新检视
- completed 状态也必须先问续跑 / 重新检视；只有用户明确选择续跑后才交付已有报告路径
- 重新检视：`node scripts/reset-run.js`（保留 `memory.json`，清除过程文件）

## Phase 1 六问 + 脚本门禁

- 主编排须按 `SKILL.md` §0.2 让分支、检视深度、跳过低风险、是否 HTML、每批最大行数、是否深入分析疑问代码都有值；可以分多轮问，不要求一次性发完。用户跳过时用默认值：当前分支 / `master`、`critical_high_only`、`true`、`true`、`1200`、`true`。
- 未完成 Phase 1 时，`get-diff-files.js` 等会报 `PHASE1_REQUIRED` 并 exit 2（硬拦截，不依赖模型自觉）。
- 复述确认后：`update-state.js` 设 `review_options.user_confirmed=true`，再跑 Phase 2。

若上次只问了分支：选「重新检视」或 `reset-run.js`，新开对话重跑。

## 项目记忆

- `.codereview/memory.json`：用户手动维护的项目规则
- Phase 5 拉起专家前：`build-memory-context.js` 生成 brief
- 详见 `docs/memory-system.md`

## state.json 落盘

主编排 **必须**用 `scripts/update-state.js` 写 state（见 `SKILL.md` §2.6）。子执行器只写各自 `OUTPUT_PATH`。

## 并行执行约定

- `java-codereview-main`：读写 state、跑脚本、派发子执行器。
- 同批次 `core` / `security` / `spring` / `data` 可并行；`issue-curator` → `fix-advisor` 须串行。
- `failed` 为终态；需要重跑时先按 `SKILL.md` 说明改回 `pending`。
- `report-html`：仅 `generate_html_report=true` 且 MD 已生成后。

## 升级提示

合并 `opencode.example.json` 中新增子执行器（`issue-curator`、`report-html` 等）到现有配置；旧 `state.json` 由主编排启动时自动补字段（含 `max_lines_per_batch: 1200`）。
