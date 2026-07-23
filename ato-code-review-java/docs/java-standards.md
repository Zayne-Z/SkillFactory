# Java 代码规范参考手册

## 命名规范

### 基本规则
- **类名**：PascalCase（`UserService`、`OrderController`）
- **方法/变量**：camelCase（`getUserById`、`orderList`）
- **常量**：UPPER_SNAKE_CASE（`MAX_RETRY_COUNT`、`DEFAULT_PAGE_SIZE`）
- **包名**：全小写，点分隔（`com.example.service.impl`）
- **泛型参数**：单大写字母（`T`、`E`、`K`、`V`）

### 常见类型命名
- 接口：名词或形容词，不加前缀 `I`（`UserService` 而非 `IUserService`）
- 实现类：接口名 + `Impl`（`UserServiceImpl`）
- 抽象类：`Abstract` 前缀（`AbstractBaseService`）
- 枚举：PascalCase，枚举值 UPPER_SNAKE_CASE
- 测试类：被测类名 + `Test`（`UserServiceTest`）

### 布尔变量
- `is`/`has`/`can`/`should` 前缀（`isDeleted`、`hasPermission`）
- **⚠️ Lombok `@Data` 生成的 boolean getter 会去掉 `is` 前缀，导致 JSON 序列化字段名不一致**，建议用 `Boolean`（包装类型）

---

## 代码结构规范

### 类的成员顺序
```
1. 静态常量 static final
2. 静态变量 static
3. 实例变量（private 在前）
4. 构造方法
5. 静态工厂方法
6. 公共方法（接口实现方法）
7. 私有方法
```

### 方法规范
- 单一职责，不超过 80 行（超过考虑拆分）
- 参数不超过 5 个（超过用对象封装）
- 避免返回 `null`，优先返回空集合或 `Optional`
- 方法名动词开头（`get`/`find`/`create`/`update`/`delete`/`validate`）

---

## 注释规范

### Javadoc
```java
/**
 * 根据用户 ID 查询用户信息
 *
 * @param userId 用户 ID，不能为 null
 * @return 用户信息，若不存在返回 Optional.empty()
 * @throws IllegalArgumentException 当 userId 为 null 时
 */
public Optional<User> findById(Long userId) { ... }
```

规则：
- 公共接口和公共方法必须有 Javadoc
- `@param`、`@return`、`@throws` 标签完整填写
- 类级别 Javadoc 说明职责和主要用途

### 行内注释
- 注释解释"为什么"而非"是什么"
- 复杂算法/业务逻辑必须注释
- TODO 注释格式：`// TODO(负责人): 描述 #任务号`

---

## 常见反模式

### 魔法数字/字符串
```java
// ❌ 魔法数字
if (user.getStatus() == 1) { ... }
if (order.getType().equals("EXPRESS")) { ... }

// ✅ 使用枚举或常量
if (user.getStatus() == UserStatus.ACTIVE.getCode()) { ... }
if (OrderType.EXPRESS.name().equals(order.getType())) { ... }
```

### 过度使用 `instanceof`
```java
// ❌ 大量 instanceof 判断（违反开闭原则）
if (shape instanceof Circle) { ... }
else if (shape instanceof Rectangle) { ... }

// ✅ 多态/策略模式
shape.area();
```

### 重复代码
- 相同逻辑出现 3 次以上，提取为工具方法或基类方法
- 用模板方法模式消除算法骨架重复

---

## 集合使用规范

```java
// ✅ 返回空集合而非 null
public List<User> findByDept(Long deptId) {
    List<User> result = mapper.selectByDept(deptId);
    return result != null ? result : Collections.emptyList();
}

// ✅ 工厂方法初始化（指定初始容量）
Map<String, Object> map = new HashMap<>(16);
List<String> list = new ArrayList<>(expectedSize);

// ❌ 避免在迭代时修改集合
for (User user : userList) {
    userList.remove(user);  // ConcurrentModificationException
}
// ✅ 使用 Iterator.remove() 或 removeIf
userList.removeIf(user -> user.isDeleted());
```

---

## 字符串处理

```java
// ❌ 循环中字符串拼接
String result = "";
for (String s : list) { result += s; }

// ✅ StringBuilder
StringBuilder sb = new StringBuilder();
for (String s : list) { sb.append(s); }
String result = sb.toString();

// ✅ 或 String.join
String result = String.join(",", list);

// ❌ 字符串比较用 ==
if (str == "hello") { ... }

// ✅ 使用 equals（常量在前防 NPE）
if ("hello".equals(str)) { ... }
```

---

## 泛型与类型安全

- 避免使用原始类型（`List` 应为 `List<T>`）
- 不做不安全的强制转换（可能 ClassCastException）
- 使用 `@SuppressWarnings("unchecked")` 时必须注释原因

---

## 高频陷阱（增量 diff 优先对照）

### 包装类型比较
```java
// ❌ Integer/Long 用 ==（缓存区间外必翻车）
if (a == b) { ... }

// ✅ equals；注意一侧可能为 null
if (Objects.equals(a, b)) { ... }
```

### equals / hashCode
- 重写 `equals` 必须同时重写 `hashCode`（否则 HashMap/HashSet 行为错误）
- 用业务主键或 `Objects.equals` / `Objects.hash`；避免只比较部分可变字段却用于集合键

### 金额与精度
```java
// ❌ double/float 表示金额
double total = 0.1 + 0.2;

// ✅ BigDecimal；用字符串构造，忌 new BigDecimal(0.1)
BigDecimal total = new BigDecimal("0.1").add(new BigDecimal("0.2"));
```

### 日期时间与线程安全
```java
// ❌ SimpleDateFormat 作实例/静态字段共享（非线程安全）
private static final SimpleDateFormat FMT = new SimpleDateFormat("yyyy-MM-dd");

// ✅ DateTimeFormatter（不可变）或 Java time API
private static final DateTimeFormatter FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd");
```

### 资源关闭
```java
// ✅ try-with-resources
try (InputStream in = Files.newInputStream(path);
     Connection conn = dataSource.getConnection()) {
    // ...
}
```

---

## 误报控制

- 测试代码中的魔法数字、包可见字段：**默认从宽**，除非影响生产路径可读性/契约。
- 已用 `Objects.equals` / `BigDecimal` / `DateTimeFormatter` 的改动：**不**因「可用别的写法」空报。

---

## 检视重点清单（通用 Java）

- [ ] 类/方法/变量命名是否符合 camelCase/PascalCase 规范
- [ ] 公共方法是否有 Javadoc
- [ ] 是否存在魔法数字/魔法字符串
- [ ] 返回值是否可能为 null 且未说明
- [ ] 集合是否有空值保护
- [ ] 字符串比较是否用 equals；包装类型是否误用 `==`
- [ ] 循环中是否有字符串拼接
- [ ] 是否有不必要的原始类型使用
- [ ] `boolean` 字段是否会引起 Lombok 序列化问题
- [ ] 金额是否用 `BigDecimal`（禁止 double 累加）
- [ ] 是否共享非线程安全的 `SimpleDateFormat`
- [ ] IO/连接等是否用 try-with-resources 关闭
- [ ] 重写 `equals` 是否同时重写 `hashCode`
