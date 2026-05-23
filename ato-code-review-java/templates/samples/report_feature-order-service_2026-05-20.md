# Java 后端代码检视报告

> 本报告为单次检视的**完整交付物**，按下方章节顺序阅读即可；无需再查阅 `.codereview` 过程文件或其他说明文档。
>
> **说明**：本文件为 Skill 模板填充后的**模拟样例**，用于预览报告形态与 HTML 渲染效果。

---

## 一、基本信息

| 项目 | 内容 |
|------|------|
| 检视分支 | `feature/order-service` |
| 对比基准 | `master` |
| 检视深度 | 全部级别（Critical / High / Medium / Low） |
| 低风险文件 | 已检视全部变动文件 |
| 检视时间 | 2026-05-20 |
| 技术栈 | Java 17 · Spring Boot 3.2.5 · MyBatis-Plus 3.5.5 · MySQL 8 |
| 变动文件数 | 8 个 |
| 变动行数 | 新增 412 行 / 删除 87 行 |
| 检视批次 | 2 批 |
| 检视范围说明 | **仅针对各文件相对 `master...feature/order-service` 的 diff 变更行**；未改动代码不在本次检视范围内 |
| 报告生成时间 | 2026-05-20T14:30:00+08:00 |
| 策展附注 | 合并 2 组重复 issue；排除 1 项疑似误报（函数体内已有判空） |

---

## 二、本次变动文件清单

| # | 文件路径 | 类型 | 新增行 | 删除行 | 状态 |
|---|---------|------|--------|--------|------|
| 1 | `src/main/java/com/example/order/controller/OrderController.java` | controller | 68 | 12 | 已检视 |
| 2 | `src/main/java/com/example/order/service/impl/OrderServiceImpl.java` | service | 142 | 35 | 已检视 |
| 3 | `src/main/java/com/example/order/service/OrderService.java` | service | 18 | 4 | 已检视 |
| 4 | `src/main/java/com/example/order/mapper/OrderMapper.java` | mapper | 12 | 0 | 已检视 |
| 5 | `src/main/resources/mapper/order/OrderMapper.xml` | mapper-xml | 45 | 8 | 已检视 |
| 6 | `src/main/java/com/example/order/dto/CreateOrderRequest.java` | dto | 28 | 0 | 已检视 |
| 7 | `src/main/java/com/example/order/config/OrderAsyncConfig.java` | config | 52 | 14 | 已检视 |
| 8 | `src/test/java/com/example/order/service/OrderServiceTest.java` | test | 47 | 14 | 已检视 |

---

## 三、问题汇总统计

### 3.1 按严重级别

| 严重级别 | 数量 | 说明 |
|---------|------|------|
| 🔴 严重（Critical） | 1 | 必须修复：数据安全漏洞、必然崩溃风险 |
| 🟠 高危（High） | 3 | 应当修复：逻辑错误、数据一致性风险 |
| 🟡 中危（Medium） | 2 | 建议修复：代码质量、可维护性问题 |
| 🔵 低危（Low） | 2 | 可选修复：规范性和清洁度问题 |
| **合计** | **8** | |

### 3.2 按检视领域

| 检视领域 | 问题数 | 最高严重级别 |
|---------|--------|------------|
| 核心静态（规范 / NPE / 资源 / 基础缺陷） | 2 | Medium |
| Spring 与业务可靠性（注解 / 事务 / 幂等 / 竞态） | 2 | High |
| 安全（鉴权 / 敏感信息 / 反序列化 / Java 侧 SQL 拼接） | 1 | Critical |
| 数据与性能（SQL / ORM / N+1 / 线程安全与缓存） | 3 | High |

### 3.3 问题最多的文件 Top 5

| 排名 | 文件 | 问题数 | 最高级别 |
|------|------|--------|---------|
| 1 | `OrderServiceImpl.java` | 4 | Critical |
| 2 | `OrderMapper.xml` | 2 | High |
| 3 | `OrderController.java` | 1 | High |
| 4 | `OrderAsyncConfig.java` | 1 | Medium |
| 5 | `CreateOrderRequest.java` | 0 | — |

---

## 四、技术栈与检视依据

本次变动位于订单域增量功能：新增创建订单 API、异步通知、MyBatis 批量写入。项目为 **Spring Boot 3.2** 单体应用，Web 层使用 `@RestController` + JSR-303 校验，持久层为 **MyBatis-Plus** + XML 自定义 SQL，数据库 **MySQL 8**，异步任务通过 `@Async` + 自定义线程池。

**本次检视所依据的规范摘要**（已内化于检视结论，无需另行打开仓库内文档）：

- Java 通用编码规范（命名、结构、异常与资源管理）
- Spring Boot 3.2 实践要点（Web 层、依赖注入、事务与 AOP）
- MyBatis-Plus / XML Mapper 数据访问规范（参数绑定、SQL 与映射）

---

## 五、详细检视结果

> 每条 issue 含定位、问题代码与修复建议；锚点供第六节清单跳转 / HTML 弹窗。

### 5.1 核心静态（规范 / NPE / 资源 / 基础缺陷）

<a id="issue-COR-003"></a>

##### COR-003 · 🟡 Medium

| 定位项 | 值 |
|--------|-----|
| 文件 | `src/main/java/com/example/order/service/impl/OrderServiceImpl.java` |
| 行号 | 89 |
| 函数/方法 | `OrderServiceImpl#createOrder` |

**问题描述**：对 `request.getItems()` 直接 `stream()`，未防御 null；虽 Controller 有 `@Valid`，Service 仍可能被内部调用传入 null。

**问题代码**：

```java
List<OrderItem> items = request.getItems().stream()
    .map(this::toOrderItem)
    .collect(Collectors.toList());
```

**修复建议**：

```java
List<OrderItem> rawItems = Objects.requireNonNull(
    request.getItems(), "items must not be null");
List<OrderItem> items = rawItems.stream()
    .map(this::toOrderItem)
    .collect(Collectors.toList());
```

---

<a id="issue-COR-007"></a>

##### COR-007 · 🔵 Low

| 定位项 | 值 |
|--------|-----|
| 文件 | `src/main/java/com/example/order/config/OrderAsyncConfig.java` |
| 行号 | 34 |
| 函数/方法 | `OrderAsyncConfig#orderExecutor` |

**问题描述**：线程池 `queueCapacity=Integer.MAX_VALUE` 可能导致 OOM，与注释「防止丢任务」目标冲突。

**问题代码**：

```java
executor.setQueueCapacity(Integer.MAX_VALUE);
```

**修复建议**：

```java
// 使用有界队列 + CallerRunsPolicy 或丢弃策略，并监控队列深度
executor.setQueueCapacity(500);
executor.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
```

---

### 5.2 Spring 与业务可靠性（Spring 3.2）

<a id="issue-SPR-012"></a>

##### SPR-012 · 🟠 High · 必改

| 定位项 | 值 |
|--------|-----|
| 文件 | `src/main/java/com/example/order/service/impl/OrderServiceImpl.java` |
| 行号 | 102 |
| 函数/方法 | `OrderServiceImpl#createOrder` |

**问题描述**：`@Transactional` 标注在 public 方法上，但同类内部 `this.notifyWarehouse()` 为自调用，**事务代理不生效**，异常时可能出现订单已落库但通知未回滚的不一致。

**问题代码**：

```java
@Transactional(rollbackFor = Exception.class)
public Long createOrder(CreateOrderRequest request) {
    // ...
    this.notifyWarehouse(orderId);  // 自调用，不走代理
    return orderId;
}
```

**修复建议**：

将 `notifyWarehouse` 拆至独立 `@Service`（如 `WarehouseNotifyService`），由 Spring 代理管理 `@Transactional(REQUIRES_NEW)`；或通过 `ApplicationContext` 获取自身代理再调用。

---

<a id="issue-SPR-015"></a>

##### SPR-015 · 🟠 High · 必改

| 定位项 | 值 |
|--------|-----|
| 文件 | `src/main/java/com/example/order/controller/OrderController.java` |
| 行号 | 47 |
| 函数/方法 | `OrderController#create` |

**问题描述**：创建订单接口缺少幂等键（Idempotency-Key / 业务 requestId），重复提交可能产生 duplicate order。

**问题代码**：

```java
@PostMapping
public Result<Long> create(@RequestBody @Valid CreateOrderRequest request) {
    return Result.ok(orderService.createOrder(request));
}
```

**修复建议**：

```java
@PostMapping
public Result<Long> create(
    @RequestHeader("Idempotency-Key") String idempotencyKey,
    @RequestBody @Valid CreateOrderRequest request) {
    return Result.ok(orderService.createOrderIdempotent(idempotencyKey, request));
}
```

---

### 5.3 安全问题（鉴权 / 敏感信息 / 反序列化等）

<a id="issue-SEC-004"></a>

##### SEC-004 · 🔴 Critical · 必改

| 定位项 | 值 |
|--------|-----|
| 文件 | `src/main/java/com/example/order/controller/OrderController.java` |
| 行号 | 52 |
| 函数/方法 | `OrderController#create` |

**问题描述**：`POST /api/orders` **未校验当前用户与 request.body.userId 一致**，存在水平越权：攻击者可替他人 userId 下单。

**问题代码**：

```java
@PostMapping
public Result<Long> create(@RequestBody @Valid CreateOrderRequest request) {
    return Result.ok(orderService.createOrder(request));
}
```

**修复建议**：

```java
Long currentUserId = SecurityUtils.getCurrentUserId();
CreateOrderRequest safe = request.withUserId(currentUserId);
return Result.ok(orderService.createOrder(safe));
```

---

### 5.4 数据与性能（SQL / ORM / N+1 / 并发与缓存）

<a id="issue-DAT-008"></a>

##### DAT-008 · 🟠 High · 必改

| 定位项 | 值 |
|--------|-----|
| 文件 | `src/main/resources/mapper/order/OrderMapper.xml` |
| 行号 | 28 |
| 函数/方法 | `OrderMapper.xml#batchInsertItems` |

**问题描述**：`batchInsertItems` 使用 `${tableSuffix}` 字符串拼接，若 suffix 来自外部输入存在 **SQL 注入** 风险（本次 diff 新增动态分表逻辑）。

**问题代码**：

```xml
INSERT INTO order_item_${tableSuffix} (order_id, sku_id, qty)
VALUES ...
```

**修复建议**：

```java
private static final Set<String> ALLOWED_SUFFIX = Set.of("202605", "202606");
if (!ALLOWED_SUFFIX.contains(tableSuffix)) {
    throw new BusinessException("invalid table suffix");
}
```

---

<a id="issue-DAT-011"></a>

##### DAT-011 · 🟡 Medium

| 定位项 | 值 |
|--------|-----|
| 文件 | `src/main/java/com/example/order/service/impl/OrderServiceImpl.java` |
| 行号 | 118 |
| 函数/方法 | `OrderServiceImpl#loadOrderDetail` |

**问题描述**：循环内调用 `orderMapper.selectItemById`，典型 **N+1**；订单项较多时 DB 压力陡增。

**问题代码**：

```java
for (Long itemId : order.getItemIds()) {
    items.add(orderMapper.selectItemById(itemId));
}
```

**修复建议**：

```java
List<Long> itemIds = order.getItemIds();
List<OrderItem> items = orderMapper.selectItemsByIds(itemIds);
```

---

<a id="issue-DAT-014"></a>

##### DAT-014 · 🔵 Low

| 定位项 | 值 |
|--------|-----|
| 文件 | `src/main/resources/mapper/order/OrderMapper.xml` |
| 行号 | 41 |
| 函数/方法 | `OrderMapper.xml#listByStatus` |

**问题描述**：`SELECT *` 返回全部列，列表接口仅需摘要字段，浪费 IO。

**问题代码**：

```xml
SELECT * FROM orders WHERE status = #{status}
```

**修复建议**：

```xml
SELECT id, order_no, status, total_amount, created_at
FROM orders WHERE status = #{status}
```

---

## 六、问题清单（全量）

> Critical / High 在「必改」列标记 **是**；HTML 版可勾选「有效 / 已修复」，提交签收后回写本表。

| # | 问题 ID | 文件 | 行号 | 函数/方法 | 级别 | 必改 | 领域 | 问题描述 | 有效 | 已修复 | 详情 |
|---|---------|------|------|-----------|------|------|------|---------|------|--------|------|
| 1 | SEC-004 | OrderController.java | 52 | OrderController#create | Critical | 是 | 安全 | 创建订单未绑定当前登录用户，存在水平越权 | 否 | 否 | 否 | 否 | [查看](#issue-SEC-004) |
| 2 | SPR-012 | OrderServiceImpl.java | 102 | OrderServiceImpl#createOrder | High | 是 | Spring | 事务自调用导致 notifyWarehouse 不在同一事务 | 否 | 否 | [查看](#issue-SPR-012) |
| 3 | SPR-015 | OrderController.java | 47 | OrderController#create | High | 是 | Spring | 缺少幂等控制，重复提交可 duplicate order | 否 | 否 | [查看](#issue-SPR-015) |
| 4 | DAT-008 | OrderMapper.xml | 28 | OrderMapper.xml#batchInsertItems | High | 是 | 数据与性能 | `${tableSuffix}` 动态表名存在 SQL 注入风险 | 否 | 否 | [查看](#issue-DAT-008) |
| 5 | COR-003 | OrderServiceImpl.java | 89 | OrderServiceImpl#createOrder | Medium | 否 | 核心静态 | getItems() 可能 NPE | 否 | 否 | [查看](#issue-COR-003) |
| 6 | DAT-011 | OrderServiceImpl.java | 118 | OrderServiceImpl#loadOrderDetail | Medium | 否 | 数据与性能 | 循环查库 N+1 | 否 | 否 | [查看](#issue-DAT-011) |
| 7 | COR-007 | OrderAsyncConfig.java | 34 | OrderAsyncConfig#orderExecutor | Low | 否 | 核心静态 | 无界队列容量风险 | 否 | 否 | [查看](#issue-COR-007) |
| 8 | DAT-014 | OrderMapper.xml | 41 | OrderMapper.xml#listByStatus | Low | 否 | 数据与性能 | SELECT * 列表查询列过多 | 否 | 否 | [查看](#issue-DAT-014) |

---

## 七、检视结论与签收

| 项目 | 内容 |
|------|------|
| 检视结论 | （通过 / 修改后通过 / 不通过 等） |
| 签收人 | （请填写） |
| 有效问题个数 | （HTML 签收后自动填写） |
| 是否全部已修复 | （是 / 否） |
| 遗留下个版本问题数 | （有效且未修复的数量） |
| 签收时间 | （提交后自动填写） |
| 检视人 | （请填写） |
| 开发负责人 | （请填写） |
| 遗留问题说明 | （若无填「无」） |
| 备注 | （可选） |

---

*报告由 ato-code-review-java skill 根据模板自动生成 · 2026-05-20T14:30:00+08:00*
