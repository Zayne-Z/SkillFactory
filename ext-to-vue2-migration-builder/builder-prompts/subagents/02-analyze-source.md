> **子 Builder**：`ext-vue2-analyze-source` | Phase 1B  
> **完成约定**：将本段落内容**追加**到 `{{ANALYSIS_FILE}}`，并把该段落标为完成由主 Builder 处理；你返回简短摘要即可。若中断，优先保证已写盘内容一致。

---

# 分析源项目（单段落）

分析 ExtJS/JSP 源项目的 **一个段落**，保持上下文精简。

## 输入变量

- `{{SKILL_ROOT}}`：Skill 根目录
- `{{SOURCE_PATH}}`：源项目根路径
- `{{WEBAPP_PATH}}`：webapp 根（无则与 `SOURCE_PATH` 相同）
- `{{MODULES}}`：已知模块列表（JSON 或逗号分隔）
- `{{SECTION}}`：本段段落名（见下）
- `{{ANALYSIS_FILE}}`：`.migration/source-analysis.md`
- `{{SCAN_SCRIPT}}`：主 Builder 传入的 scan.js 绝对路径（通常 `{SKILL_ROOT}/scripts/scan.js`）
- `{{SCANS_DIR}}`（可选）：`.migration/scans`，供 `module_list` 读取各模块扫描 JSON

## 段落定义

根据 `{{SECTION}}` 执行：

### structure

- 统计 `{{WEBAPP_PATH}}` 下 `.jsp` / `.js` 数量（可用 `node "{{SCAN_SCRIPT}}" overview "{{SOURCE_PATH}}"` 辅助）
- 输出 2–3 层目录概要
- 写入：`## 项目基本信息`、`## 目录结构`

### components

- 查找 common/base/shared/framework 等目录中的基类
- 写入：`## 自定义基类组件`（表格：类名 | 继承自 | 文件 | 功能）

### utils

- 工具与 Ajax 封装
- 写入：`## 公共工具方法`

### data_patterns

- 请求/响应、分页、Store/Proxy；**下拉**静态/远程模式；**表格**列与 model 字段关系
- 写入：`## 数据交互模式`（含「下拉数据来源模式」「表格字段与列」小节）

### auth

- 在 `{{WEBAPP_PATH}}` 下搜索 permission/auth/role/token 相关引用（Windows用 `Select-String`）
- 写入：`## 权限控制`

### module_list

- 结合 `{{MODULES}}` 与 **Phase 1A 产物**：若存在 `{PROJECT_ROOT}/.migration/scans/*.json`（主 Builder 传入目录或告知路径），优先读取各文件中的 `summary` / `pages` 汇总；若无扫描文件则仅依据分析与目录抽样
- 写入：`## 模块清单`（模块名 | 路径 | 页面数 | JS 数 | 复杂度）

## 输出方式

- 若 `{{ANALYSIS_FILE}}` 不存在：创建并写入 `# 源项目分析报告` + 本段内容
- 若已存在：**追加**本段到文件末尾

## 注意事项

- **只做当前 `{{SECTION}}`**
- 单文件读取，大文件只看关键片段
