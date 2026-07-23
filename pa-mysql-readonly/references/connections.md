# MySQL 多连接配置参考

仅在连接未配置、需要新增/切换连接或修复配置时读取本页。配置文件只放在用户目录，不放入代码仓库。

## 路径与优先级

默认路径：

```text
~/.pa-mysql-readonly/connections.json
```

路径优先级：

```text
--config <绝对路径> > PA_MYSQL_CONFIG_FILE > 默认路径
```

连接优先级：

```text
--connection
PA_MYSQL_CONNECTION
MYSQL_CONNECTION_STRING 或完整 MYSQL_* 字段
defaultConnection
唯一 profile
```

旧环境变量存在且没有显式选择 profile 时，继续使用环境变量，不读取或迁移其中的密码。显式 `--connection` 可以覆盖旧环境变量。

## JSON schema

```json
{
  "schemaVersion": 1,
  "defaultConnection": "orders-dev",
  "connections": [
    {
      "name": "orders-dev",
      "description": "订单开发库",
      "host": "127.0.0.1",
      "port": 3306,
      "user": "readonly_user",
      "database": "orders",
      "password": {
        "source": "env",
        "name": "ORDERS_DB_PASSWORD"
      },
      "ssl": false
    },
    {
      "name": "analytics",
      "connectionString": {
        "source": "inline",
        "value": "mysql -hHOST -P3306 -uUSER -pPASS analytics"
      }
    }
  ]
}
```

规则：

- `schemaVersion` 固定为 `1`。
- `connections` 必须是数组，连接名唯一。
- 字段 profile 必须提供 `user`，并且只能选择 `host` 或绝对 `socketPath` 之一。
- `port` 默认为 `3306`，范围为 1 到 65535。
- `database` 可省略，表示使用账号可访问的多库模式。
- `ssl` 是布尔值；`sslCa` 如提供必须是绝对路径。
- `connectionString` 与字段配置互斥。
- 未知字段、符号链接配置文件和危险连接名会被拒绝。

## 凭据来源

推荐环境变量引用：

```json
"password": { "source": "env", "name": "ORDERS_DB_PASSWORD" }
```

也可以让整个连接串来自环境变量：

```json
"connectionString": { "source": "env", "name": "ORDERS_DB_CONNECTION" }
```

明文模式：

```json
"password": { "source": "inline", "value": "secret" }
```

明文没有加密。`config add` 发现 inline 值时会拒绝，只有用户确认风险后加入 `--allow-inline-secret` 才能保存。POSIX 文件必须是 `0600`；目录会设为 `0700`。Windows 会提示用户检查 ACL。

## 连接串输入

`config add --stdin` 接受完整 profile JSON，也接受以下连接串：

```text
mysql://user:password@host:3306/database?ssl=true
mysql2://user:password@host:3306/database
mysql -hHOST -P3306 -uUSER -pPASS database
```

`mysql://` 和 `mysql2://` 会被规范化为字段 profile。URL 只接受可选的 `ssl=true|false|1|0` 参数。CLI 格式按上游 `MYSQL_CONNECTION_STRING` 原样保存和注入。

密码和连接串只通过 stdin 输入，不放入命令参数。用户直接在对话中提供含凭据连接串时，保存前再次确认它会留在对话记录和本地 JSON。

## 管理命令

```bash
node "{SKILL_ROOT}/scripts/mysql-skill.js" config status --json
node "{SKILL_ROOT}/scripts/mysql-skill.js" config list --json
node "{SKILL_ROOT}/scripts/mysql-skill.js" config show --connection "orders-dev" --json
node "{SKILL_ROOT}/scripts/mysql-skill.js" config add --connection "orders-dev" --stdin
node "{SKILL_ROOT}/scripts/mysql-skill.js" config use --connection "orders-dev"
node "{SKILL_ROOT}/scripts/mysql-skill.js" config remove --connection "orders-dev"
node "{SKILL_ROOT}/scripts/mysql-skill.js" config path
```

`config add` 默认拒绝同名连接。用户明确要求覆盖时使用 `--replace`；需要同时切换默认值时使用 `--set-default`。

第一个连接自动成为默认。删除默认连接后，如果只剩一个 profile，它自动成为默认；仍有多个 profile 时状态变为 `selection_required`。

## 状态处理

| status | 处理 |
|---|---|
| `ready` | 运行 `doctor`，再执行用户请求 |
| `unconfigured` | 进入首次配置引导 |
| `selection_required` | 询问本次或默认连接 |
| `profile_missing` | 运行 `config list` 后重新选择 |
| `secret_missing` | 提示设置返回的环境变量名，不询问值 |
| `config_invalid` | 修复 JSON/schema，不回退其他 profile |
| `insecure_permissions` | 将 POSIX 文件权限修复为 `0600` |
| `config_symlink_rejected` | 改用普通文件 |

配置写入使用同目录临时文件和原子替换。新增后运行 `doctor --connection <name>`；验证失败时保留 profile，方便用户修复网络、TLS、账号或权限配置。
