# Skill 成对同步指南

> **策略：默认只检查，不自动写入。** 脚本列出漂移项；由 **LLM / 人工审阅** 差异后，再显式 `--apply` 写入 builder。  
> **编排层**（`SKILL.md`）脚本**从不**自动修改，须成对人工维护。

| 运行时 | Canonical（源） | Builder（生成目标） |
|--------|-----------------|---------------------|
| 前端 opencode | `ato-code-review-web` | `ato-code-review-web-builder` |
| Java opencode | `ato-code-review-java` | `ato-code-review-java-builder` |

---

## 推荐工作流（LLM 审阅后再同步）

```
1. 改 canonical（prompts / scripts / templates / docs）
2. node scripts/sync-skill-pairs.js              ← 只检查，不写入
3. LLM 打开待同步文件，说明 diff 含义与风险
4. 成对改 SKILL.md（若有 --check-skill 告警）
5. 用户确认后：node scripts/sync-skill-pairs.js --apply
6. CI：node scripts/sync-skill-pairs.js --check --check-skill
```

**禁止：** 未审阅直接 `--apply`；只改 builder 侧会被下次 `--apply` 覆盖。

---

## 命令说明

```bash
node scripts/sync-skill-pairs.js                 # 默认：文件 + SKILL 检查，不写入
node scripts/sync-skill-pairs.js --check         # 仅文件漂移
node scripts/sync-skill-pairs.js --check-skill   # 仅 SKILL.md 编排指纹
node scripts/sync-skill-pairs.js --apply         # 审阅通过后写入 builder
node scripts/sync-skill-pairs.js --apply --pair web
```

| 命令 | 写入 | 用途 |
|------|------|------|
| （无参） | ❌ | 日常检查 |
| `--check` / `--check-skill` | ❌ | 分项检查 |
| `--apply` | ✅ | 确认后镜像 canonical → builder |

**Cursor 斜杠命令：**

| 命令 | 作用 |
|------|------|
| `/sync-skills` | 先检查 + LLM 审阅 diff，**用户确认后**才 `--apply` |
| `/check-skills-sync` | 仅检查，不写入 |

---

## `--apply` 会写入什么

| 内容 | 源 → 目标 |
|------|-----------|
| `scripts/*.js` | canonical → builder |
| `templates/**` | canonical → builder |
| `docs/`（清单内） | canonical → builder（术语替换） |
| `prompts/*.md` | → `builder-prompts/subagents/`（加 Builder 头） |

### 提示词映射（web / java 见 sync-skill-pairs.js 内 `prompts` 数组）

Java 特化：`framework-reviewer` → `04-review-spring`，`perf-reviewer` → `06-review-data`。

---

## 脚本不会碰的文件（须人工 / LLM 成对改）

- `SKILL.md`（`--check-skill` 只对比指纹，不写入）
- `MAIN_BUILDER.md`、各 README
- `opencode/`

---

## 升级检查清单

1. [ ] 改动在 **canonical**
2. [ ] `node scripts/sync-skill-pairs.js` 审阅输出
3. [ ] LLM/人工看过待同步 diff
4. [ ] `SKILL.md` 成对对齐（`--check-skill` 无告警）
5. [ ] 用户确认后 `--apply`
6. [ ] 新增 doc/prompt 已加入 `sync-skill-pairs.js` 清单

---

## CI 建议

```yaml
- name: Verify skill pairs (check only, no apply)
  run: node scripts/sync-skill-pairs.js --check --check-skill
```
