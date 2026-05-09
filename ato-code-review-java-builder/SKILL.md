---
name: ato-code-review-java
description: >-
  Java 后端增量代码检视 Skill。主 Builder 读取本文件驱动全流程，通过拉起预配置的子 Builder
  逐阶段完成检视，所有中间状态持久化到 .codereview/state.json，支持任意环节断点续跑，
  解决 GLM-4.7 等中等上下文模型的长度限制。
---

# Java 后端代码检视 · 主 Builder 工作流

> **本文件是主 Builder 运行时的唯一指令来源。**
> 主 Builder 启动后读取本文件，按阶段推进，通过拉起子 Builder 执行检视；
> 主 Builder 自身**不做**深度代码检视，只负责编排、状态管理与故障恢复。

---

## 1. Skill 目录（`{SKILL_ROOT}` = SKILL.md 所在目录）

```
{SKILL_ROOT}/
├── SKILL.md                  ← 本文件（主 Builder 运行时读取）
├── docs/                     ← 参考文档（子 Builder 自行按路径读取）
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
└── builder-prompts/          ← ⚠️ 仅供人工创建 Builder 时参考，运行时不读取
    ├── README.md
    ├── main/MAIN_BUILDER.md  ← 主 Builder 系统提示词（粘贴到 Builder 配置）
    └── subagents/            ← 8 个子 Builder 系统提示词
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

### 2.2 主 Builder 启动逻辑（每次对话开头必执行）

```
1. 确认 {SKILL_ROOT} 绝对路径（读取本 SKILL.md 的目录）
2. 读取 .codereview/state.json
   ├─ 不存在 → 进入 Phase 0（初始化）
   └─ 存在   → 读取 current_phase
       ├─ completed     → 告知用户「检视已完成，报告在 codereview/ 下」
       └─ 其它          → 跳转到对应 Phase 继续
3. 兼容性补丁：
   a. 若 state.json 不含 review_options 字段
      → 补入默认值 { "severity_mode": "all", "skip_low_risk_files": false }
   b. 若 review_progress[*] 缺少 curator 键（升级到含 issue-curator 的版本）
      → 对每个批次补入 curator: "pending"，position 在 data 与 fix 之间
   → 写回 state.json（保证后续阶段可安全读取）
4. 对 reviewing 阶段：按批次、按专家顺序（见 Phase 5）扫描 review_progress，
   找到第一个 status 为 pending 或 in_progress 的 {batch}+{expert}（completed / skipped / failed 跳过；
   in_progress 时先按 docs/state-structure.md「in_progress 防死锁」校验结果 JSON，再决定 completed 或改 pending 重跑）
5. 对 synthesizing 阶段：若 synthesis.report_path 已有可读报告文件，可将 synthesis 与 current_phase 标为完成；否则重跑报告合成
6. 幂等（可选）：tech_stack 且 tech-stack.json 已合法 → 可直接进入 task_planning；task_planning 且 task-plan.json 已存在 → 补全 review_progress 后进入 reviewing
```

**这意味着**：用户可以在任何时刻关闭主 Builder，重新打开后它会自动从断点继续。

### 2.3 子 Builder 调用与故障恢复

**调用子 Builder 的标准流程：**

```
1. 将对应专家的 state 设为 "in_progress"，写回 state.json
2. 拉起子 Builder，传入变量（见各阶段说明）
3. 等待子 Builder 返回结果
4. 检查结果文件是否已写入（如 .codereview/results/batch-001-core.json）
   ├─ 文件存在且 JSON 合法 → 将 state 设为 "completed"
   └─ 文件不存在或异常   → 进入故障恢复
```

**故障恢复（子 Builder 超时/上下文超长/报错）：**

```
1. 将该专家 state 重置为 "pending"（而非 in_progress，防止死锁）
2. 写回 state.json
3. 重新拉起一个全新的子 Builder 实例（新上下文）
4. 最多重试 2 次；仍失败则标记 "failed"，记录到 notes[]，继续下一个专家
```

### 2.4 主 Builder 自身上下文保护

- 主 Builder **禁止**将子 Builder 的提示词全文、docs/ 参考文档、专家结果 JSON 全量粘贴到主对话
- 主 Builder 只传递**变量名和路径**给子 Builder
- 当主 Builder 感知到上下文接近极限时：将当前进度写入 state.json，输出「当前进度已保存，请重新启动主 Builder 继续」

---

## 3. 阶段详情

### Phase 0：初始化

```
若 .codereview/ 目录不存在 → 创建
若 state.json 不存在 → 按 docs/state-structure.md 创建初始结构
设置 current_phase = "branch_selection"
```

---

### Phase 1：分支与检视选项（主 Builder 本地执行）

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

### Phase 2：变动文件与分批（主 Builder + 脚本）

**Step 1：生成清单**（若 `review_options.skip_low_risk_files === true`，追加 `--skip-low-risk true`）
```powershell
node "{SKILL_ROOT}/scripts/get-diff-files.js" --branch1 {BRANCH1} --branch2 {BRANCH2} --output .codereview/file-inventory.json
```

**Step 2：分批**
```powershell
node "{SKILL_ROOT}/scripts/batch-processor.js" --inventory .codereview/file-inventory.json --max-lines 600 --output .codereview/file-inventory.json
```

**Step 3：预计算批次 diff（默认执行）**

多专家各自反复 `git diff` 会重复 I/O，且 diff 文本可能不一致。**每批次只对 Git 调用一次**，将 unified diff 写入 `.codereview/diffs/{BATCH_ID}.patch`，子 Builder **优先读该文件**，与多次单文件 diff 等价，上下文更稳定。

```powershell
node "{SKILL_ROOT}/scripts/export-batch-diffs.js" --inventory .codereview/file-inventory.json --output-dir .codereview/diffs
```

脚本会更新 `file-inventory.json` 的 `diff_bundle`（含 `manifest.json`）。若某 patch 为空，子专家可回退为按文件 `git diff`。若 `manifest` 中单批 `byte_length` 过大，可告警或调整 `max-lines` 分批。

**Step 4：** 向用户展示批次数、文件数、行数及跳过低风险统计（若有），确认后设 `current_phase = "tech_stack"`

---

### Phase 3：技术栈分析

**拉起子 Builder：** `java-codereview-tech-stack`

**传入变量：**
| 变量 | 值 |
|------|---|
| `PROJECT_ROOT` | 项目仓库根目录 |
| `OUTPUT_PATH` | `.codereview/tech-stack.json` |

**完成标志：** `.codereview/tech-stack.json` 文件存在且 JSON 合法

**完成后：** 设 `current_phase = "task_planning"`

---

### Phase 4：任务规划

**拉起子 Builder：** `java-codereview-task-plan`

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
  该批次 4 位检视专家全部 completed/skipped 后：
    执行 issue-curator（Phase 5.5 单批，跨专家合并 + 函数体级误报排除）
    curator 状态设 completed → 写回 state.json
  curator 完成后：
    执行 fix-advisor（Phase 6 单批，输入为 curated.json）
    fix 状态设 completed → 写回 state.json

所有批次全部完成 → current_phase = "synthesizing"
```

**每个专家的子 Builder 调用：**

| 专家 | 子 Builder 标识 | 输出文件 |
|------|----------------|---------|
| core | `java-codereview-review-core` | `.codereview/results/{BATCH_ID}-core.json` |
| security | `java-codereview-review-security` | `...-security.json` |
| spring | `java-codereview-review-spring` | `...-spring.json` |
| data | `java-codereview-review-data` | `...-data.json` |

**统一传入变量（每次拉起子 Builder 必传）：**

| 变量 | 值 |
|------|---|
| `BATCH_ID` | 如 `batch-001` |
| `BATCH_FILES` | 该批次文件列表 JSON（从 task-plan.json 读取） |
| `BRANCH1` | 被检视分支 |
| `BRANCH2` | 基准分支 |
| `DIFF_PATCH_PATH` | `.codereview/diffs/{BATCH_ID}.patch`（Phase 2 已导出则必传；不存在则子 Builder 仅用 git） |
| `SEVERITY_MODE` | `state.json` → `review_options.severity_mode`（`all` 或 `critical_high_only`） |
| `TECH_STACK` | tech-stack.json 内容摘要（或路径，让子 Builder 自读） |
| `OUTPUT_PATH` | 结果文件路径 |
| `SKILL_ROOT` | 本 Skill 根目录（子 Builder 需读取 docs/ 下参考文档） |

**检视范围（硬性规则，传达给每个子 Builder）：**

> **优先**读取 `DIFF_PATCH_PATH` 中的 unified diff（与 `git --no-pager diff {BRANCH2}...{BRANCH1} -- <paths…>` 等价）。缺失或为空时再对每个文件执行 `git --no-pager diff {BRANCH2}...{BRANCH1} -- <file>`。
> 只检视变更行；禁止对未改动代码批量报问题。`line` 字段必须为字符串；每条 issue 必须补充 `symbol`（如 `UserServiceImpl#createOrder`、`UserMapper.xml#selectById`），报告不得只依赖行号定位。
>
> 若 `SEVERITY_MODE` 为 `critical_high_only`，**仅**输出 `critical` 与 `high`，不得输出 `medium` / `low`。

**适用性剪枝（来自 task-plan.json 的 `applicable_experts`）：**

- 若 `review_options.skip_low_risk_files` 为 `true`，DTO/Entity/测试类已在 Phase 2 排除，不会出现在批次中
- 若为 `false`：纯 POJO/DTO/Entity 批次 → 跳过 spring、data
- 纯 Mapper XML → 重点 data + core
- Controller → security + spring 重点
- Service → spring + data 重点

---

### Phase 5.5：问题策展（每批次一次，嵌入 Phase 5 循环；4 专家完成后执行）

**拉起子 Builder：** `java-codereview-issue-curator`

**目的：**
1. **跨专家合并**：把同一文件、同一行（区间重叠）、实质相同根因的多条 issue 合并为一条主条目（按主责专家优先级），其余视角并入 `merged_from[]`，避免 fix-advisor 与最终报告对同一行写出多段重复内容
2. **函数体级关联复核**：对合并后剩余的每条 issue，**仅在其所在函数体（或 XML SQL 节点）范围内**检查是否已通过判空 / try-with-resources / `@Valid` / 工具断言 / 白名单 / 同步原语等手段处理；已处理的移入 `invalidated[]` 不再下发，避免误报

**传入变量：**
| 变量 | 值 |
|------|---|
| `BATCH_ID` | 当前批次 |
| `BATCH_FILES` | 当前批次文件列表 |
| `BRANCH1` / `BRANCH2` | 同 Phase 5 |
| `DIFF_PATCH_PATH` | `.codereview/diffs/{BATCH_ID}.patch`（与 Phase 5 共用） |
| `SEVERITY_MODE` | 同 Phase 5（`critical_high_only` 时不得保留 medium / low） |
| `RESULTS_DIR` | `.codereview/results/`（用于读取 4 份原始专家 JSON） |
| `OUTPUT_PATH` | `.codereview/results/{BATCH_ID}-curated.json` |
| `SKILL_ROOT` | 本 Skill 根目录 |

**完成标志：** `{BATCH_ID}-curated.json` 文件存在且 JSON 合法（含 `summary` / `issues[]` / `invalidated[]` 三个字段）

**与 fix-advisor 的契约：** 策展输出是 fix-advisor 的**唯一输入源**；fix-advisor 不应再读 4 份原始专家 JSON（仅 curated.json 缺失时兜底）。

---

### Phase 6：修复建议（每批次一次，嵌入 Phase 5 循环中）

**拉起子 Builder：** `java-codereview-fix-advisor`

**传入变量：**
| 变量 | 值 |
|------|---|
| `BATCH_ID` | 当前批次 |
| `BATCH_FILES` | 当前批次文件列表 |
| `BRANCH1` | 被检视分支（与 Phase 5 相同） |
| `BRANCH2` | 基准分支（与 Phase 5 相同） |
| `DIFF_PATCH_PATH` | `.codereview/diffs/{BATCH_ID}.patch`（Phase 2 `export-batch-diffs.js` 已生成；主 Builder 按 `BATCH_ID` 自动拼装路径并传入，**用户无需填写**；与检视专家共用同一份 unified diff） |
| `CURATED_PATH` | `.codereview/results/{BATCH_ID}-curated.json`（Phase 5.5 输出，**优先输入**；缺失时 fix-advisor 自动回退读 4 份原始专家 JSON） |
| `RESULTS_DIR` | `.codereview/results/`（兜底回退路径） |
| `SEVERITY_MODE` | 同 Phase 5（`critical_high_only` 时仅对 C/H 问题给修复建议） |
| `OUTPUT_PATH` | `.codereview/results/{BATCH_ID}-fix.json` |

**修复阶段上下文规则（须传达给子 Builder）：** 优先从 `DIFF_PATCH_PATH` 中定位各 `issue` 对应文件与行号附近的 hunk，用 patch 内已有上下文生成修复片段；**禁止**对同一工作区源文件反复 `read_file`。仅当 patch 缺失、为空或 hunk 上下文不足以写出正确补丁时，对该文件**最多**使用一次工作区读取（或 `git --no-pager diff {BRANCH2}...{BRANCH1} -- <file>`），并合并该文件内多条 issue 所需的行区间。

---

### Phase 7：报告合成

**拉起子 Builder：** `java-codereview-report-synthesizer`

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

## 4. 子 Builder 标识对照表

用户需在 AI 插件中预先创建以下 Builder，系统提示词取自 `{SKILL_ROOT}/builder-prompts/subagents/` 对应文件：

| 标识 | 提示词来源 | Phase |
|------|-----------|-------|
| `java-codereview-tech-stack` | `subagents/01-tech-stack.md` | 3 |
| `java-codereview-task-plan` | `subagents/02-task-plan.md` | 4 |
| `java-codereview-review-core` | `subagents/03-review-core.md` | 5 |
| `java-codereview-review-spring` | `subagents/04-review-spring.md` | 5 |
| `java-codereview-review-security` | `subagents/05-review-security.md` | 5 |
| `java-codereview-review-data` | `subagents/06-review-data.md` | 5 |
| `java-codereview-issue-curator` | `subagents/07-issue-curator.md` | 5.5 |
| `java-codereview-fix-advisor` | `subagents/08-fix-advisor.md` | 6 |
| `java-codereview-report-synthesizer` | `subagents/09-report-synthesizer.md` | 7 |

---

## 5. Git 命令备忘

```powershell
git rev-parse --verify "branch-name"
git --no-pager diff --name-only {BRANCH2}...{BRANCH1}
git --no-pager diff {BRANCH2}...{BRANCH1} -- path/to/File.java
git --no-pager diff --stat {BRANCH2}...{BRANCH1}
```

---

## 6. 主 Builder 禁令（防上下文爆炸）

1. **不要**将 `builder-prompts/subagents/*.md` 的内容读入主对话
2. **不要**将 `docs/*.md` 参考文档全文读入主对话（留给子 Builder 自读）
3. **不要**将专家结果 JSON 全文读入主对话（只在需要验证时读几行确认文件存在与格式）
4. **不要**在主对话中做代码检视（那是子 Builder 的事）
5. 如果感知到上下文接近极限 → 立刻写 state.json → 告知用户重启
