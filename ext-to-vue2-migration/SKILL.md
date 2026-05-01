---
name: ext-to-vue2-migration
description: >-
  将 ExtJS/JSP 前端项目迁移到 Vue2 技术栈。支持渐进式扫描大型项目、断点续迁、
  记忆积累。使用场景：当用户要求迁移 Ext 项目、JSP 前端、或将旧前端转为 Vue2 时触发。
---

# ExtJS to Vue2 迁移 Skill

## 架构

本 Skill 采用 **主 Agent 编排 + Subagent 执行** 模式：

- **主 Agent（你）**：负责状态管理、用户交互、阶段调度
- **Subagent**：负责具体的扫描、分析、迁移、校验任务（上下文隔离）

这样设计的原因：源项目可能非常大，单个上下文无法装下。Subagent 每次只处理一个模块/页面，
完成后将结果写入文件，主 Agent 读取结果继续编排。

## 工具链

**不依赖 Python**。所有操作通过：
1. **Agent 原生能力** — 文件读写（状态/记忆/文档管理）
2. **Shell 命令** — `find/grep/wc/ls`（快速扫描）
3. **Node.js（可选）** — `scripts/scan.js`（Vue2 项目必有 Node）
4. **Subagent（Task 工具）** — 上下文隔离的重任务

## 目录结构

```
.cursor/skills/ext-to-vue2-migration/
├── SKILL.md              ← 你在读的文件（主编排逻辑）
├── docs/                 ← 参考文档（按需读取）
│   ├── reference-ext-to-vue2.md    # 通用 Ext→Vue2 组件映射
│   ├── reference-common-issues.md  # 常见迁移问题经验
│   ├── state-management.md         # 状态文件结构
│   ├── memory-system.md            # 记忆系统设计
│   └── output-files.md             # 过程文件模板
├── prompts/              ← Subagent 任务模板
│   ├── scan-module.md       # 扫描单模块
│   ├── analyze-source.md    # 分析源项目
│   ├── analyze-target.md    # 分析目标项目
│   ├── generate-guide.md    # 生成转换指南
│   ├── migrate-page.md      # 迁移单页面
│   └── validate.md          # 校验质量
└── scripts/
    └── scan.js              # Node.js 扫描工具（可选）
```

## 运行时生成文件

Skill 执行后会在工作目录下创建 `.migration/` 目录，所有过程文件集中存放：

```
.migration/                   ← 自动创建，全部运行产物都在这里
├── state.json               ← Phase 0 创建，全程更新（Agent 读写）
├── source-analysis.md       ← Phase 1 生成（用户可读）
├── target-analysis.md       ← Phase 2 生成（用户可读）
├── inventory.md             ← Phase 3 生成（★ 用户可编辑）
├── plan.md                  ← Phase 3 生成（★ 用户可编辑）
├── conversion-guide.md      ← Phase 4 生成（用户可读）
├── memory.json              ← Phase 5 首次迁移时创建，之后每次迁移都读写
├── progress.md              ← Phase 5 每完成一个任务更新（用户可读）
└── validation-report.md     ← Phase 6 生成（用户可读）
```

**memory.json 生命周期**：
- Phase 5 第一次迁移任务启动前，如不存在则初始化空结构
- 每个迁移 Subagent **执行前**读取 memory.json 获取已有经验
- 每个迁移 Subagent **执行后**写入新发现的模式/问题/映射
- 文件持续增长，是"越跑越智能"的核心载体
- 主 Agent 和 Subagent 都直接通过文件读写操作 memory.json

模板格式见 [docs/output-files.md](docs/output-files.md)。

---

## 启动入口

```
检查 .migration/state.json
├── 不存在 → Phase 0
└── 存在 → 读取 current_phase
    ├── source_analysis → 检查 source_sections，从未完成的段落继续
    ├── target_analysis → 检查 target_sections，从未完成的段落继续
    ├── planning → 检查 inventory.md / plan.md 是否存在
    ├── guide_generation → 检查 guide_sections，从未完成的段落继续
    ├── migrating → 找 in_progress 或下一个 pending 任务
    └── validating → 重新执行
```

---

## Phase 0: 项目发现（主 Agent 直接执行）

1. 扫描工作目录子目录：
   ```bash
   # Linux/macOS
   ls -la
   # Windows PowerShell
   Get-ChildItem
   ```
2. 快速检测各目录类型：
   ```bash
   # 优先使用 Node.js（跨平台，Vue2 项目必有）
   node .cursor/skills/ext-to-vue2-migration/scripts/scan.js detect <dir>

   # Linux/macOS Shell 替代
   find <dir> -maxdepth 4 -name "*.jsp" | head -3
   grep -rl "Ext\.define" <dir> --include="*.js" | head -3
   cat <dir>/package.json 2>/dev/null | grep '"vue"'

   # Windows PowerShell 替代
   Get-ChildItem -Path <dir> -Recurse -Depth 4 -Filter "*.jsp" | Select-Object -First 3
   Get-ChildItem -Path <dir> -Recurse -Filter "*.js" | Select-String "Ext\.define" | Select-Object -ExpandProperty Path -Unique | Select-Object -First 3
   Get-Content <dir>/package.json | Select-String '"vue"'
   ```
3. 向用户确认：源项目、目标项目、目标子目录
4. 初始化 `.migration/state.json`（直接写 JSON）
5. 更新 `current_phase: "source_analysis"`

---

## Phase 1: 源项目分析（分段执行，每段可断点）

**⚠️ 源项目可能很大，分析也要拆细，每完成一段就写入文件和状态。**

### 1.1 扫描各模块
对每个一级前端模块启动 Subagent：
```
prompts/scan-module.md → subagent_type="explore"
```
- 可并行也可串行，每完成一个模块更新 `state.scan_progress.scanned_modules`

### 1.2 分段深度分析
分析拆成独立小段，每段一个 Subagent，每段完成立即追加写入 `source-analysis.md`：

```
prompts/analyze-source.md → 填充 section 变量
```

| 段落 | section 值 | 分析内容 | 断点标记 |
|------|-----------|---------|---------|
| A | `structure` | 项目基本信息 + 目录树 | `source_sections.structure` |
| B | `components` | 自定义基类组件清单 | `source_sections.components` |
| C | `utils` | 公共工具方法 + Ajax 封装 | `source_sections.utils` |
| D | `data_patterns` | 数据交互模式 + 分页 + 响应格式 | `source_sections.data_patterns` |
| E | `auth` | 权限控制 + 认证方式 | `source_sections.auth` |
| F | `module_list` | 模块清单汇总表 | `source_sections.module_list` |

**执行方式**：
1. 主 Agent 检查 `state.source_sections`，找到未完成的段落
2. 为该段落启动 Subagent（每次只做一段，上下文小而集中）
3. Subagent 完成后将结果**追加**到 `.migration/source-analysis.md`
4. 主 Agent 标记该段完成，继续下一段
5. 全部段落完成后向用户展示，等待确认

**断点恢复**：如果在段落 C 中断，重启后检查 state → 跳过 A/B → 从 C 继续。

---

## Phase 2: 目标项目分析（分段执行，每段可断点）

同样拆成独立小段：

```
prompts/analyze-target.md → 填充 section 变量
```

| 段落 | section 值 | 分析内容 | 断点标记 |
|------|-----------|---------|---------|
| A | `config` | package.json + 构建配置 + 依赖清单 | `target_sections.config` |
| B | `components` | 已有公共组件清单与功能 | `target_sections.components` |
| C | `code_style` | 抽样阅读已有页面，总结代码风格 | `target_sections.code_style` |
| D | `api_layer` | API 封装方式、拦截器、错误处理 | `target_sections.api_layer` |
| E | `store_router` | 状态管理 + 路由结构 + 权限 | `target_sections.store_router` |

每段一个 Subagent，完成后追加到 `.migration/target-analysis.md`，标记断点。

---

## Phase 3: 生成清单与计划（主 Agent 执行）

基于 source-analysis.md 和 target-analysis.md：

1. 生成 `.migration/inventory.md`（待迁移清单，**用户可编辑**）
2. 生成 `.migration/plan.md`（迁移计划，**用户可编辑**）
3. 告知用户："清单和计划已生成，请查看编辑后告诉我继续"
4. 用户确认后更新 state.json

格式模板见 [docs/output-files.md](docs/output-files.md)。

---

## Phase 4: 生成转换指南（分段执行，每段可断点）

同样拆成独立小段：

```
prompts/generate-guide.md → 填充 section 变量
```

| 段落 | section 值 | 内容 | 断点标记 |
|------|-----------|------|---------|
| A | `custom_mappings` | 源项目自定义组件→目标方案 | `guide_sections.custom_mappings` |
| B | `std_mappings` | 标准 Ext 组件→目标方案 | `guide_sections.std_mappings` |
| C | `data_rules` | 数据交互转换 + 分页 + 响应格式 | `guide_sections.data_rules` |
| D | `layout_route` | 布局转换 + 路由转换 | `guide_sections.layout_route` |
| E | `auth_style` | 权限适配 + 命名规范 | `guide_sections.auth_style` |

每段一个 Subagent，读取两份分析报告中的对应章节 + 通用参考，输出到 `.migration/conversion-guide.md`。

主 Agent 展示给用户确认，更新 state.json。

---

## Phase 5: 逐页迁移（Subagent 执行，核心阶段）

### 5.0 迁移前
- 确认 memory.json 存在（不存在则按 `docs/memory-system.md` 初始化空结构，含 `user_lessons` / `resolution_paths` 空数组）
- 读取 plan.md 获取当前批次任务
- 询问用户本次迁移几个任务（建议 1-3 个）
- 若用户刚口头补充了长期约束，在下一任务变量中传入 **`user_hint`**（一两句话摘要）

### 5.1 逐任务执行
迁移时必须保持与源行为一致（详见 `prompts/migrate-page.md`）：**下拉**数据静态/异步不可错配；**表格**列与行字段不擅自增删；**开始/结束时间**若源为分开字段则迁移后仍分开，不擅自改为范围组件。

对每个任务，**启动独立 Subagent**：

```
读取 prompts/migrate-page.md
填充变量：task_id, task_name, source_files, target_files,
          guide_path, memory_path, target_project,
          user_hint（可选，无则空）
调用 Task 工具，subagent_type="generalPurpose"
```

记忆须按 `docs/memory-system.md` 维护 **`user_lessons`**（用户提醒）与 **`resolution_paths`**（多步查阅后才成功的路径沉淀）。

**⚠️ 一次只启动一个迁移 Subagent**——因为后一个任务可能依赖前一个的记忆更新。

### 5.2 主 Agent 后处理
每个 Subagent 完成后：
- 确认文件已生成
- 读取 Subagent 返回的结果摘要
- 更新 state.json（任务状态 → completed）
- 更新 `.migration/progress.md`
- 如有问题，记录到 state.json 的 notes

### 5.3 批次间暂停
一批任务完成后，询问用户是否继续下一批。

---

## Phase 6: 校验验证（Subagent 执行）

```
读取 prompts/validate.md
填充变量：target_path, migrated_files, router_path
调用 Task 工具，subagent_type="generalPurpose"
```

Subagent 输出 `.migration/validation-report.md`。
主 Agent 展示给用户，标记迁移完成。

---

## 状态管理

主 Agent 直接读写 `.migration/state.json`，不需要脚本。
结构详见 [docs/state-management.md](docs/state-management.md)。

核心字段：
```json
{
  "current_phase": "source_analysis|target_analysis|planning|guide_generation|migrating|validating",
  "source_project": "路径",
  "target_project": "路径",
  "scan_progress": { "scanned_modules": [], "pending_modules": [] },
  "migration_tasks": [{ "id": "T001", "status": "pending|in_progress|completed|failed|skipped" }]
}
```

## 记忆系统

主 Agent 直接读写 `.migration/memory.json`（Subagent 也可直接读写）。
设计详见 [docs/memory-system.md](docs/memory-system.md)。

核心：迁移 Subagent 迁移前读记忆、迁移后写记忆，经验自然积累。

---

## Subagent 调用模式速查

| 阶段 | Prompt 模板 | subagent_type | 执行方式 | 断点粒度 |
|------|------------|---------------|---------|---------|
| Phase 1 扫描 | prompts/scan-module.md | explore | 可并行 | 单模块 |
| Phase 1 分析 | prompts/analyze-source.md | generalPurpose | 逐段串行 | 单段落(6段) |
| Phase 2 分析 | prompts/analyze-target.md | generalPurpose | 逐段串行 | 单段落(5段) |
| Phase 4 指南 | prompts/generate-guide.md | generalPurpose | 逐段串行 | 单段落(5段) |
| Phase 5 迁移 | prompts/migrate-page.md | generalPurpose | 串行 | 单任务 |
| Phase 6 校验 | prompts/validate.md | generalPurpose | 单个 | 整体 |

---

## 串行/并行兼容说明

**并行是优化，不是必须**。本 Skill 在纯串行环境下完全可用。

### 不支持并行 Subagent 时（串行模式）
- Phase 1 扫描：逐个模块依次扫描（慢一些，但功能不受影响）
- Phase 5 迁移：本身就是串行的，无影响
- 其他阶段：本身就是单个 Subagent，无影响

### 支持并行 Subagent 时（加速模式）
- Phase 1 扫描：多个模块同时启动 Subagent 扫描，显著加速
- 需要的能力：Agent 能在**单条消息中发起多个 Task 工具调用**
- 在 Cursor IDE 中，这取决于底层模型是否支持多工具调用

### 不支持 Subagent 时（降级模式）
如果 IDE/模型不支持 Task 工具（Subagent），所有任务由主 Agent 直接执行：
- 每个阶段按 prompt 模板中的步骤直接执行
- 注意主动控制上下文：完成一个模块/页面后总结要点，不要积累太多原始代码
- 更频繁地写入状态和记忆，便于上下文超限时通过新对话恢复

### 判断逻辑
```
如果 Task 工具可用：
  → 按 Subagent 模式执行（推荐）
否则：
  → 按降级模式执行（主 Agent 直接做，严控上下文）
```

---

## Shell 命令速查（替代 Node.js）

> ⚠️ **跨平台注意**：优先使用 Node.js scan.js（跨平台）。Shell 命令在 Windows 上需改用 PowerShell 版本。
> ⚠️ **git 命令**：运行 `git diff` 等命令时，**必须加 `--no-pager`** 或设置 `GIT_PAGER=cat`，否则会触发交互式分页器（显示 `:` 需手动按 q 退出）。

```bash
# ── 检测项目类型 ──

# Linux/macOS
find <path> -maxdepth 4 -name "*.jsp" | wc -l
grep -rl "Ext\.define" <path> --include="*.js" | wc -l

# Windows PowerShell
(Get-ChildItem -Path <path> -Recurse -Depth 4 -Filter "*.jsp").Count
(Get-ChildItem -Path <path> -Recurse -Filter "*.js" | Select-String "Ext\.define").Count

# ── 目录概览 ──

# Linux/macOS
find <path> -maxdepth 2 -type d | sort

# Windows PowerShell
Get-ChildItem -Path <path> -Directory -Recurse -Depth 2 | Sort-Object FullName

# ── 检查迁移残留 ──

# Linux/macOS
grep -rn "Ext\.\|Ext\.create" src/views/ --include="*.vue" --include="*.js"

# Windows PowerShell
Get-ChildItem -Path src/views -Recurse -Include "*.vue","*.js" | Select-String "Ext\."

# ── git 命令（防止分页器卡住）──
git --no-pager diff
git --no-pager log --oneline
# 或全局禁用：GIT_PAGER=cat git diff（Linux/macOS）
# Windows: $env:GIT_PAGER='cat'; git diff
```
