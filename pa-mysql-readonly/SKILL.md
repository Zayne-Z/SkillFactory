---
name: pa-mysql-readonly
description: >-
  当用户需要连接 MySQL 查看数据库、表、字段、索引或外键，执行只读 SQL、统计汇总、EXPLAIN 查询计划、实体与表结构对照、数据模型分析或数据库故障排查时，应主动使用本 Skill。用户只要提到 MySQL、库表结构、字段类型、索引、慢查询、查询计划、只读查数或数据分布，即使没有配置连接或 MySQL MCP，也要触发；本 Skill 会检测用户级连接配置，缺失时交互引导添加字段或连接串，支持保存多个连接和切换默认连接，再一次性启动只读 MySQL MCP。用户请求 INSERT、UPDATE、DELETE 或 DDL 时也要触发，但只能明确拒绝并说明只读边界，绝不能执行；目标明确不是 MySQL 时不要使用。
compatibility: 需要 Node.js 20+、用户级 JSON 配置或 MYSQL_* 环境变量，并能访问包含 @benborla29/mcp-server-mysql@2.0.9 的 npm 仓库。
---

# PA MySQL 只读查询

无需用户配置常驻 MCP，直接进行 MySQL 结构检查和只读查询。随附启动器会管理用户级多连接配置，并为单次操作启动 `@benborla29/mcp-server-mysql@2.0.9`；完成 MCP 握手和查询后关闭子进程。

## 安全边界

本 Skill 永远按只读模式工作。

- 启动器强制关闭 INSERT、UPDATE、DELETE、DDL、多数据库写入和“禁用只读事务”，即使外部环境变量试图开启也会覆盖为关闭。
- 本地第二层校验只接受一条 `SELECT`、`SHOW`、`DESCRIBE`、`DESC`、`EXPLAIN` 或只读 `WITH` 语句。
- SQL 和表名会在验证或使用连接配置、启动 MCP 子进程之前完成校验；危险请求不会连接数据库。
- 拒绝多语句、事务控制、文件访问、锁、存储过程、sleep/benchmark、processlist、可执行注释以及任何写入或 DDL 关键字。
- 数据库账号本身也必须只有只读权限。客户端校验是纵深防御，不能代替数据库授权。
- 默认只询问保存密码的环境变量名，不主动索要密码。用户选择明文模式或直接提供含凭据连接串时，先说明它会进入对话记录和本地 JSON，得到明确确认后才能继续。
- 密码和连接串只能通过 stdin 传给配置命令，不得放入命令参数、报告或项目文件。

## 连接配置

每次正常查询前先检测当前连接状态：

```bash
node "{SKILL_ROOT}/scripts/mysql-skill.js" config status --json
```

按返回状态处理：

- `ready`：使用返回的 `selected_connection`；`legacy_environment` 表示继续使用旧 `MYSQL_*` 环境变量。
- `unconfigured`：按“首次配置引导”添加连接。
- `selection_required`：列出脱敏连接摘要，让用户选择本次连接或持久默认连接。
- `profile_missing`：提示用户从 `config list` 中重新选择。
- `secret_missing`：只指出缺少的环境变量名，不索要其值。
- `config_invalid`、`insecure_permissions` 或 `config_symlink_rejected`：停止连接，修复配置后再继续。

默认文件为 `~/.pa-mysql-readonly/connections.json`。需要改变位置时使用绝对路径 `PA_MYSQL_CONFIG_FILE`；不得在项目目录创建连接配置。完整 schema、连接串格式和命令说明见 [references/connections.md](references/connections.md)。

### 首次配置引导

1. 询问连接别名，例如 `orders-dev`。
2. 询问使用“主机字段”还是“连接串”。
3. 字段方式依次确认 host 或 socket、端口、用户、数据库以及是否启用 SSL。
4. 凭据默认保存环境变量引用，只询问变量名，例如 `ORDERS_DB_PASSWORD`。
5. 用户要求保存明文密码或提供含凭据连接串时，说明对话记录和本地明文风险，再次确认。
6. 将完整 profile JSON 或连接串通过 stdin 传给 `config add`。明文模式必须加 `--allow-inline-secret`。
7. 保存成功后立即用该连接运行 `doctor`。验证失败时保留配置并报告网络、TLS、账号或权限问题。

示例命令形态；实际 JSON 通过进程 stdin 发送，不把密钥拼到命令行：

```bash
node "{SKILL_ROOT}/scripts/mysql-skill.js" config add --connection "orders-dev" --stdin
node "{SKILL_ROOT}/scripts/mysql-skill.js" doctor --connection "orders-dev"
```

### 多连接与切换

- 第一个连接自动成为默认连接。
- 单次使用其他连接：所有查询命令添加 `--connection "analytics"`，不修改默认值。
- 用户明确要求“切换默认连接”时执行：

```bash
node "{SKILL_ROOT}/scripts/mysql-skill.js" config use --connection "analytics"
```

- 使用 `config list` 查看脱敏摘要，使用 `config remove` 删除连接。删除动作前先征得用户确认。
- 选择优先级为 `--connection`、`PA_MYSQL_CONNECTION`、旧 `MYSQL_*` 环境变量、JSON 默认连接、唯一 profile。

### 旧环境变量兼容

原有配置无需迁移：

```text
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=readonly_user
MYSQL_PASS=<secret>
MYSQL_DB=app_db
```

可用 `MYSQL_SOCKET_PATH` 替代主机和端口，也可用 `MYSQL_CONNECTION_STRING` 替代分散字段；连接串仍必须保存在环境或密钥系统中。

Skill 不会自动把环境变量中的密码写入 JSON。需要迁移时重新建立 profile，并优先保存环境变量引用。

底层包固定为 `@benborla29/mcp-server-mysql@2.0.9`。公司镜像可通过 `PA_MYSQL_MCP_PACKAGE` 指定另一个已审批的精确版本；标签、范围、URL、路径和 `latest` 都会被拒绝。

## 默认工作流

1. 先运行 `config status --json`，完成配置或连接选择。
2. 再运行 `doctor`，用 `SELECT 1` 验证选中连接，不读取业务数据。
3. 优先使用 `tables`、`schema` 和 `indexes` 理解结构，再决定是否查询数据。
4. 数据问题只选择必要字段并优先使用聚合；抽样查询添加保守的 `LIMIT`。
5. 生成报告时不写入原始业务行，只总结结构、数量、关系和异常。
6. 分析慢 SQL 前先运行 `EXPLAIN`。

```bash
node "{SKILL_ROOT}/scripts/mysql-skill.js" doctor
node "{SKILL_ROOT}/scripts/mysql-skill.js" tables
node "{SKILL_ROOT}/scripts/mysql-skill.js" schema --table "order_info"
node "{SKILL_ROOT}/scripts/mysql-skill.js" indexes --table "order_info"
```

## 只读查询

传入单条、正确引用的 SQL：

```bash
node "{SKILL_ROOT}/scripts/mysql-skill.js" query \
  --sql "SELECT status, COUNT(*) AS total FROM order_info GROUP BY status LIMIT 100"
```

复杂 SQL 优先通过标准输入传递，减少 shell 引号问题：

```bash
node "{SKILL_ROOT}/scripts/mysql-skill.js" query --stdin <<'SQL'
SELECT customer_type, COUNT(*) AS total
FROM customer_summary
GROUP BY customer_type
LIMIT 100;
SQL
```

确定性脚本需要完整 MCP 响应时使用 `--json`：

```bash
node "{SKILL_ROOT}/scripts/mysql-skill.js" explain \
  --sql "SELECT id, status FROM order_info WHERE created_at >= CURRENT_DATE LIMIT 100" \
  --json
```

## Windows PowerShell

入口脚本已在 Windows 下通过 shell 调用 `npx`。单行 SQL 可直接执行：

```powershell
node "{SKILL_ROOT}/scripts/mysql-skill.js" query --sql "SELECT status, COUNT(*) AS total FROM order_info GROUP BY status LIMIT 100"
```

多行 SQL 使用 PowerShell here-string 管道，不要使用 Bash 的 `<<'SQL'`：

```powershell
@'
SELECT customer_type, COUNT(*) AS total
FROM customer_summary
GROUP BY customer_type
LIMIT 100;
'@ | node "{SKILL_ROOT}/scripts/mysql-skill.js" query --stdin
```

确保 Node.js 20+ 和 `npx` 在 `PATH` 中。用户级 JSON 路径在 Windows 上同样位于用户主目录；保存明文凭据时，提醒用户确认文件 ACL 只允许当前用户读取。环境变量引用仍是推荐方式。

## 隐私与结果处理

- 默认启用 PII 脱敏，同时允许查看数据库结构。
- 启用脱敏时强制禁止 `SELECT *` 和直接引用被识别为 PII 的列，外部环境变量不能放宽这两项保护。
- 正常流程避免 `SELECT *`，只查询必要列，并尽量聚合。
- `PA_MYSQL_PII_REDACTION=off` 是管理员显式覆盖项，不得仅为方便查询而关闭。
- 不得原样转发可能含连接信息的服务端错误；启动器会对密码和连接串进行替换后再输出。

## 用量统计

启动器只记录 Skill 名称与版本、操作、成功与否、耗时、客户端标签、平台和匿名安装标识。它不会记录主机、端口、数据库、用户名、密码、连接串、SQL、表名、查询结果或服务端输出。

- 本地记录：`~/.pa-skill-usage/events.jsonl`
- 公司统计端点：`PA_SKILL_USAGE_ENDPOINT=https://...`
- 可选鉴权令牌：`PA_SKILL_USAGE_TOKEN`
- 客户端归因：`PA_SKILL_CLIENT=codex|claude-code|opencode|openclaw`
- 关闭统计：`PA_SKILL_TELEMETRY=off`

统计是尽力而为的旁路操作，不改变查询的成功或失败。
