---
name: pa-codegraph
description: >-
  处理代码仓库相关任务时主动使用本 Skill，包括理解或修改代码、定位缺陷、运行或分析测试、检索符号、梳理架构和调用链、评估依赖与变更影响。即使用户没有提到 CodeGraph，也先用本 Skill 检查公司 CodeGraph wrapper MCP 和当前项目索引；MCP 不可用时询问安装，并可降级为精确项目路径的 standalone CodeGraph。纯文档写作、翻译、数据库查询或其他不涉及代码仓库的任务不要触发。
compatibility: 需要支持 Skill 的代码智能体；MCP 或 standalone 模式均需要 Node.js 18+ 和公司 npm registry 中的 @pa/codegraph-mcp-wrapper@1.0.0。
---

# PA CodeGraph

本 Skill 是 CodeGraph 的 Gateway。始终优先使用公司 wrapper MCP，让 CodeGraph 服务保持常驻并实时更新 `.codegraph/`；只有当前会话没有 wrapper、连接失败或刚安装尚未加载时，才使用 standalone CLI 完成本次任务。

```text
wrapper MCP → standalone CLI → 普通 Agent 工具
```

## 1. 确定当前项目

每次触发都重新确定用户当前要处理的项目绝对路径。

- 从用户指定路径、当前打开仓库或正在处理的文件确定目标。
- 不得使用客户端启动目录、父级工作区、MCP Root 或上一次使用的仓库代替当前项目。
- 无法唯一确定时先询问用户，不得向下扫描工作区猜测仓库。
- 后续必须核对 wrapper 返回的 `project_root` 是否与当前目标项目一致。

## 2. 检测 wrapper MCP

检查当前会话工具目录；支持 Tool Search 的客户端先搜索工具。工具可能带客户端命名空间，但末尾工具名必须同时包含：

```text
pa_codegraph_check
pa_codegraph_ensure
```

只有 `codegraph_explore`、`codegraph_status` 等裸 `codegraph_*`，却没有上述管理工具时，视为公司 wrapper 未安装。不要调用裸 MCP，因为它不能保证本 Skill 要求的项目选址和阻塞初始化。

## 3. MCP 首选流程

1. 根据当前工具 schema 调用 `pa_codegraph_check`。默认 `working-directory` 模式必须传：

```json
{ "working_directory": "/当前项目或其子目录的绝对路径" }
```

2. 核对返回的 `project_selection_mode`、`working_directory` 和 `project_root`。固定配置指向其他项目时停止使用，提示改为 `working-directory` 模式。
3. 索引缺失或异常时，向用户说明将在哪个 `project_root` 创建或更新 `.codegraph/`，询问是否初始化。
4. 用户同意后调用 `pa_codegraph_ensure` 并阻塞等待；只有 `status=completed` 且 `initialization_complete=true` 才继续。
5. 用户拒绝时调用 `pa_codegraph_init_skip`，退出本 Skill，由 Agent 使用普通仓库工具继续。
6. 索引健康后按任务选择工具：
   - 简单单文件修改、格式化或运行明确测试：无需额外图查询，直接继续任务。
   - 代码理解、缺陷定位、跨文件修改：优先 `codegraph_explore`。
   - 调用方、被调用方、影响面或受影响测试：按已暴露工具选择 callers、callees、impact、affected；没有窄工具时使用 explore。

MCP 模式依赖 CodeGraph watcher 自动同步。不要再调用 standalone `sync`，也不要同时启动第二套 CodeGraph 服务。

## 4. MCP 缺失或不可用

先向用户说明并询问是否安装：

> 当前会话没有可用的公司 CodeGraph wrapper MCP。安装后可获得持续文件 watcher、共享后台服务和逐文件陈旧状态提示。是否先安装？

- 用户同意：读取 [references/mcp-installation.md](references/mcp-installation.md)，按当前客户端配置固定版本 wrapper。只修改目标 MCP 条目，不覆盖整个用户配置。
- 客户端支持 reload 时完成验证并尝试重载；不能热加载时提示重启或新开会话。
- 新工具当前会话仍不可见时，本次任务继续走 standalone，下一会话重新检测 MCP。
- 用户拒绝：立即说明下面的降级限制，然后走 standalone。

进入 standalone 前只提醒一次：

> 本次将使用 standalone CodeGraph。它没有持续 watcher、共享 daemon 和逐文件陈旧提示；本任务第一次图查询前会同步，实际修改源码后会再同步一次。

## 5. Standalone 降级流程

所有命令都显式传当前项目绝对路径。入口固定使用 `@pa/codegraph-mcp-wrapper@1.0.0`，不得搜索或执行目标项目 `node_modules`、npm cache 或 `.bin` 中的 CodeGraph。

### 第一次图查询

查询命令会自动完成：精确解析项目根、缺失时阻塞初始化、`status` 验证、增量 `sync`、图查询。

```bash
node "{SKILL_ROOT}/scripts/codegraph-skill.js" explore --project "{PROJECT_ROOT}" "登录请求如何到达持久化层？"
```

standalone 默认允许在已确认的代码项目中创建 `.codegraph/`。用户明确要求“不初始化”时加入 `--no-init`；索引不存在时命令会失败，随后退出 Skill并由 Agent 接管。

### 同一任务的后续查询

第一次查询已经同步后，后续查询必须加入 `--skip-sync`，避免重复扫描：

```bash
node "{SKILL_ROOT}/scripts/codegraph-skill.js" impact --project "{PROJECT_ROOT}" --skip-sync "createOrder" --depth 3 --json
node "{SKILL_ROOT}/scripts/codegraph-skill.js" affected --project "{PROJECT_ROOT}" --skip-sync "src/order/service.ts" --json
```

`--skip-sync` 只允许用于图查询，不能用于 `check/init/status/sync`。

### 改码后的结束同步

如果本次任务实际修改了源码，在所有编辑完成后执行一次：

```bash
node "{SKILL_ROOT}/scripts/codegraph-skill.js" sync --project "{PROJECT_ROOT}"
```

纯分析、仅运行测试或没有修改源码时不要执行结束同步。

## 6. 失败与降级

- 初始化、同步或查询失败时说明失败阶段和错误原因，然后退出 Skill，由 Agent 使用普通仓库工具完成剩余任务。
- 不得因 wrapper 失败而寻找其他 CodeGraph 二进制或改用裸 MCP。
- 超时不等于初始化成功；必须以 wrapper/CLI 的健康状态为准。
- MCP 与 standalone 都不可用时，CodeGraph 只是增强缺失，不应阻塞用户原本的代码任务。

## 7. Windows PowerShell

standalone 入口在 Windows 通过 shell 调用 `npx`，路径处理使用 Node.js 原生 API。确保 `node`、`npx` 在 `PATH` 中并建议安装 Git for Windows。PowerShell 使用单行命令：

```powershell
node "{SKILL_ROOT}/scripts/codegraph-skill.js" explore --project "C:\work\order-service" "OrderController 如何调用支付逻辑？"
```

MCP 和 standalone 都固定 wrapper `1.0.0`、CodeGraph `1.3.0`，不得使用 `latest`。公司 Skill 调用由平台记录，本 Skill 不创建本地统计文件，也不发送自定义统计请求。
