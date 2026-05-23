---
name: ato-code-review-web-builder
description: >-
  前端（Vue / React 等）增量代码检视 Skill（Builder 模式）。主 Builder 读取本文件驱动全流程，通过预配置的子 Builder
  分阶段完成检视；中间状态写入 .codereview/state.json，支持断点续跑。Phase 1 须确认分支、检视深度、跳过低风险、是否生成 HTML 四项。
---

# 前端代码检视 · 主 Builder 工作流

> **本文件是主 Builder 运行时的唯一指令来源**（VS Code AI 插件主 Builder 读取本 `SKILL.md`；`MAIN_BUILDER.md` 仅为粘贴用短引导）。
> 主 Builder 负责编排、状态管理与故障恢复；**不做**深度代码检视。
> 须用 `scripts/update-state.js` 落盘；Phase 2+ 在 `user_confirmed !== true` 时会报 `PHASE1_REQUIRED`。

---

## 0. 主 Builder 启动清单（每次对话最先执行，优先于下文所有章节）

### 0.1 读 state

```bash
# 不存在则：
node "{SKILL_ROOT}/scripts/update-state.js" --init --checkpoint phase0_init
```

### 0.2 Phase 1 四问（`user_confirmed !== true` 时**只做本步**）

**禁止**：只问分支就跑脚本 / 拉子 Builder；用补丁默认值代替用户选择。

**必须**向用户**一次性**发送（四项同一条消息）：

```
请确认本次前端增量检视配置（四项均需回复，缺一不可）：

1) 分支 — BRANCH1：___  BRANCH2：（默认 master）
2) 检视深度 severity_mode — all | critical_high_only
3) 跳过低风险 skip_low_risk_files — true | false
4) 生成 HTML generate_html_report — true | false
```

复述四项无异议后**必须**执行：

```bash
node "{SKILL_ROOT}/scripts/update-state.js" \
  --branch1 <BRANCH1> --branch2 <BRANCH2> \
  --set review_options.severity_mode=<all|critical_high_only> \
  --set review_options.skip_low_risk_files=<true|false> \
  --set review_options.generate_html_report=<true|false> \
  --set review_options.user_confirmed=true \
  --phase diff_analysis --checkpoint phase1_done
```

确认 `user_confirmed===true` 后，才进入 Phase 2。

### 0.3 落盘 state（全程）

每个操作后用 `update-state.js` 写 `.codereview/state.json`（禁止只在聊天里说进度）。子 Builder **不写** state。

### 0.4 断点续跑

读 `current_phase` / `review_progress` 继续；**但 `user_confirmed !== true` 一律回到 §0.2**。

---

## 1. Skill 目录（`{SKILL_ROOT}` = 本 SKILL.md 所在目录）

```
{SKILL_ROOT}/
├── SKILL.md
├── docs/
│   ├── vue2-reference.md
│   ├── vue3-reference.md
│   ├── react-reference.md
│   ├── general-standards.md
│   ├── security-checklist.md
│   └── state-structure.md
├── scripts/
│   ├── get-diff-files.js
│   ├── batch-processor.js
│   ├── export-batch-diffs.js
│   ├── git-line-authors.js
│   ├── sync-report-signoff.js
│   ├── update-state.js
│   └── require-phase1.js
├── templates/
│   ├── report-template.md
│   ├── report-shell.html
│   └── signoff-payload.example.json
└── builder-prompts/
    ├── README.md
    ├── main/MAIN_BUILDER.md
    └── subagents/
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
    ├── report_<branch>_<date>.md
    └── report_<branch>_<date>.html
```

---

## 2. 断点续跑与故障恢复

### 2.1 状态驱动

每个操作前读 `state.json`，操作后立即写回。字段见 `{SKILL_ROOT}/docs/state-structure.md`。

### 2.2 主 Builder 启动逻辑（每次对话开头必执行）

```
1. 确认 {SKILL_ROOT} 绝对路径
2. 读取 .codereview/state.json
   ├─ 不存在 → Phase 0 初始化
   └─ 存在   → 读 current_phase；completed 则按 html_status 输出 MD/HTML 路径
3. 兼容性补丁：
   a. 缺 review_options → 补 severity_mode / skip_low_risk_files / generate_html_report / user_confirmed
   b. 缺 synthesis.html_report_path / html_status → 补 "" 与 "skipped"
   c. review_progress[*] 缺 curator → 补 curator: "pending"
   → 写回 state.json
3b. user_confirmed !== true → **只做 §0.2 四问**，不得 Phase 2+
4. reviewing：按批次顺序 core → framework → reliability → security → curator → fix，找首个 pending/in_progress
5. synthesizing：MD 已存在
   ├─ generate_html_report === true → html_rendering
   └─ 否则 → html_status = skipped，completed
   MD 不存在 → Phase 7
5b. html_rendering：按 state-structure.md「HTML 完整性校验」；失败则重拉 web-codereview-report-html（最多 2 次）
6. 幂等（可选）：tech_stack / task_planning 阶段可跳过已完成的子步骤
```

### 2.3 子 Builder 调用与故障恢复

**标准流程：** 拉起子 Builder 前将该专家标为 `in_progress` 并写回 `state.json`；返回后根据结果文件是否合法标为 `completed` 或进入故障恢复。

**故障恢复：** 子 Builder 超时/异常：将该专家置 `pending`，新实例重试，**最多 2 次**；仍失败则 `failed` 并记入 `notes[]`。

### 2.4 主 Builder 上下文纪律

禁止将子 Builder 提示词全文、`docs/` 全文、结果 JSON 全量读入主对话；只传变量与路径。上下文将满时写 `state.json` 并请用户重启主 Builder。

---

## 3. 阶段详情

### Phase 0：初始化

若 `.codereview/` 或 `state.json` 不存在，按 `docs/state-structure.md` 创建；`current_phase = "branch_selection"`。

---

### Phase 1：分支与检视选项

**与 §0.2 相同**（四问模板、`update-state.js` 命令、复述确认）。进入 Phase 2 条件：`review_options.user_confirmed === true`。

验证分支：`git rev-parse --verify "<branch>"`（Windows 勿用 `grep`）。

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

子 Builder **优先**读取 `.codereview/diffs/{BATCH_ID}.patch`；缺失再按文件 `git diff`。

**Step 4** 展示批次数、文件数、行数及跳过低风险统计；将 `diff_analysis`（文件数、变动行数、批次数、`completed: true`）写入 `state.json` 后，设 `current_phase = "tech_stack"`。

---

### Phase 3：技术栈分析

**子 Builder：** `web-codereview-tech-stack`

| 变量 | 值 |
|------|-----|
| `PROJECT_ROOT` | 仓库根目录 |
| `OUTPUT_PATH` | `.codereview/tech-stack.json` |

完成标志：文件存在且 JSON 合法。完成后 `current_phase = "task_planning"`。

---

### Phase 4：任务规划

**子 Builder：** `web-codereview-task-plan`

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
拉起子 Builder，写回 state
  本批专家全部完成后 → Phase 5.5 curator → 写回
  curator 完成后 → Phase 6 fix（输入 curated.json）→ 写回
all batches done → current_phase = "synthesizing"（见 Phase 7）
```

**四位检视专家**（由原 7 位合并，减少子 Builder 数量，与 java-builder 四专家规模对齐）：

| 专家 | 子 Builder | 输出 | 合并来源 |
|------|------------|------|----------|
| core | `web-codereview-review-core` | `{BATCH_ID}-core.json` | 扫描 + 规范 |
| framework | `web-codereview-review-framework` | `{BATCH_ID}-framework.json` | Vue/React + 样式 |
| reliability | `web-codereview-review-reliability` | `{BATCH_ID}-reliability.json` | 性能 + 健壮性 |
| security | `web-codereview-review-security` | `{BATCH_ID}-security.json` | 安全（独立） |

**每次检视子 Builder 必传：**

| 变量 | 说明 |
|------|------|
| `BATCH_ID` | 如 `batch-001` |
| `BATCH_FILES` | 该批文件列表 JSON |
| `BRANCH1` / `BRANCH2` | 分支 |
| `DIFF_PATCH_PATH` | `.codereview/diffs/{BATCH_ID}.patch`（存在则必传） |
| `SEVERITY_MODE` | `state.json` → `review_options.severity_mode` |
| `TECH_STACK` | 摘要或路径（子 Builder 可读 `tech-stack.json`） |
| `OUTPUT_PATH` | 结果路径 |
| `SKILL_ROOT` | 本 Skill 根目录（子 Builder 按需读 `docs/` 下参考文档） |

**检视范围（传达给子 Builder）：**

> 优先读 `DIFF_PATCH_PATH` 中 unified diff；缺失或为空再 `git --no-pager diff {BRANCH2}...{BRANCH1} -- <file>`。只报变更相关行；`line` **字符串**；每条 issue 必须补充 `symbol`（如 `UserList.vue#fetchUsers`、`useUser.ts#useUser`），报告不得只依赖行号定位。`critical_high_only` 时仅 `critical`/`high`。

**适用性：** 以 `task-plan.json` 的 `applicable_experts` 为准；非适用专家在 `review_progress` 中为 `skipped`。

**框架专家路径变量**（主 Builder 仅在与 **framework** 子 Builder 通信时传入）：`VUE2_REF_PATH` = `{SKILL_ROOT}/docs/vue2-reference.md`；`VUE3_REF_PATH` = `{SKILL_ROOT}/docs/vue3-reference.md`；`REACT_REF_PATH` = `{SKILL_ROOT}/docs/react-reference.md`；`GENERAL_STANDARDS_PATH` = `{SKILL_ROOT}/docs/general-standards.md`。

**安全专家路径变量**（主 Builder 仅在与 **security** 子 Builder 通信时传入）：`SECURITY_REF_PATH` = `{SKILL_ROOT}/docs/security-checklist.md`。

---

### Phase 5.5：问题策展（每批次一次）

**子 Builder：** `web-codereview-issue-curator`

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

**子 Builder：** `web-codereview-fix-advisor`

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

**子 Builder：** `web-codereview-report-synthesizer`（`builder-prompts/subagents/09-report-synthesizer.md`）

| 变量 | 值 |
|------|-----|
| `STATE_PATH` | `.codereview/state.json` |
| `RESULTS_DIR` | `.codereview/results/` |
| `TECH_STACK_PATH` | `.codereview/tech-stack.json` |
| `INVENTORY_PATH` | `.codereview/file-inventory.json` |
| `TEMPLATE_PATH` | `{SKILL_ROOT}/templates/report-template.md` |
| `REPORT_PATH` | `codereview/report_{BRANCH1}_{DATE}.md` |

**完成后：**

1. `synthesis.report_path = REPORT_PATH`，`synthesis.status = "completed"`
2. 若 `generate_html_report === true` → `html_status = "pending"`，`current_phase = "html_rendering"`
3. 否则 → `html_status = "skipped"`，`current_phase = "completed"`

---

### Phase 7.5：HTML 报告渲染（可选）

**子 Builder：** `web-codereview-report-html`（`builder-prompts/subagents/10-report-html.md`）

| 变量 | 值 |
|------|-----|
| `REPORT_MD_PATH` | `synthesis.report_path` |
| `HTML_TEMPLATE_PATH` | `{SKILL_ROOT}/templates/report-shell.html` |
| `HTML_REPORT_PATH` | 与 MD 同名 `.html` |

完整性校验与 HTML 签收流程见 `{SKILL_ROOT}/docs/state-structure.md` 与 `report-shell.html` 内脚本。

**完成后：** `html_status = "completed"`，`current_phase = "completed"`。

---

## 4. 子 Builder 标识对照表

将 `{SKILL_ROOT}/builder-prompts/subagents/` 对应文件粘贴为各 Builder 系统提示词（**1 主 + 10 子**）：

| 标识 | 提示词文件 |
|------|------------|
| `web-codereview-tech-stack` | `01-tech-stack.md` |
| `web-codereview-task-plan` | `02-task-plan.md` |
| `web-codereview-review-core` | `03-review-core.md` |
| `web-codereview-review-framework` | `04-review-framework.md` |
| `web-codereview-review-reliability` | `05-review-reliability.md` |
| `web-codereview-review-security` | `06-review-security.md` |
| `web-codereview-issue-curator` | `07-issue-curator.md` |
| `web-codereview-fix-advisor` | `08-fix-advisor.md` |
| `web-codereview-report-synthesizer` | `09-report-synthesizer.md` |
| `web-codereview-report-html` | `10-report-html.md` |

主 Builder 系统提示词：`builder-prompts/main/MAIN_BUILDER.md`（**1 主 + 10 子**）。

---

## 5. Git 备忘

```powershell
git rev-parse --verify "branch-name"
git --no-pager diff --name-only {BRANCH2}...{BRANCH1}
git --no-pager diff {BRANCH2}...{BRANCH1} -- path/to/file.vue
```

---

## 6. 主 Builder 禁令

1. 不要将 `builder-prompts/subagents/*.md` 全文读入主对话  
2. 不要将 `docs/*.md` 全文读入主对话  
3. 不要将专家 JSON 全文读入（仅必要时校验存在性）  
4. 不要在主对话中代做代码检视  
5. 上下文将满 → 写 `state.json` → 请用户重启主 Builder
