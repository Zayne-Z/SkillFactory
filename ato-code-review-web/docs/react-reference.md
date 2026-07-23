# React 代码检视参考手册

在 **`review_mode === "react"`** 时，框架专家在 diff 范围内对照下列项（与 reliability / security / core 边界以各子执行器为准）。

## 核心规范

### 组件与 Hooks 调用规则
- 函数组件优先；hooks **仅在组件或自定义 hook 顶层**调用，不在循环 / 条件 / 嵌套函数内调用。
- 自定义 hook 命名 `use` 前缀（`useUserList`）；可复用副作用与状态逻辑优先抽 hook，而非复制粘贴。
- 避免在已统一 hooks 的项目中新增 class 组件（diff 中出现可提示与规范对齐）。

### useEffect / 副作用
```javascript
// ✅ 依赖完整；订阅与定时器在 cleanup 中释放
useEffect(() => {
  const controller = new AbortController()
  fetchData({ signal: controller.signal }).then(setData)
  return () => controller.abort()
}, [userId])

// ❌ 依赖缺失 → 闭包陈旧 / 漏更新
useEffect(() => {
  fetchData(userId)
}, []) // 缺 userId
```

**⚠️ 常见陷阱**：
- StrictMode（开发态）会故意双调用 mount/effect：副作用必须可重入、cleanup 必须正确。
- 竞态：后发请求先返回时覆盖新数据 —— 用 abort / 序号 / `ignore` 标志。
- 在 effect 里直接 `setState` 派生另一状态时，优先改用渲染期计算或 `useMemo`，避免额外渲染环。

### useMemo / useCallback / 依赖
- 仅在确有昂贵计算或作为下游稳定依赖时使用；不要默认包一层「优化」。
- 依赖数组必须完整；对象 / 数组字面量作依赖会导致每次重算（应提升或 memo 上游）。
- `useCallback` 的意义通常是稳住传给 memo 子组件的引用，而非「写了就更快」。

### 状态与受控组件
```javascript
// ❌ 受控与非受控混用（value 与 defaultValue 切换）
<input value={v} onChange={...} />  // 某次渲染又改成 defaultValue

// ✅ 选定一种；切换挂载身份用 key 重置
<input key={formId} value={v} onChange={e => setV(e.target.value)} />
```

- 派生状态优先在渲染中计算，避免「state 同步另一 state」的双重来源。
- 列表中用 `key` 重置局部状态时，确认是有意为之（否则会丢输入）。

### 列表渲染
- `key` 稳定且在兄弟间唯一；列表会重排 / 插入 / 删除时**不用数组下标**作唯一 key。
- 与 **reliability** 分工：纯「应用业务 id 作 key」的约定可归 **framework**。

---

## 常见问题

### 过时闭包与事件处理器
```javascript
// ❌ 订阅里用到的 state 未进依赖，回调永远看到旧值
useEffect(() => {
  const onMsg = () => console.log(count)
  socket.on('msg', onMsg)
  return () => socket.off('msg', onMsg)
}, []) // 缺 count；或改用 ref 保存最新 count
```

### 在渲染路径触发副作用
```javascript
// ❌ 渲染中 setState / 请求 → 无限更新或重复请求
if (data == null) setData(load())

// ✅ 放到 useEffect，或用路由/loader 在渲染外取数
```

### dangerouslySetInnerHTML
- 仅可信 / 已净化内容；否则归 **security**（见 `security-checklist.md`）。

---

## 常见库约定（按 tech-stack.json 实际依赖）

### React Router v6
- 导航用 `useNavigate` / `<Navigate />`；勿混用已废弃的 `history.push` 旧模式（除非项目仍锁定旧 API）。
- 使用 data router 时：loader/action 错误用 `errorElement` / 路由错误边界承接。
- 路由懒加载：`React.lazy` + `<Suspense>`，或框架自带的 code-split 约定。

### TanStack Query
- `queryKey` 稳定且序列化友好；参数变化必须体现在 key 中。
- 用 `enabled` 控制条件请求；统一处理 `isError` / `isPending`，避免静默失败。
- 突变后 `invalidateQueries`，勿手写两套缓存真相。

### Next.js（`meta_framework === next`）
- Client / Server 组件边界清晰；`'use client'` 仅在需要浏览器 API / hooks 时添加。
- 勿在客户端暴露仅服务端可用的密钥；服务端逻辑勿依赖可被伪造的请求头作为唯一鉴权。
- `NEXT_PUBLIC_` 变量视为公开；秘密只放服务端环境变量。

---

## 样式（与 Vue 专家共用「检查清单 B」思路）

- CSS Modules：`styles.xxx` 与类名变更保持同步。
- styled-components / emotion：主题与 SSR 水合相关变更（若 diff 涉及）。
- 全局 CSS 泄漏、选择器权重、`:focus-visible` 与对比度（与 `general-standards.md` 一致）。

---

## 误报控制

- 已有 cleanup / AbortController 的 effect：**不**因「可能泄漏」空报。
- 依赖数组与 eslint-plugin-react-hooks 已说明 disable 且注释了原因的：谨慎报，优先看是否真有陈旧闭包。
- 纯展示组件未使用 memo：**默认不报**（除非 profiling / 列表卡顿证据在 diff 语境中明确）。

---

## 与 `framework_version` 输出

检视结果 JSON 中 `framework_version` 字段请填 **`react`**（勿填具体 18/19 数字于该字段，版本信息已在技术栈 JSON）。

---

## 检视重点清单（React 专用）

- [ ] Hooks 是否只在顶层调用（无条件 / 循环调用）
- [ ] `useEffect` 依赖是否完整；订阅 / 定时器 / 请求是否有 cleanup 或 abort
- [ ] 是否存在渲染路径中的 setState / 请求副作用
- [ ] 列表 `key` 是否稳定唯一（重排场景避免纯 index）
- [ ] 受控 / 非受控是否混用；表单状态来源是否单一
- [ ] `useMemo` / `useCallback` 是否有完整依赖，而非无效包装
- [ ] `dangerouslySetInnerHTML` 是否仅用于可信内容（否则交 security）
- [ ] Router / Query / Next 边界是否符合项目实际依赖
- [ ] 自定义 hook 是否在组件顶层调用且命名 `use*`
- [ ] StrictMode 下副作用是否可安全双调用（开发态）
