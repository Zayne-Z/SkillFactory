# 状态文件结构与断点恢复

## 文件路径

`.codereview/state.json`

## 完整结构

```json
{
  "version": "2.0",
  "skill": "ato-code-review-java",
  "created_at": "2026-04-06T10:00:00.000Z",
  "updated_at": "2026-04-06T10:00:00.000Z",

  "current_phase": "branch_selection",
  "last_checkpoint": "init",

  "branches": {
    "branch1": "<current-branch>",
    "branch2": "master"
  },

  "review_options": {
    "severity_mode": "critical_high_only",
    "skip_low_risk_files": true,
    "generate_html_report": true,
    "max_lines_per_batch": 1200,
    "deep_doubt_analysis": true,
    "user_confirmed": false
  },

  "tech_stack": {},

  "diff_analysis": {
    "total_files": 0,
    "total_changed_lines": 0,
    "total_batches": 0,
    "inventory_path": ".codereview/file-inventory.json",
    "completed": false
  },

  "review_progress": {},

  "synthesis": {
    "status": "pending",
    "report_path": "",
    "html_report_path": "",
    "html_status": "skipped"
  },

  "notes": []
}
```

## last_checkpoint

| 字段 | 类型 | 说明 |
|------|------|------|
| `last_checkpoint` | string | 主编排器最近一次写盘时的检查点名称，如 `phase2_done`、`batch-001-core-done`。用于确认 opencode 是否真正落盘；若流程已推进但该字段仍为 `init`，说明 `state.json` 未更新 |

## review_options

| 字段 | 类型 | 说明 |
|------|------|------|
| `severity_mode` | string | `all`：报告所有严重级别；`critical_high_only`：仅 Critical + High |
| `skip_low_risk_files` | boolean | `true` 时 Phase 2 对 `get-diff-files.js` 传 `--skip-low-risk true`，排除 DTO/Entity/测试等（详见清单 `review_scope`） |
| `generate_html_report` | boolean | `true` 时 Phase 7 完成后进入 `html_rendering`，拉起 HTML 子执行器产出同名 `.html`；`false` 时跳过 |
| `max_lines_per_batch` | number | Phase 2 `batch-processor.js --max-lines`；默认 **1200** |
| `deep_doubt_analysis` | boolean | 默认 **true**；专家遇到疑问代码时可读取所属源文件局部窗口或做一次有界引用下钻 |
| `user_confirmed` | boolean | Phase 1 六项清单已向用户询问并复述确认后为 `true`；**为 `false` 时禁止进入 Phase 2**（兼容性补丁填 `false` 不能代替用户确认） |

Phase 1 须让分支 + 上表各项选项（含 `max_lines_per_batch`、`deep_doubt_analysis`）都有值；可分多轮收集，用户跳过时使用默认值。复述后设 `user_confirmed: true` 再进入 `diff_analysis`。断点续跑时子执行器通过主编排器传入的 `SEVERITY_MODE` 等变量读取此配置。

## synthesis

| 字段 | 类型 | 说明 |
|------|------|------|
| `status` | string | 报告合成整体状态（`pending` / `completed` 等） |
| `report_path` | string | Phase 7 产出的 `.md` 路径 |
| `html_report_path` | string | Phase 7.5 产出的 `.html` 路径（与 MD 同名，扩展名不同） |
| `html_status` | string | `skipped`：未开启 HTML；`pending` / `in_progress` / `completed` / `failed` |

### HTML 完整性校验（主编排器判定 Phase 7.5 是否成功）

通过条件（**五者必须同时满足**）：

1. 文件首部含 `<!DOCTYPE html>`
2. 文件末尾 16KB 内含 `</html>`
3. 文件末尾 16KB 内含哨兵注释 `<!-- ato-codereview-html-end -->`
4. `render-report-html.js` stdout 中 `allIssueCodeMissing` 为 `false`
5. stdout 中 `section6IssueRowsComplete` 为 `true`（即 `issueRows >= expectedIssueRows`，第六节多张问题表会合并计数）

任一缺失：判定失败。主编排应**先**重跑 `node "{SKILL_ROOT}/scripts/render-report-html.js" --md … --shell … --out …`（覆盖写出）；脚本仍失败时再重拉 `java-codereview-report-html`（不复用既有半成品）。跨子执行器调用（重试）一律从空白重写。

**禁止** HTML 正文中出现 `section.truncated` 或「请查看同名 .md」占位（除非 MD 本身缺失对应 `##` 章节且脚本与子执行器均已报错）。

`render-report-html.js` 会替换壳内 `{{REPORT_TITLE}}`、`{{META_SUMMARY}}`、`{{BODY_HTML}}` 等，并校验**最终 HTML 不得残留** `{{PLACEHOLDER}}`，issue 详情「问题代码」不得全部为「（无）」，且第六节问题清单行数不得少于第三节合计或第五节 issue 条目数。脚本可选用 `--state .codereview/state.json` 从 state/inventory/tech-stack 补全 MD 中尚未替换的基础变量；统计类占位（如 `{{COUNT_*}}`）须由 Phase 7 合成官在 MD 中写实。

### MD 完整性校验（主编排器判定 Phase 7 是否成功）

Phase 7 优先运行 `render-report-md.js` 机械合成 Markdown。通过条件：

1. stdout `ok: true`
2. `unresolvedPlaceholders` 为空
3. `allIssueCodeMissing` 为 `false`
4. 当 stdout `issues > 0` 时，第六节「问题清单（全量）」至少包含同等数量的问题行，且 HTML 详情里的「问题代码」不得全部为「（无）」

失败才拉起 `java-codereview-report-synthesizer` 兜底；兜底也必须保证第六节不为空。

## file-inventory.json 补充字段（非 state.json）

- `review_scope`：`get-diff-files.js` 写入，含 `skip_low_risk_files`、`skipped_low_risk_files` 等，供报告说明。
- `diff_bundle`：`export-batch-diffs.js` 写入，含预计算 patch 目录与 `manifest.json` 路径。

## 阶段值（current_phase）

| 值 | 含义 | 进入条件 |
|----|------|---------|
| `branch_selection` | 等待用户输入分支 | Phase 0 初始化后 |
| `diff_analysis` | 获取变动文件 | Phase 1 分支确认后 |
| `tech_stack` | 技术栈分析 | Phase 2 分批完成后 |
| `task_planning` | 任务规划 | Phase 3 完成后 |
| `reviewing` | 多专家检视（含每批次的修复建议） | Phase 4 完成后 |
| `synthesizing` | 报告合成 | 所有批次完成后 |
| `html_rendering` | HTML 报告渲染 | Phase 7 MD 已就绪且 `generate_html_report === true` |
| `completed` | 全部结束 | Phase 7 完成（无 HTML）或 Phase 7.5 完成/跳过/失败后 |

## review_progress 结构

Phase 4 完成后，主编排器根据 `task-plan.json` 初始化：

```json
"review_progress": {
  "batch-001": {
    "files": ["src/.../UserController.java", "src/.../UserServiceImpl.java"],
    "core":     "pending",
    "spring":   "pending",
    "security": "pending",
    "data":     "pending",
    "curator":  "pending",
    "fix":      "pending"
  },
  "batch-002": {
    "files": ["src/.../UserMapper.java", "src/.../UserMapper.xml"],
    "core":     "pending",
    "spring":   "skipped",
    "security": "skipped",
    "data":     "pending",
    "curator":  "pending",
    "fix":      "pending"
  }
}
```

## 专家状态值

| 值 | 含义 | 后续动作 |
|----|------|---------|
| `pending` | 待执行 | 主编排器拉起子执行器|
| `in_progress` | 执行中 | 子执行器正在跑 |
| `completed` | 已完成 | 跳过 |
| `skipped` | 不适用 | 跳过（如纯 POJO 跳过 data） |
| `failed` | 执行失败（已重试 2 次） | 跳过，记录到 notes[] |

专家键名：`core` / `spring` / `security` / `data` / `curator` / `fix`

> `curator`：Phase 5.5 的策展专家（issue-curator），固定在 4 位检视专家全部 `completed`/`skipped` 之后、`fix` 之前执行；不会被 `task-plan` 标为 `skipped`（即便所有检视专家都 skipped，curator 仍需跑一次以输出空 issue 的 curated.json，给 fix-advisor 与合成官提供统一入口）。

## 断点恢复逻辑（主编排器每次启动必执行）

### Run 生命周期（续跑 / 重新检视）

**唯一探测信号**：`.codereview/state.json` 是否存在（**不**探测 `codereview/` 历史报告目录）。

| 用户选择 | 动作 |
|----------|------|
| 续跑 | 读 state，`current_phase` 跳转；`completed` 时交付 `synthesis.report_path` |
| 重新检视 | `reset-run.js`：删 state/diffs/results 等，**保留** `memory.json`，再 `--init` state |

`.codereview/memory.json`：项目规则，用户手动维护；详见 `docs/memory-system.md`。

```
1. 若 state.json 存在 → §0.0 问续跑 / 重新检视
2. 读取 state.json，根据 current_phase 跳转到对应 Phase
3. 若 current_phase == "reviewing"：
   a. 扫描 review_progress（批次顺序与 task-plan / inventory 一致）
   b. 对每个批次按专家顺序（core → security → spring → data → curator → fix）查找：**第一个**状态为 `pending` 或 `in_progress` 的专家；`completed` / `skipped` / `failed` 均跳过（`failed` 为终态，不再自动改 pending）
   c. 若选中项为 "in_progress"：按下方「in_progress 防死锁」处理后再继续
   d. 从该处拉起子执行器或继续主流程
4. 若 current_phase == "synthesizing"：
   若 synthesis.report_path 指向的 MD 已存在且非空：
     - 若 review_options.generate_html_report === true → current_phase = "html_rendering"，进入步骤 4b
     - 否则 → synthesis.html_status = "skipped"，synthesis.status = completed，current_phase = "completed"
   否则 → 重跑报告合成（Phase 7）
4b. 若 current_phase == "html_rendering"：
   按「HTML 完整性校验」检查 synthesis.html_report_path：
     - 通过 → html_status = completed，synthesis.status = completed，current_phase = completed
     - 不通过 → 重跑 render-report-html.js 或重拉 java-codereview-report-html（最多 2 次；仍失败 → html_status = failed，current_phase = completed，MD 仍交付）
5. 幂等（可选优化）：current_phase == "tech_stack" 且 .codereview/tech-stack.json 已存在且合法 → 可直接进入 task_planning；
   current_phase == "task_planning" 且 task-plan.json 已存在 → 可补全 review_progress 后进入 reviewing（避免重复跑子执行器）
6. 升级兼容：
   a. 若 review_progress[*] 缺少 curator 键 → 每批次补 curator: "pending"
   b. 若 review_options 缺少 generate_html_report → 补 true
   c. 若 review_options 缺少 max_lines_per_batch → 补 1200
   d. 若 review_options 缺少 deep_doubt_analysis → 补 true
   e. 若 review_options 缺少 user_confirmed → 补 false（补完后仍须执行 Phase 1 清单）
   f. 若 synthesis 缺少 html_report_path / html_status → 补 "" 与 "skipped"
   → 写回 state.json 后再进入步骤 3/4/4b
```

## in_progress 防死锁

如果主编排器读到某个专家状态为 `in_progress`，说明上次执行中途中断（主编排器或子执行器崩溃）。此时：

- 检查对应结果文件是否存在且 JSON 合法：
  - 检视专家：`.codereview/results/{BATCH_ID}-{core|spring|security|data}.json`
  - **curator**：`.codereview/results/{BATCH_ID}-curated.json`
  - **fix**：`.codereview/results/{BATCH_ID}-fix.json`
  - 满足 → 标记 `completed`；否则 → 重置为 `pending` 并重新执行

## updated_at

主编排器每次写回 state.json 时更新此字段为当前 ISO 时间戳，便于追踪最后操作时间。
