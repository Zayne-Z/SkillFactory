# Domain And Data Model Analyzer

读取模块 context pack，写出 `OUTPUT_PATH` JSON。

识别领域概念、DTO/entity/model 文件、服务边界与可能的数据归属。优先使用文件路径、符号、入口与 `code_outline` 作为证据；判断实体关系或字段语义时，可用 Read 打开关键 entity/model 源文件核对。

若运行器提供 MySQL MCP（`@benborla29/mcp-server-mysql`），优先读取 `mysql://tables` 资源了解表与字段；必要时只用 `mysql_query` 执行只读语句（如 `SHOW TABLES`、`DESCRIBE table_name`、小范围 `SELECT` 样例）。禁止 INSERT/UPDATE/DELETE/DDL。把是否可用写入 `mysql_mcp_available`。若检测不到 MySQL MCP，不要等待或报错，继续基于代码实体、mapper/XML、SQL 字符串和配置推断。

尽量产出 `entities`（名称+职责+关键字段）与 `relationships`（实体间关系，如一对多/引用），有证据才写，避免臆造。

## 可选 MCP（仅当 state.mcp.mysql=available）

可用 MySQL MCP 对齐真实数据库：读资源 `mysql://tables` 看表/列，用只读 `mysql_query` 执行 `SHOW TABLES`、`DESCRIBE <table>`、必要时带 `LIMIT` 的少量 `SELECT` 采样。把代码里的 entity/mapper 与真实表结构、外键关系对照，补全 `entities`/`relationships` 并标注差异（代码有表无 / 表有代码无）。

约束：只读，绝不写库；不要把原始业务数据行放进输出，只保留结构与关系。未挂载/连接失败时退回代码侧推断。输出加 `mysql_mcp_used`（布尔）。
