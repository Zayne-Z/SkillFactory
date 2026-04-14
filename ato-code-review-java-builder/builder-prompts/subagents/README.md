# 子 Builder 提示词索引（手动绑定 VS Code AI）

每个 `.md` 文件对应 **一个**独立子 Builder 会话的系统提示词（或等价配置）。**勿**与主 Builder 合并。

| 建议标识（交接名） | 文件 | Phase / 用途 |
|-------------------|------|----------------|
| `java-codereview-tech-stack` | [01-tech-stack.md](01-tech-stack.md) | Phase 3 技术栈 |
| `java-codereview-task-plan` | [02-task-plan.md](02-task-plan.md) | Phase 4 任务规划 |
| `java-codereview-review-core` | [03-review-core.md](03-review-core.md) | Phase 5 核心静态 |
| `java-codereview-review-spring` | [04-review-spring.md](04-review-spring.md) | Phase 5 Spring/可靠性 |
| `java-codereview-review-security` | [05-review-security.md](05-review-security.md) | Phase 5 安全 |
| `java-codereview-review-data` | [06-review-data.md](06-review-data.md) | Phase 5 数据与性能 |
| `java-codereview-fix-advisor` | [07-fix-advisor.md](07-fix-advisor.md) | Phase 6 修复建议 |
| `java-codereview-report-synthesizer` | [08-report-synthesizer.md](08-report-synthesizer.md) | Phase 7 报告合成 |

**路径约定**：各文件中的 `{SKILL_ROOT}` 表示 Skill 根目录（含 `SKILL.md`、`docs/`、`scripts/`）。
