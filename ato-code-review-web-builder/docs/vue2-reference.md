# Vue 2 代码检视参考手册

## 核心规范

### 组件命名
- 组件文件名用 PascalCase（如 `UserProfile.vue`）
- 模板中用 kebab-case（`<user-profile />`）或 PascalCase（`<UserProfile />`）
- 基础组件统一前缀（如 `Base`、`App`）
- 单实例组件用 `The` 前缀（如 `TheHeader.vue`）

### 组件选项顺序（Options API）
```
name → components → directives → filters → mixins →
props → data → computed → watch → 生命周期钩子 →
methods → render
```

### Props 规范
- 必须定义类型（`type`）
- 生产环境 required 字段需设置 `required: true`
- 避免直接修改 prop（应 emit 事件）
- 命名用 camelCase，模板绑定用 kebab-case

### Data 规范
- `data` 必须是函数（组件内）
- 避免在 `data` 中存放不需要响应式的大对象
- 不在 `data` 声明后动态添加根级属性（需用 `Vue.set`）

### 响应式注意事项
- 数组变异方法：`push/pop/shift/unshift/splice/sort/reverse`
- 非变异操作需重新赋值：`this.arr = [...this.arr, newItem]`
- 对象新增属性用 `Vue.set(obj, key, val)` 或 `this.$set`
- 对象整体替换：`this.obj = Object.assign({}, this.obj, changes)`

### Computed 规范
- 避免有副作用（不应修改数据）
- 复杂计算优先用 computed 而非 watch
- getter/setter 配对使用

### Watch 规范
- 避免在 watch 中直接修改被监听的值（循环触发）
- 优先使用 `handler + immediate` 替代手动首次调用
- 深层监听用 `deep: true`，注意性能

### 生命周期
- `created`：数据初始化、接口请求（无 DOM）
- `mounted`：DOM 操作、第三方库初始化
- `beforeDestroy`：清理定时器、解绑事件、取消订阅（**必须清理**）
- 避免在 `mounted` 之前访问 DOM

### 事件规范
- 自定义事件名用 kebab-case（`$emit('update-value')`）
- 在 `beforeDestroy` 中解绑所有 `$on` 监听
- 父子通信优先 props/emit，避免过度使用 `$parent/$children`

---

## 常见问题

### 内存泄漏
```javascript
// ❌ 错误：未清理定时器
mounted() { this.timer = setInterval(() => {}, 1000) }

// ✅ 正确
mounted() { this.timer = setInterval(() => {}, 1000) }
beforeDestroy() { clearInterval(this.timer) }
```

### 响应式失效
```javascript
// ❌ 直接索引赋值不触发响应式
this.list[0] = newItem

// ✅ 使用 $set 或 splice
this.$set(this.list, 0, newItem)
this.list.splice(0, 1, newItem)
```

### 异步请求未取消
```javascript
// ❌ 组件销毁后仍然回调
mounted() {
  axios.get('/api/data').then(res => { this.data = res.data })
}

// ✅ 使用取消令牌或标志位
mounted() {
  this._cancel = false
  axios.get('/api/data').then(res => {
    if (!this._cancel) this.data = res.data
  })
}
beforeDestroy() { this._cancel = true }
```

---

## Vuex 规范

- State 定义在 `state` 函数中（模块化）
- 修改 state 只通过 `mutation`
- 异步操作在 `action` 中，`action` 内调用 `commit`
- 合理使用 `namespace: true`
- 避免在组件中直接修改 `$store.state`

## Vue Router 规范

- 路由组件懒加载：`() => import('./views/Home.vue')`
- 路由守卫中必须调用 `next()`
- 避免硬编码路由路径，使用命名路由
- 动态路由参数变化时用 `watch $route` 或 `beforeRouteUpdate`

---

## Element UI 常见问题

- 表单验证：`this.$refs.form.validate(valid => {...})`
- 表格数据更新后需 `this.$nextTick(() => this.$refs.table.doLayout())`
- Dialog 内表单复位：关闭时调用 `this.$refs.form.resetFields()`
- Select 远程搜索需设置 `:filterable="true" :remote="true"`

---

## 检视重点清单（Vue2 专用）

- [ ] 是否存在直接修改 props
- [ ] `data` 是否为函数
- [ ] 定时器/事件监听是否在 `beforeDestroy` 中清理
- [ ] 数组/对象响应式操作是否正确
- [ ] `v-for` 是否有 `:key`（且非 index）
- [ ] 是否存在 `v-if` 和 `v-for` 同时使用（应拆分）
- [ ] computed 是否有副作用
- [ ] 异步请求是否处理了组件销毁后的回调
- [ ] Vuex mutation 是否同步
- [ ] 路由懒加载是否正确配置
