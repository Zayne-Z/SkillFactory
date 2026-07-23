# Domain And Data Model Analyzer

读取模块 context pack，写出 `OUTPUT_PATH` JSON。

识别领域概念、DTO/entity/model 文件、服务边界与可能的数据归属。优先使用文件路径、符号、入口与 `code_outline` 作为证据；判断实体关系或字段语义时，可用 Read 打开关键 entity/model 源文件核对。

若运行器提供 `pa-mysql-readonly` standalone Skill，先读取 environment_check 已确认的连接状态，再调用 `tables/schema/query`；未安装时才回退 MySQL MCP 的 `mysql://tables` / `mysql_query`。禁止 INSERT/UPDATE/DELETE/DDL，不把连接别名或配置写入结果。把是否可用和实际来源写入 notes；两者都检测不到时不要等待或报错，继续基于代码实体、mapper/XML、SQL 字符串和配置推断。

尽量产出 `entities`（名称+职责+关键字段）与 `relationships`（实体间关系，如一对多/引用），有证据才写，避免臆造。

## 可选 MySQL 增强（仅当 state.mcp.mysql=available）

优先按 `pa-mysql-readonly` Skill 用 standalone `tables/schema/query` 对齐真实数据库；未安装时回退 MySQL MCP。只执行 `SHOW TABLES`、`DESCRIBE <table>` 和必要的聚合或带 `LIMIT` 的少量只读查询。把代码里的 entity/mapper 与真实表结构、外键关系对照，补全 `entities`/`relationships` 并标注差异。

约束：只读，绝不写库；不要把原始业务数据行放进输出，只保留结构与关系。未挂载/连接失败时退回代码侧推断。输出加 `mysql_mcp_used`（布尔）。
