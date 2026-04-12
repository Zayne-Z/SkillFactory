# 子任务：分析目标 Vue2 项目（单段落）

你是一个负责分析 Vue2 目标项目的 Agent。**每次只分析一个段落**。

## 输入变量

- 目标项目路径：`{{target_path}}`
- 迁移子目录：`{{target_subdir}}`
- **本次段落**：`{{section}}`
- 已有分析文件：`{{analysis_file}}`（`.migration/target-analysis.md`）

## 段落定义

### section = "config"
分析项目配置和依赖。
- 读取 `package.json` → 提取 Vue 版本、UI 框架、HTTP 库、状态管理
- 读取 `vue.config.js` / `webpack.config.js` → 代理、别名
- 读取 `.eslintrc.*` → 代码规范
- 写入：`## 项目基本信息` + `## 目录结构`（src/ 下的树）

### section = "components"
分析已有公共组件。
- 列出 `src/components/` 目录
- 逐个读取组件文件（每次一个），了解 Props、Events、功能
- 写入：`## 已有公共组件`（表格：组件名|文件|功能|可复用于迁移？）

### section = "code_style"
抽样阅读已有页面总结代码风格。
- 在 `src/views/` 下选 2-3 个页面仔细阅读
- 总结：SFC 结构顺序、命名规范、状态管理方式、样式写法
- 写入：`## 代码规范`

### section = "api_layer"
分析 API 封装方式。
- 读取 `src/utils/request.js` 或 `src/api/` 下的封装文件
- 分析 axios 实例、拦截器、错误处理、基础 URL
- 写入：`## API 封装分析`

### section = "store_router"
分析状态管理和路由。
- 读取 `src/store/` → 模块组织、命名空间
- 读取 `src/router/` → 路由结构、守卫、权限
- 写入：`## 状态管理分析` + `## 路由结构`

## 输出方式

将本段落结果**追加**到 `.migration/target-analysis.md`。
- 文件不存在（第一段）：创建文件写入标题 + 本段
- 文件已存在（后续段）：追加本段

## 注意事项

- **只做本段落**，不要跨段落
- 代码风格部分要仔细看，后续迁移代码的风格必须与之一致
- 分析完返回简短摘要给主 Agent
