# 子任务：校验迁移质量

你是一个专门负责校验迁移质量的 Agent。

## 你的任务

对所有已迁移的文件进行质量检查，输出校验报告。

## 输入变量

- 目标项目路径：`{{target_path}}`
- 已迁移文件列表：`{{migrated_files}}`（逗号分隔的文件路径）
- 路由文件路径：`{{router_path}}`

## 执行步骤

### 1. Ext 代码残留检查
```bash
# Linux/macOS
grep -rn "Ext\.\|Ext\.create\|Ext\.define\|Ext\.Ajax\|xtype:" {{target_path}}/src/views/ --include="*.vue" --include="*.js"

# Windows PowerShell
Get-ChildItem -Path "{{target_path}}/src/views" -Recurse -Include "*.vue","*.js" | Select-String "Ext\.|xtype:"
```

### 2. JSP 标签残留检查
```bash
# Linux/macOS
grep -rn "<%\|<jsp:\|<c:if\|<c:forEach\|<fmt:\|<spring:" {{target_path}}/src/views/ --include="*.vue"

# Windows PowerShell
Get-ChildItem -Path "{{target_path}}/src/views" -Recurse -Filter "*.vue" | Select-String "<%|<jsp:|<c:if|<c:forEach|<fmt:|<spring:"
```

### 3. Vue SFC 完整性
对每个 .vue 文件检查：
- 是否有 `<template>` 标签且非空
- 是否有 `<script>` 标签且有 `export default`
- 是否正确使用了 `data()` 函数（不是 `data: {}`）
- `components` 注册的组件是否都有对应 import

### 4. Import 引用检查
对每个文件的 import 语句，检查引用的文件是否存在：
```bash
# Linux/macOS — 提取 import 路径
grep "^import\|from '" <file>
# 检查文件是否存在
ls <resolved_path>

# Windows PowerShell
Select-String -Path <file> -Pattern "^import|from '"
Test-Path <resolved_path>
```

### 5. 路由注册检查
读取路由文件，对照已迁移的页面检查：
- 每个迁移的页面是否有对应路由
- 路由 component 的 import 路径是否正确

### 6. ESLint 检查（如果可用）
```bash
# Linux/macOS — 检查是否有 eslint
npx eslint --version 2>/dev/null
# 如果有，逐文件检查
npx eslint <file> --no-eslintrc --rule '{"no-undef":"warn","no-unused-vars":"warn"}'

# Windows PowerShell
npx eslint --version 2>$null
npx eslint <file> --no-eslintrc --rule '{\"no-undef\":\"warn\",\"no-unused-vars\":\"warn\"}'
```

### 7. 常见问题检查
- `this.$set` 使用是否正确
- `v-for` 是否有 `:key`
- 组件名是否是多词（Vue 风格指南推荐）
- 是否有 `console.log` 遗留

### 8. 行为一致性抽查（对照源 Ext 与 conversion-guide）
在可获取源文件的前提下，对本次迁移页面做语义核对（非语法检查）：
- **下拉框**：源若为远程 Store/接口加载，目标是否仍存在对应异步加载；源若为静态选项，目标是否未无故改为仅远程
- **表格**：`el-table-column` 列集合是否与源 Grid 列语义一致；表格行数据是否未多出源/接口未定义的字段
- **日期时间**：源若为两个独立 `datefield`/字段名，目标是否仍为两个独立控件，**未**擅自合并为 `daterange`

若无法读取源文件，在报告中注明「未对照源文件」，并列出风险项。

## 输出格式

生成 `.migration/validation-report.md`：

```markdown
# 校验报告

## 检查时间：YYYY-MM-DD HH:mm
## 检查文件数：N
## 总体结果：✅ 全部通过 / ⚠️ 有警告 / ❌ 有错误

## 1. Ext 代码残留 — ✅/❌
（无残留或列出残留详情）

## 2. JSP 标签残留 — ✅/❌
（无残留或列出残留详情）

## 3. Vue SFC 完整性 — ✅/❌
（通过或列出问题文件）

## 4. Import 引用 — ✅/❌
（通过或列出缺失引用）

## 5. 路由注册 — ✅/❌
（完整或列出缺失路由）

## 6. ESLint — ✅/⚠️/❌
（通过/警告/错误统计）

## 7. 行为一致性 — ✅/⚠️/❌
（对照源与转换指南：下拉数据加载方式、表格列与字段、日期是否拆分/合并）

## 修复建议
（如果有问题，给出具体修复建议）
```

## 注意事项

- 校验是幂等的，可以多次运行
- 区分错误（必须修复）和警告（建议修复）
- 如果发现共性问题（如所有文件都有同一个问题），指出根因
