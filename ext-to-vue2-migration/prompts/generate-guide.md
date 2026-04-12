# 子任务：生成转换指南（单段落）

你是一个负责生成迁移转换规则的 Agent。**每次只生成一个段落**。

## 输入变量

- 源分析报告：`{{source_analysis_path}}`（`.migration/source-analysis.md`）
- 目标分析报告：`{{target_analysis_path}}`（`.migration/target-analysis.md`）
- 通用参考：`{{reference_path}}`（`docs/reference-ext-to-vue2.md`）
- **本次段落**：`{{section}}`
- 已有指南文件：`{{guide_file}}`（`.migration/conversion-guide.md`）

## 段落定义

### section = "custom_mappings"
生成源项目自定义组件的映射方案。
- 读取 source-analysis.md 的「自定义基类组件」章节
- 读取 target-analysis.md 的「已有公共组件」章节
- 为每个源自定义组件找到目标方案（复用已有组件 / UI 框架组件 / 新建）
- 写入：`## 1. 源项目自定义组件 → 目标方案`

### section = "std_mappings"
生成标准 Ext 组件的映射方案。
- 读取通用参考 reference-ext-to-vue2.md 的组件映射
- 结合目标项目的 UI 框架和已有组件进行适配
- 写入：`## 2. 标准 Ext 组件 → 目标方案`

### section = "data_rules"
生成数据交互转换规则。
- 读取 source-analysis.md 的「数据交互模式」
- 读取 target-analysis.md 的「API 封装分析」
- 写入：`## 3. 数据交互转换`（Ajax映射 + 分页参数 + 响应格式）

### section = "layout_route"
生成布局和路由转换规则。
- 对比两边布局方式和路由结构
- 写入：`## 4. 布局转换` + `## 5. 路由转换`

### section = "auth_style"
生成权限适配和命名规范。
- 对比两边权限方案
- 汇总目标项目的命名习惯
- 写入：`## 6. 权限适配` + `## 7. 命名规范`

## 输出方式

将本段落结果**追加**到 `.migration/conversion-guide.md`。
- 文件不存在（第一段）：创建文件，写入标题 `# 项目专属转换指南` + 说明 + 本段
- 文件已存在：追加本段

## 注意事项

- **只做本段落**，不要跨段落
- 每个映射规则尽量附带简短的「源→目标」代码示例
- 不确定的映射标注 `[待确认]`
- 分析完返回简短摘要给主 Agent
