# MyBatis / JPA / ORM 最佳实践参考

## MyBatis 规范

### Mapper 接口与 XML 对应
```java
// ✅ Mapper 接口方法与 XML id 对应
@Mapper
public interface UserMapper {
    User selectById(Long id);
    List<User> selectByCondition(@Param("query") UserQuery query);
    int insert(User user);
    int updateById(User user);
    int deleteById(Long id);
}
```

### XML SQL 规范

**参数引用**：
```xml
<!-- ✅ 预编译参数（防 SQL 注入）-->
<select id="selectById" resultType="User">
    SELECT * FROM t_user WHERE id = #{id}
</select>

<!-- ❌ 字符串拼接（SQL 注入风险）-->
<select id="selectByName">
    SELECT * FROM t_user WHERE name = '${name}'
</select>
```

**动态 SQL**：
```xml
<!-- ✅ 使用 <where> 标签自动处理 AND 前缀 -->
<select id="selectByCondition">
    SELECT * FROM t_user
    <where>
        <if test="name != null and name != ''">
            AND name LIKE CONCAT('%', #{name}, '%')
        </if>
        <if test="status != null">
            AND status = #{status}
        </if>
    </where>
</select>

<!-- ❌ 手动拼接 WHERE 1=1 -->
<select id="selectByCondition">
    SELECT * FROM t_user WHERE 1=1
    <if test="name != null"> AND name = #{name} </if>
</select>
```

**批量操作**：
```xml
<!-- ✅ 批量插入（性能优）-->
<insert id="batchInsert">
    INSERT INTO t_user (name, status) VALUES
    <foreach collection="list" item="item" separator=",">
        (#{item.name}, #{item.status})
    </foreach>
</insert>

<!-- ❌ 循环单条插入（N 次网络往返）-->
<!-- 在 Java 中 for 循环调用 mapper.insert(user) -->
```

### 结果映射

```xml
<!-- ✅ 明确 resultMap 处理字段映射 -->
<resultMap id="UserResultMap" type="User">
    <id property="id" column="id"/>
    <result property="userName" column="user_name"/>
    <result property="createTime" column="create_time"/>
    <!-- 关联对象 -->
    <association property="dept" javaType="Dept">
        <id property="id" column="dept_id"/>
        <result property="name" column="dept_name"/>
    </association>
</resultMap>

<!-- ⚠️ SELECT * 问题：字段变更时可能查到多余字段或丢失字段映射 -->
<!-- ✅ 生产代码应明确列出查询字段 -->
```

---

## N+1 查询问题

### 识别 N+1
```java
// ❌ N+1 反模式：1 次查列表 + N 次查关联
List<Order> orders = orderMapper.selectAll();  // 1 次 SQL
for (Order order : orders) {
    User user = userMapper.selectById(order.getUserId());  // N 次 SQL
    order.setUser(user);
}

// ✅ 方案一：JOIN 一次查询
List<OrderWithUserVO> list = orderMapper.selectAllWithUser();

// ✅ 方案二：先批量查关联数据，再组装
List<Order> orders = orderMapper.selectAll();
Set<Long> userIds = orders.stream().map(Order::getUserId).collect(toSet());
Map<Long, User> userMap = userMapper.selectByIds(userIds).stream()
    .collect(toMap(User::getId, identity()));
orders.forEach(o -> o.setUser(userMap.get(o.getUserId())));
```

### MyBatis 嵌套查询（懒加载陷阱）
```xml
<!-- ⚠️ association/collection 的 select 属性会触发 N+1 -->
<resultMap id="OrderMap" type="Order">
    <association property="user" select="selectUserById"
                 column="user_id" fetchType="lazy"/>
</resultMap>
<!-- 遍历 orders 时每条都触发一次 selectUserById -->
```

---

## JPA / Hibernate 规范

### Entity 设计
```java
@Entity
@Table(name = "t_user")
public class User {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    // ✅ 字段映射明确
    @Column(name = "user_name", nullable = false, length = 50)
    private String userName;

    // ✅ 时间字段用 LocalDateTime
    @Column(name = "create_time")
    private LocalDateTime createTime;
}
```

### 懒加载陷阱
```java
// ❌ 在事务外访问懒加载字段（LazyInitializationException）
User user = userRepository.findById(id).get();  // 事务结束
user.getOrders().size();  // 此处抛异常

// ✅ 在事务内访问，或使用 @EntityGraph 指定加载策略
@EntityGraph(attributePaths = {"orders"})
Optional<User> findWithOrdersById(Long id);
```

### JPQL 规范
```java
// ✅ 具名参数
@Query("SELECT u FROM User u WHERE u.name = :name")
List<User> findByName(@Param("name") String name);

// ❌ 位置参数（容易出错）
@Query("SELECT u FROM User u WHERE u.name = ?1")
```

---

## 分页查询规范

```java
// ✅ MyBatis + PageHelper
PageHelper.startPage(pageNum, pageSize);
List<User> list = userMapper.selectAll();
PageInfo<User> pageInfo = new PageInfo<>(list);

// ✅ JPA Pageable
Page<User> page = userRepository.findAll(PageRequest.of(pageNum - 1, pageSize));

// ❌ 内存分页（全量查出再截取）
List<User> all = userMapper.selectAll();
List<User> page = all.subList((pageNum-1)*pageSize, pageNum*pageSize);
```

---

## SQL 优化基础

### 索引使用
- 查询条件字段（WHERE/JOIN ON）必须有索引
- 联合索引遵循最左前缀原则
- 避免索引失效：`LIKE '%xxx'`、`OR` 条件、对字段做函数运算

### 查询优化
```sql
-- ❌ SELECT *（查多余字段，无法使用覆盖索引）
SELECT * FROM t_order WHERE user_id = ?

-- ✅ 按需查字段
SELECT id, order_no, status, amount FROM t_order WHERE user_id = ?

-- ❌ NOT IN（大数据集性能差）
SELECT * FROM t_user WHERE id NOT IN (SELECT user_id FROM t_ban)

-- ✅ LEFT JOIN ... WHERE IS NULL
SELECT u.* FROM t_user u
LEFT JOIN t_ban b ON u.id = b.user_id
WHERE b.user_id IS NULL
```

---

## 检视重点清单（ORM/SQL）

- [ ] XML 中是否有 `${...}` 拼接参数（SQL 注入风险）
- [ ] 是否存在 N+1 查询（循环内调用 Mapper）
- [ ] 批量操作是否用 `foreach` 而非循环单条
- [ ] `SELECT *` 是否替换为具体字段
- [ ] 分页是否使用 PageHelper/Pageable 而非内存分页
- [ ] 动态 SQL 是否用 `<where>`/`<set>` 标签
- [ ] JPA 是否存在懒加载在事务外访问
- [ ] 大查询是否有必要的索引支撑
