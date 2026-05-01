# React 代码检视参考（增量 diff）

在 **`review_mode === "react"`** 时，框架专家在 diff 范围内可重点对照下列项（与 reliability / security / core 边界以各子 Builder 为准）。

## 组件与 Hooks

- 函数组件：hooks 仅在组件顶层调用，不在循环/条件内调用。
- `useEffect`：依赖数组完整；副作用清理（订阅、定时器、`abortController`）在返回函数中释放。
- 避免过时的类组件模式混在新代码中（若项目已统一 hooks，diff 中新增 class 组件可提示与规范对齐）。
- **列表渲染**：稳定且唯一的 `key`（不用数组下标作为唯一标识当列表会重排时）；与 **reliability** 分工——纯「应用业务 id 作 key」的约定可归 **framework**。

## 数据与渲染

- `dangerouslySetInnerHTML`：仅可信/已净化内容；否则归 **security**。
- 受控组件与非受控混用、key 导致状态错误挂载等。

## 常见库约定（按 tech-stack.json 实际依赖）

- **React Router v6**：`useNavigate` / `<Navigate />`；布局与 data router 的 loader/action 错误边界（若使用）。
- **TanStack Query**：queryKey 稳定、`enabled`、错误与 loading 状态。
- **Next.js**（若 `meta_framework` 为 next）：Client/Server 组件边界、`use client` 是否必要；勿在客户端暴露仅服务端可用的密钥；服务端敏感逻辑勿依赖可被伪造的请求头。

## 样式（与 Vue 专家共用「检查清单 B」思路）

- CSS Modules：`styles.xxx` 与类名变更。
- styled-components / emotion：主题与 SSR 水合相关变更（若 diff 涉及）。
- 全局 CSS 泄漏、选择器权重、`:focus-visible` 与对比度（与通用样式清单一致）。

## 与 `framework_version` 输出

检视结果 JSON 中 `framework_version` 字段请填 **`react`**（勿填具体 18/19 数字于该字段，版本信息已在技术栈 JSON）。
