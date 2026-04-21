---
name: ato-code-review-web-builder
description: >-
  前端（Vue / React 等）增量代码检视 Skill（Builder 模式）。主 Builder 读取本文件驱动全流程，通过预配置的子 Builder
  分阶段完成检视；中间状态写入 .codereview/state.json，支持断点续跑，适配中等上下文模型。
---

# 前端代码检视 · 主 Builder 工作流

> **本文件是主 Builder 运行时的唯一指令来源。**  
> 主 Builder 负责编排、状态管理与故障恢复；**不做**深度代码检视。

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
│   └── export-batch-diffs.js
├── templates/
│   └── report-template.md
└── builder-prompts/          ← 仅供人工创建 Builder 时参考，运行时不读取
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
    └── report_<branch>_<date>.md
```

---

## 2. 断点续跑与故障恢复

### 2.1 状态驱动

每个操作前读 `state.json`，操作后立即写回。字段见 `{SKILL_ROOT}/docs/state-structure.md`。

### 2.2 主 Builder 启动（每次对话开头）

```
1. 确认 {SKILL_ROOT} 绝对路径
2. 读取 .codereview/state.json
   - 不存在：Phase 0 初始化
   - 存在：读取 current_phase
     - 若为 completed：告知报告路径；否则跳到对应 Phase
3. 若缺少 review_options → 补 { severity_mode: "all", skip_low_risk_files: false } 并写回
4. **reviewing**：按批次、按专家顺序 `core` → `framework` → `reliability` → `security` → `fix`，找到第一个状态为 `pending` 或 `in_progress` 的项（`completed` / `skipped` / **`failed`** 均跳过；`failed` 为终态，除非用户要求人工改回 `pending`）  
   - `in_progress`：按 `docs/state-structure.md`「in_progress 防死锁」校验对应 `*-{expert}.json` 或 `*-fix.json`
5. **synthesizing**：若 `synthesis.report_path` 已有可读报告 → 可将 `synthesis.status` 与 `current_phase` 置完成；否则重跑报告子 Builder
6. **幂等（可选）**：`tech_stack` 且 `tech-stack.json` 已合法 → 可直接 `task_planning`；`task_planning` 且 `task-plan.json` 已存在 → 补全 `review_progress` 后进入 `reviewing`
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

### Phase 1：分支与检视选项（主 Builder）

1. 确认 `BRANCH1`（被检视分支）、`BRANCH2`（基准，默认 `master`）。支持 `a vs b` 格式。
2. **检视深度** → `review_options.severity_mode`：`all` | `critical_high_only`。
3. **是否跳过低风险文件** → `review_options.skip_low_risk_files`：  
   `true` 时 Phase 2 调用 `get-diff-files.js` 追加 `--skip-low-risk true`（排除测试/E2E/Storybook 源文件、`.snap` 等，见清单 `review_scope`）。
4. 验证分支：`git rev-parse --verify "<branch>"`（**不要**使用 `grep`，Windows PowerShell 无此命令）。
5. 写入 `state.json`，`current_phase = "diff_analysis"`。

---

### Phase 2：变动文件与分批（脚本）

**Step 1 清单**（若 `skip_low_risk_files === true`，在下列命令末尾追加 `--skip-low-risk true`）：

```bash
node "{SKILL_ROOT}/scripts/get-diff-files.js" --branch1 {BRANCH1} --branch2 {BRANCH2} --output .codereview/file-inventory.json
# 跳过低风险时示例：
# node "{SKILL_ROOT}/scripts/get-diff-files.js" --branch1 {BRANCH1} --branch2 {BRANCH2} --output .codereview/file-inventory.json --skip-low-risk true
```

**Step 2 分批**（前端默认每批约 800 变动行，可按需调整）：

```bash
node "{SKILL_ROOT}/scripts/batch-processor.js" --inventory .codereview/file-inventory.json --max-lines 800 --output .codereview/file-inventory.json
```

**Step 3 预计算批次 diff**：

```bash
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

根据 `task-plan.json` 初始化 `review_progress`（每批每专家 `pending`，不适用则 `skipped`）。`current_phase = "reviewing"`。

---

### Phase 5：多专家检视（批次 × 专家）

**循环：**

```
for each batch:
  for expert in [core, framework, reliability, security]:
    skip if completed/skipped
拉起子 Builder，写回 state
  本批专家全部完成后 → Phase 6 fix → 写回
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

> 优先读 `DIFF_PATCH_PATH` 中 unified diff；缺失或为空再 `git --no-pager diff {BRANCH2}...{BRANCH1} -- <file>`。只报变更相关行；`line` **字符串**。`critical_high_only` 时仅 `critical`/`high`。

**适用性：** 以 `task-plan.json` 的 `applicable_experts` 为准；非适用专家在 `review_progress` 中为 `skipped`。

**框架专家路径变量**（主 Builder 仅在与 **framework** 子 Builder 通信时传入）：`VUE2_REF_PATH` = `{SKILL_ROOT}/docs/vue2-reference.md`；`VUE3_REF_PATH` = `{SKILL_ROOT}/docs/vue3-reference.md`；`REACT_REF_PATH` = `{SKILL_ROOT}/docs/react-reference.md`；`GENERAL_STANDARDS_PATH` = `{SKILL_ROOT}/docs/general-standards.md`。

**安全专家路径变量**（主 Builder 仅在与 **security** 子 Builder 通信时传入）：`SECURITY_REF_PATH` = `{SKILL_ROOT}/docs/security-checklist.md`。

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
| `SKILL_ROOT` | Skill 根目录 |

---

### Phase 7：报告合成

进入本阶段前：将 `state.json` 的 `current_phase` 设为 `"synthesizing"`，`synthesis.status` 可为 `"in_progress"`，并写回。

**子 Builder：** `web-codereview-report-synthesizer`

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

## 4. 子 Builder 标识对照表

将 `{SKILL_ROOT}/builder-prompts/subagents/` 对应文件粘贴为各 Builder 系统提示词（**1 主 + 8 子**）：

| 标识 | 提示词文件 |
|------|------------|
| `web-codereview-tech-stack` | `01-tech-stack.md` |
| `web-codereview-task-plan` | `02-task-plan.md` |
| `web-codereview-review-core` | `03-review-core.md` |
| `web-codereview-review-framework` | `04-review-framework.md` |
| `web-codereview-review-reliability` | `05-review-reliability.md` |
| `web-codereview-review-security` | `06-review-security.md` |
| `web-codereview-fix-advisor` | `07-fix-advisor.md` |
| `web-codereview-report-synthesizer` | `08-report-synthesizer.md` |

主 Builder 系统提示词：`builder-prompts/main/MAIN_BUILDER.md`。

---

## 5. Git 备忘

```bash
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

