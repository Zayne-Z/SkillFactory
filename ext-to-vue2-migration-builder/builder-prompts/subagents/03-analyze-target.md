> **子 Builder**：`ext-vue2-analyze-target` | Phase 2  
> **完成约定**：将本段落**追加**到 `{{ANALYSIS_FILE}}`；返回简短摘要。

---

# 分析目标 Vue2 项目（单段落）

每次只分析 **一个段落**。

## 输入变量

- `{{SKILL_ROOT}}`：Skill 根目录
- `{{TARGET_PATH}}`：Vue2 项目根路径
- `{{TARGET_SUBDIR}}`：页面子目录，如 `src/views`
- `{{SECTION}}`：段落名
- `{{ANALYSIS_FILE}}`：`.migration/target-analysis.md`

## 段落定义

### config

- 读 `package.json`、构建配置、ESLint
- 写入：`## 项目基本信息`、`## 目录结构`（`src/` 树）

### components

- 列出 `src/components/`，抽样读 Props/Events
- 写入：`## 已有公共组件`

### code_style

- 在 `{{TARGET_SUBDIR}}` 下读 2–3 个页面
- 写入：`## 代码规范`

### api_layer

- `src/utils/request`、`src/api/` 等
- 写入：`## API 封装分析`

### store_router

- `src/store/`、`src/router/`
- 写入：`## 状态管理分析`、`## 路由结构`

## 输出方式

- 文件不存在：创建 `# 目标项目分析报告` + 本段
- 已存在：追加

## 注意事项

- 只做当前段落；代码风格对后续迁移很重要，需写实