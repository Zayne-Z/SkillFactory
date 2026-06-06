# 项目检视记忆（`.codereview/memory.json`）

## 设计原则

1. **极简 JSON**：用户可直接编辑，无需脚本维护
2. **持久化**：`reset-run.js` 重新检视时**保留**本文件，仅清除 state/diffs/results 等过程文件
3. **手动维护**：用户根据误检/漏检/团队约定自行追加规则
4. **行动前注入**：Phase 5 每批次、每专家拉起前，主编排器运行 `build-memory-context.js` 生成 brief

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
      "scope": "framework",
      "type": "must_check"
    }
  ],
  "project_conventions": ["团队级约定"]
}
```

### 字段说明

| 字段 | 说明 |
|------|------|
| `user_lessons[].type` | `must_check`：漏检补强，注入 4 检视专家；`false_positive_hint`：误检提示，**仅**注入 curator |
| `user_lessons[].scope` | `core` / `framework` / `reliability` / `security` / `all` |
| `project_conventions` | 对所有专家可见 |

示例见 `{SKILL_ROOT}/templates/memory.json.example`。

---

## 主编排器操作

### Phase 0 / 重新检视后

```bash
node "{SKILL_ROOT}/scripts/init-memory.js"
```

### Phase 5 每专家拉起前

```bash
node "{SKILL_ROOT}/scripts/build-memory-context.js" \
  --memory .codereview/memory.json \
  --batch-id batch-001 \
  --expert framework \
  --output .codereview/memory-brief-batch-001-framework.json
```

专家名：`core` / `framework` / `reliability` / `security` / `curator`

---

## 子执行器使用规则

| 专家 | 行为 |
|------|------|
| core / framework / reliability / security | 按 `[必查]` **加强**检视；不得因误检提示删 issue |
| curator | 接收**全部** `[误检提示]`（不限 scope）；**security 类禁止仅凭 memory 排除** |

brief 默认上限约 800 字。
