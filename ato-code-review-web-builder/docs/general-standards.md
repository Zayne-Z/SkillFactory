# 通用前端代码规范参考

## JavaScript / TypeScript 规范

### 命名规范
- 变量/函数：camelCase（`getUserList`）
- 常量：UPPER_SNAKE_CASE（`MAX_RETRY_COUNT`）
- 类/构造函数：PascalCase（`UserService`）
- 私有属性：`_` 前缀（`_privateField`）或 TypeScript `private`
- 布尔变量：`is/has/can/should` 前缀（`isLoading`, `hasError`）

### 函数规范
- 单一职责，不超过 30 行（超过应考虑拆分）
- 参数不超过 3 个（超过用对象参数）
- 纯函数优先（无副作用）
- 异步函数统一用 `async/await`，避免混用 `.then` 链

### 错误处理
```javascript
// ✅ async/await 错误处理
async function fetchData() {
  try {
    const res = await api.get('/data')
    return res.data
  } catch (error) {
    console.error('fetchData failed:', error)
    throw error  // 或返回默认值
  }
}

// ✅ Promise 错误处理
fetch('/api').then(handleSuccess).catch(handleError)
```

### 空值处理
```javascript
// ✅ 可选链
const name = user?.profile?.name ?? '匿名'

// ✅ 防御性判断
if (!list || list.length === 0) return

// ❌ 避免
if (list.length)  // 未判断 list 是否存在
```

---

## 代码质量

### 避免的反模式
- 魔法数字：用常量代替（`const PAGE_SIZE = 20`）
- 深层嵌套：提前 return，或拆分函数
- 重复代码：抽取公共函数
- 过长的条件：封装为函数（`isValidUser(user)`）
- `console.log` 留在生产代码中

### 注释规范
- 注释解释"为什么"而非"是什么"
- 复杂算法/业务逻辑必须注释
- TODO 注释必须附带 issue 号或负责人
- JSDoc 用于公共 API 函数

---

## HTTP 请求规范

### 接口调用
- 统一封装 axios 实例，不直接使用原始 axios
- 请求/响应拦截器统一处理认证、错误提示
- 接口按模块分文件（`api/user.js`, `api/order.js`）
- Loading 状态统一管理，避免并发重复请求

### 错误处理
```javascript
// ✅ 统一错误处理（在拦截器中）
axios.interceptors.response.use(
  response => response.data,
  error => {
    const msg = error.response?.data?.message || '请求失败'
    showErrorToast(msg)
    return Promise.reject(error)
  }
)
```

---

## 安全规范

### XSS 防护
- 避免 `innerHTML` / `v-html` 插入用户输入
- 用 `v-html` 时必须对内容进行 HTML 转义
- URL 参数拼接必须 encodeURIComponent

### 敏感信息
- 不在前端代码中硬编码密码、密钥、token
- 环境变量通过 `.env` 文件管理（不提交 `.env.local`）
- 用户敏感信息（手机号、身份证）展示时做脱敏处理

### 权限控制
- 前端权限控制只作为 UI 层防护
- 路由级别做权限跳转，菜单/按钮级别做显隐控制
- 权限数据来自后端，不信任前端本地存储的权限

---

## 性能规范

### 渲染优化
- 长列表必须虚拟滚动（超过 100 条）
- 图片懒加载，使用 `loading="lazy"` 或 IntersectionObserver
- 防抖（debounce）：搜索输入、resize 监听
- 节流（throttle）：scroll 监听、频繁点击

### 资源优化
- 按需引入组件库（避免全量引入）
- 路由懒加载（动态 import）
- 公共依赖配置 externals 或 CDN
- 图片 WebP 格式，SVG 用 sprite 合并

### 内存管理
- 及时清理：定时器、事件监听、WebSocket、观察者
- 避免全局变量泄漏
- 大数据处理后解除引用

---

## CSS/样式规范

### 命名规范
- 类名用 kebab-case（`user-profile-card`）
- BEM 命名：`.block__element--modifier`
- 避免深层嵌套（不超过 3 层）

### 作用域
- 组件样式加 `scoped` 防止污染
- 需要覆盖第三方样式时使用 `::v-deep`（Vue2）或 `:deep()`（Vue3）

### 单位
- 响应式布局用 `rem/vw/vh/flex`
- 像素精确场景用 `px`
- 字体大小不用 `px`（影响无障碍）

---

## 检视重点清单（通用）

- [ ] 命名是否规范（camelCase/PascalCase/kebab-case）
- [ ] 是否存在 `console.log` / 调试代码
- [ ] 异步操作是否有错误处理
- [ ] 是否存在魔法数字
- [ ] 是否存在硬编码的 URL/密钥
- [ ] 长列表是否有虚拟滚动
- [ ] 事件监听/定时器是否有清理
- [ ] XSS 注入点是否有防护
- [ ] 接口请求是否统一封装
- [ ] CSS 是否有 scoped 或合理的命名空间
