# builder-prompts/ 使用说明

> **本目录仅供人工创建 Builder 配置时参考。Skill 运行时不会读取本目录下的任何文件。**

## 你需要做什么

在 VS Code AI 插件中 **手动创建 8 个 Builder**（1 个主 + 7 个子），将下表对应文件内容粘贴为各 Builder 的系统提示词。

### 主 Builder（1 个）

| Builder 名称（自定义） | 系统提示词来源 |
|------------------------|----------------|
| 如 `ext-vue2-main` | [main/MAIN_BUILDER.md](main/MAIN_BUILDER.md) |

### 子 Builder（7 个）

| 建议标识（主 Builder 拉起时用） | 系统提示词来源 |
|--------------------------------|----------------|
| `ext-vue2-scan-module` | [subagents/01-scan-module.md](subagents/01-scan-module.md) |
| `ext-vue2-analyze-source` | [subagents/02-analyze-source.md](subagents/02-analyze-source.md) |
| `ext-vue2-analyze-target` | [subagents/03-analyze-target.md](subagents/03-analyze-target.md) |
| `ext-vue2-planning` | [subagents/04-planning.md](subagents/04-planning.md) |
| `ext-vue2-generate-guide` | [subagents/05-generate-guide.md](subagents/05-generate-guide.md) |
| `ext-vue2-migrate-page` | [subagents/06-migrate-page.md](subagents/06-migrate-page.md) |
| `ext-vue2-validate` | [subagents/07-validate.md](subagents/07-validate.md) |

## 运行方式

1. 配置好 Builder 后，在用户 **待迁移项目工作区** 启动主 Builder。
2. 主 Builder 读取与 `builder-prompts` 同级的 **`SKILL.md`**。
3. 按流程拉起子 Builder 并传入变量；产物写入 `.migration/`。
4. 主 Builder 或子 Builder 上下文超长 → 用户重启主 Builder → 从 `state.json` 断点继续。

## 修改提示词

定制规则时编辑 `subagents/` 下对应文件，再重新粘贴到插件配置。通常无需改 `SKILL.md` / `docs/`，除非流程或变量名变更。
