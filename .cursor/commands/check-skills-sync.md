# 检查 Skill 成对目录（只读）

不写入。用于日常检查或 CI。

```bash
node scripts/sync-skill-pairs.js --check --check-skill
```

有漂移时：用 `/sync-skills` 走「LLM 审阅 → 用户确认 → --apply」流程，不要直接 apply。

详见 `docs/SKILL-SYNC.md`。
