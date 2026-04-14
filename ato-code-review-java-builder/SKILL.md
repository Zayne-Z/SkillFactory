---
name: ato-code-review-java
description: >-
  Java 后端项目代码检视 Skill。通过多专家 Subagent 协作，对 Git 两分支 diff 中**变更行**
  进行检视（非整文件通篇评审），输出按模板组织的完整 Markdown 报告：变动文件清单在前、
  问题详情与全量清单居中、Critical/High 必改项与人工处置结论在后。支持 Spring Boot/
  Spring MVC/MyBatis/JPA 等主流栈。使用场景：Java 代码检视、Code Review、分支对比分析。
  支持断点续检、批量处理大型变动、智能技术栈识别。
---

# Java 后端代码检视 Skill（ato-code-review-java）

## 架构

**主 Agent 编排 + 多专家 Subagent 并行/串行检视**

- **主 Agent**：状态管理、用户交互、阶段调度、结果汇总
- **Subagent**：每个专家独立上下文，避免超长上下文问题

## 目录结构

```
.cursor/skills/ato-code-review-java/
├── SKILL.md                      ← 主编排逻辑（当前文件）
├── docs/
│   ├── java-standards.md         # Java 编码规范参考
│   ├── spring-boot-reference.md  # Spring Boot/MVC 最佳实践
│   ├── mybatis-reference.md      # MyBatis/JPA/ORM 规范
│   └── state-structure.md        # 状态文件结构说明
├── prompts/
│   ├── tech-stack-analysis.md    # 技术栈分析专家
│   ├── task-planner.md           # 检视任务规划专家
│   ├── code-scanner.md           # 代码扫描专家
│   ├── spec-reviewer.md          # 规范专家
│   ├── perf-reviewer.md          # 性能专家（含线程安全）
│   ├── security-reviewer.md      # 安全专家
│   ├── framework-reviewer.md     # 框架专家（Spring 生态）
│   ├── robustness-reviewer.md    # 健壮性专家（含事务管理）
│   ├── sql-reviewer.md           # SQL 专家（ORM/SQL优化/N+1）
│   ├── fix-advisor.md            # 修复专家
│   └── report-synthesizer.md    # 分析合成官
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
│   ├── batch-001-scanner.json
│   ├── batch-001-spec.json
│   ├── batch-001-perf.json
│   ├── batch-001-security.json
│   ├── batch-001-framework.json
│   ├── batch-001-robust.json
│   ├── batch-001-sql.json        ← SQL 专家（Java 独有）
│   └── batch-001-fix.json
codereview/                       ← 最终报告输出目录
└── report_<branch>_<date>.md     ← 例：report_Release_AMP-CORE6.10.0_2026-04-06.md
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
2. 不存在则创建目录和初始状态文件（见 [docs/state-structure.md](docs/state-structure.md)）
3. 进入 Phase 1

---

## Phase 1：分支选择（主 Agent）

**提问用户：**
- "请输入要检视的分支名（默认与 master 对比）"
- "或输入两个分支，格式：`branch1 vs branch2`"

**处理逻辑：**
```
用户输入 "feature/user-service"
  → branch1 = "feature/user-service", branch2 = "master"

用户输入 "release/1.0 vs develop"
  → branch1 = "release/1.0", branch2 = "develop"
```

**确认后：**
- 验证分支存在：`git branch -a | grep <branch>`
- 更新 state.json，进入 Phase 2

---

## Phase 2：变动文件分析（Node.js 脚本 + 分批处理）

**⚠️ 防超时：先用脚本获取文件清单，再分批读取内容**

### 2.1 获取变动文件清单

```bash
node .cursor/skills/ato-code-review-java/scripts/get-diff-files.js \
  --branch1 <branch1> --branch2 <branch2> \
  --output .codereview/file-inventory.json
```

### 2.2 智能分批

```bash
node .cursor/skills/ato-code-review-java/scripts/batch-processor.js \
  --inventory .codereview/file-inventory.json \
  --max-lines 600 \
  --output .codereview/file-inventory.json
```

> Java 类文件通常比前端文件复杂，每批上限设为 600 行（比前端更保守）

### 2.3 向用户确认

展示变动汇总（文件数、总行数、批次数），询问是否继续。

---

## Phase 3：技术栈分析（Subagent）

**⚠️ 必须在代码检视前完成，避免框架规范幻觉**

```
prompts/tech-stack-analysis.md → subagent_type="explore"
```

分析：
- `pom.xml` 或 `build.gradle`：Spring Boot 版本、主要依赖
- ORM 框架：MyBatis / JPA / Hibernate
- 数据库：MySQL / PostgreSQL / Oracle
- Java 版本（`<java.version>` 或 `sourceCompatibility`）
- 其他：Lombok、MapStruct、Swagger 等

结果写入 `.codereview/tech-stack.json`，加载对应参考文档：
- 有 MyBatis → 读取 `docs/mybatis-reference.md`
- Spring Boot → 读取 `docs/spring-boot-reference.md`

---

## Phase 4：任务规划（Subagent）

```
prompts/task-planner.md → subagent_type="generalPurpose"
```

输入：`file-inventory.json` + `tech-stack.json`

输出：`.codereview/task-plan.json`（含各批次、各专家适用性）

---

## Phase 5：多专家代码检视（分批 + 分专家执行）

### 检视范围（硬性要求）

- **只检视本次 Git 差异中的变更行**，不对整文件做通篇评审。
- 各专家必须使用 `git --no-pager diff <branch2>...<branch1> -- <path>` 获取统一 diff，**仅**在新增（`+`）或修改涉及的逻辑上报告问题。
- 允许为理解变更块读取前后少量未改动行作为上下文；**禁止**因通读完整源文件而对「未在本次 diff 中改动的代码」批量报问题。
- 若某问题根因在未改行、但由**本次变更直接触发或暴露**（例如新调用了未判空的方法），可以报告，并在描述中说明与变更的关系。
- 目的：控制单次检视问题数量在可处理范围内，结论与 MR/PR 变更范围一致。

**每批文件由以下专家依次或并行检视：**

| 专家 | Prompt 文件 | 检视方向 | 输出文件 |
|------|------------|---------|---------|
| 代码扫描专家 | prompts/code-scanner.md | 空指针/语法/死代码/异常捕获 | batch-NNN-scanner.json |
| 规范专家 | prompts/spec-reviewer.md | Java 命名/注释/代码组织 | batch-NNN-spec.json |
| 性能专家 | prompts/perf-reviewer.md | 线程安全/连接池/循环优化/缓存 | batch-NNN-perf.json |
| 安全专家 | prompts/security-reviewer.md | SQL注入/反序列化/权限/敏感信息 | batch-NNN-security.json |
| 框架专家 | prompts/framework-reviewer.md | Spring 最佳实践/注解使用 | batch-NNN-framework.json |
| 健壮性专家 | prompts/robustness-reviewer.md | 异常处理/事务管理/幂等性 | batch-NNN-robust.json |
| SQL 专家 | prompts/sql-reviewer.md | SQL优化/N+1/索引/ORM反模式 | batch-NNN-sql.json |

### 执行策略

```
对每个批次 (batch-001, batch-002, ...):
  ├── 并行模式（IDE 支持时）：同时启动 7 个专家 Subagent
  └── 串行模式（默认/降级）：按顺序逐个执行
  每个专家完成后立即写入结果文件并更新 state.json
```

**断点恢复**：读取 state.json 中 `review_progress`，跳过已完成的批次+专家组合。

**适用性剪枝**：
- 纯 POJO / DTO / Entity 类 → 跳过 SQL 专家、性能专家（无业务逻辑）；安全专家保留（检测 `@Valid`/`@NotBlank` 等校验注解缺失）
- 纯 Mapper XML 文件 → 只执行 SQL 专家 + 代码扫描专家（跳过规范、性能、框架、健壮性专家）
- Controller 类 → 安全专家重点检视（输入校验/权限）
- Service 类 → 框架专家 + 健壮性专家 + 性能专家重点检视

---

## Phase 6：修复建议（Subagent，每批一次）

```
prompts/fix-advisor.md → subagent_type="generalPurpose"
```

读取当前批次所有专家结果，生成具体 Java 修复代码片段。

---

## Phase 7：报告合成（Subagent）

```
prompts/report-synthesizer.md → subagent_type="generalPurpose"
```

按 `templates/report-template.md` 生成**一份完整、可独立交付**的最终 Markdown 报告（章节顺序：基本信息 → **变动文件清单** → 问题统计与详情 → 修复建议 → 全量问题表 → **必改项与人工处置结论**）。报告正文中**不得**要求读者再去查阅 `.codereview/` 过程文件或 skill 内 `docs/` 说明；技术栈与规范依据以报告第四节「技术栈与检视依据」中的摘要为准。

```
codereview/report_<branch1>_<YYYY-MM-DD>.md
```

---

## 状态管理

主 Agent 直接读写 `.codereview/state.json`。
结构详见 [docs/state-structure.md](docs/state-structure.md)。

核心字段：
```json
{
  "current_phase": "branch_selection|diff_analysis|tech_stack|task_planning|reviewing|fix_advising|synthesizing|completed",
  "branches": {
    "branch1": "feature/xxx",
    "branch2": "master"
  },
  "tech_stack": {
    "framework": "spring-boot",
    "spring_boot_version": "2.7.18",
    "orm": "mybatis",
    "java_version": "17"
  },
  "review_progress": {
    "batch-001": {
      "scanner":   "pending|in_progress|completed",
      "spec":      "pending",
      "perf":      "pending",
      "security":  "pending",
      "framework": "pending",
      "robust":    "pending",
      "sql":       "pending",
      "fix":       "pending"
    }
  }
}
```

---

## Subagent 调用速查

| 阶段 | Prompt | subagent_type | 并行 | 断点粒度 |
|------|--------|---------------|------|---------|
| Phase 3 技术栈 | tech-stack-analysis.md | explore | 否 | 整体 |
| Phase 4 规划 | task-planner.md | generalPurpose | 否 | 整体 |
| Phase 5 各专家 | scanner/spec/perf/security/framework/robust/sql | generalPurpose | 可并行 | 批次×专家 |
| Phase 6 修复 | fix-advisor.md | generalPurpose | 否 | 单批次 |
| Phase 7 合成 | report-synthesizer.md | generalPurpose | 否 | 整体 |

---

## 串行/并行兼容

- **并行**：同一批次 7 个专家在单条消息中同时启动
- **串行（默认）**：逐个专家依次执行，功能不受影响
- **无 Subagent 降级**：主 Agent 直接按 prompt 步骤执行，严控上下文

---

## 跨平台注意事项

- **Windows / Linux / macOS 均兼容**：Node.js 脚本已内置 `GIT_PAGER=cat`，无需手动设置
- **git diff 防卡住**：所有手动执行的 `git diff` 命令必须加 `--no-pager` 参数，防止进入 less 翻页器（Windows 下表现为 `:` 提示符需手动按 `q` 退出）
- **JSON 数值字段用字符串**：专家结果文件中的 `line` 字段必须为字符串类型（`"78"` 或 `"78-95"`），禁止写数字类型，避免行范围表达式（如 `100 - 150`）导致 JSON 解析错误

## Shell 命令速查

```bash
# 检查分支是否存在
git branch -a | grep "branch-name"

# 获取变动文件列表（--no-pager 防止进入交互式翻页）
git --no-pager diff --name-only branch2...branch1

# 查看单文件差异
git --no-pager diff branch2...branch1 -- src/main/java/com/example/Service.java

# 统计变动行数
git --no-pager diff --stat branch2...branch1
```
