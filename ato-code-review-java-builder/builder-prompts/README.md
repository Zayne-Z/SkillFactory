# builder-prompts/ 使用说明

> **本目录仅供人工创建 Builder 配置时参考。Skill 运行时不会读取本目录下的任何文件。**

## 你需要做什么

在 VS Code AI 插件中 **手动创建 10 个 Builder**，并将下表中对应文件的内容粘贴为各 Builder 的系统提示词：

### 主 Builder（1 个）

| Builder 名称（自定义） | 系统提示词来源 |
|------------------------|---------------|
| 主 Builder（如 `java-codereview-main`） | [main/MAIN_BUILDER.md](main/MAIN_BUILDER.md) |

### 子 Builder（9 个）

| 建议标识（主 Builder 拉起时用） | 系统提示词来源 | Phase |
|-------------------------------|---------------|-------|
| `java-codereview-tech-stack` | [subagents/01-tech-stack.md](subagents/01-tech-stack.md) | 3 |
| `java-codereview-task-plan` | [subagents/02-task-plan.md](subagents/02-task-plan.md) | 4 |
| `java-codereview-review-core` | [subagents/03-review-core.md](subagents/03-review-core.md) | 5 |
| `java-codereview-review-spring` | [subagents/04-review-spring.md](subagents/04-review-spring.md) | 5 |
| `java-codereview-review-security` | [subagents/05-review-security.md](subagents/05-review-security.md) | 5 |
| `java-codereview-review-data` | [subagents/06-review-data.md](subagents/06-review-data.md) | 5 |
| `java-codereview-issue-curator` | [subagents/07-issue-curator.md](subagents/07-issue-curator.md) | 5.5 |
| `java-codereview-fix-advisor` | [subagents/08-fix-advisor.md](subagents/08-fix-advisor.md) | 6 |
| `java-codereview-report-synthesizer` | [subagents/09-report-synthesizer.md](subagents/09-report-synthesizer.md) | 7 |

> 升级提示：从旧版（无 issue-curator）升级时，仅需新增 `java-codereview-issue-curator` 一个 Builder，并把 `fix-advisor` 与 `report-synthesizer` 的系统提示词替换为 `08-fix-advisor.md` / `09-report-synthesizer.md` 的最新内容（标识不变）。运行中的 `state.json` 由主 Builder 启动时自动补 `curator: "pending"`。

## 运行方式

1. 创建好上述 Builder 后，**启动主 Builder**。
2. 主 Builder 会读取 **`SKILL.md`**（与本目录同级）获取完整工作流。
3. 主 Builder 按流程自动拉起子 Builder，传入变量。
4. 子 Builder 超时/上下文超长 → 主 Builder 自动重拉。
5. 主 Builder 自身上下文超长 → 用户重新启动主 Builder → 自动从 `state.json` 断点继续。

## 修改提示词

若需定制某个子 Builder 的检视规则（如添加公司规范），直接编辑 `subagents/` 下对应文件，然后重新粘贴到插件配置即可。`SKILL.md` 和 `docs/` 不需要改动。
