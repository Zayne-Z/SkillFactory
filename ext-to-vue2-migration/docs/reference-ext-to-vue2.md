# ExtJS → Vue2 组件映射参考

本文档供迁移过程中查阅，包含 ExtJS 常见组件/模式到 Vue2 的对应实现方案。
假设目标项目使用 Element UI 作为 UI 框架（如使用其他框架请适配）。

---

## 1. 布局组件

### Ext.container.Viewport → App.vue + vue-router
```javascript
// ExtJS
Ext.create('Ext.container.Viewport', {
    layout: 'border',
    items: [
        { region: 'north', xtype: 'app-header' },
        { region: 'west', xtype: 'app-menu', width: 200 },
        { region: 'center', xtype: 'app-main' }
    ]
});
```

```html
<!-- Vue2 -->
<template>
  <el-container>
    <el-header><app-header /></el-header>
    <el-container>
      <el-aside width="200px"><app-menu /></el-aside>
      <el-main><router-view /></el-main>
    </el-container>
  </el-container>
</template>
```

### Ext.panel.Panel → el-card 或 div
```javascript
// ExtJS
Ext.create('Ext.panel.Panel', {
    title: '面板标题',
    html: '内容',
    collapsible: true
});
```

```html
<!-- Vue2: 简单面板 -->
<el-card>
  <div slot="header">面板标题</div>
  内容
</el-card>

<!-- Vue2: 可折叠面板 -->
<el-collapse>
  <el-collapse-item title="面板标题">内容</el-collapse-item>
</el-collapse>
```

### Ext.tab.Panel → el-tabs
```javascript
// ExtJS
Ext.create('Ext.tab.Panel', {
    items: [
        { title: 'Tab1', html: '内容1' },
        { title: 'Tab2', html: '内容2' }
    ]
});
```

```html
<!-- Vue2 -->
<el-tabs v-model="activeTab">
  <el-tab-pane label="Tab1" name="tab1">内容1</el-tab-pane>
  <el-tab-pane label="Tab2" name="tab2">内容2</el-tab-pane>
</el-tabs>
```

### layout: 'hbox' / 'vbox' → Flex 布局
```javascript
// ExtJS
{ layout: 'hbox', items: [...] }  // 水平排列
{ layout: 'vbox', items: [...] }  // 垂直排列
```

```html
<!-- Vue2 -->
<el-row :gutter="20">  <!-- 或用 flex -->
  <el-col :span="12">...</el-col>
  <el-col :span="12">...</el-col>
</el-row>

<!-- 或纯 CSS flex -->
<div style="display: flex; gap: 20px;">
  <div>...</div>
  <div>...</div>
</div>
```

---

## 2. 数据展示

### Ext.grid.Panel → el-table
```javascript
// ExtJS
Ext.create('Ext.grid.Panel', {
    store: userStore,
    columns: [
        { text: '姓名', dataIndex: 'name', flex: 1 },
        { text: '年龄', dataIndex: 'age', width: 80 },
        { text: '操作', xtype: 'actioncolumn', items: [{
            iconCls: 'x-fa fa-edit',
            handler: function(grid, rowIndex) { /* ... */ }
        }]}
    ],
    dockedItems: [{
        xtype: 'pagingtoolbar',
        store: userStore,
        dock: 'bottom'
    }]
});
```

```html
<!-- Vue2 -->
<template>
  <div>
    <el-table :data="tableData" border stripe>
      <el-table-column prop="name" label="姓名" />
      <el-table-column prop="age" label="年龄" width="80" />
      <el-table-column label="操作" width="120">
        <template slot-scope="scope">
          <el-button size="mini" @click="handleEdit(scope.row)">编辑</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-pagination
      @current-change="handlePageChange"
      :current-page="pagination.page"
      :page-size="pagination.size"
      :total="pagination.total"
      layout="total, prev, pager, next"
    />
  </div>
</template>

<script>
export default {
  data() {
    return {
      tableData: [],
      pagination: { page: 1, size: 20, total: 0 }
    }
  },
  created() {
    this.loadData()
  },
  methods: {
    async loadData() {
      const res = await this.$api.getUsers(this.pagination)
      this.tableData = res.data.list
      this.pagination.total = res.data.total
    },
    handlePageChange(page) {
      this.pagination.page = page
      this.loadData()
    },
    handleEdit(row) { /* ... */ }
  }
}
</script>
```

### Ext.tree.Panel → el-tree
```javascript
// ExtJS
Ext.create('Ext.tree.Panel', {
    store: treeStore,
    rootVisible: false,
    listeners: { itemclick: function(view, record) { /* ... */ } }
});
```

```html
<!-- Vue2 -->
<el-tree
  :data="treeData"
  :props="{ label: 'text', children: 'children' }"
  @node-click="handleNodeClick"
/>
```

---

## 3. 表单组件

### Ext.form.Panel → el-form
```javascript
// ExtJS
Ext.create('Ext.form.Panel', {
    items: [
        { xtype: 'textfield', fieldLabel: '用户名', name: 'username', allowBlank: false },
        { xtype: 'numberfield', fieldLabel: '年龄', name: 'age', minValue: 0 },
        { xtype: 'combobox', fieldLabel: '角色', name: 'role',
          store: roleStore, displayField: 'name', valueField: 'id' },
        { xtype: 'datefield', fieldLabel: '日期', name: 'date', format: 'Y-m-d' },
        { xtype: 'checkboxfield', fieldLabel: '启用', name: 'enabled' }
    ],
    buttons: [{
        text: '提交',
        handler: function() {
            var form = this.up('form').getForm();
            if (form.isValid()) { form.submit({ url: '/api/save' }); }
        }
    }]
});
```

```html
<!-- Vue2 -->
<template>
  <el-form :model="form" :rules="rules" ref="form" label-width="80px">
    <el-form-item label="用户名" prop="username">
      <el-input v-model="form.username" />
    </el-form-item>
    <el-form-item label="年龄" prop="age">
      <el-input-number v-model="form.age" :min="0" />
    </el-form-item>
    <el-form-item label="角色" prop="role">
      <el-select v-model="form.role">
        <el-option v-for="r in roles" :key="r.id" :label="r.name" :value="r.id" />
      </el-select>
    </el-form-item>
    <el-form-item label="日期" prop="date">
      <el-date-picker v-model="form.date" value-format="yyyy-MM-dd" />
    </el-form-item>
    <el-form-item label="启用">
      <el-switch v-model="form.enabled" />
    </el-form-item>
    <el-form-item>
      <el-button type="primary" @click="handleSubmit">提交</el-button>
    </el-form-item>
  </el-form>
</template>

<script>
export default {
  data() {
    return {
      form: { username: '', age: 0, role: '', date: '', enabled: false },
      roles: [],
      rules: {
        username: [{ required: true, message: '请输入用户名', trigger: 'blur' }]
      }
    }
  },
  methods: {
    handleSubmit() {
      this.$refs.form.validate(valid => {
        if (valid) {
          this.$api.save(this.form).then(() => {
            this.$message.success('保存成功')
          })
        }
      })
    }
  }
}
</script>
```

### 表单字段映射速查

| ExtJS xtype | Vue2 Element UI | 备注 |
|---|---|---|
| `textfield` | `el-input` | |
| `textarea` | `el-input type="textarea"` | |
| `numberfield` | `el-input-number` | |
| `combobox` | `el-select` + `el-option` | 注意远程搜索用 `filterable remote` |
| `datefield` | `el-date-picker` | format 不同: `Y-m-d` → `yyyy-MM-dd` |
| `timefield` | `el-time-picker` | |
| `checkboxfield` | `el-checkbox` 或 `el-switch` | |
| `radiofield` | `el-radio` | |
| `filefield` | `el-upload` | API 差异很大，需重写 |
| `htmleditor` | 第三方富文本（wangeditor/quill） | Ext 自带，Vue 需引入 |
| `hiddenfield` | 不需要，直接用 data | |
| `displayfield` | `<span>` 或 `el-form-item` 纯展示 | |
| `fieldcontainer` | `el-form-item` 嵌套 | |

---

## 4. 弹窗与消息

### Ext.window.Window → el-dialog
```javascript
// ExtJS
Ext.create('Ext.window.Window', {
    title: '编辑用户',
    width: 500, height: 400,
    modal: true, layout: 'fit',
    items: [{ xtype: 'userform' }],
    buttons: [{ text: '保存', handler: onSave }, { text: '取消', handler: onCancel }]
});
```

```html
<!-- Vue2 -->
<el-dialog title="编辑用户" :visible.sync="dialogVisible" width="500px">
  <user-form ref="userForm" :data="currentUser" />
  <span slot="footer">
    <el-button @click="dialogVisible = false">取消</el-button>
    <el-button type="primary" @click="handleSave">保存</el-button>
  </span>
</el-dialog>
```

### Ext.MessageBox → this.$message / this.$confirm
```javascript
// ExtJS
Ext.Msg.alert('提示', '操作成功');
Ext.Msg.confirm('确认', '确定删除?', function(btn) { if(btn==='yes') {/*...*/} });
```

```javascript
// Vue2
this.$message.success('操作成功');
this.$confirm('确定删除?', '确认', { type: 'warning' }).then(() => { /* 确定 */ });
```

---

## 5. 数据层

### Ext.data.Store → Vuex store 或组件 data
```javascript
// ExtJS Store
Ext.define('App.store.Users', {
    extend: 'Ext.data.Store',
    model: 'App.model.User',
    proxy: {
        type: 'ajax',
        url: '/api/users',
        reader: { type: 'json', rootProperty: 'data', totalProperty: 'total' }
    },
    autoLoad: true
});
```

**策略选择**：
- 简单页面：数据直接放组件 `data()` 中
- 跨组件共享：使用 Vuex module

```javascript
// Vue2 Vuex module（复杂场景）
const userModule = {
  namespaced: true,
  state: { list: [], total: 0, loading: false },
  mutations: {
    SET_LIST(state, { list, total }) { state.list = list; state.total = total },
    SET_LOADING(state, val) { state.loading = val }
  },
  actions: {
    async fetchList({ commit }, params) {
      commit('SET_LOADING', true)
      try {
        const res = await api.getUsers(params)
        commit('SET_LIST', { list: res.data.data, total: res.data.total })
      } finally {
        commit('SET_LOADING', false)
      }
    }
  }
}
```

```javascript
// Vue2 API 层
import request from '@/utils/request'
export function getUsers(params) {
  return request({ url: '/api/users', method: 'get', params })
}
```

### Ext.data.Model → 不需要单独定义
ExtJS 的 Model 定义字段类型、验证等。Vue2 中：
- 字段声明 → 组件 data 或 Vuex state
- 验证 → el-form rules
- 类型转换 → 在 API 层或组件中处理

---

## 6. 事件系统

### 组件事件映射

| ExtJS | Vue2 | 说明 |
|---|---|---|
| `listeners: { click: fn }` | `@click="fn"` | |
| `handler: function(){}` | `methods: { fn() {} }` | |
| `this.fireEvent('custom')` | `this.$emit('custom')` | |
| `controller.listen()` | 父组件 `@custom="handler"` | |
| `Ext.GlobalEvents.fireEvent()` | EventBus `$emit` 或 Vuex | 全局事件 |

### 全局事件总线
```javascript
// ExtJS
Ext.GlobalEvents.fireEvent('userUpdated', data);
Ext.GlobalEvents.on('userUpdated', function(data) {});

// Vue2 EventBus
// bus.js
import Vue from 'vue'
export const EventBus = new Vue()

// 发送
EventBus.$emit('userUpdated', data)
// 监听（记得在 beforeDestroy 中 $off）
EventBus.$on('userUpdated', this.onUserUpdated)
```

---

## 7. Ajax 请求

### Ext.Ajax.request → axios
```javascript
// ExtJS
Ext.Ajax.request({
    url: '/api/users',
    method: 'POST',
    jsonData: { name: 'test' },
    success: function(response) {
        var data = Ext.decode(response.responseText);
    },
    failure: function(response) {
        Ext.Msg.alert('错误', '请求失败');
    }
});
```

```javascript
// Vue2 (axios)
async saveUser(data) {
  try {
    const res = await this.$http.post('/api/users', data)
    this.$message.success('保存成功')
    return res.data
  } catch (err) {
    this.$message.error('请求失败')
  }
}
```

---

## 8. 路由

### Ext MVC Controller → vue-router

ExtJS 通常用 Controller + 组件动态切换实现"页面路由"。

```javascript
// Vue2 router
const routes = [
  {
    path: '/user',
    component: Layout,
    children: [
      { path: 'list', component: () => import('@/views/user/UserList.vue') },
      { path: 'detail/:id', component: () => import('@/views/user/UserDetail.vue') }
    ]
  }
]
```

---

## 9. 常用工具方法映射

| ExtJS | Vue2/JS | 说明 |
|---|---|---|
| `Ext.isEmpty(v)` | `v == null \|\| v === ''` | |
| `Ext.isArray(v)` | `Array.isArray(v)` | |
| `Ext.isObject(v)` | `typeof v === 'object' && v !== null` | |
| `Ext.clone(obj)` | `JSON.parse(JSON.stringify(obj))` 或 lodash `cloneDeep` | |
| `Ext.apply(dest, src)` | `Object.assign(dest, src)` | |
| `Ext.String.format('{0}是{1}', a, b)` | 模板字符串 `` `${a}是${b}` `` | |
| `Ext.Date.format(d, 'Y-m-d')` | dayjs/moment `dayjs(d).format('YYYY-MM-DD')` | |
| `Ext.encode(obj)` | `JSON.stringify(obj)` | |
| `Ext.decode(str)` | `JSON.parse(str)` | |

---

## 10. JSP 特殊处理

JSP 文件中常见的需要处理的模式：

| JSP 模式 | Vue2 处理方式 |
|---|---|
| `<%= variable %>` | `{{ variable }}` 或 data 绑定 |
| `<c:if test="">` | `v-if` |
| `<c:forEach>` | `v-for` |
| `<c:choose><c:when>` | `v-if / v-else-if / v-else` |
| `<fmt:formatDate>` | 过滤器或方法格式化 |
| `<spring:message>` | i18n 或直接写中文 |
| `<script>` 中嵌 `<%= %>` | 提取为 API 调用，不再服务端渲染 |
| `<%@ include file="">` | `import` 组件 |
| JSTL 函数 `fn:length()` 等 | JS 原生 `.length` 等 |

**关键原则**：JSP 是服务端渲染，Vue2 是客户端渲染。所有服务端取数据的逻辑都要改为 API 调用。
