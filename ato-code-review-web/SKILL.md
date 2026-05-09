---
name: ato-code-review-web
description: >-
  前端（Vue 等）增量代码检视 Skill。主编排 Agent 读取本文件驱动全流程，可通过 opencode
  并行拉起子 agent/subagent 分阶段完成检视；中间状态写入 .codereview/state.json，
  支持断点续跑，适配中等上下文模型。
---

# 前端代码检视 · 主编排工作流

> **本文件是主编排 Agent 运行时的唯一指令来源。**
> 主编排 Agent 负责编排、状态管理、并行调度与故障恢复；**不做**深度代码检视。

---

## 1. Skill 目录（`{SKILL_ROOT}` = 本 SKILL.md 所在目录）

```
{SKILL_ROOT}/
├── SKILL.md
├── docs/
│   ├── vue2-reference.md
│   ├── vue3-reference.md
│   ├── general-standards.md
│   └── state-structure.md
├── scripts/
│   ├── get-diff-files.js
│   ├── batch-processor.js
│   └── export-batch-diffs.js
├── templates/
│   └── report-template.md
└── prompts/                  ← 子 agent 系统提示词（opencode/其它编排器按文件加载）
    ├── tech-stack-analysis.md
    ├── task-planner.md
    ├── code-scanner.md       ← core：核心静态（兼容旧文件名）
    ├── framework-reviewer.md ← framework：Vue + 样式
    ├── perf-reviewer.md      ← reliability：性能 + 健壮性
    ├── security-reviewer.md
    ├── issue-curator.md      ← curator：跨专家合并 + 局部误报复核
    ├── fix-advisor.md
    └── report-synthesizer.md
```

**运行时生成：**

```
{项目根}/
├── .codereview/
│   ├── state.json
│   ├── diffs/ ← 各批次 *.patch（Phase 2 预计算）
│   ├── file-inventory.json
│   ├── tech-stack.json
│   ├── task-plan.json
│   └── results/
└── codereview/
    └── report_<branch>_<date>.md
```

---

## 2. 断点续跑与故障恢复

### 2.1 状态驱动

每个操作前读 `state.json`，操作后立即写回。字段见 `{SKILL_ROOT}/docs/state-structure.md`。

### 2.2 主编排 Agent 启动（每次对话开头）

```
1. 确认 {SKILL_ROOT} 绝对路径
2. 读取 .codereview/state.json
   - 不存在：Phase 0 初始化
   - 存在：读取 current_phase
     - 若为 completed：告知报告路径；否则跳到对应 Phase
3. 兼容性补丁：
   - 若缺少 review_options → 补 { severity_mode: "all", skip_low_risk_files: false }
   - 若 review_progress[*] 缺少 curator → 在 security 与 fix 之间补 `curator: "pending"`
   - 写回 state.json
4. **reviewing**：按批次、按专家顺序 `core` → `framework` → `reliability` → `security` → `curator` → `fix`，找到第一个状态为 `pending` 或 `in_progress` 的项（`completed` / `skipped` / **`failed`** 均跳过；`failed` 为终态，除非用户要求人工改回 `pending`）
   - `in_progress`：按 `docs/state-structure.md`「in_progress 防死锁」校验对应 `*-{expert}.json`、`*-curated.json` 或 `*-fix.json`
5. **synthesizing**：若 `synthesis.report_path` 已有可读报告 → 可将 `synthesis.status` 与 `current_phase` 置完成；否则重跑报告子 agent
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

若 `.codereview/` 或 `state.json` 不存在，按 `docs/state-structure.md` 创建；`current_phase = "branch_selection"`。

---

### Phase 1：分支与检视选项（主编排 Agent）

1. 确认 `BRANCH1`（被检视分支）、`BRANCH2`（基准，默认 `master`）。支持 `a vs b` 格式。
2. **检视深度** → `review_options.severity_mode`：`all` | `critical_high_only`。
3. **是否跳过低风险文件** → `review_options.skip_low_risk_files`：
   `true` 时 Phase 2 调用 `get-diff-files.js` 追加 `--skip-low-risk true`（排除测试/E2E/Storybook 源文件、`.snap` 等，见清单 `review_scope`）。
4. 验证分支：`git rev-parse --verify "<branch>"`（**不要**使用 `grep`，Windows PowerShell 无此命令）。
5. 写入 `state.json`，`current_phase = "diff_analysis"`。

---

### Phase 2：变动文件与分批（脚本）

**Step 1 清单**（若 `skip_low_risk_files === true`，在下列命令末尾追加 `--skip-low-risk true`）：

```powershell
node "{SKILL_ROOT}/scripts/get-diff-files.js" --branch1 {BRANCH1} --branch2 {BRANCH2} --output .codereview/file-inventory.json
# 跳过低风险时示例：
# node "{SKILL_ROOT}/scripts/get-diff-files.js" --branch1 {BRANCH1} --branch2 {BRANCH2} --output .codereview/file-inventory.json --skip-low-risk true
```

**Step 2 分批**（前端默认每批约 800 变动行，可按需调整）：

```powershell
node "{SKILL_ROOT}/scripts/batch-processor.js" --inventory .codereview/file-inventory.json --max-lines 800 --output .codereview/file-inventory.json
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

**四位检视专家**（由原 7 位合并，减少子 agent 数量，与 Java 四专家规模对齐）：

| 专家 | 子 agent | 提示词文件 | 输出 | 合并来源 |
|------|------------|------------|------|----------|
| core | `web-codereview-review-core` | `{SKILL_ROOT}/prompts/code-scanner.md` | `{BATCH_ID}-core.json` | 扫描 + 规范 |
| framework | `web-codereview-review-framework` | `{SKILL_ROOT}/prompts/framework-reviewer.md` | `{BATCH_ID}-framework.json` | Vue + 样式 |
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
| `TECH_STACK` | 摘要或路径（子 agent 可读 `tech-stack.json`） |
| `OUTPUT_PATH` | 结果路径 |
| `SKILL_ROOT` | 本 Skill 根目录（读 `docs/vue2-reference.md` 等） |

**检视范围（传达给子 agent）：**

> 优先读 `DIFF_PATCH_PATH` 中 unified diff；缺失或为空再 `git --no-pager diff {BRANCH2}...{BRANCH1} -- <file>`。只报变更相关行；`line` **字符串**；每条 issue 必须补充 `symbol`（如 `UserList.vue#fetchUsers`、`useUser.ts#useUser`），报告不得只依赖行号定位。`critical_high_only` 时仅 `critical`/`high`。

**适用性：** 以 `task-plan.json` 的 `applicable_experts` 为准；非适用专家在 `review_progress` 中为 `skipped`。

**opencode 并行派发建议：**

同一 `BATCH_ID` 中，对 `applicable_experts` 取交集后可一次性并行拉起多个子 agent。每个任务必须显式包含：`BATCH_ID`、`BATCH_FILES`、`BRANCH1`、`BRANCH2`、`DIFF_PATCH_PATH`、`SEVERITY_MODE`、`TECH_STACK`、`SKILL_ROOT`、独立 `OUTPUT_PATH`，并强调“完成后只写对应输出文件”。主编排 Agent 等待这一组输出文件全部存在且 JSON 合法后，再将对应状态改为 `completed`；随后串行执行 `issue-curator` 与 `fix-advisor`。

**框架专家路径变量：**`VUE2_REF_PATH` = `{SKILL_ROOT}/docs/vue2-reference.md`
`VUE3_REF_PATH` = `{SKILL_ROOT}/docs/vue3-reference.md`
`GENERAL_STANDARDS_PATH` = `{SKILL_ROOT}/docs/general-standards.md`

---

### Phase 5.5：问题策展（每批次一次）

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

进入本阶段前：将 `state.json` 的 `current_phase` 设为 `"synthesizing"`，`synthesis.status` 可为 `"in_progress"`，并写回。

**子 agent：** `web-codereview-report-synthesizer`
**提示词文件：** `{SKILL_ROOT}/prompts/report-synthesizer.md`

| 变量 | 值 |
|------|-----|
| `STATE_PATH` | `.codereview/state.json` |
| `RESULTS_DIR` | `.codereview/results/` |
| `TECH_STACK_PATH` | `.codereview/tech-stack.json` |
| `INVENTORY_PATH` | `.codereview/file-inventory.json` |
| `TEMPLATE_PATH` | `{SKILL_ROOT}/templates/report-template.md` |
| `REPORT_PATH` | `codereview/report_{BRANCH1}_{DATE}.md`（`/` → `_`） |

合成官须读取 `review_options` 与 `review_scope`，填写模板中 `{{SEVERITY_MODE_LABEL}}`、`{{LOW_RISK_SCOPE_LABEL}}`。

**完成后写回 `state.json`：** `synthesis.status = "completed"`，`synthesis.report_path = {REPORT_PATH}`，`current_phase = "completed"`，`updated_at` 更新；向用户输出报告路径与问题摘要。

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

兼容说明：`prompts/spec-reviewer.md` 同 core，`prompts/style-reviewer.md` 同 framework，`prompts/robustness-reviewer.md` 同 reliability，保留旧文件名是为了不破坏已有配置；新流程只使用上表 9 个标识。

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
