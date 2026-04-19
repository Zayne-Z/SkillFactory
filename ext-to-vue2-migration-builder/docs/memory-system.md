# 记忆系统设计

## 设计原则

1. **极简**：一个 JSON 文件，Agent 直接读写，不需要任何脚本
2. **模型无关**：任何 LLM 都能读写，结构清晰一看就懂
3. **即学即用**：迁移完一个页面就记录，下一个页面立刻参考
4. **自然增长**：不需手动维护，随迁移推进自动丰富

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
  ]
}
```

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
  "project_notes": []
}
```

### 迁移前查阅
1. 读取 memory.json
2. 查看当前源文件用了哪些 Ext 组件
3. 在 `component_mappings` 中查找已知映射
4. 在 `patterns` 中查找类似页面的成功方案
5. 在 `issues` 中查找需要注意的坑
6. 如果有匹配的 `reference_file`，参考该文件的实现

### 迁移后记录
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

1. 读取源文件 → 发现使用了 Ext.tree.Panel + Ext.grid.Panel 联动
2. 查 component_mappings:
   - Ext.tree.Panel → 无记录（首次遇到树）
   - Ext.grid.Panel → 有记录，confidence 0.95
3. 查 patterns → 没有"树+表联动"模式
4. 查 issues → 没有树相关的坑
5. 结论：表格部分有经验可复用，树部分是新模式，需重点关注
6. 迁移完成后：
   - 新增 component_mappings["Ext.tree.Panel"]
   - 新增 pattern "树+表联动"
   - 如果遇到坑，新增 issue
```

---

## 注意事项

1. 记忆文件是**累积**的，前 3-5 个页面是"学习期"，之后效率显著提升
2. 不要在记忆中存大段代码，只存关键摘要和文件引用
3. `project_notes` 在前几次迁移中手动补充，后续自动参考
4. `reference_file` 字段非常重要——指向已成功迁移的文件，后续可直接参考
