# builder-prompts/ 使用说明

> **本目录仅供人工创建 Builder 配置时参考。Skill 运行时不会读取本目录下的任何文件。**

## 你需要做什么

在 VS Code AI 插件中 **手动创建 10 个 Builder**（**1 个主 + 9 个子**），并将下表中对应文件的内容粘贴为各 Builder 的系统提示词。

检视专家已由 7 位合并为 **4 位**：`core`（扫描+规范）、`framework`（Vue/React+样式）、`reliability`（性能+健壮性）、`security`。

### 主 Builder（1 个）

| Builder 名称（自定义） | 系统提示词来源 |
|------------------------|---------------|
| 主 Builder（如 `web-codereview-main`） | [main/MAIN_BUILDER.md](main/MAIN_BUILDER.md) |

### 子 Builder（9 个）

| 建议标识（主 Builder 拉起时用） | 系统提示词来源 |
|-------------------------------|---------------|
| `web-codereview-tech-stack` | [subagents/01-tech-stack.md](subagents/01-tech-stack.md) |
| `web-codereview-task-plan` | [subagents/02-task-plan.md](subagents/02-task-plan.md) |
| `web-codereview-review-core` | [subagents/03-review-core.md](subagents/03-review-core.md) |
| `web-codereview-review-framework` | [subagents/04-review-framework.md](subagents/04-review-framework.md) |
| `web-codereview-review-reliability` | [subagents/05-review-reliability.md](subagents/05-review-reliability.md) |
| `web-codereview-review-security` | [subagents/06-review-security.md](subagents/06-review-security.md) |
| `web-codereview-issue-curator` | [subagents/07-issue-curator.md](subagents/07-issue-curator.md) |
| `web-codereview-fix-advisor` | [subagents/08-fix-advisor.md](subagents/08-fix-advisor.md) |
| `web-codereview-report-synthesizer` | [subagents/09-report-synthesizer.md](subagents/09-report-synthesizer.md) |

> 升级提示：从旧版（无 issue-curator）升级时，仅需新增 `web-codereview-issue-curator` 一个 Builder，并把 `fix-advisor` 与 `report-synthesizer` 的系统提示词替换为 `08-fix-advisor.md` / `09-report-synthesizer.md` 的最新内容。运行中的 `state.json` 由主 Builder 启动时自动补 `curator: "pending"`。

## 运行方式

1. 创建好上述 Builder 后，**启动主 Builder**。
2. 主 Builder 读取 **`SKILL.md`**（与本目录同级）执行工作流。
3. 主 Builder 按流程拉起子 Builder 并传入变量。
4. 子 Builder 失败 → 主 Builder 按 SKILL.md 重试；主 Builder 上下文过长 → 用户重启主 Builder → 从 `state.json` 断点继续。

## 修改提示词

若需定制某个子 Builder 的检视规则，编辑 `subagents/` 下对应文件后，重新粘贴到插件配置即可。

从 `ato-code-review-web` 同步 builder 侧重内容时：

1. **检查**：`node scripts/sync-skill-pairs.js --pair web`（或仓库根目录，见 `docs/SKILL-SYNC.md`）
2. **LLM/人工审阅** 列出的 diff
3. **确认后写入**：`node scripts/sync-skill-pairs.js --apply --pair web`

`gen-builder-prompts.js` 仅为兼容入口，**默认只检查、不写入**。
