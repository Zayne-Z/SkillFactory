# 记忆系统设计

## 设计原则

1. **极简**：一个 JSON 文件，Agent 直接读写，不需要任何脚本
2. **模型无关**：任何 LLM 都能读写，结构清晰一看就懂
3. **即学即用**：迁移完一个页面就记录，下一个页面立刻参考
4. **自然增长**：不需手动维护，随迁移推进自动丰富
5. **人机共写**：用户口头提醒的约束要**落盘**到 `user_lessons`，避免只停留在当轮对话
6. **探索沉淀**：若本次任务经**多处查阅/多轮尝试**才定型，要把**成功路径**写入 `resolution_paths`，让后续少绕路

---

## 文件位置

`.migration/memory.json`

---

## 数据结构

> ⚠️ **重要**：JSON 中所有数值字段（confidence、hit_count 等）**必须使用字符串类型**（加双引号），避免含连字符的值导致 JSON 解析失败。

```json
{
  "version": "1.0",
  "updated_at": "2025-01-15T10:30:00",

  "component_mappings": {
    "App.base.Grid": {
      "vue_solution": "el-table + 项目 TableMixin",
      "notes": "项目已有 TableMixin 包含分页逻辑，直接复用",
      "confidence": "0.95",
      "used_in": ["T003", "T005"]
    },
    "Ext.form.Panel": {
      "vue_solution": "el-form + rules 验证",
      "notes": "验证从 vtype 改为 rules 对象",
      "confidence": "0.9",
      "used_in": ["T004"]
    }
  },

  "patterns": [
    {
      "id": "p001",
      "name": "列表页标准模式",
      "ext_pattern": "Grid + 顶部搜索 + 分页 + 操作列",
      "vue_solution": "SearchBar + el-table + el-pagination，搜索重置时页码回1",
      "reference_task": "T003",
      "reference_file": "src/views/user/List.vue",
      "confidence": "0.95"
    }
  ],

  "issues": [
    {
      "id": "i001",
      "problem": "Ext store autoLoad 回调在组件销毁后仍触发",
      "solution": "Vue 中在 beforeDestroy 取消请求或加 isDestroyed 守卫",
      "severity": "medium",
      "hit_count": "3"
    }
  ],

  "api_mappings": [
    {
      "source_url": "/user/list.do",
      "target_api_file": "src/api/user.js",
      "target_method": "getUserList",
      "param_notes": "start/limit → pageNum/pageSize",
      "response_notes": "data.rows → data.list"
    }
  ],

  "project_notes": [
    "后端接口统一返回 { code: 0, msg: '', data: {} }",
    "项目约定 views 下按模块建子目录，文件用 PascalCase",
    "已有全局权限指令 v-permission"
  ],

  "user_lessons": [
    {
      "id": "ul001",
      "content": "财务模块表格必须用项目封装的 FinanceTable，不要直接用 el-table",
      "task_id": "T012",
      "created_at": "2026-04-21T15:00:00",
      "source": "user"
    }
  ],

  "resolution_paths": [
    {
      "id": "rp001",
      "task_id": "T011",
      "goal": "Ext.form.field.Tag → 可搜索多选",
      "steps": [
        "查 component_mappings 无现成映射",
        "读 target-analysis 第三方组件库 → 确认为 Element",
        "读 conversion-guide 无该控件 → 对照 reference-ext-to-vue2 表单章节",
        "读 memory patterns 中类似表单页 reference_file",
        "最终采用 el-select multiple + filterable"
      ],
      "outcome": "el-select multiple + filterable，选项来自原 store 转数组",
      "key_files": [
        ".migration/target-analysis.md",
        "src/views/example/TagForm.vue"
      ],
      "confidence": "0.82"
    }
  ]
}
```

### 字段说明（新增）

| 字段 | 用途 |
|------|------|
| `user_lessons` | **用户主动提醒**的经验（纠正偏好、模块约定、禁止事项等）。`source` 一般为 `user`；若主 Builder 代用户摘要写入，可标 `source`: `main_builder` |
| `resolution_paths` | **Agent 本次任务内**多次查询/尝试后才成功的路径摘要；不是流水账，而是「从哪几步绕到哪一结论」 |

---

## Agent 操作方式

### 初始化
Phase 5 首次执行时，如果 memory.json 不存在，创建空结构：
```json
{
  "version": "1.0",
  "updated_at": "",
  "component_mappings": {},
  "patterns": [],
  "issues": [],
  "api_mappings": [],
  "project_notes": [],
  "user_lessons": [],
  "resolution_paths": []
}
```

### 迁移前查阅
1. 读取 memory.json 全文（含新增段）
2. **优先浏览 `user_lessons`**：用户强调过的规则优先于个人推断
3. **浏览 `resolution_paths`**：若当前任务与某条 `goal` / `task_id` 场景相近，优先复用其 `outcome` 与 `steps` 中的结论，避免重复试错
4. 查看当前源文件用了哪些 Ext 组件
5. 在 `component_mappings` 中查找已知映射
6. 在 `patterns` 中查找类似页面的成功方案
7. 在 `issues` 中查找需要注意的坑
8. 如果有匹配的 `reference_file`，参考该文件的实现

### 用户提醒时写入（可与迁移完成合并一次写盘）

当**用户在本轮对话中**明确说「记住 / 以后 / 必须 / 不要 / 统一用…」等**长期有效**的约束时：

1. 将语义压缩为一条或数条 `user_lessons` 条目（`id` 可用 `ul` + 三位递增；`source`: `user`；`task_id` 填当前任务）
2. 若与已有 `project_notes` 重复，合并或更新较新的一条，避免刷屏式重复

主 Builder 若在拉起 `ext-vue2-migrate-page` 时传入可选变量 **`USER_HINT`**（对用户原话的简短摘要），子 Agent **必须**把其中属于长期经验的写入 `user_lessons`（可与用户当轮自然语言合并理解）。

### 多步探索成功后写入 `resolution_paths`

当本次任务满足 **「查阅或尝试 ≥ 3 个不同信息源才定稿」** 时（例如：memory → target-analysis → conversion-guide → 某 reference_file → 源 Ext 再确认），在任务**成功或部分成功**后追加一条 `resolution_paths`：

- **`goal`**：本次解决的迁移子问题（一句话）
- **`steps`**：字符串数组，**3～6 步**，每步极短，写清「先查了哪类依据、为何转向下一步」
- **`outcome`**：最终采用的技术方案（一句话 + 可写关键组件名）
- **`key_files`**：最多 5 个路径，含本次产出的 `.vue` / 曾救场的 md
- **`confidence`**：字符串；首次沉淀建议 `"0.75"`～`"0.85"`，后续若被同类任务复用成功可酌情调高（同 `patterns` 信心度逻辑）

若任务非常顺利（一两次查阅就完成），**不必**硬造 `resolution_paths` 条目。

### 迁移后记录（原有各类）
完成一个页面后，Agent 评估并写入：

**新组件映射**：
```json
// 往 component_mappings 中追加
"App.ux.ComboTree": {
  "vue_solution": "el-popover + el-tree 组合实现",
  "notes": "需要双向绑定选中值",
  "confidence": "0.7",
  "used_in": ["T008"]
}
```

**成功的模式**：
```json
// 往 patterns 中追加
{
  "id": "p002",
  "name": "树+表联动",
  "ext_pattern": "左侧 TreePanel 点击，右侧 Grid 刷新",
  "vue_solution": "el-aside 放 el-tree，@node-click 触发表格 reload",
  "reference_task": "T010",
  "reference_file": "src/views/org/Index.vue",
  "confidence": "0.7"
}
```

**踩坑记录**：
```json
// 往 issues 中追加
{
  "id": "i002",
  "problem": "Ext.form.field.Date 的 submitFormat 和显示 format 分离",
  "solution": "el-date-picker 用 value-format 控制提交格式，format 控制显示",
  "severity": "low",
  "hit_count": "1"
}
```

### 信心度调整
- 新记录默认 `confidence: "0.7"`（字符串）
- 每次成功复用：将 confidence 字符串值按浮点运算后更新（+0.05，上限 "0.99"）
- 如果某条记忆导致了错误：将 confidence 降低 0.2（下限 "0.1"）
- Agent 优先参考高 confidence 的记忆

---

## 记忆查询流程示例

```
迁移 T010（组织架构页面）之前：

1. 读 user_lessons → 用户曾要求「组织树必须用懒加载」，本页含树 → 遵守
2. 读 resolution_paths → 无完全同题，有一条「TreePanel + Grid」探索记录 → 参考其 outcome
3. 读取源文件 → 发现使用了 Ext.tree.Panel + Ext.grid.Panel 联动
4. 查 component_mappings:
   - Ext.tree.Panel → 无记录（首次遇到树）
   - Ext.grid.Panel → 有记录，confidence 0.95
5. 查 patterns → 没有「树+表联动」模式
6. 查 issues → 没有树相关的坑
7. 结论：表格部分有经验可复用，树部分是新模式，需重点关注
8. 迁移完成后：
   - 新增 component_mappings["Ext.tree.Panel"]
   - 新增 pattern「树+表联动」
   - 若本次经多源查阅才定稿 → 追加一条 resolution_paths
   - 若用户在对话中说「记住：组织树节点图标用自定义 SVG」→ 写入 user_lessons
   - 如果遇到坑，新增 issue
```

---

## 注意事项

1. 记忆文件是**累积**的，前 3-5 个页面是「学习期」，之后效率显著提升
2. 不要在记忆中存大段代码，只存关键摘要和文件引用
3. `project_notes` 可混合用户与 Agent 写入；与 `user_lessons` 区分：**后者带任务锚点与显式来源**，适合「用户纠正」类内容
4. `reference_file` 字段非常重要——指向已成功迁移的文件，后续可直接参考
5. `resolution_paths` 与 `patterns` 互补：**patterns** 偏业务形态（列表页、树表联动）；**resolution_paths** 偏「这次怎么绕出来的」解题轨迹，便于疑难控件二次遇到时对齐
6. `user_lessons` 与 `conversion-guide.md` 冲突时：以**用户最新明确指令**为准，并在 `user_lessons` 或 `issues` 中注明待更新指南（避免静默矛盾）
