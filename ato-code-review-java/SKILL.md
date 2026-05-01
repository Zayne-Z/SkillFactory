---
name: ato-code-review-java
description: >-
  Java 后端增量代码检视 Skill。主编排 Agent 读取本文件驱动全流程，可通过 opencode
  并行拉起子 agent/subagent 逐阶段完成检视，所有中间状态持久化到 .codereview/state.json，
  支持任意环节断点续跑，解决中等上下文模型的长度限制。
---

# Java 后端代码检视 · 主编排工作流

> **本文件是主编排 Agent 运行时的唯一指令来源。**
> 主编排 Agent 启动后读取本文件，按阶段推进，通过 opencode/子 agent 执行检视；
> 主编排 Agent 自身**不做**深度代码检视，只负责编排、状态管理、并行调度与故障恢复。

---

## 1. Skill 目录（`{SKILL_ROOT}` = SKILL.md 所在目录）

```
{SKILL_ROOT}/
├── SKILL.md                  ← 本文件（主编排 Agent 运行时读取）
├── docs/                     ← 参考文档（子 agent 自行按路径读取）
│   ├── java-standards.md
│   ├── spring-boot-reference.md
│   ├── mybatis-reference.md
│   └── state-structure.md    ← state.json 字段说明
├── scripts/
│   ├── get-diff-files.js     ← 生成变动文件清单（可选跳过低风险类型）
│   ├── batch-processor.js    ← 智能分批
│   └── export-batch-diffs.js ← 按批次预计算 unified diff（各专家共用）
├── templates/
│   └── report-template.md    ← 最终报告模板
└── prompts/                  ← 子 agent 系统提示词（opencode/其它编排器按文件加载）
    ├── tech-stack-analysis.md
    ├── task-planner.md
    ├── code-scanner.md       ← core：核心静态（兼容旧文件名）
    ├── framework-reviewer.md ← spring：Spring/可靠性（兼容旧文件名）
    ├── security-reviewer.md
    ├── perf-reviewer.md      ← data：数据与性能（兼容旧文件名）
    ├── fix-advisor.md
    └── report-synthesizer.md
```

**运行时生成：**

```
{项目根}/
├── .codereview/
│   ├── state.json            ← 全程状态（断点核心）
│   ├── diffs/                ← 各批次 *.patch（预计算 diff，Phase 2 生成）
│   ├── file-inventory.json
│   ├── tech-stack.json
│   ├── task-plan.json
│   └── results/              ← 各专家 JSON
└── codereview/
    └── report_<branch>_<date>.md
```

---

## 2. 核心机制：断点续跑与故障恢复

### 2.1 状态驱动

**每个操作前读 `state.json`，每个操作后立即写回。** 字段详见 `{SKILL_ROOT}/docs/state-structure.md`。

关键字段：
- `current_phase`：当前大阶段（`branch_selection` → `diff_analysis` → `tech_stack` → `task_planning` → `reviewing` → `synthesizing` → `completed`）
- `review_progress.{batch-NNN}.{expert}`：`pending` / `in_progress` / `completed` / `skipped` / `failed`

### 2.2 主编排 Agent 启动逻辑（每次对话开头必执行）

```
1. 确认 {SKILL_ROOT} 绝对路径（读取本 SKILL.md 的目录）
2. 读取 .codereview/state.json
   ├─ 不存在 → 进入 Phase 0（初始化）
   └─ 存在   → 读取 current_phase
       ├─ completed     → 告知用户「检视已完成，报告在 codereview/ 下」
       └─ 其它          → 跳转到对应 Phase 继续
3. 兼容性补丁：若 state.json 不含 review_options 字段
   → 补入默认值 { "severity_mode": "all", "skip_low_risk_files": false }
   → 写回 state.json（保证后续阶段可安全读取）
4. 对 reviewing 阶段：按批次、按专家顺序（见 Phase 5）扫描 review_progress，
   找到第一个 status 为 pending 或 in_progress 的 {batch}+{expert}（completed / skipped / failed 跳过；
   in_progress 时先按 docs/state-structure.md「in_progress 防死锁」校验结果 JSON，再决定 completed 或改 pending 重跑）
5. 对 synthesizing 阶段：若 synthesis.report_path 已有可读报告文件，可将 synthesis 与 current_phase 标为完成；否则重跑报告合成
6. 幂等（可选）：tech_stack 且 tech-stack.json 已合法 → 可直接进入 task_planning；task_planning 且 task-plan.json 已存在 → 补全 review_progress 后进入 reviewing
```

**这意味着**：用户可以在任何时刻关闭主编排 Agent，重新打开后它会自动从断点继续。

### 2.3 子 agent 调用与故障恢复

**调用子 agent 的标准流程：**

```
1. 将对应专家的 state 设为 "in_progress"，写回 state.json
2. 拉起子 agent，传入变量（见各阶段说明）
3. 等待子 agent 返回结果
4. 检查结果文件是否已写入（如 .codereview/results/batch-001-core.json）
   ├─ 文件存在且 JSON 合法 → 将 state 设为 "completed"
   └─ 文件不存在或异常   → 进入故障恢复
```

**故障恢复（子 agent 超时/上下文超长/报错）：**

```
1. 将该专家 state 重置为 "pending"（而非 in_progress，防止死锁）
2. 写回 state.json
3. 重新拉起一个全新的子 agent 实例（新上下文）
4. 最多重试 2 次；仍失败则标记 "failed"，记录到 notes[]，继续下一个专家
```

### 2.4 主编排 Agent 自身上下文保护

- 主编排 Agent **禁止**将子 agent 的提示词全文、docs/ 参考文档、专家结果 JSON 全量粘贴到主对话
- 主编排 Agent 只传递**变量名和路径**给子 agent
- 当主编排 Agent 感知到上下文接近极限时：将当前进度写入 state.json，输出「当前进度已保存，请重新启动主编排 Agent 继续」

### 2.5 opencode 并行执行约定

本 Skill 可通过 opencode 执行。主编排 Agent 应将 `prompts/*.md` 作为子 agent 的系统提示词来源，并通过任务描述传入变量。每个子 agent 的唯一交付物是写入约定的 `OUTPUT_PATH` JSON/报告文件；主编排 Agent 只检查文件，不依赖对话内容合并结果。

**并行原则：**

- Phase 3 技术栈、Phase 4 任务规划存在依赖关系，必须串行。
- Phase 5 中，同一批次内 `core`、`security`、`spring`、`data` 四个专家彼此独立，凡 `task-plan.json` 标记为适用且状态为 `pending` / `failed` 的，可以通过 opencode 并行拉起。
- 并行启动前，先把这些专家状态统一写为 `in_progress`；每个子 agent 写自己的固定输出文件，互不共享写入目标。
- 等同批次所有适用专家完成后，才能执行该批次的 `fix-advisor`；fix 完成后再进入下一批次或报告合成。
- 若 opencode 当前环境不支持并行任务，则按 `core → security → spring → data` 串行降级，输出文件与状态规则保持不变。

---

## 3. 阶段详情

### Phase 0：初始化

```
若 .codereview/ 目录不存在 → 创建
若 state.json 不存在 → 按 docs/state-structure.md 创建初始结构
设置 current_phase = "branch_selection"
```

---

### Phase 1：分支与检视选项（主编排 Agent 本地执行）

1. 向用户确认：`BRANCH1`（被检视分支）、`BRANCH2`（基准，默认 `master`）
2. **检视深度**（必问，写入 `state.json` → `review_options.severity_mode`）：
   - `all`：全部级别（Critical / High / Medium / Low 均报告）
   - `critical_high_only`：仅 Critical + High（专家不得输出 Medium / Low）
3. **是否跳过低风险文件**（必问，写入 `review_options.skip_low_risk_files`：`true` / `false`）：
   - **是**：Phase 2 调用 `get-diff-files.js` 时追加 `--skip-low-risk true`，清单排除脚本识别的 DTO/VO/Request/Response、Entity/DO/PO、测试类（`*Test` / `*Tests`）；`file-inventory.json` 的 `review_scope` 记录被跳过路径
   - **否**：不排除（仍可按 task-plan 对纯 POJO 批次做专家剪枝）
4. 验证分支存在：`git rev-parse --verify <branch>`（返回非空即存在；**不要**用 `grep`，Windows PowerShell 无此命令）
5. 更新 `state.json`：写入 `branches`、`review_options`，设 `current_phase = "diff_analysis"`

---

### Phase 2：变动文件与分批（主编排 Agent + 脚本）

**Step 1：生成清单**（若 `review_options.skip_low_risk_files === true`，追加 `--skip-low-risk true`）
```powershell
node "{SKILL_ROOT}/scripts/get-diff-files.js" --branch1 {BRANCH1} --branch2 {BRANCH2} --output .codereview/file-inventory.json
```

**Step 2：分批**
```powershell
node "{SKILL_ROOT}/scripts/batch-processor.js" --inventory .codereview/file-inventory.json --max-lines 600 --output .codereview/file-inventory.json
```

**Step 3：预计算批次 diff（默认执行）**

多专家各自反复 `git diff` 会重复 I/O，且 diff 文本可能不一致。**每批次只对 Git 调用一次**，将 unified diff 写入 `.codereview/diffs/{BATCH_ID}.patch`，子 agent **优先读该文件**，与多次单文件 diff 等价，上下文更稳定。

```powershell
node "{SKILL_ROOT}/scripts/export-batch-diffs.js" --inventory .codereview/file-inventory.json --output-dir .codereview/diffs
```

脚本会更新 `file-inventory.json` 的 `diff_bundle`（含 `manifest.json`）。若某 patch 为空，子专家可回退为按文件 `git diff`。若 `manifest` 中单批 `byte_length` 过大，可告警或调整 `max-lines` 分批。

**Step 4：** 向用户展示批次数、文件数、行数及跳过低风险统计（若有），确认后设 `current_phase = "tech_stack"`

---

### Phase 3：技术栈分析

**拉起子 agent：** `java-codereview-tech-stack`
**提示词文件：** `{SKILL_ROOT}/prompts/tech-stack-analysis.md`

**传入变量：**
| 变量 | 值 |
|------|---|
| `PROJECT_ROOT` | 项目仓库根目录 |
| `OUTPUT_PATH` | `.codereview/tech-stack.json` |

**完成标志：** `.codereview/tech-stack.json` 文件存在且 JSON 合法

**完成后：** 设 `current_phase = "task_planning"`

---

### Phase 4：任务规划

**拉起子 agent：** `java-codereview-task-plan`
**提示词文件：** `{SKILL_ROOT}/prompts/task-planner.md`

**传入变量：**
| 变量 | 值 |
|------|---|
| `INVENTORY_PATH` | `.codereview/file-inventory.json` |
| `TECH_STACK_PATH` | `.codereview/tech-stack.json` |
| `OUTPUT_PATH` | `.codereview/task-plan.json` |

**完成标志：** `.codereview/task-plan.json` 文件存在

**完成后：** 根据 `task-plan.json` 中的批次信息初始化 `review_progress`（每批每专家设 `pending`，不适用的设 `skipped`），设 `current_phase = "reviewing"`

---

### Phase 5：多专家检视（循环：批次 × 专家）

**核心循环逻辑：**

```
读取 state.json 的 review_progress
遍历所有批次（batch-001, batch-002, ...）：
  遍历该批次的专家（core → security → spring → data）：
    if status == "completed" or "skipped" → 跳过
    if status == "pending" or "failed"   → 执行该专家
    执行完成 → 立即写回 state.json
  该批次所有专家完成后：
    执行 fix-advisor（Phase 6 单批）
    fix 状态设 completed → 写回 state.json

所有批次全部完成 → current_phase = "synthesizing"
```

**每个专家的子 agent 调用：**

| 专家 | 子 agent 标识 | 提示词文件 | 输出文件 |
|------|----------------|------------|---------|
| core | `java-codereview-review-core` | `{SKILL_ROOT}/prompts/code-scanner.md` | `.codereview/results/{BATCH_ID}-core.json` |
| security | `java-codereview-review-security` | `{SKILL_ROOT}/prompts/security-reviewer.md` | `...-security.json` |
| spring | `java-codereview-review-spring` | `{SKILL_ROOT}/prompts/framework-reviewer.md` | `...-spring.json` |
| data | `java-codereview-review-data` | `{SKILL_ROOT}/prompts/perf-reviewer.md` | `...-data.json` |

**统一传入变量（每次拉起子 agent 必传）：**

| 变量 | 值 |
|------|---|
| `BATCH_ID` | 如 `batch-001` |
| `BATCH_FILES` | 该批次文件列表 JSON（从 task-plan.json 读取） |
| `BRANCH1` | 被检视分支 |
| `BRANCH2` | 基准分支 |
| `DIFF_PATCH_PATH` | `.codereview/diffs/{BATCH_ID}.patch`（Phase 2 已导出则必传；不存在则子 agent 仅用 git） |
| `SEVERITY_MODE` | `state.json` → `review_options.severity_mode`（`all` 或 `critical_high_only`） |
| `TECH_STACK` | tech-stack.json 内容摘要（或路径，让子 agent 自读） |
| `OUTPUT_PATH` | 结果文件路径 |
| `SKILL_ROOT` | 本 Skill 根目录（子 agent 需读取 docs/ 下参考文档） |

**检视范围（硬性规则，传达给每个子 agent）：**

> **优先**读取 `DIFF_PATCH_PATH` 中的 unified diff（与 `git --no-pager diff {BRANCH2}...{BRANCH1} -- <paths…>` 等价）。缺失或为空时再对每个文件执行 `git --no-pager diff {BRANCH2}...{BRANCH1} -- <file>`。
> 只检视变更行；禁止对未改动代码批量报问题。`line` 字段必须为字符串；每条 issue 必须补充 `symbol`（如 `UserServiceImpl#createOrder`、`UserMapper.xml#selectById`），报告不得只依赖行号定位。
>
> 若 `SEVERITY_MODE` 为 `critical_high_only`，**仅**输出 `critical` 与 `high`，不得输出 `medium` / `low`。

**opencode 并行派发建议：**

同一 `BATCH_ID` 中，对 `applicable_experts` 取交集后可一次性并行拉起多个子 agent。每个任务必须显式包含：`BATCH_ID`、`BATCH_FILES`、`BRANCH1`、`BRANCH2`、`DIFF_PATCH_PATH`、`SEVERITY_MODE`、`TECH_STACK`、`SKILL_ROOT`、独立 `OUTPUT_PATH`，并强调“完成后只写对应输出文件”。主编排 Agent 等待这一组输出文件全部存在且 JSON 合法后，再将对应状态改为 `completed`。

**适用性剪枝（来自 task-plan.json 的 `applicable_experts`）：**

- 若 `review_options.skip_low_risk_files` 为 `true`，DTO/Entity/测试类已在 Phase 2 排除，不会出现在批次中
- 若为 `false`：纯 POJO/DTO/Entity 批次 → 跳过 spring、data
- 纯 Mapper XML → 重点 data + core
- Controller → security + spring 重点
- Service → spring + data 重点

---

### Phase 6：修复建议（每批次一次，嵌入 Phase 5 循环中）

**拉起子 agent：** `java-codereview-fix-advisor`
**提示词文件：** `{SKILL_ROOT}/prompts/fix-advisor.md`

**传入变量：**
| 变量 | 值 |
|------|---|
| `BATCH_ID` | 当前批次 |
| `BATCH_FILES` | 当前批次文件列表 |
| `BRANCH1` | 被检视分支（与 Phase 5 相同） |
| `BRANCH2` | 基准分支（与 Phase 5 相同） |
| `DIFF_PATCH_PATH` | `.codereview/diffs/{BATCH_ID}.patch`（Phase 2 `export-batch-diffs.js` 已生成；主编排 Agent 按 `BATCH_ID` 自动拼装路径并传入，**用户无需填写**；与检视专家共用同一份 unified diff） |
| `RESULTS_DIR` | `.codereview/results/` |
| `SEVERITY_MODE` | 同 Phase 5（`critical_high_only` 时仅对 C/H 问题给修复建议） |
| `OUTPUT_PATH` | `.codereview/results/{BATCH_ID}-fix.json` |

**修复阶段上下文规则（须传达给子 agent）：** 优先从 `DIFF_PATCH_PATH` 中定位各 `issue` 对应文件与行号附近的 hunk，用 patch 内已有上下文生成修复片段；**禁止**对同一工作区源文件反复 `read_file`。仅当 patch 缺失、为空或 hunk 上下文不足以写出正确补丁时，对该文件**最多**使用一次工作区读取（或 `git --no-pager diff {BRANCH2}...{BRANCH1} -- <file>`），并合并该文件内多条 issue 所需的行区间。

---

### Phase 7：报告合成

**拉起子 agent：** `java-codereview-report-synthesizer`
**提示词文件：** `{SKILL_ROOT}/prompts/report-synthesizer.md`

**传入变量：**
| 变量 | 值 |
|------|---|
| `STATE_PATH` | `.codereview/state.json` |
| `RESULTS_DIR` | `.codereview/results/` |
| `TECH_STACK_PATH` | `.codereview/tech-stack.json` |
| `INVENTORY_PATH` | `.codereview/file-inventory.json` |
| `TEMPLATE_PATH` | `{SKILL_ROOT}/templates/report-template.md` |
| `REPORT_PATH` | `codereview/report_{BRANCH1}_{DATE}.md`（`/` → `_`） |

合成官须读取 `state.json` 的 `review_options` 与 `file-inventory.json` 的 `review_scope`，填入报告基本信息（检视深度、是否跳过低风险及跳过文件数）。

**完成后：** 设 `current_phase = "completed"`，向用户输出报告路径与问题统计摘要。

---

## 4. 子 agent / opencode 标识对照表

用户需在 opencode 或其它 AI 编排器中预先创建以下子 agent。系统提示词取自 `{SKILL_ROOT}/prompts/` 对应文件：

| 标识 | 提示词来源 | Phase |
|------|-----------|-------|
| `java-codereview-tech-stack` | `prompts/tech-stack-analysis.md` | 3 |
| `java-codereview-task-plan` | `prompts/task-planner.md` | 4 |
| `java-codereview-review-core` | `prompts/code-scanner.md` | 5 |
| `java-codereview-review-spring` | `prompts/framework-reviewer.md` | 5 |
| `java-codereview-review-security` | `prompts/security-reviewer.md` | 5 |
| `java-codereview-review-data` | `prompts/perf-reviewer.md` | 5 |
| `java-codereview-fix-advisor` | `prompts/fix-advisor.md` | 6 |
| `java-codereview-report-synthesizer` | `prompts/report-synthesizer.md` | 7 |

兼容说明：`prompts/spec-reviewer.md` 同 core，`prompts/robustness-reviewer.md` 同 spring，`prompts/sql-reviewer.md` 同 data，保留旧文件名是为了不破坏已有配置；新流程只使用上表 8 个标识。

---

## 5. Git 命令备忘

```powershell
git rev-parse --verify "branch-name"
git --no-pager diff --name-only {BRANCH2}...{BRANCH1}
git --no-pager diff {BRANCH2}...{BRANCH1} -- path/to/File.java
git --no-pager diff --stat {BRANCH2}...{BRANCH1}
```

---

## 6. 主编排 Agent 禁令（防上下文爆炸）

1. **不要**将 `prompts/*.md` 的内容读入主对话
2. **不要**将 `docs/*.md` 参考文档全文读入主对话（留给子 agent 自读）
3. **不要**将专家结果 JSON 全文读入主对话（只在需要验证时读几行确认文件存在与格式）
4. **不要**在主对话中做代码检视（那是子 agent 的事）
5. 如果感知到上下文接近极限 → 立刻写 state.json → 告知用户重启
