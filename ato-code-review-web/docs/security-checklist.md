# 前端安全检视参考（增量 diff）

供 `web-codereview-review-security` 子执行器按需查阅，与主 prompt 中的严重级别规则一致。

## 严重级别与 `critical_high_only` 模式

- **`all`**：可输出 `critical` / `high` / `medium` / `low`。
- **`critical_high_only`**：**仅**允许 `critical` 与 `high`。不得输出 `medium` / `low`。
  - **不确定但需提醒**：使用 **`high`**，`title` 或 `description` 中写明「需人工确认数据来源 / 是否已净化 / 是否后端已鉴权」等，**禁止**用 `medium` 绕过该限制。

## 领域速查（仅对 diff 变更行）

| 领域 | 典型危险模式 | 常见安全做法 |
|------|----------------|----------------|
| XSS | `v-html` / `dangerouslySetInnerHTML` 绑定不可信数据；`innerHTML`；`eval` / `new Function` | 默认文本插值；富文本先 DOMPurify 等净化 |
| 敏感信息 | 硬编码密钥；`console.log` 打印 token/PII；`VITE_`/`NEXT_PUBLIC_` 暴露秘密 | 秘钥仅服务端；前端只放公开配置 |
| 权限 | 仅前端隐藏按钮；路由无守卫；信任 localStorage 角色 | 后端鉴权；敏感操作二次校验 |
| 重定向 | `window.location` / `redirect` 参数未校验 | 白名单域名或相对路径 |
| 上传 | 无类型/大小限制 | MIME 与扩展名校验、服务端扫描 |
| CSRF | 无 token / 无 SameSite | Cookie SameSite、关键请求 token |

## 误报控制

- 已确认后端净化或静态可信内容的 `v-html` / `dangerouslySetInnerHTML`：**不**报 issue。
- 仅当 diff 能关联到「用户/URL/外部接口」等不可信来源时再报 XSS。

## Vue / React 对照（XSS）

- Vue：`v-html="untrusted"` → 高风险。
- React：`dangerouslySetInnerHTML={{ __html: untrusted }}` → 同等风险。
