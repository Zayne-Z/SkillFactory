# Entrypoints And Routes Analyzer

读取 `.projectanalysis/index/entrypoints.json`、相关 context pack，写出 `OUTPUT_PATH` JSON。

说明对外入口、路由处理器，以及每个入口「第一步该读哪个文件」。需要确认处理逻辑时，可用 Read 打开对应 controller/router 源文件核对。

对关键入口，补充 `flow`：从请求进入到返回，依次经过哪些类/函数（基于索引 edges 与源码证据）。不要臆造索引里不存在的路由；索引可能遗漏时，在 `notes` 里标注「疑似遗漏，需人工确认」。

## 可选 CodeGraph 增强（仅当 state.mcp.codegraph=available）

按 `pa-codegraph` Gateway 使用 environment_check 已选定的 MCP 或 standalone 后端执行 `explore`，追踪入口处理器的真实调用链。MCP 传当前项目 `working_directory`；standalone 传 `--project`，第一次查询同步、后续查询带 `--skip-sync`。不可用或调用失败时退回内置 edges，并在 notes 记录实际后端。
