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
  "branches": { "branch1": "", "branch2": "master" },
  "review_options": {
    "severity_mode": "all",
    "skip_low_risk_files": false,
    "generate_html_report": false,
    "max_lines_per_batch": 900,
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
| `max_lines_per_batch` | number | Phase 2 `batch-processor.js --max-lines`；默认 **900** |
| `user_confirmed` | boolean | Phase 1 五项确认后为 `true`；**为 false 时禁止 Phase 2** |

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

失败则先重跑 `render-report-html.js`；仍失败再重拉 `web-codereview-report-html`（最多 2 次）。**禁止** HTML 正文用「请查看同名 .md」占位已有 MD 章节。

`render-report-html.js` 替换壳内 `{{REPORT_TITLE}}`、`{{BODY_HTML}}` 等，并校验最终 HTML **不得残留** `{{PLACEHOLDER}}`（`placeholdersOk: true`）。可用 `--state .codereview/state.json` 补全 MD 基础变量；`{{COUNT_*}}` 等统计须由 Phase 7 在 MD 中写实。

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

执行顺序：`core → framework → reliability → security → curator → fix`

## 断点恢复

### Run 生命周期（续跑 / 重新检视）

**唯一探测信号**：`.codereview/state.json` 是否存在（**不**探测 `codereview/` 历史报告）。

| 用户选择 | 动作 |
|----------|------|
| 续跑 | 读 state 跳转；`completed` 时交付 `synthesis.report_path` |
| 重新检视 | `reset-run.js`：删过程文件，**保留** `memory.json`，再 `--init` state |

`.codereview/memory.json`：项目规则，详见 `docs/memory-system.md`。

- `reviewing`：找第一个 `pending` / `in_progress` 专家继续
- `synthesizing`：MD 存在则按 `generate_html_report` 进入 `html_rendering` 或 `completed`
- `html_rendering`：校验 HTML 完整性后 `completed` 或重试
- 兼容补丁：补 `curator`、`generate_html_report`、`user_confirmed`、`html_status` 等缺失字段

## in_progress 防死锁

检查 `.codereview/results/{BATCH_ID}-{core|framework|reliability|security|curated|fix}.json` 是否合法 → `completed`，否则重置 `pending`。

## 运行时辅助文件

- `.codereview/memory.json`：项目检视规则（reset-run **保留**）
- `.codereview/memory-brief-*.json`：Phase 5 运行时 brief（reset 清除）
- `.codereview/line-authors.json`：Phase 7 前由 `git-line-authors.js` 生成（提交人映射）
- `.codereview/diffs/*.patch`：Phase 2 预计算 diff
