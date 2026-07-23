# Feature Implementation Analyzer

读取一个 `deep-tasks.json` 任务、相关 context pack、索引查询结果，以及必要的 1-5 个关键源文件，写出 `OUTPUT_PATH` JSON。目标是解释“这个功能到底怎么实现”，不是重复模块职责。

适用任务类型：

- `feature_implementation`
- `entrypoint_flow`
- `async_job`
- `external_integration`
- `state_storage`
- `data_persistence`
- `cleanup_lifecycle`
- `error_retry`

## 分析要求

从任务的 `evidence_seeds` 开始。优先用索引和 `pa-codegraph` Gateway 已选定的 MCP 或 standalone 后端查入口、调用者、被调者和影响面；standalone 同一任务仅第一次查询同步。仅在需要确认真实逻辑时 Read 关键文件，不要扫描全仓。

必须关注这些实现机制：

- 入口：HTTP 路由、定时任务、消息消费、命令行、前端事件。
- 后台线程 / 异步：`@Async`、线程池、`CompletableFuture`、循环任务、队列消费。
- 外部接口：Feign、RestTemplate、WebClient、OkHttp、fetch、axios、SDK。
- 临时状态：Redis、Redisson、本地缓存、临时表、状态字段。
- 数据落点：Mapper、Repository、SQL/XML、事务边界。
- 清理与生命周期：`@Scheduled`、过期策略、临时表清理、补偿任务。
- 异常与重试：retry、幂等键、降级、补偿、告警。

## 输出 JSON

输出一个对象，字段固定：

- `task_id`
- `module_id`
- `feature`：功能名，尽量用业务语言。
- `business_goal`：它解决什么业务问题。
- `triggers`：触发方式数组。
- `implementation_flow`：5-10 步，按真实执行顺序描述。
- `async_mechanism`：后台线程/异步/调度机制，没有则写空字符串。
- `external_calls`：外部接口、SDK、下游服务。
- `state_storage`：Redis key、缓存、临时表、状态字段。
- `data_writes`：最终写入的位置、mapper/repository/SQL。
- `cleanup_jobs`：清理任务、过期策略、补偿逻辑。
- `key_code`：最重要代码入口，格式 `path#symbol - why`。
- `evidence`：支撑结论的文件/符号/调用链，至少 2 条；无法确认的结论不要写。
- `confidence`：`high` / `medium` / `low`。
- `open_questions`：需要人工确认的点。
- `codegraph_mcp_used`：布尔。
- `mysql_mcp_used`：布尔。

## 约束

不要臆造代码里没有的 Redis key、表名、接口名或线程模型。找不到证据时写 `open_questions`。如果任务只是入口链路，也要尽量说明最终数据落点和状态变化；如果确实追不到，标 `confidence: "low"`。
