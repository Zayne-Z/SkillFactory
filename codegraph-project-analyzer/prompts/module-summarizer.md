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

## 可选 MCP（仅当 state.mcp.codegraph=available）

当内置 edges 不足以确认调用流时，可调 codegraph MCP（`codegraph_explore`，或已开启的 `codegraph_callers`/`codegraph_callees`）核对本模块关键符号的真实调用关系，再写 `key_flow`。MCP 未挂载/项目未建 `.codegraph/` 索引/调用失败时，直接用内置索引与源码判断。在输出加 `codegraph_mcp_used`（布尔）。

