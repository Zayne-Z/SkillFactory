## ExtJS-to-Vue2 Migration Skill 完整介绍

### 一、定位

这是一个 Cursor IDE Agent Skill，指导 AI Agent 将大型 ExtJS/JSP 前端项目迁移到 Vue2 技术栈。专为**内网环境**（无法访问在线文档）、**大型项目**（上下文超限风险）设计。

### 二、架构设计

```
┌──────────────────────────────────────────────────┐
│                  主 Agent（编排器）                │
│  职责：状态管理、用户交互、阶段调度、进度跟踪      │
│  直接操作：state.json / memory.json / progress.md │
└────────┬──────────┬──────────┬──────────┬────────┘
         │          │          │          │
    ┌────▼───┐ ┌───▼────┐ ┌──▼───┐ ┌───▼────┐
    │ 扫描   │ │ 分析   │ │ 迁移 │ │ 校验   │
    │Subagent│ │Subagent│ │Subagent│ │Subagent│
    │(explore│ │(general│ │(general│ │(general│
    │ 可并行)│ │Purpose)│ │ 串行) │ │Purpose)│
    └────────┘ └────────┘ └───────┘ └────────┘
```

**为什么这样设计**：
- **主 Agent 轻量化** — 只做调度和状态管理，不直接读大量源代码
- **Subagent 上下文隔离** — 每个扫描/迁移任务在独立上下文中，避免撑爆
- **文件系统做通信桥梁** — Subagent 结果写入文件，主 Agent 读取继续

**三级降级兼容**：
| 模式 | 条件 | 效果 |
|------|------|------|
| 并行模式 | 支持多 Task 并行调用 | Phase 1 扫描加速 |
| 串行模式 | 仅支持逐个 Task | 功能完全相同，慢一点 |
| 降级模式 | 不支持 Task 工具 | 主 Agent 直接执行所有步骤 |

### 三、文件结构

```
.cursor/skills/ext-to-vue2-migration/     ← Skill 本体（13个文件）
├── SKILL.md              306行   主编排逻辑
├── docs/                         参考文档（按需读取）
│   ├── reference-ext-to-vue2.md    510行   Ext→Vue2 组件映射（含代码示例）
│   ├── reference-common-issues.md  293行   18个常见迁移问题解决方案
│   ├── state-management.md         106行   状态文件 JSON 结构
│   ├── memory-system.md            179行   记忆系统设计与示例
│   └── output-files.md             283行   9个过程文件的模板
├── prompts/                        Subagent 任务模板
│   ├── scan-module.md               77行   扫描单个模块
│   ├── analyze-source.md            72行   分析源项目特征
│   ├── analyze-target.md            71行   分析目标项目
│   ├── generate-guide.md            84行   生成项目专属转换指南
│   ├── migrate-page.md             119行   迁移单个页面（最核心）
│   └── validate.md                  99行   校验迁移质量
└── scripts/
    └── scan.js                     278行   Node.js 扫描工具（可选）

.migration/                               ← 运行时生成（9个文件）
├── state.json               Phase 0 创建   断点恢复（Agent 用）
├── source-analysis.md       Phase 1 生成   源项目分析报告
├── target-analysis.md       Phase 2 生成   目标项目分析报告
├── inventory.md             Phase 3 生成   ★ 待迁移清单（用户可编辑）
├── plan.md                  Phase 3 生成   ★ 迁移计划（用户可编辑）
├── conversion-guide.md      Phase 4 生成   项目专属转换指南
├── memory.json              Phase 5 创建   迁移记忆（越跑越智能）
├── progress.md              Phase 5 更新   进度看板
└── validation-report.md     Phase 6 生成   校验报告
```

### 四、7 阶段工作流程

```
Phase 0        Phase 1         Phase 2        Phase 3
项目发现  ───→  源项目深度   ───→ 目标项目   ───→ 生成清单
(主Agent)       分析              分析            与计划
                (Subagent)       (Subagent)      (主Agent)
                                                    │
    ┌───────────────────────────────────────────────┘
    ▼
Phase 4         Phase 5                        Phase 6
生成转换  ───→  逐页迁移（循环）          ───→  校验验证
指南             ┌→ 读记忆                      (Subagent)
(Subagent)       ├→ 读转换指南
                 ├→ 迁移代码
                 ├→ 写记忆
                 └→ 下一页...
                 (Subagent,串行)
```

| Phase | 做什么 | 谁做 | 产出 | 用户参与 |
|-------|--------|------|------|---------|
| 0 | 扫描目录，确认源/目标项目 | 主Agent | state.json | 确认项目路径 |
| 1 | 渐进扫描+深度分析源项目 | Subagent | source-analysis.md | 确认分析结果 |
| 2 | 分析目标Vue2项目结构和规范 | Subagent | target-analysis.md | 确认分析结果 |
| 3 | 生成待迁移清单和分批计划 | 主Agent | inventory.md, plan.md | **可编辑**清单和计划 |
| 4 | 结合两项目分析生成专属转换指南 | Subagent | conversion-guide.md | 确认转换规则 |
| 5 | 按计划逐页迁移，读写记忆 | Subagent(串行) | Vue文件 + memory.json + progress.md | 选择每批数量 |
| 6 | 检查残留Ext代码、SFC完整性等 | Subagent | validation-report.md | 查看报告 |

### 五、三大核心设计思路

**1. "先分析后动手"** — 解决盲目迁移问题

不是拿到项目就开始转代码。Phase 1-4 做了充分准备：
- Phase 1 深入分析源项目的**自定义组件体系**（不只看通用 Ext API）
- Phase 2 分析目标项目的**已有组件和代码风格**
- Phase 4 基于**两边实际代码**生成项目专属转换指南（而非通用模板）

这样迁移出来的代码才能和目标项目已有代码**风格一致**。

**2. "记忆系统"** — 解决越跑越蠢的问题

`memory.json` 存储 5 类经验：
- `component_mappings`：Ext组件→Vue方案的映射（带信心度）
- `patterns`：成功的页面迁移模式（带参考文件指针）
- `issues`：踩过的坑（带严重度和命中次数）
- `api_mappings`：接口映射关系
- `project_notes`：项目特有的规则发现

每个迁移 Subagent **启动前**查记忆，**完成后**写记忆。前 3-5 个页面是学习期，之后效率显著提升。信心度机制确保好经验被优先采纳（+0.05），坏经验被抑制（-0.2）。

**3. "断点可续"** — 解决大项目跑不完的问题

`state.json` 精确记录进度到**每个模块、每个任务**。任何时刻中断：
- 重新开始对话 → Agent 读取 state.json → 自动跳到断点继续
- Phase 1 中断 → 跳过已扫描模块
- Phase 5 中断 → 找到 in_progress 或下一个 pending 任务

### 六、工具链（零外部依赖）

| 工具 | 用途 | 必须？ |
|------|------|--------|
| Agent 文件读写 | 状态/记忆/文档管理 | 是 |
| Shell (find/grep/wc) | 快速扫描目录和文件 | 是 |
| Node.js (scan.js) | 结构化项目扫描 | 否（有 shell 替代） |
| Task 工具 (Subagent) | 上下文隔离执行 | 否（可降级为主Agent直接执行） |

不依赖 Python、不依赖网络、不依赖数据库——纯文件驱动，任何内网环境都能跑。

### 七、内网适配

由于无法访问在线文档，Skill 自带了两份离线参考：
- `reference-ext-to-vue2.md`（510行）：涵盖布局、表格、表单、弹窗、数据层、Ajax、路由、JSP 等全部 10 大类组件的映射，包含可直接复制的代码示例
- `reference-common-issues.md`（293行）：18 个常见迁移问题的解决方案，涵盖架构、组件、数据、样式、响应性等
