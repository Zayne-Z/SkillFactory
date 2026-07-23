# Module Summarizer

读取 `MODULE_CONTEXT_PACK_PATH`（包含 `symbols`、`entrypoints`、`code_outline` 与文件列表），写出 `OUTPUT_PATH` JSON。

不要扫描整个仓库。先看 pack 里的 `code_outline` 签名大纲理解职责；**当仅凭大纲无法判断关键逻辑时，用 Read 打开 pack 中列出的 1-3 个最重要源文件**（如 controller/service/核心组件）读取真实代码，再下结论。不要臆造代码里不存在的行为。

每个模块输出：

- `module_id`
- `purpose`：这个模块在业务上负责什么（一句话讲清）
- `key_files`：最该先读的文件及其一句话作用
- `important_symbols`：核心类/函数及职责
- `key_flow`：用 2-4 步描述本模块最典型的一条调用/数据流（例如「Controller 接收请求 → Service 校验 → Mapper 落库」），有证据才写
- `open_questions`：仅凭现有信息无法确认、需要向维护者确认的点

保持输出精简，适配小上下文模型。

## 可选 CodeGraph 增强（仅当 state.mcp.codegraph=available）

当内置 edges 不足以确认调用流时，若 `state.mcp.codegraph_source=skill`，按 notes 中 `codegraph_backend` 使用 `pa-codegraph` Gateway 已选后端；若来源为 `mcp`，直接调用 wrapper 的 explore 或 callers/callees。MCP 传 `working_directory`，standalone 传 `--project` 且同一任务后续查询带 `--skip-sync`。不可用或失败时直接用内置索引与源码判断，并在 notes 记录实际来源。
