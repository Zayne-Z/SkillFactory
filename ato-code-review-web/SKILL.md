---
name: ato-code-review-web
description: >-
  前端（Vue / React 等）增量代码检视 Skill。主编排 Agent 读取本文件驱动全流程；状态持久化到
  .codereview/state.json，支持断点续跑。启动后若 state.json 存在则询问续跑或重新检视；
  Phase 1 须确认分支、检视深度、跳过低风险、是否生成 HTML、每批最大行数五项。
---

# 前端代码检视 · 主编排工作流

> **本文件是主编排 Agent 运行时的唯一指令来源。**
> 主编排 Agent 负责编排、状态管理、并行调度与故障恢复；**不做**深度代码检视。
> 须用 `scripts/update-state.js` 落盘；Phase 2+ 在 `user_confirmed !== true` 时会报 `PHASE1_REQUIRED`。

---

## 0. 启动清单

### 0.0 续跑 vs 重新检视（**仅**探测 `.codereview/state.json`）

**不探测** `codereview/`（多版本历史报告目录）。

若 `.codereview/state.json` **存在**，在 §0.2 **之前**问用户：

```
检测到已有检视状态（.codereview/state.json），请选择：
1) 续跑 — 按 state.json 继续
2) 重新检视 — 清除过程文件（保留 memory.json），从头开始
```

- **续跑** → 读 state；`completed` 时输出报告路径，不自动重跑
- **重新检视** → `node "{SKILL_ROOT}/scripts/reset-run.js"`，再 §0.1

### 0.1 读 state / 初始化

```bash
node "{SKILL_ROOT}/scripts/init-memory.js"
node "{SKILL_ROOT}/scripts/update-state.js" --init --checkpoint phase0_init
```

### 0.2 Phase 1 五问（`user_confirmed !== true` 时只做本步）

```
1) 分支 — BRANCH1：___  BRANCH2：（默认 master）
2) severity_mode — all | critical_high_only
3) skip_low_risk_files — true | false
4) generate_html_report — true | false
5) max_lines_per_batch — 默认 900（大 MR 可 1200，小 MR 可 600）
```

复述确认后：

```bash
node "{SKILL_ROOT}/scripts/update-state.js" \
  --branch1 <BRANCH1> --branch2 <BRANCH2> \
  --set review_options.severity_mode=<mode> \
  --set review_options.skip_low_risk_files=<bool> \
  --set review_options.generate_html_report=<bool> \
  --set review_options.max_lines_per_batch=<N> \
  --set review_options.user_confirmed=true \
  --phase diff_analysis --checkpoint phase1_done
```

### 0.3 项目记忆

- `.codereview/memory.json`：用户手动维护（`reset-run.js` 保留）；见 `{SKILL_ROOT}/docs/memory-system.md`
- Phase 5 每专家拉起前：`build-memory-context.js` → `MEMORY_BRIEF_PATH`

---

## 1. Skill 目录（`{SKILL_ROOT}` = 本 SKILL.md 所在目录）

```
{SKILL_ROOT}/
├── SKILL.md
├── docs/
│   ├── memory-system.md
│   └── …
├── scripts/
│   ├── get-diff-files.js
│   ├── batch-processor.js
│   ├── export-batch-diffs.js
│   ├── git-line-authors.js
│   ├── render-report-html.js   ← Phase 7.5：MD → HTML（机械填充，优先于子 agent）
│   ├── sync-report-signoff.js
│   ├── init-memory.js
│   ├── reset-run.js
│   ├── build-memory-context.js
│   ├── update-state.js
│   └── require-phase1.js
├── templates/
│   ├── report-template.md
│   ├── report-shell.html
│   ├── memory.json.example
│   └── signoff-payload.example.json
└── prompts/
    ├── …（检视子 agent）
    ├── report-synthesizer.md
    └── report-html.md
```

**运行时生成：**

```
.codereview/  ← state、memory.json、memory-brief-*.json、diffs、results/（持久化，reset 保留 memory）
codereview/   ← 多版本 report_*.md / *.html（不参与启动探测）
```

---

## 2. 断点续跑与故障恢复

### 2.1 状态驱动

每个操作前读 `state.json`，操作后立即写回。字段见 `{SKILL_ROOT}/docs/state-structure.md`。

### 2.2 主编排 Agent 启动（每次对话开头）

```
1. 确认 {SKILL_ROOT} 绝对路径
2. 若 .codereview/state.json 存在 → §0.0 续跑/重新检视；否则 §0.1 init
3. 读取 .codereview/state.json
   - 不存在：Phase 0 初始化
   - 存在：读取 current_phase
     - 若为 completed：告知报告路径；否则跳到对应 Phase
4. 兼容性补丁：
   - 若缺少 review_options → 补 severity_mode / skip_low_risk_files / generate_html_report / max_lines_per_batch(900) / user_confirmed
   - 若 review_progress[*] 缺少 curator → 补 `curator: "pending"`
   - 若 synthesis 缺少 html_report_path / html_status → 补 "" 与 "skipped"
   - **`user_confirmed !== true` → 回到 §0.2 Phase 1 五问**
4. **reviewing**：按批次、按专家顺序 `core` → `framework` → `reliability` → `security` → `curator` → `fix`，找到第一个状态为 `pending` 或 `in_progress` 的项（`completed` / `skipped` / **`failed`** 均跳过；`failed` 为终态，除非用户要求人工改回 `pending`）
   - `in_progress`：按 `docs/state-structure.md`「in_progress 防死锁」校验对应 `*-{expert}.json`、`*-curated.json` 或 `*-fix.json`
5. **synthesizing**：若 MD 已存在 → 按 `generate_html_report` 进入 `html_rendering` 或 `completed`；否则 Phase 7
6. **html_rendering**：按 `state-structure.md` 校验 HTML 完整性；通过则 `completed`，否则重拉 HTML 子 agent（最多 2 次）
6. **幂等（可选）**：`tech_stack` 且 `tech-stack.json` 已合法 → 可直接 `task_planning`；`task_planning` 且 `task-plan.json` 已存在 → 补全 `review_progress` 后进入 `reviewing`
```

### 2.3 子 agent 调用与故障恢复

**标准流程：** 拉起子 agent 前将该专家标为 `in_progress` 并写回 `state.json`；返回后根据结果文件是否合法标为 `completed` 或进入故障恢复。

**故障恢复：** 子 agent 超时/异常：将该专家置 `pending`，新实例重试，**最多 2 次**；仍失败则 `failed` 并记入 `notes[]`。

### 2.4 主编排 Agent 上下文纪律

禁止将子 agent 提示词全文、`docs/` 全文、结果 JSON 全量读入主对话；只传变量与路径。上下文将满时写 `state.json` 并请用户重启主编排 Agent。

### 2.5 opencode 并行执行约定

本 Skill 可通过 opencode 执行。主编排 Agent 应将 `prompts/*.md` 作为子 agent 的系统提示词来源，并通过任务描述传入变量。每个子 agent 的唯一交付物是写入约定的 `OUTPUT_PATH` JSON/报告文件；主编排 Agent 只检查文件，不依赖对话内容合并结果。

**并行原则：**

- Phase 3 技术栈、Phase 4 任务规划存在依赖关系，必须串行。
- Phase 5 中，同一批次内 `core`、`framework`、`reliability`、`security` 四个专家彼此独立，凡 `task-plan.json` 标记为适用且状态为 `pending` / `failed` 的，可以通过 opencode 并行拉起。
- 并行启动前，先把这些专家状态统一写为 `in_progress`；每个子 agent 写自己的固定输出文件，互不共享写入目标。
- 等同批次所有适用专家完成后，先执行该批次的 `issue-curator`；curator 完成后再执行 `fix-advisor`，fix 完成后再进入下一批次或报告合成。
- 若 opencode 当前环境不支持并行任务，则按 `core → framework → reliability → security` 串行降级，输出文件与状态规则保持不变。

---

## 3. 阶段详情

### Phase 0：初始化

```bash
node "{SKILL_ROOT}/scripts/init-memory.js"
node "{SKILL_ROOT}/scripts/update-state.js" --init --checkpoint phase0_init
```

`current_phase = "branch_selection"`；确认 `memory.json` 存在。

---

### Phase 1：分支与检视选项（主编排 Agent）

**须与 §0.2 五问一致**；未 `user_confirmed` 禁止进入 Phase 2。

1. 确认 `BRANCH1`、`BRANCH2`（默认 `master`）
2. `severity_mode`：`all` | `critical_high_only`
3. `skip_low_risk_files`：`true` 时 Phase 2 追加 `--skip-low-risk true`
4. **`generate_html_report`**：`true` | `false`
5. **`max_lines_per_batch`**：默认 `900`（Phase 2 传给 `batch-processor.js`）
6. 验证分支后 `update-state.js` 落盘，`current_phase = "diff_analysis"`

---

### Phase 2：变动文件与分批（脚本）

**Step 1 清单**（若 `skip_low_risk_files === true`，在下列命令末尾追加 `--skip-low-risk true`）：

```powershell
node "{SKILL_ROOT}/scripts/get-diff-files.js" --branch1 {BRANCH1} --branch2 {BRANCH2} --output .codereview/file-inventory.json
# 跳过低风险时示例：
# node "{SKILL_ROOT}/scripts/get-diff-files.js" --branch1 {BRANCH1} --branch2 {BRANCH2} --output .codereview/file-inventory.json --skip-low-risk true
```

**Step 2 分批**（`max-lines` 取自 `review_options.max_lines_per_batch`，默认 900）：

```powershell
node "{SKILL_ROOT}/scripts/batch-processor.js" --inventory .codereview/file-inventory.json --max-lines {MAX_LINES} --output .codereview/file-inventory.json
```

**Step 3 预计算批次 diff**：

```powershell
node "{SKILL_ROOT}/scripts/export-batch-diffs.js" --inventory .codereview/file-inventory.json --output-dir .codereview/diffs
```

子 agent **优先**读取 `.codereview/diffs/{BATCH_ID}.patch`；缺失再按文件 `git diff`。

**Step 4** 展示批次数、文件数、行数及跳过低风险统计；将 `diff_analysis`（文件数、变动行数、批次数、`completed: true`）写入 `state.json` 后，设 `current_phase = "tech_stack"`。

---

### Phase 3：技术栈分析

**子 agent：** `web-codereview-tech-stack`
**提示词文件：** `{SKILL_ROOT}/prompts/tech-stack-analysis.md`

| 变量 | 值 |
|------|-----|
| `PROJECT_ROOT` | 仓库根目录 |
| `OUTPUT_PATH` | `.codereview/tech-stack.json` |

完成标志：文件存在且 JSON 合法。完成后 `current_phase = "task_planning"`。

---

### Phase 4：任务规划

**子 agent：** `web-codereview-task-plan`
**提示词文件：** `{SKILL_ROOT}/prompts/task-planner.md`

| 变量 | 值 |
|------|-----|
| `INVENTORY_PATH` | `.codereview/file-inventory.json` |
| `TECH_STACK_PATH` | `.codereview/tech-stack.json` |
| `OUTPUT_PATH` | `.codereview/task-plan.json` |

根据 `task-plan.json` 初始化 `review_progress`（core/framework/reliability/security 按适用性设 `pending` 或 `skipped`；每批固定追加 `curator: "pending"` 与 `fix: "pending"`）。`current_phase = "reviewing"`。

---

### Phase 5：多专家检视（批次 × 专家）

**循环：**

```
for each batch:
  for expert in [core, framework, reliability, security]:
    skip if completed/skipped
拉起子 agent，写回 state
  本批专家全部完成后 → Phase 5.5 curator → 写回
  curator 完成后 → Phase 6 fix（输入 curated.json）→ 写回
all batches done → current_phase = "synthesizing"（见 Phase 7）
```

**四位检视专家**（拉起**前**必运行 `build-memory-context.js`，传入 `MEMORY_BRIEF_PATH`）：

```bash
node "{SKILL_ROOT}/scripts/build-memory-context.js" \
  --memory .codereview/memory.json \
  --batch-id {BATCH_ID} \
  --expert {core|framework|reliability|security} \
  --output .codereview/memory-brief-{BATCH_ID}-{expert}.json
```

| 专家 | 子 agent | 提示词文件 | 输出 | 合并来源 |
|------|------------|------------|------|----------|
| core | `web-codereview-review-core` | `{SKILL_ROOT}/prompts/code-scanner.md` | `{BATCH_ID}-core.json` | 扫描 + 规范 |
| framework | `web-codereview-review-framework` | `{SKILL_ROOT}/prompts/framework-reviewer.md` | `{BATCH_ID}-framework.json` | Vue/React + 样式 |
| reliability | `web-codereview-review-reliability` | `{SKILL_ROOT}/prompts/perf-reviewer.md` | `{BATCH_ID}-reliability.json` | 性能 + 健壮性 |
| security | `web-codereview-review-security` | `{SKILL_ROOT}/prompts/security-reviewer.md` | `{BATCH_ID}-security.json` | 安全（独立） |

**每次检视子 agent 必传：**

| 变量 | 说明 |
|------|------|
| `BATCH_ID` | 如 `batch-001` |
| `BATCH_FILES` | 该批文件列表 JSON |
| `BRANCH1` / `BRANCH2` | 分支 |
| `DIFF_PATCH_PATH` | `.codereview/diffs/{BATCH_ID}.patch`（存在则必传） |
| `SEVERITY_MODE` | `state.json` → `review_options.severity_mode` |
| `MEMORY_BRIEF_PATH` | `.codereview/memory-brief-{BATCH_ID}-{expert}.json` |
| `TECH_STACK` | 摘要或路径（子 agent 可读 `tech-stack.json`） |
| `OUTPUT_PATH` | 结果路径 |
| `SKILL_ROOT` | 本 Skill 根目录（读 `docs/vue2-reference.md` 等） |

**检视范围（传达给子 agent）：**

> 优先读 `DIFF_PATCH_PATH` 中 unified diff；缺失或为空再 `git --no-pager diff {BRANCH2}...{BRANCH1} -- <file>`。只报变更相关行；`line` **字符串**；每条 issue 必须补充 `symbol`（如 `UserList.vue#fetchUsers`、`useUser.ts#useUser`），报告不得只依赖行号定位。`critical_high_only` 时仅 `critical`/`high`。

**适用性：** 以 `task-plan.json` 的 `applicable_experts` 为准；非适用专家在 `review_progress` 中为 `skipped`。

**opencode 并行派发建议：**

同一 `BATCH_ID` 中，对 `applicable_experts` 取交集后可一次性并行拉起多个子 agent。每个任务必须显式包含：`BATCH_ID`、`BATCH_FILES`、`BRANCH1`、`BRANCH2`、`DIFF_PATCH_PATH`、`SEVERITY_MODE`、`MEMORY_BRIEF_PATH`、`TECH_STACK`、`SKILL_ROOT`、独立 `OUTPUT_PATH`，并强调“完成后只写对应输出文件”。主编排 Agent 等待这一组输出文件全部存在且 JSON 合法后，再将对应状态改为 `completed`；随后串行执行 `issue-curator` 与 `fix-advisor`。

**框架专家路径变量**（主编排 Agent 仅在与 **framework** 子 agent 通信时传入）：`VUE2_REF_PATH` = `{SKILL_ROOT}/docs/vue2-reference.md`；`VUE3_REF_PATH` = `{SKILL_ROOT}/docs/vue3-reference.md`；`REACT_REF_PATH` = `{SKILL_ROOT}/docs/react-reference.md`；`GENERAL_STANDARDS_PATH` = `{SKILL_ROOT}/docs/general-standards.md`。

**安全专家路径变量**（主编排 Agent 仅在与 **security** 子 agent 通信时传入）：`SECURITY_REF_PATH` = `{SKILL_ROOT}/docs/security-checklist.md`。

---

### Phase 5.5：问题策展（每批次一次）

**拉起前：**

```bash
node "{SKILL_ROOT}/scripts/build-memory-context.js" \
  --memory .codereview/memory.json \
  --batch-id {BATCH_ID} \
  --expert curator \
  --output .codereview/memory-brief-{BATCH_ID}-curator.json
```

**子 agent：** `web-codereview-issue-curator`
**提示词文件：** `{SKILL_ROOT}/prompts/issue-curator.md`

| 变量 | 值 |
|------|-----|
| `BATCH_ID` | 当前批次 |
| `BATCH_FILES` | 当前批次文件列表 |
| `BRANCH1` / `BRANCH2` | 分支 |
| `DIFF_PATCH_PATH` | `.codereview/diffs/{BATCH_ID}.patch`（可选，与 Phase 5 同批） |
| `RESULTS_DIR` | `.codereview/results/` |
| `SEVERITY_MODE` | 同 Phase 5 |
| `MEMORY_BRIEF_PATH` | `.codereview/memory-brief-{BATCH_ID}-curator.json` |
| `OUTPUT_PATH` | `.codereview/results/{BATCH_ID}-curated.json` |
| `SKILL_ROOT` | Skill 根目录 |

完成标志：`{BATCH_ID}-curated.json` 存在且 JSON 合法，包含 `summary`、`issues[]`、`invalidated[]`。策展输出是 fix-advisor 与 report-synthesizer 的优先输入源。

---

### Phase 6：修复建议（每批次一次，嵌在 Phase 5 循环末尾）

**子 agent：** `web-codereview-fix-advisor`
**提示词文件：** `{SKILL_ROOT}/prompts/fix-advisor.md`

| 变量 | 值 |
|------|-----|
| `BATCH_ID` | 当前批次 |
| `BATCH_FILES` | 当前批次文件列表 |
| `BRANCH1` / `BRANCH2` | 分支 |
| `RESULTS_DIR` | `.codereview/results/` |
| `SEVERITY_MODE` | 同 Phase 5 |
| `OUTPUT_PATH` | `.codereview/results/{BATCH_ID}-fix.json` |
| `DIFF_PATCH_PATH` | `.codereview/diffs/{BATCH_ID}.patch`（可选，与 Phase 5 同批） |
| `CURATED_PATH` | `.codereview/results/{BATCH_ID}-curated.json` |
| `SKILL_ROOT` | Skill 根目录 |

---

### Phase 7：报告合成

**Phase 7 开始前必须执行：**

```bash
node "{SKILL_ROOT}/scripts/git-line-authors.js" \
  --branch1 <BRANCH1> --branch2 <BRANCH2> \
  --results .codereview/results/ \
  --output .codereview/line-authors.json
```

**子 agent：** `web-codereview-report-synthesizer`  
**提示词：** `{SKILL_ROOT}/prompts/report-synthesizer.md`

| 变量 | 值 |
|------|-----|
| `STATE_PATH` | `.codereview/state.json` |
| `RESULTS_DIR` | `.codereview/results/` |
| `TECH_STACK_PATH` | `.codereview/tech-stack.json` |
| `INVENTORY_PATH` | `.codereview/file-inventory.json` |
| `TEMPLATE_PATH` | `{SKILL_ROOT}/templates/report-template.md` |
| `REPORT_PATH` | `codereview/report_{BRANCH1}_{DATE}.md` |

合成官读取 `line-authors.json` 填第六节「提交人」列；contributors → {{CONTRIBUTORS}}（第七节「本次参与开发」）。

**完成后：**

1. `synthesis.report_path = REPORT_PATH`，`synthesis.status = "completed"`
2. 若 `generate_html_report === true` → `html_status = "pending"`，`current_phase = "html_rendering"`
3. 否则 → `html_status = "skipped"`，`current_phase = "completed"`

---

### Phase 7.5：HTML 报告渲染（可选）

**Step 1（必做）：** 机械渲染（禁止「请查看同名 .md」占位）：

```bash
node "{SKILL_ROOT}/scripts/render-report-html.js" \
  --md "{REPORT_MD_PATH}" \
  --shell "{SKILL_ROOT}/templates/report-shell.html" \
  --out "{HTML_REPORT_PATH}" \
  --state ".codereview/state.json"
```

| 变量 | 值 |
|------|-----|
| `REPORT_MD_PATH` | `synthesis.report_path` |
| `HTML_TEMPLATE_PATH` | `{SKILL_ROOT}/templates/report-shell.html` |
| `HTML_REPORT_PATH` | 与 MD 同名 `.html` |

**Step 2：** 脚本 `ok: true` 且 `placeholdersOk: true`；并校验 `<!DOCTYPE html>` + `</html>` + `<!-- ato-codereview-html-end -->`（见 `state-structure.md`）。`unresolvedPlaceholders` 非空 → 回到 Phase 7 补全 MD。

**Step 3（仅当 Step 1/2 失败）：** 子 agent `web-codereview-report-html`（`prompts/report-html.md`），禁止降级占位，最多 2 次。

**HTML 签收：** 第六节勾选有效/已修（勾选「已修复」自动勾选「有效」）；第七节验证与签收：开发负责人填写结论并提交，**备注**默认「上述问题无需修复」可修改；自动汇总「本次参与开发」。提交后回写 MD 并生成 `【Fix】` 版 HTML；`file://` 下 fetch MD 失败时壳内 JS 会根据页面自动生成 MD。

**完成后：** `html_status = "completed"`，`current_phase = "completed"`。

### completed 输出文案

| `html_status` | 模板 |
|---|---|
| `skipped` | `检视完成。MD 报告：{report_path}` |
| `completed` | `检视完成。MD 报告：{report_path}；HTML 报告：{html_report_path}` |
| `failed` | `检视完成。MD 报告：{report_path}；HTML 渲染失败（详见 notes），不影响 MD 交付` |

---

## 4. 子 agent / opencode 标识对照表

用户需在 opencode 或其它 AI 编排器中预先创建以下子 agent。系统提示词取自 `{SKILL_ROOT}/prompts/` 对应文件：

| 标识 | 提示词文件 |
|------|------------|
| `web-codereview-tech-stack` | `prompts/tech-stack-analysis.md` |
| `web-codereview-task-plan` | `prompts/task-planner.md` |
| `web-codereview-review-core` | `prompts/code-scanner.md` |
| `web-codereview-review-framework` | `prompts/framework-reviewer.md` |
| `web-codereview-review-reliability` | `prompts/perf-reviewer.md` |
| `web-codereview-review-security` | `prompts/security-reviewer.md` |
| `web-codereview-issue-curator` | `prompts/issue-curator.md` |
| `web-codereview-fix-advisor` | `prompts/fix-advisor.md` |
| `web-codereview-report-synthesizer` | `prompts/report-synthesizer.md` |
| `web-codereview-report-html` | `prompts/report-html.md` |

兼容说明：`prompts/spec-reviewer.md` 同 core，`prompts/style-reviewer.md` 同 framework，`prompts/robustness-reviewer.md` 同 reliability；新流程使用上表 **10** 个标识（HTML 子 agent 可选）。

---

## 5. Git 备忘

```powershell
git rev-parse --verify "branch-name"
git --no-pager diff --name-only {BRANCH2}...{BRANCH1}
git --no-pager diff {BRANCH2}...{BRANCH1} -- path/to/file.vue
```

---

## 6. 主编排 Agent 禁令

1. 不要将 `prompts/*.md` 全文读入主对话
2. 不要将 `docs/*.md` 全文读入主对话
3. 不要将专家 JSON 全文读入（仅必要时校验存在性）
4. 不要在主对话中代做代码检视
5. 上下文将满 → 写 `state.json` → 请用户重启主编排 Agent
