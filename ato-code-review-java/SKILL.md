---
name: ato-code-review-java
description: >-
  Java 后端增量代码检视 Skill。主编排 Agent 读取本文件驱动全流程，可通过 opencode
  并行拉起子 agent/subagent 逐阶段完成检视，所有中间状态持久化到 .codereview/state.json，
  支持任意环节断点续跑。启动后 Phase 1 必须向用户逐项确认分支、检视深度、跳过低风险、是否生成 HTML，
  四项全部收齐并复述确认前禁止进入 Phase 2。opencode 主编排 Agent 必须通过 scripts/update-state.js 落盘 state.json，禁止仅在对话中更新进度。
---

# Java 后端代码检视 · 主编排工作流

> **本文件是主编排 Agent 运行时的唯一指令来源**（opencode / Builder 均加载本 `SKILL.md`）。
> 主编排 Agent 启动后按阶段推进，通过 opencode/子 agent 执行检视；
> 主编排 Agent 自身**不做**深度代码检视，只负责编排、状态管理、并行调度与故障恢复。

---

## 0. 主编排启动清单（每次对话最先执行，优先于下文所有章节）

### 0.1 读 state

```bash
# 不存在则：
node "{SKILL_ROOT}/scripts/update-state.js" --init --checkpoint phase0_init
```

### 0.2 Phase 1 四问（`user_confirmed !== true` 时**只做本步**）

**禁止**：只问分支就跑脚本 / 拉子 agent；用补丁默认值代替用户选择。

**必须**向用户**一次性**发送（四项同一条消息，不要分多轮只问第 1 项）：

```
请确认本次 Java 增量检视配置（四项均需回复，缺一不可）：

1) 分支 — BRANCH1：___  BRANCH2：（默认 master）
2) 检视深度 severity_mode — all | critical_high_only
3) 跳过低风险 skip_low_risk_files — true | false
4) 生成 HTML generate_html_report — true | false
```

用户只答分支 → 说明还需 2/3/4，**不得**继续。

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

确认输出 `{"ok":true}` 且 `user_confirmed===true` 后，才进入 Phase 2。  
Phase 2 脚本内置门禁：未完成 Phase 1 会报 `PHASE1_REQUIRED` 并 exit 2。

### 0.3 落盘 state（全程）

每个操作后用 `update-state.js` 写 `.codereview/state.json`（禁止只在聊天里说进度）。检查点表见 §2.6。子 agent **不写** state。

### 0.4 断点续跑

读 `current_phase` / `review_progress` 继续；**但 `user_confirmed !== true` 一律回到 §0.2**。

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
│   ├── export-batch-diffs.js ← 按批次预计算 unified diff（各专家共用）
│   ├── git-line-authors.js   ← Phase 7 前：issue 行 git blame + 参与开发者
│   ├── sync-report-signoff.js← HTML 签收 payload 回写 MD（CLI 兜底）
│   ├── update-state.js       ← 主编排 Agent 写 state.json（必用）
│   └── require-phase1.js     ← Phase 2 脚本门禁（内部引用）
├── templates/
│   ├── report-template.md    ← 最终 MD 报告模板
│   └── report-shell.html     ← HTML 报告壳模板（Phase 7.5）
└── prompts/                  ← 子 agent 系统提示词（opencode/其它编排器按文件加载）
    ├── tech-stack-analysis.md
    ├── task-planner.md
    ├── code-scanner.md       ← core：核心静态（兼容旧文件名）
    ├── framework-reviewer.md ← spring：Spring/可靠性（兼容旧文件名）
    ├── security-reviewer.md
    ├── perf-reviewer.md      ← data：数据与性能（兼容旧文件名）
    ├── issue-curator.md      ← curator：跨专家合并 + 函数体级误报排除
    ├── fix-advisor.md
    ├── report-synthesizer.md
    └── report-html.md        ← Phase 7.5 HTML 渲染（可选）
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
│   ├── line-authors.json     ← Phase 7 git-line-authors.js 产出（提交人映射）
│   └── results/              ← 各专家 JSON
└── codereview/
    ├── report_<branch>_<date>.md
    └── report_<branch>_<date>.html   ← 仅当 generate_html_report 为 true
```

---

## 2. 核心机制：断点续跑与故障恢复

### 2.1 状态驱动

**每个操作前读 `state.json`，每个操作后立即写回磁盘。** 字段详见 `{SKILL_ROOT}/docs/state-structure.md`。

> **opencode 硬性要求**：主编排 Agent **必须**用 shell 执行 `node "{SKILL_ROOT}/scripts/update-state.js" ...` 更新状态（或等价地 Write 整个 `.codereview/state.json`）。**禁止**仅在聊天里说「已进入 reviewing / 某专家已完成」而不写文件；用户应以磁盘上的 `state.json` 的 `updated_at` 与 `last_checkpoint` 为准。

关键字段：
- `current_phase`：当前大阶段（`branch_selection` → `diff_analysis` → `tech_stack` → `task_planning` → `reviewing` → `synthesizing` → `html_rendering`（可选）→ `completed`）
- `review_progress.{batch-NNN}.{expert}`：`pending` / `in_progress` / `completed` / `skipped` / `failed`

### 2.2 主编排 Agent 启动逻辑（每次对话开头必执行）

```
1. 确认 {SKILL_ROOT} 绝对路径（读取本 SKILL.md 的目录）
2. 读取 .codereview/state.json
   ├─ 不存在 → 进入 Phase 0（初始化）
   └─ 存在   → 读取 current_phase
       ├─ completed     → 按 synthesis.html_status 三态输出报告路径（见 Phase 7 / 7.5 完成后说明）
       └─ 其它          → 跳转到对应 Phase 继续
3. 兼容性补丁：
   a. 若 state.json 不含 review_options 字段
      → 补入默认值 { "severity_mode": "all", "skip_low_risk_files": false, "generate_html_report": false }
   b. 若 review_options 缺少 generate_html_report → 补 false（**仅字段占位**；不得据此跳过 Phase 1 向用户提问）
   c. 若 review_options 缺少 user_confirmed → 补 false（为 false 时必须执行完整 Phase 1 清单）
   d. 若 synthesis 缺少 html_report_path / html_status → 补 "" 与 "skipped"
   e. 若 review_progress[*] 缺少 curator 键（升级到含 issue-curator 的版本）
      → 对每个批次补入 curator: "pending"，position 在 data 与 fix 之间
   → 写回 state.json（保证后续阶段可安全读取）
3b. 若 current_phase == "branch_selection" 或 review_options.user_confirmed !== true：
   → **不得**进入 Phase 2；执行 Phase 1 清单（见 §3 Phase 1），收齐并复述后再写 state
4. 对 reviewing 阶段：按批次、按专家顺序（见 Phase 5）扫描 review_progress，
   找到第一个 status 为 pending 或 in_progress 的 {batch}+{expert}（completed / skipped / failed 跳过；
   in_progress 时先按 docs/state-structure.md「in_progress 防死锁」校验结果 JSON，再决定 completed 或改 pending 重跑）
5. 对 synthesizing 阶段：若 synthesis.report_path 的 MD 已存在且非空
   ├─ generate_html_report === true  → current_phase = "html_rendering"，进入步骤 5b
   └─ 否则 → synthesis.html_status = "skipped"，current_phase = "completed"
   若 MD 不存在 → 重跑 Phase 7 报告合成
5b. 对 html_rendering 阶段：按 docs/state-structure.md「HTML 完整性校验」检查 html_report_path
   ├─ 通过 → html_status = completed，current_phase = completed
   └─ 不通过 → 整文件重写，重拉 java-codereview-report-html（最多 2 次；仍失败 → html_status = failed，current_phase = completed，MD 仍交付）
6. 幂等（可选）：tech_stack 且 tech-stack.json 已合法 → 可直接进入 task_planning；task_planning 且 task-plan.json 已存在 → 补全 review_progress 后进入 reviewing
```

**这意味着**：用户可以在任何时刻关闭主编排 Agent，重新打开后它会自动从断点继续。

### 2.3 子 agent 调用与故障恢复

**调用子 agent 的标准流程：**

```
1. node update-state.js --expert {BATCH_ID}:{expert}:in_progress --checkpoint {BATCH_ID}-{expert}-start
2. 拉起子 agent，传入变量（见各阶段说明）
3. 等待子 agent 返回结果
4. 检查结果文件是否已写入（如 .codereview/results/batch-001-core.json）
   ├─ 存在且合法 → node update-state.js --expert {BATCH_ID}:{expert}:completed --checkpoint {BATCH_ID}-{expert}-done
   └─ 不存在或异常 → 进入故障恢复
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
- 等同批次所有适用专家完成后，先执行该批次的 `issue-curator` 做合并去重与误报排除，再执行 `fix-advisor`；fix 完成后再进入下一批次或报告合成。
- 若 opencode 当前环境不支持并行任务，则按 `core → security → spring → data` 串行降级，输出文件与状态规则保持不变。

### 2.6 opencode：`state.json` 落盘检查点（必执行）

主编排 Agent 在下列时机 **必须** 运行 `update-state.js`（成功后会打印 `{"ok":true,...}`）：

| 时机 | 命令示例 |
|------|----------|
| 启动 / Phase 0 | `node "{SKILL_ROOT}/scripts/update-state.js" --init --checkpoint phase0_init` |
| Phase 1 复述确认后 | `node .../update-state.js --branch1 {B1} --branch2 {B2} --set review_options.severity_mode=all --set review_options.skip_low_risk_files=false --set review_options.generate_html_report=true --set review_options.user_confirmed=true --phase diff_analysis --checkpoint phase1_done` |
| Phase 2 脚本跑完 | `node .../update-state.js --phase tech_stack --checkpoint phase2_diff_done`（可从 inventory 读 total 写入 `--set diff_analysis.total_files=N` 等） |
| Phase 3 完成 | `node .../update-state.js --phase task_planning --checkpoint phase3_tech_stack_done` |
| Phase 4 完成 | `node .../update-state.js --init-review-progress --task-plan .codereview/task-plan.json --phase reviewing --checkpoint phase4_task_plan_done` |
| 拉起子 agent **前** | `node .../update-state.js --expert {BATCH}:{expert}:in_progress --checkpoint {BATCH}-{expert}-start` |
| 子 agent **成功后** | `node .../update-state.js --expert {BATCH}:{expert}:completed --checkpoint {BATCH}-{expert}-done` |
| 并行拉起多个专家 **前** | 对每个适用专家各执行一条 `--expert ...:in_progress`，再派发 Task |
| Phase 7 MD 完成 | `node .../update-state.js --set synthesis.report_path=codereview/report_....md --set synthesis.status=completed --phase html_rendering或completed --checkpoint phase7_md_done` |
| Phase 7.5 HTML 完成/失败 | 更新 `synthesis.html_status`、`synthesis.html_report_path`、`current_phase=completed` |

**自检**：每次写 state 后，用 `read_file` 或 `cat .codereview/state.json` 确认 `updated_at` 已变为当前时间；若未变，**不得**进入下一步。

**子 agent 不写 state**：只有主编排 Agent 写 `.codereview/state.json`；子 agent 只写各自 `OUTPUT_PATH` / 报告文件。

---

## 3. 阶段详情

### Phase 0：初始化

```
若 .codereview/ 目录不存在 → 创建
执行（必须）：
  node "{SKILL_ROOT}/scripts/update-state.js" --init --checkpoint phase0_init
确认 .codereview/state.json 已创建，current_phase = branch_selection
```

---

### Phase 1：分支与检视选项（主编排 Agent 本地执行）

**与 §0.2 相同**（四问模板、`update-state.js` 命令、复述确认流程见 §0.2）。进入 Phase 2 条件：`review_options.user_confirmed === true`。

**字段说明（写入 `review_options`）：**

| 字段 | 取值 |
|------|------|
| `severity_mode` | `all` \| `critical_high_only` |
| `skip_low_risk_files` | `true` \| `false` |
| `generate_html_report` | `true` \| `false`（须用户明确选择，不得静默默认） |
| `user_confirmed` | Phase 1 复述确认后为 `true` |

---

### Phase 2：变动文件与分批（主编排 Agent + 脚本）

**进入本阶段前自检：** `review_options.user_confirmed === true`。若为 `false`，**立即退回 Phase 1**，不得执行下方脚本。

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

**Step 4：** 向用户展示批次数、文件数、行数及跳过低风险统计（若有），确认后执行：

```powershell
node "{SKILL_ROOT}/scripts/update-state.js" --phase tech_stack --checkpoint phase2_done
```

（可选：从 `file-inventory.json` 读取统计后 `--set diff_analysis.total_files=...` 等。）

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

**完成后：**

```powershell
node "{SKILL_ROOT}/scripts/update-state.js" --phase task_planning --checkpoint phase3_done
```

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

**完成后：**

```powershell
node "{SKILL_ROOT}/scripts/update-state.js" --init-review-progress --task-plan .codereview/task-plan.json --phase reviewing --checkpoint phase4_done
```

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

同一 `BATCH_ID` 中，对 `applicable_experts` 取交集后可一次性并行拉起多个子 agent。每个任务必须显式包含：`BATCH_ID`、`BATCH_FILES`、`BRANCH1`、`BRANCH2`、`DIFF_PATCH_PATH`、`SEVERITY_MODE`、`TECH_STACK`、`SKILL_ROOT`、独立 `OUTPUT_PATH`，并强调“完成后只写对应输出文件”。主编排 Agent 等待这一组输出文件全部存在且 JSON 合法后，再将对应状态改为 `completed`；随后串行执行 `issue-curator` 和 `fix-advisor`。

**适用性剪枝（来自 task-plan.json 的 `applicable_experts`）：**

- 若 `review_options.skip_low_risk_files` 为 `true`，DTO/Entity/测试类已在 Phase 2 排除，不会出现在批次中
- 若为 `false`：纯 POJO/DTO/Entity 批次 → 跳过 spring、data
- 纯 Mapper XML → 重点 data + core
- Controller → security + spring 重点
- Service → spring + data 重点

---

### Phase 5.5：问题策展（每批次一次，嵌入 Phase 5 循环；4 专家完成后执行）

**拉起子 agent：** `java-codereview-issue-curator`
**提示词文件：** `{SKILL_ROOT}/prompts/issue-curator.md`

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
| `CURATED_PATH` | `.codereview/results/{BATCH_ID}-curated.json`（Phase 5.5 输出，**优先输入**；缺失时 fix-advisor 自动回退读 4 份原始专家 JSON） |
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

**提交人 attribution（多人协作认领）：** Phase 7 **开始前**，主编排 Agent **必须**执行（不可仅依赖合成官自觉运行）：

```bash
node "{SKILL_ROOT}/scripts/git-line-authors.js" \
  --branch1 <BRANCH1> --branch2 <BRANCH2> \
  --results .codereview/results/ \
  --output .codereview/line-authors.json
```

合成官读取 `line-authors.json`：`issue_authors[issue_id]` → 第六节「提交人」列；`contributors` → 模板 `{{CONTRIBUTORS}}`（第七节「本次参与开发」）。

**完成后：**

1. 写入 `synthesis.report_path = REPORT_PATH`，`synthesis.status = "completed"`
2. 若 `review_options.generate_html_report === true`：
   - `synthesis.html_status = "pending"`
   - `synthesis.html_report_path =` 与 MD 同路径，扩展名改为 `.html`
   - `current_phase = "html_rendering"` → 进入 Phase 7.5
3. 否则：
   - `synthesis.html_status = "skipped"`
   - `current_phase = "completed"` → 按下文「completed 输出文案」`skipped` 模板告知用户

---

### Phase 7.5：HTML 报告渲染（可选，仅 `generate_html_report === true`）

**拉起子 agent：** `java-codereview-report-html`
**提示词文件：** `{SKILL_ROOT}/prompts/report-html.md`

**前置条件：** Phase 7 的 MD 报告已存在且非空。

**传入变量：**

| 变量 | 值 |
|------|---|
| `REPORT_MD_PATH` | `synthesis.report_path`（Phase 7 产出） |
| `HTML_TEMPLATE_PATH` | `{SKILL_ROOT}/templates/report-shell.html` |
| `HTML_REPORT_PATH` | 与 MD 同名，扩展名 `.html`（`/` → `_`） |

**完成标志（主编排 Agent 校验，三者缺一不可）：**

1. 文件首部含 `<!DOCTYPE html>`
2. 文件末尾 16KB 内含 `</html>`
3. 文件末尾 16KB 内含 `<!-- ato-codereview-html-end -->`

校验不通过 → **整文件重写**重拉子 agent（最多 2 次）；仍失败 → `synthesis.html_status = "failed"`，记录 `notes[]`，`current_phase = "completed"`（**MD 仍交付**）。

**完成后：** `synthesis.html_status = "completed"`，`current_phase = "completed"`，按下文「completed 输出文案」输出。

**HTML 签收：** 第六节勾选有效/已修（勾选「已修复」自动勾选「有效」）；第七节验证与签收：开发负责人填写结论并提交，**备注**默认「上述问题无需修复」可修改；自动汇总「本次参与开发」。提交后回写同名 MD 并生成 `【Fix】` 前缀 HTML；若浏览器无法 fetch MD（如 `file://`），壳内 JS 会根据当前页面直接生成完整 MD。

### completed 输出文案（主编排 Agent 必须严格使用）

在 `current_phase = "completed"` 时，根据 `synthesis.html_status` 选择**其一**（随后均追加问题统计摘要：Critical/High/Medium/Low 数量、必改项条数、1–3 条重点关注）：

| `html_status` | 输出模板 |
|---|---|
| `skipped` | `检视完成。MD 报告：{report_path}` |
| `completed` | `检视完成。MD 报告：{report_path}；HTML 报告：{html_report_path}` |
| `failed` | `检视完成。MD 报告：{report_path}；HTML 渲染已重试 2 次仍失败，已跳过（详见 state.notes），不影响 MD 交付` |

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
| `java-codereview-issue-curator` | `prompts/issue-curator.md` | 5.5 |
| `java-codereview-fix-advisor` | `prompts/fix-advisor.md` | 6 |
| `java-codereview-report-synthesizer` | `prompts/report-synthesizer.md` | 7 |
| `java-codereview-report-html` | `prompts/report-html.md` | 7.5（可选） |

兼容说明：`prompts/spec-reviewer.md` 同 core，`prompts/robustness-reviewer.md` 同 spring，`prompts/sql-reviewer.md` 同 data，保留旧文件名是为了不破坏已有配置；新流程使用上表 10 个标识（HTML 子 agent 可选）。

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
