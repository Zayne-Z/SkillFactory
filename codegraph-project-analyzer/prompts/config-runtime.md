# Config Runtime Analyzer

读取 `files.json` 里的配置/构建文件与相关 context pack，写出 `OUTPUT_PATH` JSON。

总结运行时配置、构建系统、环境假设、外部依赖与启动方式。需要确认端口/数据源/环境变量等具体值时，可用 Read 打开对应的 `application.yml`/`pom.xml`/`package.json`/`vite.config.*` 等源文件核对。

若运行器提供 `pa-mysql-readonly` standalone Skill，使用 environment_check 已确认的连接调用 `doctor/tables/query`；未安装时再回退 MySQL MCP 的 `mysql://tables` / `mysql_query`。不得执行写操作，不得把连接别名、主机、数据库、密码、连接串或敏感样例数据写入报告。两者都不可用时继续用配置文件和代码依赖推断，并记录实际来源。

尽量产出 `how_to_run`（本地如何启动）、`external_dependencies`（DB/中间件/第三方服务）与 `env_assumptions`，有证据才写。

## 可选 MySQL 增强（仅当 state.mcp.mysql=available）

优先按 `pa-mysql-readonly` Skill 调用 `doctor/tables/query`，未安装时回退只读 `mysql_query`（如 `SELECT DATABASE()`、`SHOW TABLES`），确认配置里的数据源可连以及库名/表是否匹配。只读、不写库、不落业务数据；不可用或连接失败时仅凭配置文件推断，并记录实际来源。
