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
- **在 `package.json` 中显式列出**：Vue 版本、`dependencies` / `devDependencies` 中的 **UI 组件库**（如 `element-ui`、`ant-design-vue`、`iview`、`vuetify`、`vant` 等）、HTTP 客户端、Vuex 等；注明大致版本号
- 写入：`## 项目基本信息`（含上述依赖表）、`## 目录结构`（`src/` 树）

### components

本段落是迁移时「控件选对、写法对齐」的关键，**必须写实**，不可只列目录名。

**A. 第三方 UI 组件库（通常来自 `package.json`，与 config 段落相互印证）**

- 确认项目实际使用的一个或多个 UI 库；若同时存在多个，说明各自用途（如 PC 用 Element、H5 用 Vant）
- **注册与按需**：阅读 `src/main.js`、`src/main.ts` 及 `src/plugins/`、`babel.config.js` / `.babelrc` / `vue.config.js` 中与 UI 库相关的配置，说明是 **全局注册**、**Vue.use**、还是 **babel-plugin-import / 按需**，以及是否有自定义主题或样式入口
- **典型用法**：在 `{{TARGET_SUBDIR}}` 下 **至少精读 2 个真实页面**（优先选列表+表单或含弹窗的页），记录：
  - 模板中使用的 **组件标签前缀**（如 `el-`、`a-`、`i-`）及常用组合（表格、表单、分页、对话框、日期、下拉）
  - **import 写法**：是 `import { X } from 'element-ui'` 还是仅模板标签、是否使用项目封装的包装组件
- 写入：`## 第三方 UI 组件库`（库名、版本、注册方式、按需策略、**与 Ext 迁移最相关的表格/表单/弹窗写法要点**）

**B. 项目内公共组件**

- 列出 `src/components/`（及若存在 `src/business/` 等封装目录一并列出），抽样读 Props/Events、是否与 UI 库二次封装
- 写入：`## 已有公共组件`（建议表格：组件名 | 路径 | 功能 | 迁移时复用建议）

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

- 只做当前段落；**components 段落与 code_style 段落共同决定迁移代码是否像「本项目写的」**：组件库用法须写清，避免迁移时默认套用 Element 而目标实际是 Ant Design Vue 等
- `code_style` 段落会再抽样页面；若与 `components` 为同一批文件，可在本段注明「详见某文件」避免重复粘贴大段代码