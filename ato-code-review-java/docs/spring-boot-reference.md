# Spring Boot / Spring MVC 最佳实践参考

## 分层架构规范

### 标准三层结构
```
Controller  → 接收请求，参数校验，调用 Service，返回结果
Service     → 业务逻辑，事务管理，调用多个 Repository/Mapper
Repository/Mapper → 数据访问，无业务逻辑
```

**⚠️ 常见违规**：
- Controller 中写业务逻辑
- Service 中直接操作多个 DAO 但不加事务
- Mapper 中做数据拼装/业务判断

---

## Controller 规范

### 注解使用
```java
// ✅ 推荐 @RestController（= @Controller + @ResponseBody）
@RestController
@RequestMapping("/api/v1/users")
public class UserController {

    // ✅ 明确 HTTP 方法
    @GetMapping("/{id}")
    public Result<UserVO> getById(@PathVariable Long id) { ... }

    @PostMapping
    public Result<Void> create(@Valid @RequestBody CreateUserRequest req) { ... }

    @PutMapping("/{id}")
    public Result<Void> update(@PathVariable Long id, @Valid @RequestBody UpdateUserRequest req) { ... }

    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id) { ... }
}
```

### 参数校验
```java
// ✅ 使用 Bean Validation + 全局异常处理
@PostMapping
public Result<Void> create(@Valid @RequestBody CreateUserRequest req) { ... }

// ✅ 路径变量不为负数
@GetMapping("/{id}")
public Result<UserVO> getById(@PathVariable @Positive Long id) { ... }

// ❌ 手动 if 判断代替注解校验（冗余且容易遗漏）
if (req.getName() == null || req.getName().isEmpty()) {
    return Result.fail("姓名不能为空");
}
```

### 统一响应格式
```java
// ✅ 统一返回 Result<T> 包装类
public class Result<T> {
    private int code;
    private String message;
    private T data;
}

// ❌ 直接返回裸 POJO（无法统一错误处理）
public User getUser(Long id) { ... }
```

---

## Service 规范

### 事务管理
```java
// ✅ @Transactional 放在实现类方法上
@Service
public class OrderServiceImpl implements OrderService {

    // ✅ 写操作加事务
    @Transactional(rollbackFor = Exception.class)
    public void createOrder(CreateOrderDTO dto) { ... }

    // ✅ 只读查询加 readOnly 优化
    @Transactional(readOnly = true)
    public OrderVO getOrderById(Long id) { ... }
}
```

**⚠️ 事务失效场景**：
- `@Transactional` 方法被同类内部方法调用（AOP 代理失效）
- 方法非 `public`（Spring AOP 不代理）
- 异常被 catch 后未重新抛出（事务不会回滚）
- 默认只回滚 `RuntimeException`，checked 异常需指定 `rollbackFor`

```java
// ❌ 同类内部调用，事务失效
@Service
public class UserServiceImpl {
    public void outer() {
        this.inner();  // 事务不会生效
    }
    @Transactional
    public void inner() { ... }
}

// ❌ 异常被吞，事务不回滚
@Transactional
public void createUser(User user) {
    try {
        mapper.insert(user);
    } catch (Exception e) {
        log.error("insert failed", e);
        // 没有重新抛出，事务照样提交！
    }
}
```

### 依赖注入
```java
// ✅ 构造器注入（推荐，便于单元测试）
@Service
@RequiredArgsConstructor  // Lombok
public class UserServiceImpl {
    private final UserMapper userMapper;
    private final CacheService cacheService;
}

// ⚠️ 字段注入（@Autowired on field）不推荐，无法测试
@Autowired
private UserMapper userMapper;
```

---

## 全局异常处理

```java
// ✅ 统一异常处理
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public Result<Void> handleValidation(MethodArgumentNotValidException ex) {
        String msg = ex.getBindingResult().getFieldErrors().stream()
            .map(e -> e.getField() + ": " + e.getDefaultMessage())
            .collect(joining(", "));
        return Result.fail(400, msg);
    }

    @ExceptionHandler(BusinessException.class)
    public Result<Void> handleBusiness(BusinessException ex) {
        return Result.fail(ex.getCode(), ex.getMessage());
    }

    @ExceptionHandler(Exception.class)
    public Result<Void> handleUnknown(Exception ex) {
        log.error("未知异常", ex);
        return Result.fail(500, "服务器内部错误");
    }
}
```

---

## Spring Bean 规范

- 避免单例 Bean 持有有状态字段（线程不安全）
- 不在 `@PostConstruct` 中做耗时操作（阻塞启动）
- 配置类 `@Configuration` 不应有业务逻辑
- 使用 `@ConditionalOnProperty` 等条件注解做功能开关

---

## 日志规范

```java
// ✅ 使用 SLF4J + Logback，@Slf4j（Lombok）
@Slf4j
@Service
public class UserServiceImpl {
    public void createUser(User user) {
        log.info("创建用户: userId={}, name={}", user.getId(), user.getName());
        // ...
        log.debug("用户详情: {}", user);  // debug 级别放敏感/大对象
    }
}

// ❌ System.out.println
System.out.println("创建用户: " + user);

// ❌ 字符串拼接（未触发时也会执行拼接，性能损耗）
log.debug("用户详情: " + user);

// ✅ 占位符方式（延迟求值）
log.debug("用户详情: {}", user);
```

---

## 检视重点清单（Spring Boot）

- [ ] Controller 是否统一使用 `@Valid` 做参数校验
- [ ] Service 写操作是否加 `@Transactional(rollbackFor = Exception.class)`
- [ ] 事务方法是否存在被内部调用（AOP 失效）
- [ ] `@Transactional` 中异常是否被 catch 后未重新抛出
- [ ] 是否使用构造器注入而非字段注入
- [ ] 是否有统一的 `@RestControllerAdvice` 异常处理
- [ ] 日志是否使用占位符格式
- [ ] 是否存在 `System.out.println`
- [ ] 单例 Bean 是否持有非线程安全的实例变量
- [ ] 接口是否有统一的返回格式包装
