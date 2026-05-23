# 同步 Skill 成对目录（审阅后写入）

**默认不自动写入。** 先检查 → LLM 审阅 diff → 用户确认 → 再 `--apply`。详见 `docs/SKILL-SYNC.md`。

## 阶段 A：检查（必须先做）

```bash
node scripts/sync-skill-pairs.js
# 或分项：--check / --check-skill / --pair web|java
```

## 阶段 B：LLM 审阅（有漂移时必做）

对脚本列出的每个「待同步」项：

1. **读取** canonical 与 builder 对应文件，展示关键 diff（不要全文刷屏）
2. **说明**：变更性质（机械镜像 / 术语替换 / 逻辑变更）、是否安全、是否需同步改 `SKILL.md`
3. **`--check-skill` 告警**：指出哪侧 `SKILL.md` 缺什么，给出具体修改建议（脚本不会自动改 SKILL.md）
4. **清单外文件 ⚠**：建议是否加入 `sync-skill-pairs.js` 清单

向用户汇总：**建议 apply / 建议先改 canonical / 建议先改 SKILL.md / 不建议同步**。

## 阶段 C：写入（仅用户明确同意后）

```bash
node scripts/sync-skill-pairs.js --apply
# 可选：--pair web | java
```

**禁止**在用户未确认、或未完成阶段 B 审阅时执行 `--apply`。

## 阶段 D：写入后确认

`--apply` 会自动做写入后校验。若仍有漂移或 SKILL 不一致，说明原因并给出下一步。

## 禁止

- 不要跳过审阅直接 `--apply`
- 不要 `git commit`，除非用户明确要求
