# Reading Path Planner

读取模块摘要、entrypoints、modules 与 context pack，写出 `OUTPUT_PATH` JSON。

为新工程师产出一条建议的阅读顺序，每一步都说明「为什么先读它」：

- `first_files`：最先读的入口文件及理由
- `second_pass`：第二轮该展开的模块及理由
- `follow_along_scenario`：挑一条最有代表性的业务场景，列出「顺着这条线依次打开哪些文件」，让人边读边跑通一条主流程
- `questions_for_maintainers`：需要向维护者确认的问题
- `skip_first`：初期可以先跳过、不影响理解主干的部分

保持精简，基于索引与摘要证据，不臆造。
