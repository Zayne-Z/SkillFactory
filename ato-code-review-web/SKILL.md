---
name: ato-code-review-web
description: >-
  前端代码检视 Skill，适用于 Vue2/Vue3 等前端项目。通过多专家 Subagent 协作，
  对 Git 分支相对基准的 **diff 变更行** 进行检视（非全文），输出按模板填写的完整结构化报告。
  使用场景：用户要求进行代码检视、Code Review、分支对比分析时触发。
  支持断点续检、批量处理大型变动、智能技术栈识别。
---

# 前端代码检视 Skill（ato-code-review-web）

## 架构

**主 Agent 编排 + 多专家 Subagent 并行/串行检视**

- **主 Agent**：状态管理、用户交互、阶段调度、结果汇总
- **Subagent**：每个专家独立上下文，避免超长上下文问题

## 目录结构

```
.cursor/skills/ato-code-review-web/
├── SKILL.md                      ← 主编排逻辑（当前文件）
├── docs/
│   ├── vue2-reference.md         # Vue2 规范与常见问题
│   ├── vue3-reference.md         # Vue3 规范与常见问题
│   ├── general-standards.md      # 通用前端规范
│   └── state-structure.md        # 状态文件结构说明
├── prompts/
│   ├── tech-stack-analysis.md    # 技术栈分析专家
│   ├── task-planner.md           # 检视任务规划专家
│   ├── code-scanner.md           # 代码扫描专家
│   ├── spec-reviewer.md          # 规范专家
│   ├── perf-reviewer.md          # 性能专家
│   ├── security-reviewer.md      # 安全专家
│   ├── framework-reviewer.md     # 框架专家
│   ├── robustness-reviewer.md    # 健壮性专家
│   ├── style-reviewer.md         # 样式专家
│   ├── fix-advisor.md            # 修复专家
│   └── report-synthesizer.md     # 分析合成官
├── scripts/
│   ├── get-diff-files.js         # 获取分支变动文件清单
│   └── batch-processor.js        # 文件批量分组工具
└── templates/
    └── report-template.md        # 检视报告模板
```

## 运行时生成文件

```
.codereview/                      ← 自动创建，过程文件
├── state.json                    ← 全程状态（主 Agent 读写）
├── file-inventory.json           ← 变动文件清单（含批次划分）
├── tech-stack.json               ← 技术栈分析结果
├── task-plan.json                ← 检视任务列表
├── results/
│   ├── batch-001-scanner.json    ← 扫描专家结果（按批次）
│   ├── batch-001-spec.json       ← 规范专家结果
│   ├── batch-001-perf.json       ← 性能专家结果
│   ├── batch-001-security.json   ← 安全专家结果
│   ├── batch-001-framework.json  ← 框架专家结果
│   ├── batch-001-robust.json     ← 健壮性专家结果
│   ├── batch-001-style.json      ← 样式专家结果
│   └── batch-001-fix.json        ← 修复专家结果
codereview/                       ← 最终报告输出目录
└── report_<branch>_<date>.md     ← 检视报告（命名如 report_Release_AMP-CORE6.10.0_2026-04-06.md）
```

---

## 启动入口

```
检查 .codereview/state.json
├── 不存在 → Phase 0（初始化）
└── 存在 → 读取 current_phase 和 checkpoint
    ├── branch_selection   → Phase 1
    ├── diff_analysis      → Phase 2（检查 file_batches 进度）
    ├── tech_stack         → Phase 3
    ├── task_planning      → Phase 4
    ├── reviewing          → Phase 5（找到未完成的批次和专家）
    ├── fix_advising       → Phase 6
    └── synthesizing       → Phase 7
```

---

## Phase 0：初始化

1. 检查 `.codereview/state.json` 是否存在
2. 不存在则创建目录和初始状态文件
3. 进入 Phase 1

---

## Phase 1：分支选择（主 Agent）

**提问用户：**
- "请输入要检视的分支名（默认与 master 对比）"
- "或输入两个分支，格式：`branch1 vs branch2`"

**处理逻辑：**
```
用户输入 "feature/my-branch"
  → branch1 = "feature/my-branch", branch2 = "master"

用户输入 "release/1.0 vs develop"
  → branch1 = "release/1.0", branch2 = "develop"
```

**确认后：**
- 验证分支存在：`git rev-parse --verify "<branch>"`（跨平台，不依赖 grep）
- 更新 state.json，进入 Phase 2

---

## Phase 2：变动文件分析（Node.js 脚本 + 分批处理）

**⚠️ 防超时：先用脚本获取文件清单，再分批读取文件内容**

### 2.1 获取变动文件清单

```bash
node .cursor/skills/ato-code-review-web/scripts/get-diff-files.js \
  --branch1 <branch1> --branch2 <branch2> \
  --output .codereview/file-inventory.json
```

脚本输出变动文件清单（含文件类型、变动行数、文件大小）。

### 2.2 智能分批

```bash
node .cursor/skills/ato-code-review-web/scripts/batch-processor.js \
  --inventory .codereview/file-inventory.json \
  --max-lines 800 \
  --output .codereview/file-inventory.json
```

- 按变动行数分批，每批不超过 800 行
- 超大单文件单独成一批
- 批次信息写入 `file-inventory.json`

### 2.3 向用户确认

展示变动汇总（文件数、总行数、批次数），询问是否继续。

---

## Phase 3：技术栈分析（Subagent）

**⚠️ 必须在代码检视前完成，避免幻觉**

启动 Subagent：
```
prompts/tech-stack-analysis.md → subagent_type="generalPurpose"
```

分析：
- `package.json`：vue 版本、主要依赖
- 构建配置文件（vue.config.js / vite.config.js）
- 抽样查看 `.vue` 文件（Options API / Composition API）
- UI 框架（Element UI / Element Plus / Ant Design Vue 等）

结果写入 `.codereview/tech-stack.json`，加载对应参考文档：
- Vue 2.x → 读取 `docs/vue2-reference.md`
- Vue 3.x → 读取 `docs/vue3-reference.md`
- 其他框架 → 读取 `docs/general-standards.md`

---

## Phase 4：任务规划（Subagent）

启动 Subagent：
```
prompts/task-planner.md → subagent_type="generalPurpose"
```

输入：`file-inventory.json`（含已由脚本划分好的批次）+ `tech-stack.json`

输出：`.codereview/task-plan.json`（在现有批次基础上补充各批次的 `applicable_experts` 字段）

> **注意**：批次划分已在 Phase 2.2 由 `batch-processor.js` 完成，task-planner 不重新划分批次，只规划每批次应启用哪些专家。

---

## Phase 5：多专家代码检视（分批 + 分专家执行）

**检视范围（所有专家必须遵守）**

- 仅针对 `git diff {{BRANCH2}}...{{BRANCH1}}` 中的**变更行**（及理解所需的最小上下文）进行检视。
- **不得**对未变更代码做问题报告；不得要求通读全文件后罗列历史问题。
- 各专家 Prompt 中均已写明「检视范围」；主 Agent 启动 Subagent 时勿删减该说明。

**每批文件由以下专家依次或并行检视：**

| 专家 | Prompt 文件 | 检视方向 | 输出文件 |
|------|------------|---------|---------|
| 代码扫描专家 | prompts/code-scanner.md | 语法错误、明显 Bug、死代码 | batch-NNN-scanner.json |
| 规范专家 | prompts/spec-reviewer.md | 命名规范、代码风格、注释 | batch-NNN-spec.json |
| 性能专家 | prompts/perf-reviewer.md | 渲染性能、内存泄漏、接口优化 | batch-NNN-perf.json |
| 安全专家 | prompts/security-reviewer.md | XSS、权限、敏感信息泄露 | batch-NNN-security.json |
| 框架专家 | prompts/framework-reviewer.md | Vue2/Vue3 最佳实践 | batch-NNN-framework.json |
| 健壮性专家 | prompts/robustness-reviewer.md | 错误处理、边界条件、空值判断 | batch-NNN-robust.json |
| 样式专家 | prompts/style-reviewer.md | CSS 规范、BEM、响应式 | batch-NNN-style.json |

### 执行策略

```
对每个批次 (batch-001, batch-002, ...):
  ├── 并行模式（IDE 支持时）：同时启动 7 个专家 Subagent
  └── 串行模式（默认/降级）：逐个专家依次执行
  每个专家完成后立即写入结果文件并更新 state.json
```

**断点恢复**：读取 state.json 中 `review_progress`，跳过已完成的批次+专家组合。

---

## Phase 6：修复建议（Subagent，每批一次）

```
prompts/fix-advisor.md → subagent_type="generalPurpose"
```

读取当前批次所有专家结果，生成具体修复建议，写入 `batch-NNN-fix.json`。

---

## Phase 7：报告合成（Subagent）

```
prompts/report-synthesizer.md → subagent_type="generalPurpose"
```

读取所有批次的全部专家结果 + 修复建议，**按 `templates/report-template.md` 全章节**生成最终报告（含：变动文件清单 → 问题清单 → 必改清单及人工填写区）。报告为**唯一交付物**，合成结果中**不得**引导用户再去查阅 `.codereview` 过程文件或本 SKILL 的步骤说明。

```
codereview/report_<branch1>_<YYYY-MM-DD>.md
```

---

## 状态管理

主 Agent 直接读写 `.codereview/state.json`。
结构详见 [docs/state-structure.md](docs/state-structure.md)。

核心字段（完整结构见 [docs/state-structure.md](docs/state-structure.md)）：
```json
{
  "current_phase": "branch_selection|diff_analysis|tech_stack|task_planning|reviewing|fix_advising|synthesizing|completed",
  "branches": {
    "branch1": "feature/xxx",
    "branch2": "master"
  },
  "tech_stack": {
    "framework": "vue2|vue3|other",
    "vue_version": "2.x.x",
    "ui_library": "element-ui",
    "build_tool": "vue-cli"
  },
  "diff_analysis": {
    "total_files": 0,
    "total_changed_lines": 0,
    "total_batches": 0,
    "inventory_path": ".codereview/file-inventory.json",
    "completed": false
  },
  "review_progress": {
    "batch-001": {
      "scanner": "pending|in_progress|completed",
      "spec": "pending",
      "perf": "pending",
      "security": "pending",
      "framework": "pending",
      "robust": "pending",
      "style": "pending",
      "fix": "pending"
    }
  },
  "synthesis": {
    "status": "pending",
    "report_path": ""
  }
}
```

---

## Subagent 调用速查

| 阶段 | Prompt | subagent_type | 并行 | 断点粒度 |
|------|--------|---------------|------|---------|
| Phase 3 技术栈 | tech-stack-analysis.md | generalPurpose | 否 | 整体 |
| Phase 4 规划 | task-planner.md | generalPurpose | 否 | 整体 |
| Phase 5 各专家 | code-scanner/spec/perf/security/framework/robust/style | generalPurpose | 可并行 | 批次×专家 |
| Phase 6 修复 | fix-advisor.md | generalPurpose | 否 | 单批次 |
| Phase 7 合成 | report-synthesizer.md | generalPurpose | 否 | 整体 |

---

## Prompt 变量替换规则

各 prompt 文件中含有 `{{变量名}}` 占位符，**主 Agent 在启动 subagent 前必须将其替换为实际值**，再将完整 prompt 文本作为 Task 的 `prompt` 参数传入。

常用变量替换速查：

| 变量 | 来源 |
|------|------|
| `{{PROJECT_ROOT}}` | 当前工作目录（一般为 `.`） |
| `{{BRANCH1}}` | `state.branches.branch1` |
| `{{BRANCH2}}` | `state.branches.branch2` |
| `{{BATCH_ID}}` | 当前批次 ID（如 `batch-001`） |
| `{{BATCH_FILES}}` | `file-inventory.json` 对应批次的 `files` 数组（JSON 字符串） |
| `{{TECH_STACK}}` | `.codereview/tech-stack.json` 完整内容（JSON 字符串） |
| `{{OUTPUT_PATH}}` | 根据阶段和批次构造（如 `.codereview/results/batch-001-scanner.json`） |
| `{{INVENTORY_PATH}}` | `.codereview/file-inventory.json` |
| `{{TECH_STACK_PATH}}` | `.codereview/tech-stack.json` |
| `{{RESULTS_DIR}}` | `.codereview/results/` |
| `{{STATE_PATH}}` | `.codereview/state.json` |
| `{{TEMPLATE_PATH}}` | `.cursor/skills/ato-code-review-web/templates/report-template.md` |
| `{{REPORT_PATH}}` | `codereview/report_<branch1>_<YYYY-MM-DD>.md` |
| `{{MUST_FIX_SECTION_INTRO}}` / `{{MUST_FIX_TABLE_ROWS}}` | 由报告合成阶段根据 Critical/High 问题生成（见 `report-synthesizer.md`） |

---

## 串行/并行兼容

- **并行**：IDE 支持单消息多 Task 调用时，Phase 5 同一批次的 7 个专家同时启动
- **串行（默认）**：逐个专家依次执行，功能完全不受影响
- **无 Subagent 降级**：主 Agent 直接按 prompt 模板逐步执行，严控上下文大小

---

## Shell 命令速查

> **跨平台说明**：以下命令在 Linux/macOS 和 Windows（Git Bash / WSL）均可用。
> 所有 `git diff` 命令必须加 `--no-pager`，防止 git 启动交互式 pager（less）导致终端卡在 `:` 提示符。

```bash
# 检查分支是否存在
git branch -a | grep "branch-name"

# 获取变动文件列表（备用）
git --no-pager diff --name-only branch2...branch1

# 获取变动统计
git --no-pager diff --stat branch2...branch1

# 查看单文件差异
git --no-pager diff branch2...branch1 -- path/to/file.vue

# 验证分支是否存在（跨平台，不用 2>/dev/null）
git rev-parse --verify "branch-name"
```
