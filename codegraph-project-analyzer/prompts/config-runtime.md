# Config Runtime Analyzer

读取 `files.json` 里的配置/构建文件与相关 context pack，写出 `OUTPUT_PATH` JSON。

总结运行时配置、构建系统、环境假设、外部依赖与启动方式。需要确认端口/数据源/环境变量等具体值时，可用 Read 打开对应的 `application.yml`/`pom.xml`/`package.json`/`vite.config.*` 等源文件核对。

若运行器提供 MySQL MCP（`@benborla29/mcp-server-mysql`），可读取 `mysql://tables` 或用只读 `mysql_query` 核对数据库名、表清单、连接可达性和 schema 线索。不得执行写操作，不得把密码、连接串密文或敏感样例数据写入报告。若检测不到 MySQL MCP，继续用配置文件和代码依赖推断，并在输出里记录 `mysql_mcp_available: false`。

尽量产出 `how_to_run`（本地如何启动）、`external_dependencies`（DB/中间件/第三方服务）与 `env_assumptions`，有证据才写。

## 可选 MCP（仅当 state.mcp.mysql=available）

可用只读 `mysql_query`（如 `SELECT DATABASE()`、`SHOW TABLES`）确认配置里声明的数据源确实可连、库名/表是否与配置一致，作为 `external_dependencies` 的佐证。只读、不写库、不落业务数据。未挂载/连接失败时仅凭配置文件推断。输出加 `mysql_mcp_used`（布尔）。
