# 项目检视记忆（`.codereview/memory.json`）

## 设计原则

1. **极简 JSON**：用户可直接编辑，无需脚本维护
2. **持久化**：`reset-run.js` 重新检视时**保留**本文件，仅清除 state/diffs/results 等过程文件
3. **手动维护**：用户根据误检/漏检/团队约定自行追加规则；主 Builder 可提示条目文案，由用户写入文件
4. **行动前注入**：Phase 5 每批次、每专家拉起前，主 Builder 运行 `build-memory-context.js` 生成 brief，子 Builder **第一个 tool call 前**读取

---

## 文件位置

`.codereview/memory.json`

首次 Phase 0 或 `reset-run.js` 时若不存在，由 `init-memory.js` 创建空结构。

---

## 数据结构

```json
{
  "version": "1.0",
  "updated_at": "2026-05-23T10:00:00.000Z",
  "user_lessons": [
    {
      "id": "ul001",
      "content": "规则描述（一句话）",
      "scope": "spring",
      "type": "must_check"
    }
  ],
  "project_conventions": [
    "团队级约定（字符串数组）"
  ]
}
```

### 字段说明

| 字段 | 说明 |
|------|------|
| `user_lessons[].type` | `must_check`：漏检补强，注入 4 检视专家；`false_positive_hint`：误检提示，**仅**注入 curator |
| `user_lessons[].scope` | `core` / `spring` / `security` / `data` / `all` |
| `project_conventions` | 对所有专家可见的项目约定 |

完整示例见 `{SKILL_ROOT}/templates/memory.json.example`。

---

## 主 Builder 操作

### Phase 0 / 重新检视后

```bash
node "{SKILL_ROOT}/scripts/init-memory.js"
```

### Phase 5 每专家拉起前

```bash
node "{SKILL_ROOT}/scripts/build-memory-context.js" \
  --memory .codereview/memory.json \
  --batch-id batch-001 \
  --expert core \
  --output .codereview/memory-brief-batch-001-core.json
```

将 `--output` 路径作为 `MEMORY_BRIEF_PATH` 传给子 Builder。

### 用户说「记住 xxx」

1. 主 Builder 建议一条 `user_lessons` JSON 片段
2. 用户确认后**手动**编辑 `memory.json`（或授权 Agent Write 该文件）
3. 更新 `updated_at`

---

## 子 Builder 使用规则

| 专家 | 读取 brief 后 |
|------|----------------|
| core / spring / security / data | 按 `[必查]` 与「项目约定」**加强**检视；**不得**因误检提示删 issue |
| curator | 接收**全部** `[误检提示]`（不限 scope）；`must_check` 仍按 scope；可对高匹配项移入 `invalidated[]`；**security 类禁止仅凭 memory 排除** |

brief 默认上限约 800 字；超出时脚本截断。

---

## 注意事项

1. 规则 >20 条时建议合并同类项，避免 brief 截断丢信息
2. 与 skill 内 `docs/java-standards.md` 冲突时，以 **memory.json 用户规则**为准（项目特化）
3. `memory-brief-*.json` 为运行时生成，重新检视时随过程文件清除
