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
    "branch1": "",
    "branch2": "master"
  },

  "review_options": {
    "severity_mode": "all",
    "skip_low_risk_files": false,
    "generate_html_report": false,
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
| `last_checkpoint` | string | 主 Builder 最近一次写盘检查点；流程推进后仍为 `init` 表示未落盘 |

## review_options

| 字段 | 类型 | 说明 |
|------|------|------|
| `severity_mode` | string | `all`：报告所有严重级别；`critical_high_only`：仅 Critical + High |
| `skip_low_risk_files` | boolean | `true` 时 Phase 2 对 `get-diff-files.js` 传 `--skip-low-risk true`，排除 DTO/Entity/测试等（详见清单 `review_scope`） |
| `generate_html_report` | boolean | `true` 时 Phase 7 完成后进入 `html_rendering`，拉起 HTML 专家产出同名 `.html`；`false` 时跳过 |
| `user_confirmed` | boolean | Phase 1 四项已向用户询问并复述确认后为 `true`；为 `false` 时**禁止 Phase 2** |

Phase 1 收齐分支 + 三项选项并复述后设 `user_confirmed: true`。断点续跑时子 Builder 通过主 Builder 传入的 `SEVERITY_MODE` 等变量读取此配置。

## synthesis

| 字段 | 类型 | 说明 |
|------|------|------|
| `status` | string | 报告合成整体状态（`pending` / `completed` 等） |
| `report_path` | string | Phase 7 产出的 `.md` 路径 |
| `html_report_path` | string | Phase 7.5 产出的 `.html` 路径（与 MD 同名，扩展名不同） |
| `html_status` | string | `skipped`：未开启 HTML；`pending` / `in_progress` / `completed` / `failed` |

### HTML 完整性校验（主 Builder 判定 Phase 7.5 是否成功）

通过条件（**三者必须同时满足**）：

1. 文件首部含 `<!DOCTYPE html>`
2. 文件末尾 16KB 内含 `</html>`
3. 文件末尾 16KB 内含哨兵注释 `<!-- ato-codereview-html-end -->`

任一缺失：判定失败，**整文件重写**重拉 HTML 专家（不复用既有半成品）。跨子 Builder 调用（重试）一律从空白重写。

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

Phase 4 完成后，主 Builder 根据 `task-plan.json` 初始化：

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
| `pending` | 待执行 | 主 Builder 拉起子 Builder |
| `in_progress` | 执行中 | 子 Builder 正在跑 |
| `completed` | 已完成 | 跳过 |
| `skipped` | 不适用 | 跳过（如纯 POJO 跳过 data） |
| `failed` | 执行失败（已重试 2 次） | 跳过，记录到 notes[] |

专家键名：`core` / `spring` / `security` / `data` / `curator` / `fix`

> `curator`：Phase 5.5 的策展专家（issue-curator），固定在 4 位检视专家全部 `completed`/`skipped` 之后、`fix` 之前执行；不会被 `task-plan` 标为 `skipped`（即便所有检视专家都 skipped，curator 仍需跑一次以输出空 issue 的 curated.json，给 fix-advisor 与合成官提供统一入口）。

## 断点恢复逻辑（主 Builder 每次启动必执行）

```
1. 读取 state.json
2. 根据 current_phase 跳转到对应 Phase
3. 若 current_phase == "reviewing"：
   a. 扫描 review_progress（批次顺序与 task-plan / inventory 一致）
   b. 对每个批次按专家顺序（core → security → spring → data → curator → fix）查找：**第一个**状态为 `pending` 或 `in_progress` 的专家；`completed` / `skipped` / `failed` 均跳过（`failed` 为终态，不再自动改 pending）
   c. 若选中项为 "in_progress"：按下方「in_progress 防死锁」处理后再继续
   d. 从该处拉起子 Builder 或继续主流程
4. 若 current_phase == "synthesizing"：
   若 synthesis.report_path 指向的 MD 已存在且非空：
     - 若 review_options.generate_html_report === true → current_phase = "html_rendering"，进入步骤 4b
     - 否则 → synthesis.html_status = "skipped"，synthesis.status = completed，current_phase = "completed"
   否则 → 重跑报告合成（Phase 7）
4b. 若 current_phase == "html_rendering"：
   按「HTML 完整性校验」检查 synthesis.html_report_path：
     - 通过 → html_status = completed，synthesis.status = completed，current_phase = completed
     - 不通过 → 整文件重写，重拉 java-codereview-report-html（最多 2 次；仍失败 → html_status = failed，current_phase = completed，MD 仍交付）
5. 幂等（可选优化）：current_phase == "tech_stack" 且 .codereview/tech-stack.json 已存在且合法 → 可直接进入 task_planning；
   current_phase == "task_planning" 且 task-plan.json 已存在 → 可补全 review_progress 后进入 reviewing（避免重复跑子 Builder）
6. 升级兼容：
   a. 若 review_progress[*] 缺少 curator 键 → 每批次补 curator: "pending"
   b. 若 review_options 缺少 generate_html_report → 补 false
   c. 若 review_options 缺少 user_confirmed → 补 false（仍须执行 Phase 1 清单）
   d. 若 synthesis 缺少 html_report_path / html_status → 补 "" 与 "skipped"
   → 写回 state.json 后再进入步骤 3/4/4b
```

## in_progress 防死锁

如果主 Builder 读到某个专家状态为 `in_progress`，说明上次执行中途中断（主 Builder 或子 Builder 崩溃）。此时：

- 检查对应结果文件是否存在且 JSON 合法：
  - 检视专家：`.codereview/results/{BATCH_ID}-{core|spring|security|data}.json`
  - **curator**：`.codereview/results/{BATCH_ID}-curated.json`
  - **fix**：`.codereview/results/{BATCH_ID}-fix.json`
  - 满足 → 标记 `completed`；否则 → 重置为 `pending` 并重新执行

## updated_at

主 Builder 每次写回 state.json 时更新此字段为当前 ISO 时间戳，便于追踪最后操作时间。
