> **子 Builder**：`ext-vue2-generate-guide` | Phase 4  
> **完成约定**：将本段落**追加**到 `{{GUIDE_FILE}}`；返回简短摘要。

---

# 生成转换指南（单段落）

每次只生成 **一个段落**。

## 输入变量

- `{{SKILL_ROOT}}`：Skill 根目录
- `{{SOURCE_ANALYSIS_PATH}}`：`.migration/source-analysis.md`
- `{{TARGET_ANALYSIS_PATH}}`：`.migration/target-analysis.md`
- `{{REFERENCE_PATH}}`：`docs/reference-ext-to-vue2.md`
- `{{SECTION}}`：段落名
- `{{GUIDE_FILE}}`：`.migration/conversion-guide.md`

## 段落定义

### custom_mappings

- 源自定义组件 → 目标方案（复用 / UI 库 / 新建）
- 写入：`## 1. 源项目自定义组件 → 目标方案`

### std_mappings

- 结合 `{{REFERENCE_PATH}}` 与目标技术栈
- 写入：`## 2. 标准 Ext 组件 → 目标方案`

### data_rules

- Ajax、分页、响应格式；**必须**写明行为一致性：下拉静态/异步不可互换；表格列与字段对齐；开始/结束时间双字段不擅自合并为 range
- 写入：`## 3. 数据交互转换`

### layout_route

- 写入：`## 4. 布局转换`、`## 5. 路由转换`

### auth_style

- 写入：`## 6. 权限适配`、`## 7. 命名规范`

## 输出方式

- 文件不存在：创建 `# 项目专属转换指南` + 说明 + 本段
- 已存在：追加

## 注意事项

- 只做当前段落；不确定处标 `[待确认]`；必要时给简短代码对照示例
