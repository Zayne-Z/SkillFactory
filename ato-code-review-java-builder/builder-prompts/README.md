# builder-prompts/ 使用说明

> **本目录仅供人工创建 Builder 配置时参考。Skill 运行时不会读取本目录下的任何文件。**

## 你需要做什么

在 VS Code AI 插件中 **手动创建 1 个主 Builder + 10 个子 Builder**，并将下表中对应文件的内容粘贴为各 Builder 的系统提示词：

### 主 Builder（1 个）

| Builder 名称（自定义） | 系统提示词来源 |
|------------------------|---------------|
| 主 Builder（如 `java-codereview-main`） | [main/MAIN_BUILDER.md](main/MAIN_BUILDER.md)（短引导；完整流程在 **`SKILL.md` §0 起**） |

### 子 Builder（10 个）

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
| `java-codereview-report-html` | [subagents/10-report-html.md](subagents/10-report-html.md) | 7.5（可选） |

> 升级提示：新增 `issue-curator`、`report-html`（可选）时按上表创建 Builder；主 Builder 须用 `update-state.js` 落盘（见 `SKILL.md` §0、§2.5）。Phase 1 须一次问齐四项，`user_confirmed=true` 后才可跑 Phase 2 脚本。

## 运行方式

1. 创建好上述 Builder 后，**启动主 Builder**。
2. 主 Builder 会读取 **`SKILL.md`**（与本目录同级）获取完整工作流；**每次对话先执行 §0 启动清单**（Phase 1 四问、`update-state.js` 落盘）。
3. 主 Builder 按流程自动拉起子 Builder，传入变量。
4. 子 Builder 超时/上下文超长 → 主 Builder 自动重拉。
5. 主 Builder 自身上下文超长 → 用户重新启动主 Builder → 自动从 `state.json` 断点继续。

## 修改提示词

若需定制某个子 Builder 的检视规则（如添加公司规范），直接编辑 `subagents/` 下对应文件，然后重新粘贴到插件配置即可。`SKILL.md` 和 `docs/` 不需要改动。
