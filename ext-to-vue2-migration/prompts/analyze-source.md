# 子任务：分析源项目（单段落）

你是一个负责分析 ExtJS/JSP 源项目的 Agent。**每次只分析一个段落**，保持上下文精简。

## 输入变量

- 源项目路径：`{{source_path}}`
- webapp 路径：`{{webapp_path}}`
- 已知模块列表：`{{modules}}`
- **本次段落**：`{{section}}`
- 已有分析文件：`{{analysis_file}}`（`.migration/source-analysis.md`，可能已有前面段落的内容）

## 段落定义

根据 `{{section}}` 值执行对应分析：

### section = "structure"
分析项目基本信息和目录结构。
- 统计前端文件总数和代码行数：
  ```bash
  # Linux/macOS
  find {{webapp_path}} -name "*.jsp" -o -name "*.js" | wc -l
  # Windows PowerShell
  (Get-ChildItem -Path {{webapp_path}} -Recurse -Include "*.jsp","*.js").Count
  ```
- 优先使用 Node.js（跨平台）：`node .cursor/skills/ext-to-vue2-migration/scripts/scan.js overview {{source_path}}`
- 输出 2-3 层深度的目录概要树
- 写入：`## 项目基本信息` + `## 目录结构`

### section = "components"
分析项目自定义基类组件。
- 找到 common/base/shared/framework 目录
- 逐个读取基类 JS 文件（每次一个，只读关键部分）
- 识别：自定义 Grid/Form/Tree/Window 基类、公共搜索组件、公共布局
- 写入：`## 自定义基类组件`（表格：类名|继承自|文件位置|功能|引用次数）

### section = "utils"
分析公共工具方法和 Ajax 封装。
- 找到 utils/tool/helper 相关文件
- 找到 Ajax/request 封装文件
- 写入：`## 公共工具方法`（表格：方法|文件|功能）

### section = "data_patterns"
分析数据交互模式。
- 从 Ajax 封装文件分析请求/响应格式
- 分析分页参数格式
- 分析 Store/Proxy 的常见配置
- 写入：`## 数据交互模式`

### section = "auth"
分析权限和认证。
```bash
# Linux/macOS
grep -rl "permission\|auth\|role\|token" {{webapp_path}} --include="*.js" --include="*.jsp" | head -10

# Windows PowerShell
Get-ChildItem -Path {{webapp_path}} -Recurse -Include "*.js","*.jsp" | Select-String "permission|auth|role|token" | Select-Object -ExpandProperty Path -Unique | Select-Object -First 10
```
- 写入：`## 权限控制`

### section = "module_list"
汇总模块清单。
- 基于扫描结果，输出每个模块的页面数、组件数、预估复杂度
- 写入：`## 模块清单`（表格：模块名|路径|页面数|JS文件数|复杂度）

## 输出方式

将本段落的分析结果**追加**到 `.migration/source-analysis.md`。
- 如果文件不存在（第一段），创建文件并写入标题 `# 源项目分析报告` + 本段内容
- 如果文件已存在（后续段），追加本段内容到文件末尾

## 注意事项

- **只做本段落的分析**，不要跨段落工作
- 每次只读一个文件，大文件只读关键部分（前 50-80 行）
- 分析完返回简短摘要给主 Agent
