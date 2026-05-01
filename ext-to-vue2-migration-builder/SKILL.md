---
name: ext-to-vue2-migration-builder
description: >-
  ExtJS/JSP → Vue2 迁移 Skill（主 Builder 编排版，目录名常含 builder 后缀）。主 Builder 读取本文件驱动全流程，
  通过预配置的子 Builder 分阶段执行；中间状态写入 .migration/state.json，支持断点续跑，适配中等上下文模型。
  与单文件 prompts 版 ext-to-vue2-migration 为同一流程的不同封装形态。
---

# ExtJS → Vue2 迁移 · 主 Builder 工作流

> **本文件是主 Builder 运行时的唯一指令来源。**  
> 主 Builder 负责编排、状态、用户确认与脚本调用；**不**做大规模源码阅读或整页迁移（由子 Builder 完成）。

---

## 1. Skill 目录（`{SKILL_ROOT}` = 本 SKILL.md 所在目录）

```
{SKILL_ROOT}/
├── SKILL.md                    ← 本文件（主 Builder 运行时读取）
├── docs/
│   ├── reference-ext-to-vue2.md
│   ├── reference-common-issues.md
│   ├── state-structure.md      ← state.json / planning-result / 断点规则
│   ├── memory-system.md
│   └── output-files.md
├── scripts/
│   └── scan.js                 ← 跨平台检测 / 概览 / 详细扫描（零依赖）
├── builder-prompts/          ← 仅供人工创建 Builder 时参考，运行时不读取
│   ├── README.md
│   ├── main/MAIN_BUILDER.md
│   └── subagents/
└── (无 prompts/；子 Builder 提示词仅在 builder-prompts/subagents/)
```

**`{PROJECT_ROOT}` 约定**：放置 `.migration/` 的目录，一般为用户在 IDE 中打开的**工作区根目录**（单仓库根或多仓父目录）。`source_project` 与 `target_project` 可为绝对路径，**不必**与 `{PROJECT_ROOT}` 相同；所有相对路径 `.migration/...` 均相对于 `{PROJECT_ROOT}` 解析。

**运行时生成：**

```
{PROJECT_ROOT}/.migration/
├── state.json
├── scans/                      ← 各模块扫描 JSON
├── planning-result.json        ← Phase 3 结构化任务（合并入 state）
├── task-results/               ← 各迁移任务摘要 JSON
├── source-analysis.md
├── target-analysis.md
├── inventory.md
├── plan.md
├── conversion-guide.md
├── memory.json
├── progress.md
└── validation-report.md
```

---

## 2. 核心机制

### 2.1 状态驱动

每个操作前读取 `{PROJECT_ROOT}/.migration/state.json`，操作后立即写回。字段与防死锁见 `{SKILL_ROOT}/docs/state-structure.md`。

### 2.2 主 Builder 启动逻辑（每次对话开头执行）

```
1. 确认 {SKILL_ROOT} 绝对路径；若 state.json 中 skill_root 为空，写入 skill_root = {SKILL_ROOT}
2. 读取 {PROJECT_ROOT}/.migration/state.json
   - 不存在 → 执行 Phase 0
   - 存在 → 按 current_phase 续跑
3. current_phase == completed → 告知用户流程已结束，产物在 .migration/
4. current_phase == source_analysis 且 scan_progress.scan_completed !== true → 仅推进 Phase 1A（对 pending_modules 唤起 ext-vue2-scan-module）；禁止启动 ext-vue2-analyze-source
5. current_phase == source_analysis 且 scan_progress.scan_completed === true → 在 source_sections 中找首个非 completed 段落（in_progress 先按 state-structure 校验），唤起 ext-vue2-analyze-source
6. current_phase == target_analysis → 在 target_sections 中同上，唤起 ext-vue2-analyze-target
7. current_phase == planning → 若缺 inventory.md / plan.md / planning-result.json 或未合并 migration_tasks，唤起 ext-vue2-planning；若等待用户编辑清单/计划，提示路径并暂停直至用户确认继续
8. current_phase == guide_generation → 在 guide_sections 中同上，唤起 ext-vue2-generate-guide
9. current_phase == migrating → 按 Phase 5：串行 ext-vue2-migrate-page；in_progress 时校验 task-results/{id}.json
10. current_phase == validating → 唤起 ext-vue2-validate（见 Phase 6）
11. 主 Builder 上下文将满 → 写 state.json → 提示用户重启主 Builder
```

### 2.3 子 Builder 故障恢复

```
1. 执行前将任务或段落标为 in_progress，写回 state.json
2. 拉起子 Builder，传入 SKILL.md 规定的变量
3. 根据产物文件是否存在且合法，标 completed；否则 pending，换新实例重试（最多 2 次）
4. 仍失败 → failed，记入根节点 notes[]（字符串数组）或对应任务的 migration_tasks[].notes；迁移阶段是否继续下一任务须询问用户
```

### 2.4 主 Builder 禁令（防上下文爆炸）

1. **不要**读入 `builder-prompts/subagents/*.md` 全文  
2. **不要**读入 `docs/reference-*.md` 全文  
3. **不要**读入完整 `source-analysis.md` / `target-analysis.md` / `conversion-guide.md`（除非用户明确要求或做 existence 检查）  
4. **不要**在主对话中执行整页迁移或深度代码审查  

---

## 3. 阶段详情

### Phase 0：初始化与项目发现（主 Builder 本地）

**仅在新会话且 `.migration/state.json` 尚不存在时执行完整 Phase 0**（断点续跑跳过本节4–6 的「首次写入」）。

1. 确认 `{PROJECT_ROOT}`（一般为当前工作区根）。创建 `.migration/`、`.migration/scans/`、`.migration/task-results/`（若不存在）。  
2. 若用户尚未指定路径：用目录列举或 `node "{SKILL_ROOT}/scripts/scan.js" detect "<候选目录>"` 辅助，请用户确认 **`source_project`**、**`target_project`**、**`target_subdir`**（默认 `src/views`）。路径建议用绝对路径写入 `state.json`，避免多仓布局下相对路径歧义。  
3. 在已确认的 `source_project` 上执行：

```bash
node "{SKILL_ROOT}/scripts/scan.js" overview "{source_project}"
```

4. 根据 overview 填写 **`discovered_modules`**：优先取 `modules` 中 `has_frontend: true` 的 `name`；若均为 `false`（例如前端集中在 `webapp` 下而一级目录是 Maven 模块），则运行 `node "{SKILL_ROOT}/scripts/scan.js" detect "{source_project}"`，将 `webapp_path` 下的一级子目录作为候选模块，**或**由用户指定待扫目录列表。  
5. **首次**按 `docs/state-structure.md` 写入 `state.json`：`skill_root`（若为空则填 `{SKILL_ROOT}`）、`source_project`、`target_project`、`target_subdir`、`discovered_modules`、`scan_progress`（`pending_modules` = `discovered_modules` 副本，`scanned_modules` = `[]`，`total_modules` = 数量字符串，`scan_completed` = false）、各 `*_sections` 初始为 `pending`、`migration_tasks` = `[]`、`progress` 归零、`current_phase` = `"source_analysis"`，并维护 `created_at` / `updated_at`。  
6. 向用户确认模块列表是否合理，写回后再进入 Phase 1。

---

### Phase 1：源项目（扫描 + 分段分析）

#### Step A — 按模块扫描（对每个未扫描模块）

**子 Builder：** `ext-vue2-scan-module`

| 变量 | 值 |
|------|-----|
| `SKILL_ROOT` | Skill 根目录 |
| `MODULE_PATH` | 该模块实际根目录的绝对路径：一般为 `path.join(source_project, module)`；若源为 Java Web 且前端在 `webapp` 下，则为 `path.join(webapp_path, module)` 或用户为「模块」指定的子目录（须能覆盖该模块 JSP/JS） |
| `MODULE_NAME` | 模块名（用于命名扫描 JSON；与 `OUTPUT_PATH` 中 `safe_module_name` 对应） |
| `SCAN_SCRIPT` | `{SKILL_ROOT}/scripts/scan.js` |
| `OUTPUT_PATH` | `{PROJECT_ROOT}/.migration/scans/{safe_module_name}.json` |

`safe_module_name`：将 `{{MODULE_NAME}}` 中路径分隔符及非法文件名字符替换为 `_`。

**完成标志：** `OUTPUT_PATH` 存在且为合法 JSON。

每完成一个模块：从 `pending_modules` 移除、加入 `scanned_modules`；`pending_modules` 为空时设 `scan_progress.scan_completed = true`（并核对 `scanned_modules.length` 与 `total_modules` 一致，必要时修正 `total_modules`）。

#### Step B — 源分析段落（严格顺序）

**前提：** `scan_progress.scan_completed === true`。否则仅执行 Step A。

对 `source_sections` 中每个段落键（`structure` → `components` → `utils` → `data_patterns` → `auth` → `module_list`），若不为 `completed`：

**子 Builder：** `ext-vue2-analyze-source`

| 变量 | 说明 |
|------|------|
| `SKILL_ROOT` | Skill 根 |
| `SOURCE_PATH` | `state.source_project` |
| `WEBAPP_PATH` | 源项目 webapp 根（可由主 Builder `scan.js detect source_project` 读 `webapp_path`；若无则用 `source_project`） |
| `MODULES` | `discovered_modules` 的 JSON 字符串或逗号分隔列表 |
| `SECTION` | 当前段落名 |
| `ANALYSIS_FILE` | `{PROJECT_ROOT}/.migration/source-analysis.md` |
| `SCAN_SCRIPT` | `{SKILL_ROOT}/scripts/scan.js` |
| `SCANS_DIR`（可选） | `{PROJECT_ROOT}/.migration/scans`；当 `SECTION` = `module_list` 时建议传入，便于汇总 Phase 1A 的 JSON |

完成后将该段落标 `completed`。全部完成后向用户展示摘要，等待确认（可选），`current_phase = "target_analysis"`。

---

### Phase 2：目标项目分析（分段）

对 `target_sections`：`config` → `components` → `code_style` → `api_layer` → `store_router`：

> **说明**：`components` 段落须覆盖 **package.json 中的第三方 UI 库、注册/按需方式、页面中的真实用法**（见子 Builder 提示词），否则迁移易误用默认 Element 等示例。

**子 Builder：** `ext-vue2-analyze-target`

| 变量 | 说明 |
|------|------|
| `SKILL_ROOT` | Skill 根 |
| `TARGET_PATH` | `state.target_project` |
| `TARGET_SUBDIR` | `state.target_subdir` |
| `SECTION` | 当前段落 |
| `ANALYSIS_FILE` | `{PROJECT_ROOT}/.migration/target-analysis.md` |

全部 `completed` 后，`current_phase = "planning"`。

---

### Phase 3：清单与计划（子 Builder + 主 Builder 合并）

**子 Builder：** `ext-vue2-planning`

| 变量 | 说明 |
|------|------|
| `SKILL_ROOT` | Skill 根 |
| `SOURCE_ANALYSIS_PATH` | `.migration/source-analysis.md` |
| `TARGET_ANALYSIS_PATH` | `.migration/target-analysis.md` |
| `OUTPUT_FILES_DOC` | `{SKILL_ROOT}/docs/output-files.md` |
| `OUTPUT_INVENTORY` | `.migration/inventory.md` |
| `OUTPUT_PLAN` | `.migration/plan.md` |
| `PLANNING_RESULT_PATH` | `.migration/planning-result.json` |

**完成标志：**三个产物均存在；`planning-result.json` 合法且 `migration_tasks` 非空。

**主 Builder：** 将 `planning-result.json` 的 `migration_tasks` 合并入 `state.json`（见 `state-structure.md`）；更新 `progress.total`；提示用户编辑 `inventory.md` / `plan.md` 后回复继续。

用户确认后：`current_phase = "guide_generation"`。

---

### Phase 4：转换指南（分段）

对 `guide_sections`：`custom_mappings` → `std_mappings` → `data_rules` → `layout_route` → `auth_style`：

**子 Builder：** `ext-vue2-generate-guide`

| 变量 | 说明 |
|------|------|
| `SKILL_ROOT` | Skill 根 |
| `SOURCE_ANALYSIS_PATH` | `.migration/source-analysis.md` |
| `TARGET_ANALYSIS_PATH` | `.migration/target-analysis.md` |
| `REFERENCE_PATH` | `{SKILL_ROOT}/docs/reference-ext-to-vue2.md` |
| `SECTION` | 当前段落 |
| `GUIDE_FILE` | `.migration/conversion-guide.md` |

全部完成后：`current_phase = "migrating"`；若 `memory.json` 不存在，主 Builder 按 `docs/memory-system.md` 初始化。

---

### Phase 5：逐任务迁移（串行子 Builder）

**规则：** 一次只拉起 **一个** `ext-vue2-migrate-page`（记忆与文件依赖）。

1. 询问用户本批处理任务数（建议 1–3）；从 `migration_tasks` 取对应数量 `pending`。  
2. 对每个任务：

**子 Builder：** `ext-vue2-migrate-page`

| 变量 | 说明 |
|------|------|
| `SKILL_ROOT` | Skill 根 |
| `TASK_ID` | 任务 id |
| `TASK_NAME` | 任务名 |
| `SOURCE_FILES` | 相对 `source_project` 的路径列表（字符串形式） |
| `TARGET_FILES` | 目标文件路径列表 |
| `GUIDE_PATH` | `.migration/conversion-guide.md` |
| `MEMORY_PATH` | `.migration/memory.json` |
| `USER_HINT`（可选） | 用户在本任务前口头补充的长期约束，主 Builder **摘要成一两句话**传入；无则省略或空字符串 |
| `TARGET_PROJECT` | `state.target_project` |
| `SOURCE_PROJECT` | `state.source_project` |
| `OUTPUT_PATH` | `.migration/task-results/{TASK_ID}.json` |

**记忆强化（Phase 5）**：子 Builder 须按 `docs/memory-system.md` 维护 `user_lessons`（用户提醒）与 `resolution_paths`（多步查阅后才成功的路径沉淀）；主 Builder 在用户刚说完纠正意见后启动下一任务时，应把要点写入 `USER_HINT`。

3. 主 Builder 根据摘要更新 `migration_tasks[].status`、`progress`、`progress.md`（可简要追加一行，不必全文读取 guide）。  
4. 批次结束询问是否继续，直至无 `pending` 或用户暂停。全部完成 → `current_phase = "validating"`。

---

### Phase 6：校验

**子 Builder：** `ext-vue2-validate`

| 变量 | 说明 |
|------|------|
| `SKILL_ROOT` | Skill 根（读 `reference-common-issues.md` 可选） |
| `TARGET_PATH` | `target_project` |
| `MIGRATED_FILES` | 已完成任务对应的目标文件列表（逗号分隔或 JSON） |
| `ROUTER_PATH` | 由用户或主 Builder 指定，如 `src/router/index.js` |
| `SOURCE_PROJECT` | 用于行为一致性抽查 |
| `GUIDE_PATH` | `{PROJECT_ROOT}/.migration/conversion-guide.md`（行为一致性对照） |
| `VALIDATION_REPORT_PATH` | `{PROJECT_ROOT}/.migration/validation-report.md` |

完成后：`current_phase = "completed"`，告知用户报告路径。

---

## 4. 子 Builder 标识对照表

在 AI 插件中创建以下 Builder，系统提示词取自 `builder-prompts/subagents/`：

| 标识 | 提示词文件 | 阶段 |
|------|------------|------|
| `ext-vue2-scan-module` | `01-scan-module.md` | 1A |
| `ext-vue2-analyze-source` | `02-analyze-source.md` | 1B |
| `ext-vue2-analyze-target` | `03-analyze-target.md` | 2 |
| `ext-vue2-planning` | `04-planning.md` | 3 |
| `ext-vue2-generate-guide` | `05-generate-guide.md` | 4 |
| `ext-vue2-migrate-page` | `06-migrate-page.md` | 5 |
| `ext-vue2-validate` | `07-validate.md` | 6 |

---

## 5. Git / Shell 备忘

- Windows **无** `grep`：用 `Select-String` 或子 Builder 内按 OS 执行。  
- `git` 命令加 `--no-pager`，避免交互分页。

```bash
git --no-pager log --oneline -5
```

---

## 6. 并行说明（可选）

模块扫描（Phase 1A）在插件支持多子 Builder 并行时可加速；**迁移（Phase 5）保持串行**。不支持并行时按顺序执行即可，语义不变。
