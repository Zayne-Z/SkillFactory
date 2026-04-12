# 常见迁移问题与经验参考

本文档汇集 ExtJS 迁移到 Vue2 过程中的常见坑点和最佳实践，供迁移代码阶段参考。

---

## 一、架构层面常见问题

### 1. 前后端分离不彻底
**问题**：ExtJS/JSP 项目中，前端逻辑和后端逻辑混在一起。JSP 中通过 `<%= %>` 直接输出后端变量。
**解决**：
- 梳理所有后端变量注入点，改为 API 接口
- 页面初始化数据从 JSP 内嵌改为 `created()` 钩子中异步获取
- Session 中的用户信息改为登录 API + Vuex 存储

### 2. 全局变量污染
**问题**：ExtJS 项目大量使用全局变量（`window.xxx`、`Ext.ns()`）
**解决**：
- 页面级变量 → 组件 `data()`
- 跨页面共享 → Vuex state
- 常量/配置 → `src/constants/` 或 `.env` 文件
- 工具方法 → `src/utils/` 模块化导出

### 3. Controller 模式差异
**问题**：ExtJS 的 MVC Controller 与 Vue 的组件模式差异很大
**解决**：
- Ext Controller 的 `init()`、`control()` → Vue 组件 `created()`/`mounted()`
- Controller 的事件监听 → Vue 的 `@event` 绑定
- Controller 的 refs → Vue 的 `this.$refs`
- Controller 中的业务逻辑 → Vue 的 `methods`
- 跨控制器通信 → EventBus 或 Vuex

---

## 二、组件迁移常见问题

### 4. Grid（表格）迁移坑点
**问题集合**：
- ExtJS grid 的 `renderer` 函数 → el-table 的 `slot-scope` 模板
- `Ext.grid.column.Action` → 自定义操作列模板
- 行内编辑 (RowEditing plugin) → el-table 行内编辑需自行实现
- Grid 的排序/筛选 → el-table 的 `sortable` + 自定义筛选
- Grid selectionModel → el-table `@selection-change`

**行内编辑参考方案**：
```html
<el-table-column prop="name" label="姓名">
  <template slot-scope="scope">
    <el-input v-if="scope.row.editing" v-model="scope.row.name" size="small" />
    <span v-else>{{ scope.row.name }}</span>
  </template>
</el-table-column>
```

### 5. 表单验证差异
**问题**：ExtJS 的验证器（`vtype`、`validator`）与 Element UI `rules` 差异大
**解决**：
```javascript
// ExtJS vtype
{ xtype: 'textfield', vtype: 'email' }

// Vue2 Element UI
rules: {
  email: [
    { required: true, message: '请输入邮箱', trigger: 'blur' },
    { type: 'email', message: '邮箱格式不正确', trigger: 'blur' }
  ]
}

// 自定义验证器
{ validator: (rule, value, callback) => {
    if (!/^\d{6}$/.test(value)) callback(new Error('请输入6位数字'))
    else callback()
  }, trigger: 'blur'
}
```

### 6. 下拉框远程搜索
**问题**：ExtJS ComboBox 的远程搜索模式与 el-select 差异大
```html
<!-- Vue2 远程搜索下拉 -->
<el-select v-model="value" filterable remote :remote-method="remoteSearch" :loading="loading">
  <el-option v-for="item in options" :key="item.id" :label="item.name" :value="item.id" />
</el-select>
```

### 7. 文件上传
**问题**：ExtJS `filefield` 与 `el-upload` API 完全不同
```html
<!-- Vue2 文件上传 -->
<el-upload
  :action="uploadUrl"
  :headers="uploadHeaders"
  :on-success="handleUploadSuccess"
  :on-error="handleUploadError"
  :before-upload="beforeUpload"
  :file-list="fileList"
>
  <el-button size="small" type="primary">点击上传</el-button>
</el-upload>
```

---

## 三、数据处理常见问题

### 8. Store 数据加载模式差异
**问题**：ExtJS Store 的 `autoLoad`、`load()`、`loadData()` 模式不同
**解决**：
- `autoLoad: true` → `created()` 中调用加载方法
- `store.load()` → 调用 API 后赋值给 `data`
- `store.loadData(records)` → 直接赋值 `this.tableData = records`
- `store.getProxy().setExtraParam()` → API 请求参数

### 9. 数据模型转换
**问题**：ExtJS Model 的 `convert` 函数、`mapping` 配置
**解决**：
- 在 API 响应拦截器或组件方法中做数据转换
```javascript
// API 层统一处理
function transformUserData(raw) {
  return {
    ...raw,
    fullName: `${raw.firstName} ${raw.lastName}`,
    createTime: dayjs(raw.createTime).format('YYYY-MM-DD HH:mm')
  }
}
```

### 10. 分页参数差异
**问题**：ExtJS 分页参数（`start/limit`）vs 常见 Vue 分页（`page/size`）
**解决**：
```javascript
// 适配旧接口的分页参数
async loadData() {
  const { page, size } = this.pagination
  const res = await this.$api.getList({
    start: (page - 1) * size,  // 兼容旧接口
    limit: size
  })
}
```

---

## 四、样式与布局问题

### 11. ExtJS 布局系统差异
**问题**：ExtJS 的 `layout` 系统（fit/border/card/anchor/column）在 Vue 中没有直接对等
**映射表**：

| Ext Layout | Vue2 实现 |
|---|---|
| `fit` | `width:100%; height:100%` 或 flex:1 |
| `border` | `el-container` + `el-header/aside/main/footer` |
| `card` | `v-show` 或动态组件 `<component :is="xxx">` |
| `anchor` | CSS 百分比宽度 |
| `column` | `el-row` + `el-col` |
| `hbox` | `display: flex` |
| `vbox` | `display: flex; flex-direction: column` |
| `table` | CSS Grid 或 `<table>` |

### 12. 高度自适应
**问题**：ExtJS 自动计算组件高度，Vue 中需要手动处理
**解决**：
```css
/* 常用的全屏高度方案 */
.page-container {
  height: calc(100vh - 84px); /* 减去 header 高度 */
  display: flex;
  flex-direction: column;
}
.table-wrapper {
  flex: 1;
  overflow: auto;
}
```

---

## 五、其他常见陷阱

### 13. this 指向问题
**问题**：ExtJS 中大量使用 `scope: this`，迁移时容易忽略 Vue 的 this 绑定
**解决**：
- Vue methods 中的函数自动绑定 this，无需额外处理
- 回调函数用箭头函数保持 this 指向
- 避免在 `setTimeout`/`setInterval` 中使用普通 function

### 14. 生命周期差异
| ExtJS | Vue2 | 说明 |
|---|---|---|
| `initComponent` | `created` | 组件初始化 |
| `afterRender` | `mounted` | DOM 已渲染 |
| `beforeDestroy` | `beforeDestroy` | 销毁前清理 |
| `onShow` | `activated`（keep-alive） | 组件显示时 |

### 15. 深层数据响应性
**问题**：Vue2 的响应式系统对对象新增属性和数组索引修改不敏感
**解决**：
```javascript
// 对象新增属性
this.$set(this.obj, 'newKey', 'value')

// 数组修改
this.$set(this.arr, index, newValue)

// 或使用 splice
this.arr.splice(index, 1, newValue)
```

### 16. 权限控制迁移
**问题**：ExtJS 项目权限通常通过后端控制 JSP 渲染，前端权限控制弱
**解决**：
- 路由级权限 → vue-router `beforeEach` 守卫
- 按钮级权限 → 自定义指令 `v-permission`
- 菜单权限 → 动态路由 `router.addRoutes()`

### 17. 国际化迁移
**问题**：ExtJS 有内置国际化，JSP 用 `<spring:message>`
**解决**：
- 使用 `vue-i18n`
- 或如果只需要中文，直接写死中文文本

### 18. 图表组件
**问题**：ExtJS Charts 模块
**解决**：
- 使用 ECharts（推荐，功能强大）
- 或 v-charts（ECharts 的 Vue 封装）
```bash
npm install echarts vue-echarts
```

---

## 六、迁移最佳实践清单

1. **先搭骨架后填肉**：先迁移页面结构和路由，再填充业务逻辑
2. **API 层先行**：先把所有接口整理出来，统一用 axios 封装
3. **公共组件先抽取**：如果多个页面用同一个 Ext 组件模式，先做成 Vue 公共组件
4. **保持接口不变**：迁移前端，不改后端接口，降低风险
5. **逐页验证**：迁移一页测一页，不要攒一堆再测
6. **保留原始注释**：如果 ExtJS 代码有业务注释，迁移时保留
7. **处理好 loading 状态**：ExtJS 的 `mask` 要改为 Vue 的 `v-loading`
8. **表单回显注意时序**：确保数据加载完成后再渲染表单，避免默认值覆盖
9. **不要过度使用 Vuex**：简单页面的数据不需要放 Vuex，组件 data 就够了
10. **CSS 隔离**：使用 `<style scoped>` 避免样式污染

---

## 七、ExtJS 特有模式识别

迁移时需要识别以下 ExtJS 特有模式，正确转换：

### ViewModel / BindData
```javascript
// ExtJS ViewModel
viewModel: {
    data: { title: '默认标题' },
    formulas: {
        fullName: function(get) { return get('firstName') + ' ' + get('lastName'); }
    }
}
// bind: '{title}'
```
**Vue2 对应**：`data()` + `computed`

### Mixin（混入）
```javascript
// ExtJS Mixin
Ext.define('App.mixin.Pageable', { /* ... */ });
Ext.define('App.view.UserGrid', { mixins: ['App.mixin.Pageable'] });
```
**Vue2 对应**：`mixins: [pageableMixin]`

### Plugin
```javascript
// ExtJS Plugin
plugins: [{ ptype: 'gridfilters' }, { ptype: 'cellediting' }]
```
**Vue2 对应**：根据具体功能，用组件属性或自定义实现

### 自定义 xtype
```javascript
// ExtJS
Ext.define('App.view.user.UserGrid', {
    extend: 'Ext.grid.Panel',
    alias: 'widget.usergrid',
    // ...
});
// 使用: { xtype: 'usergrid' }
```
**Vue2 对应**：单独 .vue 组件文件 + import 注册
