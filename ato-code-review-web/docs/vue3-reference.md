# Vue 3 代码检视参考手册

## 核心规范

### Composition API 规范
- 逻辑相关代码用 composable 函数抽取（`use` 前缀，如 `useUserList`）
- `setup()` 内避免放过多逻辑，合理拆分 composable
- `<script setup>` 是推荐写法
- `defineProps` / `defineEmits` 必须在 `<script setup>` 顶层调用

### 响应式 API
- 基础类型用 `ref()`，对象/数组用 `reactive()`
- 不要解构 `reactive` 对象（会失去响应性），用 `toRefs()` 解构
- `computed()` 返回只读 ref，需要可写时传入 `{ get, set }`
- `watchEffect` 自动追踪依赖；`watch` 需要明确指定依赖

### 生命周期（Composition API）
```javascript
// Options API → Composition API 对应
beforeCreate/created → setup()
beforeMount         → onBeforeMount
mounted             → onMounted
beforeUpdate        → onBeforeUpdate
updated             → onUpdated
beforeUnmount       → onBeforeUnmount  // ⚠️ 注意：Vue3 改名
unmounted           → onUnmounted
```

**⚠️ Vue3 中 `beforeDestroy` 改为 `beforeUnmount`，`destroyed` 改为 `unmounted`**

### 清理副作用
```javascript
// ✅ 自动清理
watchEffect((onCleanup) => {
  const timer = setInterval(() => {}, 1000)
  onCleanup(() => clearInterval(timer))
})

// ✅ 手动清理
onUnmounted(() => {
  clearInterval(timer)
  emitter.off('event', handler)
})
```

### Props 规范
```typescript
// <script setup> 写法
const props = defineProps<{
  title: string
  count?: number
}>()

// 带默认值
const props = withDefaults(defineProps<{
  count?: number
}>(), { count: 0 })
```

### Emits 规范
```javascript
// ✅ 声明 emits
const emit = defineEmits(['update:modelValue', 'change'])
// 或 TypeScript 版本
const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()
```

---

## 常见问题

### 响应性丢失
```javascript
// ❌ 解构 reactive 丢失响应性
const { count } = reactive({ count: 0 })

// ✅ 使用 toRefs
const state = reactive({ count: 0 })
const { count } = toRefs(state)

// ✅ 或直接用 ref
const count = ref(0)
```

### watch 未停止
```javascript
// ❌ 组件销毁后 watch 仍然运行
const stopWatch = watch(source, callback)
// 忘记停止

// ✅ 在 setup 内创建的 watch 自动停止
// 手动创建的需要在 onUnmounted 中停止
onUnmounted(() => stopWatch())
```

### Teleport 与 v-model
```javascript
// v-model 双向绑定（Vue3 语法）
// 父组件
<MyInput v-model="name" />
// 等价于
<MyInput :modelValue="name" @update:modelValue="name = $event" />

// 子组件
const props = defineProps(['modelValue'])
const emit = defineEmits(['update:modelValue'])
```

---

## Pinia 规范（Vue3 状态管理）

- 每个 store 用 `defineStore` 定义，命名用 `use` + 功能 + `Store`
- 优先使用 Composition API 风格 store
- `$patch` 批量更新 state 以提升性能
- store 间依赖直接调用，不需要 Vuex 的模块嵌套

## Vue Router 4 规范

- 路由懒加载：`component: () => import('./views/Home.vue')`
- 组合式 API 中用 `useRouter()` / `useRoute()` 替代 `this.$router`
- 导航守卫返回 `false` 取消导航，返回路由对象重定向

---

## Vite 构建相关

- 环境变量用 `import.meta.env.VITE_XXX`（只有 `VITE_` 前缀的会暴露）
- 动态 import 路径避免完全动态（影响打包分析）
- CSS Modules 推荐命名 `xxx.module.css`

---

## 检视重点清单（Vue3 专用）

- [ ] `beforeDestroy` 是否错误使用（应改为 `beforeUnmount`）
- [ ] reactive 对象是否被解构导致响应性丢失
- [ ] `defineProps` / `defineEmits` 是否正确声明
- [ ] watch/watchEffect 是否有内存泄漏
- [ ] Composable 函数是否在 `setup` 顶层调用（不在条件/循环中）
- [ ] 是否使用了废弃的 `$listeners`（Vue3 已合并到 `$attrs`）
- [ ] `v-model` 语法是否符合 Vue3（`.value` 改为 `modelValue`）
- [ ] Pinia store 是否在 setup 内调用
- [ ] 模板 ref 是否正确声明 `const el = ref(null)`
- [ ] `<Suspense>` 异步组件是否有 fallback
