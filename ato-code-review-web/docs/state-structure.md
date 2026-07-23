# 状态文件结构与断点恢复

## 文件路径

`.codereview/state.json`

## 完整结构

```json
{
  "version": "2.0",
  "skill": "ato-code-review-web",
  "created_at": "2026-04-06T10:00:00.000Z",
  "updated_at": "2026-04-06T10:00:00.000Z",
  "current_phase": "branch_selection",
  "last_checkpoint": "init",
  "repository": { "name": "my-frontend-app" },
  "branches": { "branch1": "<current-branch>", "branch2": "master" },
  "review_options": {
    "severity_mode": "critical_high_only",
    "skip_low_risk_files": true,
    "generate_html_report": true,
    "max_lines_per_batch": 2000,
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

## review_options

| 字段 | 类型 | 说明 |
|------|------|------|
| `severity_mode` | string | `all` 或 `critical_high_only` |
| `skip_low_risk_files` | boolean | `true` 时 Phase 2 跳过测试/E2E/Storybook 等低风险文件 |
| `generate_html_report` | boolean | `true` 时 Phase 7 完成后进入 `html_rendering`，产出同名 `.html` |
| `max_lines_per_batch` | number | Phase 2 `batch-processor.js --max-lines`；默认 **2000** |
| `deep_doubt_analysis` | boolean | 默认 **true**；专家/策展遇到疑问代码时可读取所属源文件局部窗口或做一次有界引用下钻，并对问题行之前调用的存量函数做关联复核 |
| `user_confirmed` | boolean | Phase 1 六项确认后为 `true`；**为 false 时禁止 Phase 2** |

## synthesis

| 字段 | 类型 | 说明 |
|------|------|------|
| `report_path` | string | Phase 7 产出的 `.md` |
| `html_report_path` | string | Phase 7.5 产出的 `.html` |
| `html_status` | string | `skipped` / `pending` / `completed` / `failed` |

### HTML 完整性校验

1. 首部 `<!DOCTYPE html>`
2. 末尾 16KB 内含 `</html>`
3. 末尾 16KB 内含 `<!-- ato-codereview-html-end -->`
4. `render-report-html.js` stdout 中 `allIssueCodeMissing` 为 `false`
5. stdout 中 `section6IssueRowsComplete` 为 `true`（即 `issueRows >= expectedIssueRows`，第六节多张问题表会合并计数）
6. stdout 中 `sectionIssueIdsMatch` 为 `true`，`duplicateIssueIds` 与 `incompleteIssues` 均为空（第五、六章 ID 多重集合一致，不含重复 ID 或占位定位）

失败则先重跑 `render-report-html.js`；仍失败再重拉 `web-codereview-report-html`（最多 2 次）。**禁止** HTML 正文用「请查看同名 .md」占位已有 MD 章节。

`render-report-html.js` 替换壳内 `{{REPORT_TITLE}}`、`{{BODY_HTML}}` 等，并校验最终 HTML **不得残留** `{{PLACEHOLDER}}`（`placeholdersOk: true`），issue 详情「问题代码」不得全部为「（无）」，且第六节问题清单行数不得少于第三节合计或第五节 issue 条目数。可用 `--state .codereview/state.json` 补全 MD 基础变量；`{{COUNT_*}}` 等统计须由 Phase 7 在 MD 中写实。

### MD 完整性校验

Phase 7 优先运行 `render-report-md.js` 机械合成 Markdown。通过条件：

1. stdout `ok: true`
2. `unresolvedPlaceholders` 为空
3. `section6IssueRowsComplete` 为 `true`
4. `discardedIssueCount` 与 `.codereview/discarded-issues.json` 一致；被忽略候选不进入统计、第五章或第六章

失败才拉起 `web-codereview-report-synthesizer` 兜底；兜底也必须保证第六节不为空。

### 报告证据产物

- `file-inventory.json.batches[].segmented` / `diff_slice`：单文件变更超过批次预算时由 exporter 写入，表示拆分后的 patch 子片段；重复导出保留原批次 ID 和切片边界。
- `file-inventory.json.batches[].files[].line_ranges`：拆分子批在 branch1/new-side 上独占的问题起始行闭区间；resolver 会以 `outside_batch_scope` 丢弃越界候选。
- `file-inventory.json.files[].old_path`：重命名文件的旧路径；resolver 将旧路径问题映射到当前 `path`。
- `.codereview/resolved-issues.json`：报告与作者识别的唯一问题数据源，每条包含 `source_key`。
- `.codereview/discarded-issues.json`：无法恢复问题的缺失字段、原因与已尝试证据源。

## 阶段值（current_phase）

| 值 | 含义 |
|----|------|
| `branch_selection` | 等待 Phase 1 |
| `diff_analysis` | Phase 2 |
| `tech_stack` | Phase 3 |
| `task_planning` | Phase 4 |
| `reviewing` | Phase 5–6 |
| `synthesizing` | Phase 7 |
| `html_rendering` | Phase 7.5（`generate_html_report === true`） |
| `completed` | 全部结束 |

## review_progress

专家键名：`core` / `framework` / `reliability` / `security` / `curator` / `fix`

```json
"review_progress": {
  "batch-001": {
    "files": ["src/views/Home.vue"],
    "core": "pending",
    "framework": "pending",
    "reliability": "pending",
    "security": "pending",
    "curator": "pending",
    "fix": "pending"
  }
}
```

执行顺序：`core → framework → reliability → security → curator → fix`。`curator` 标为 `completed` 前必须已成功跑完 `resolve-report-issues.js --batch`；不得在仅有 curated、尚无 `{BATCH}-resolved.json` 时直接拉起 fix。

## 断点恢复

### Run 生命周期（续跑 / 重新检视）

**唯一探测信号**：`.codereview/state.json` 是否存在（**不**探测 `codereview/` 历史报告）。

| 用户选择 | 动作 |
|----------|------|
| 续跑（仅用户明确选择后） | 读 state 跳转；`completed` 时交付 `synthesis.report_path` |
| 重新检视 | `reset-run.js`：删过程文件，**保留** `memory.json`，再 `--init` state |

completed 也不例外：不得因报告文件存在而绕过续跑 / 重新检视选择。只有用户选择“续跑”后，主编排器才可在 completed 状态交付既有报告路径。

`.codereview/memory.json`：项目规则，详见 `docs/memory-system.md`。

- `reviewing`：找第一个 `pending` / `in_progress` 专家继续
- `synthesizing`：MD 存在则按 `generate_html_report` 进入 `html_rendering` 或 `completed`
- `html_rendering`：校验 HTML 完整性后 `completed` 或重试
- 兼容补丁：补 `curator`、`generate_html_report`、`deep_doubt_analysis`、`user_confirmed`、`html_status` 等缺失字段

## in_progress 防死锁

检查 `.codereview/results/{BATCH_ID}-{core|framework|reliability|security|curated|fix}.json` 是否合法 → `completed`，否则重置 `pending`。

## 运行时辅助文件

- `.codereview/memory.json`：项目检视规则（reset-run **保留**）
- `.codereview/memory-brief-*.json`：Phase 5 运行时 brief（reset 清除）
- `.codereview/line-authors.json`：Phase 7 前由 `git-line-authors.js` 生成（提交人映射）
- `.codereview/diffs/*.patch`：Phase 2 预计算 diff
