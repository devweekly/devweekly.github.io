---
author: SW
pubDatetime: 2026-11-24T00:00:00Z
title: "Palantir Ontology SQL GA：让业务对象成为 SQL 的查询对象"
featured: false
draft: false
tags:
  - Palantir
  - Foundry
  - Ontology
  - SQL
  - Data Architecture
  - Enterprise Architecture
  - AI Agent
description: "拆解 Palantir Ontology SQL 与 SQL Functions GA：对象和关系如何映射为 SQL、查询怎样进入 Object Storage 与 Spark、函数如何发布复用，以及这套设计对企业数据平台和 Agent 的意义。"
---

# Palantir Ontology SQL GA：让业务对象成为 SQL 的查询对象

**研究截止日期：2026 年 11 月 24 日**

Palantir 在 2026 年 11 月 12 日宣布 Ontology SQL 与 SQL Functions 正式 GA。Ontology SQL 允许使用 Spark SQL 方言的一个子集查询 Ontology 中的 Object Types、Interfaces 和 Many-to-Many Links；SQL Functions 则把带参数的查询发布为 Foundry Function，供 Workshop、Actions、Automate 和 Ontology SDK 等组件复用。

这条消息值得关注的原因不在于 Foundry 又增加了一种 SQL 编辑器。SQL Studio 早已同时支持 Dataset 和 Ontology 查询，背后分别由 Furnace 与 Ontology SQL 两个引擎处理。此次 GA 的重点，是 Ontology SQL 和 SQL Functions 从预览能力进入正式可用状态。

更重要的是它改变了 Ontology 的使用方式：开发者不必总是通过 Object Set API、专用 SDK 或应用函数逐步拼接对象查询，可以直接用 SQL 表达关系查询；一段查询也可以发布成平台级业务函数，让多个应用共享同一份查询逻辑。

但不要把它理解成“Palantir 把 Ontology 变成了一个普通关系数据库”。Ontology SQL 有自己的数据提供器、查询规划和执行路径，底层仍然是 Ontology 对象模型与 Object Storage。它只支持查询，不负责修改对象；它也不是完整的 Spark SQL，更不是替代 Snowflake、PostgreSQL 或通用数据仓库的新数据库。

## 1. Ontology SQL 到底查询什么？

先把 Ontology 和关系数据库的差别说清楚。

假设一个金融机构在 Ontology 中定义了四种对象：

| Object Type | 典型属性 |
| --- | --- |
| Customer | customerId、name、riskLevel |
| Account | accountId、balance、status |
| Transaction | transactionId、amount、timestamp |
| Employee | employeeId、department |

对象之间还存在关系，例如 Customer 拥有 Account，Account 关联 Transaction，Employee 负责 Customer。对象类型、属性和关系来自 Ontology Manager 中的定义，背后可以由不同 Dataset、数据源和索引过程支撑。

传统应用通常通过对象查询接口逐步完成这些操作：先找 Customer，再沿关系查 Account，最后查 Transaction，随后在应用代码中聚合金额。Ontology SQL 把这类查询表达为一条 SQL：

```sql
SELECT
    c.customerId,
    c.name,
    COUNT(t.transactionId) AS transaction_count,
    SUM(t.amount) AS total_amount
FROM customer_object AS c
JOIN account_object AS a
    ON a.customerId = c.customerId
JOIN transaction_object AS t
    ON t.accountId = a.accountId
WHERE c.riskLevel = 'HIGH'
  AND t.timestamp >= '2026-10-01'
  AND t.timestamp <  '2026-11-01'
GROUP BY c.customerId, c.name;
```

上面是关系查询的逻辑示意，`customer_object` 等名称用于帮助理解，不是可以直接复制到 Foundry 的真实表名。实际 Ontology SQL 使用 Object Type RID 引用对象类型；列名使用 Ontology Property 的 API name，而不是 UI 中的显示名称。下面会给出官方语法。

这点很重要：SQL 查询面对的是 Ontology 中定义的业务对象，而不是要求开发人员重新找到并 JOIN 每一张底层数据集。底层数据如何进入 Ontology、如何建立索引以及如何关联数据源，仍由 Foundry 的数据接入和 Ontology 后端负责。

## 2. SQL 与 Ontology 对象模型如何映射？

Ontology SQL 不是把每个 Object Type 导出成一张临时表。它在 SQL 引擎内部增加了 Ontology 专用 Data Providers，将对象模型转换成 SQL 查询规划可以使用的关系结构。

### 2.1 Object Type 映射为 SQL 表引用

对象类型通过 RID 引用：

```sql
SELECT
    employeeId,
    firstName,
    department
FROM `ri.ontology.main.object-type.<employee-object-type-rid>`;
```

这里有几个约束：

- `<employee-object-type-rid>` 是 Ontology Manager 中对象类型的实际 RID，示例中的占位符需要替换。
- 查询字段使用 Property API name，例如 `employeeId`，而不是显示标签。
- Object Type 需要在 Ontology Manager 中定义。
- Object Type 的列结构由 Ontology 元数据决定，不是用户在 SQL 中自行建表。

这和直接查询 Dataset 有本质区别。Dataset SQL 面向数据集资源；Ontology SQL 面向经过 Ontology 建模的对象类型。两者可以在 SQL Studio 使用相近的语法和编辑体验，但不是同一个查询引擎。

### 2.2 一对一和一对多关系不要求先创建 Link Table

一对一和一对多关系可以直接使用 SQL JOIN。官方文档明确说明，这类关系不要求先在 Ontology Manager 中定义 Link Type；查询时可以按照业务键或外键字段进行关联。是否把这种关联登记为 Ontology Link，不改变 SQL JOIN 的性能语义。

例如，Account 对象中有 `customerId` 属性：

```sql
SELECT
    c.customerId,
    c.name,
    a.accountId,
    a.balance
FROM `ri.ontology.main.object-type.<customer-rid>` AS c
JOIN `ri.ontology.main.object-type.<account-rid>` AS a
  ON a.customerId = c.customerId
WHERE c.riskLevel = 'HIGH';
```

这里的 JOIN 条件由对象属性表达。SQL 并不要求每个 JOIN 都必须对应一条 Ontology Link。

### 2.3 多对多关系必须有 Ontology Link 定义

多对多关系不同。它需要在 Ontology Manager 中定义 Link Type，SQL 查询时使用对应的 Relation RID。

官方文档以 Person 和 Car 为例。Person 的 Link API name 是 `vehicles`，Car 侧的 Link API name 是 `drivers`。关系表中的外键列名按 `<objectTypeApiName>_<relationApiName>` 组织：

```sql
SELECT c.*
FROM `ri.ontology.main.relation.<person-car-relation-rid>` AS linkTable
JOIN `ri.ontology.main.object-type.<car-rid>` AS c
  ON c.carId = linkTable.person_vehicles
WHERE linkTable.car_drivers = 'person-123';
```

这条查询找出指定 Person 驾驶的 Car。关系表不是让开发者自行在数据库中创建的物理表，而是 Ontology SQL 对已定义 Many-to-Many Link 提供的 SQL 查询入口。

官方建议在查询多对多关系时使用表别名，否则两个方向的外键字段容易混淆。

### 2.4 Interfaces 也可以作为查询对象

Ontology SQL 支持 Interfaces。它们提供跨 Object Type 的共同属性契约，使查询可以面向接口表达，而不是把每种具体对象类型都写死在查询中。

这对大型 Ontology 有实际意义：业务概念可能由多个对象类型实现。Interface 允许上层查询围绕共同语义组织，而不是让每个应用重复维护对象类型之间的判断逻辑。

需要注意，接口支持不代表 SQL 可以随意访问所有 Ontology 元数据。可查询的实体、属性和关系仍受 Ontology 定义与权限控制。

## 3. 查询到底怎样执行？

Ontology SQL 的实现重点在后端。Palantir 没有为 Ontology 重新维护一套完全独立的 SQL 语言，而是复用 Foundry SQL 基础设施中的解析层和 Spark SQL 方言，再为 Ontology 数据建立专门的查询规划与执行路径。

![Ontology SQL 查询执行与 SQL Function 发布架构](/diagrams/palantir-ontology-sql/ontology-sql-architecture.svg)

*图：SQL 入口、Ontology 专用数据提供器、Object Set Service 和计算引擎的关系。[打开 HTML 版本](/diagrams/palantir-ontology-sql/ontology-sql-architecture.html)。*

### 3.1 共享解析层，专用查询后端

Foundry 的 SQL 产品共享 Spark SQL 方言和 SQL 解析基础设施。SQL Studio 中，Data mode 查询 Dataset，由 Furnace 执行；Object mode 查询 Ontology 对象，由 Ontology SQL 执行。

这种拆分让语法、编辑器和开发体验保持一致，同时避免把 Dataset 的执行模型直接套在 Ontology 对象上。

Ontology SQL 引入专用 Data Providers，负责把 Object Type 属性、主键、多对多关系等 Ontology 概念转换为 SQL 可用的表结构。解析器得到 SQL 语法结构之后，后端根据 Ontology 元数据构建对应的查询计划。

因此，它不是简单地将 SQL 翻译成一串 Object Set API 调用。官方描述的是一套专门的查询引擎：负责解析、规划、优化并执行针对 Ontology 的 SQL。

### 3.2 查询直接访问 Object Storage

Ontology SQL 的查询直接针对 Foundry Object Storage 执行，使用的也是 Object Set 等 Ontology 操作所依赖的对象存储层。官方强调，这条路径不需要先把对象数据导出到另一个中间数据集再查询。

这也是它和“把 Ontology 定期同步到数据仓库，再用 SQL 查询”的做法不同的地方。后者会增加数据复制、同步延迟和模型映射维护；Ontology SQL 在查询时使用当前 Ontology 对象数据及其元数据。

需要区分数据源和对象存储：Ontology 对象可能由 Dataset、Restricted View 或流式数据源等支撑，Object Data Funnel 等组件负责把来源数据索引到对象存储。Ontology SQL 查询的是已建立的对象存储视图，不会在每次查询时重新读取所有源系统。

### 3.3 Object Set Service 负责选择执行引擎

查询计划形成后，Object Set Service（OSS）根据查询形态决定由哪个 Compute Engine 执行。

官方公布了两类执行路径：

| 执行路径 | 适用情况 |
| --- | --- |
| Object Storage 上的 In-memory Compute | 已支持的查询形态，减少执行开销 |
| Spark | 更复杂的查询，由系统自动路由 |

这不是用户在 SQL 中指定 `USE SPARK` 或手动切换执行引擎，而是查询执行层根据计划和资源约束选择路径。官方没有公布完整的路由规则，也没有给出每种 JOIN、聚合或函数表达式对应的引擎矩阵。因此不能简单断言“所有简单 JOIN 都走内存”或“所有 GROUP BY 都走 Spark”。

这种 Compute Engine Abstraction 的价值在于：SQL 接口与具体执行引擎解耦。引擎可以按查询复杂度、资源管理和性能优化逐步演进，而调用方不必更换 SQL 接口。

### 3.4 Object Storage v2 是当前前提

Ontology SQL 目前只支持 Object Storage v2。理解这一点很重要，因为 SQL 引擎不是独立于 Ontology 后端的通用查询层。

Object Storage v2 将对象索引、查询和写入等职责拆分到不同服务中。OSS 负责从 Ontology 提供读取服务，对象数据库负责存储和索引对象数据，Object Data Funnel 负责把数据源与用户编辑写入对象存储。Ontology SQL 运行在这套后端体系之上。

如果一个环境仍然依赖旧的 Object Storage v1（Phonograph），不能因为 SQL Studio 可用就认为 Ontology SQL 一定可用；需要先确认对象类型已经迁移到 Object Storage v2。

## 4. SQL Functions：把查询变成可复用的业务接口

单独支持 SQL，主要改善的是查询表达和开发效率。SQL Functions 则把查询逻辑带入 Foundry 的函数体系。

### 4.1 用 DECLARE 定义参数

Ontology SQL 使用 `DECLARE` 声明参数：

```sql
DECLARE
    @riskLevel STRING = 'HIGH',
    @minBalance DOUBLE = 100000.0;

SELECT
    customerId,
    accountId,
    balance
FROM `ri.ontology.main.object-type.<account-rid>`
WHERE riskLevel = @riskLevel
  AND balance >= @minBalance;
```

发布时，参数会成为函数的输入。测试查询时可以使用默认值；正式调用时由调用方传入参数。

参数并不是任意 SQL 片段。Literal 参数只能承载 SQL 方言支持的字面量类型，例如字符串、数字和布尔值，并且只能出现在 SQL 语法允许字面量的位置。调用方不能通过参数传入一段 WHERE、JOIN 或任意 SQL 表达式。这既限制了函数的动态能力，也避免把 SQL 拼接当成参数化查询。

ObjectSet 参数是另一种形式，只能放在 `FROM` 子句中，用于把对象集合传给查询。

### 4.2 发布与调用

函数的创建流程是：

1. 在 SQL Studio 的 Object mode 编写查询。
2. 保存 Worksheet 到项目。
3. 使用 Publish 发布为 Ontology SQL Function。
4. 为函数定义名称和 API name。
5. 在 Ontology Manager 中查看和管理已发布函数及其版本。
6. 在支持 Ontology Function 的应用和代码中调用。

SQL Function 的返回类型由 SELECT 列决定。选择多个列时，每行返回一个 Struct，整个结果是 `List<Struct<...>>`；只选择一个列时，返回对应类型的 List。

例如：

```sql
SELECT customerId, accountId, balance
FROM `ri.ontology.main.object-type.<account-rid>`
WHERE balance >= @minBalance;
```

对应的结果形状类似：

```text
List<Struct<
  customerId: STRING,
  accountId: STRING,
  balance: DOUBLE
>>
```

发布后，SQL Function 可以在 Workshop、Actions、Automate 和 Ontology SDK 中复用，也可以从 TypeScript Functions 和 Python Functions 调用。它还支持在 Branch 和 Scenario 上查询。

这和把 SQL 文本复制到多个应用里有明显区别。查询逻辑有统一的 API name 和发布版本，调用方依赖的是函数契约，而不是各自维护一份 SQL 字符串。

### 4.3 它不是 Stored Procedure，也不是 Action

SQL Function 是只读查询。它不能通过 INSERT、UPDATE 或 DELETE 修改 Ontology，也不能在函数里执行写入外部系统的副作用。

如果业务需要修改对象，应使用 Actions 等受控写入机制。可以把两者理解为不同职责：

| 能力 | 负责什么 |
| --- | --- |
| Ontology SQL | 查询对象和关系 |
| SQL Function | 把只读查询发布为可复用函数 |
| Action | 在权限、校验和业务约束下修改对象 |
| Workshop / Automate | 组织用户交互和流程 |
| OSDK / Functions | 在应用代码中使用 Ontology 能力 |

不要因为 SQL Function 可以被 Actions 调用，就认为 SQL Function 本身具有写权限。查询和修改的边界仍然存在。

## 5. 权限、安全与查询边界

SQL 是一个新的访问入口，不代表 Ontology 的权限模型被绕过。

Foundry 的 SQL 权限控制查询入口和 Worksheet 等操作；访问 Ontology 对象仍然遵循对象类型的标准 Ontology 权限。SQL 权限本身不会自动授予底层资源的读取权限。用户需要同时具备运行 SQL 所需的权限，以及查询所引用资源的正常访问权限。

因此，同一条查询在不同用户身份下可能得到不同结果。不能因为 SQL 查询在 SQL Studio 中成功，就推断它可以被一个没有对象读取权限的 Agent 或应用执行。

对 SQL Functions 也要保留这一原则：发布函数解决的是查询逻辑复用，不是把权限检查从调用链中删除。部署时应分别检查函数可见性、调用方权限和对象数据读取权限。

### 5.1 当前限制

GA 并不意味着 Ontology SQL 已经覆盖完整 Spark SQL 或关系数据库能力。根据官方文档，目前需要注意这些边界：

| 项目 | 当前边界 |
| --- | --- |
| SQL 操作 | 只读 SELECT |
| 语句数量 | 单条 SELECT，可在前面使用一次 DECLARE |
| DDL / DML | 不支持 CREATE、ALTER、DROP、INSERT、UPDATE、DELETE |
| Dataset 与 Ontology 混合查询 | 不支持在同一查询中混合 |
| 输出行数 | Ontology SQL 服务最多返回 10,000 行 |
| 查询超时 | 20 秒 |
| 资源排队 | OSS Spark 资源紧张时可能排队，文档描述最长 6 秒 |
| 存储后端 | 仅 Object Storage v2 |
| Object Set | 可作为部分前端支持的查询输入，不能直接作为查询输出 |

SQL Studio 的默认结果预览为 1,000 行，有相应权限时可以调整到 10,000 行。需要区分 SQL 服务结果限制和编辑器默认预览限制，它们不是同一件事。

SQL 方言也是 Spark SQL 的一个子集。不能因为两个引擎共享解析层，就假设所有 Spark SQL 函数和表达式都已经支持。Palantir 在 GA 公告中仍将扩展 Spark SQL 函数支持、进一步降低查询延迟、改善查询规划和执行可观测性列为后续工作。

### 5.2 性能优化要遵循对象存储的查询特征

官方特别提醒：尽量不要在 WHERE 条件中对被过滤字段做函数转换，否则查询引擎无法利用索引有效定位数据。

不推荐：

```sql
SELECT employeeId, hireDate
FROM employee
WHERE YEAR(hireDate) = 2026;
```

更合适的写法：

```sql
SELECT employeeId, hireDate
FROM employee
WHERE hireDate >= '2026-01-01'
  AND hireDate < '2027-01-01';
```

类似地，使用 `salary + bonus` 这样的计算表达式过滤，也可能使索引无法发挥作用。应尽量让过滤条件直接作用于原始属性。

这说明 Ontology SQL 并不是把所有查询都交给一个通用关系执行器。数据模型和索引仍然来自 Ontology 后端，SQL 写法需要考虑其访问特征。

## 6. 与传统数据平台相比，架构发生了什么变化？

可以从查询对象、关系维护和业务逻辑复用三个方面比较。

| 维度 | 传统数据仓库查询 | Ontology SQL |
| --- | --- | --- |
| 查询对象 | Dataset、Table、View | Ontology Object Type、Interface、Link |
| 关系 | 外键、JOIN、视图 | 属性关联与 Ontology Link |
| 业务语义 | 常在数据模型、指标层或应用中维护 | 集中定义在 Ontology |
| 执行后端 | 数据仓库或 SQL Engine | Object Storage 上的内存路径，复杂查询转 Spark |
| 复用方式 | View、Stored Procedure、API | SQL Function / Ontology Function |
| 写入 | 数据库 DML 或数据管道 | Actions 等 Ontology 写入能力 |

Ontology SQL 并没有消除数据建模工作，也没有自动解决不同系统的主数据冲突。它的前提仍然是：组织已经把业务实体、属性、关系和权限正确建模到 Ontology。

如果对象类型的主键不稳定、Link 定义错误、属性语义不一致，SQL 只会更方便地查询这些错误。Ontology 不是免建模工具，而是让业务语义模型能够被更多应用和查询入口共同使用。

## 7. 对企业 AI Agent 的影响

SQL 是 Agent 比较容易理解和生成的接口，但让 Agent 直接生成 SQL 并不等于完成了企业级数据访问设计。

Ontology SQL 提供了一条新的访问路径：Agent 可以通过 SQL Studio 中的 AI 辅助查询、Ontology MCP Server 或已发布的 SQL Functions 使用 Ontology 数据。相较于让 Agent 理解多种 Object Set API 和 Link 调用方式，SQL 更适合表达筛选、关联、聚合等查询任务。

例如，用户提出：

> 找出过去 30 天交易金额超过 100 万、关联高风险客户的账户。

Agent 可以根据 Ontology 的对象结构生成查询，或者调用已经发布的高风险账户查询函数。前者灵活，后者更容易控制和审查。

### 7.1 自由 SQL 与预定义 Function 应该并存

两种方式适合不同任务：

| 方式 | 适合场景 | 主要风险 |
| --- | --- | --- |
| Agent 生成 Ontology SQL | 临时探索、分析、低频问题 | 查询范围、性能和结果解释需要审查 |
| Agent 调用已发布 SQL Function | 高频业务查询、固定指标、标准化规则 | 函数契约和版本需要治理 |

对于低风险探索任务，可以让 Agent 生成只读 SQL，并限制执行资源、结果规模和可访问对象范围。对于高频或业务关键查询，应优先发布 SQL Function，让参数、返回结构和版本成为可管理的契约。

这并不意味着预定义函数就天然安全。函数发布后仍然需要检查权限、输入约束、数据范围和调用方；只读也不等于没有风险，敏感数据被读取和汇总本身就可能造成泄露。

### 7.2 查询和写入要分开治理

Agent 可以使用 Ontology SQL 读取对象，但修改对象应走 Actions。这样可以把查询自由度和业务写入控制分开：

- SQL 负责回答“哪些对象符合条件”。
- SQL Function 负责复用稳定的只读查询。
- Action 负责执行经过授权和校验的状态变更。
- Agent 负责理解意图、选择工具、组织流程，并把执行结果反馈给用户。

例如，Agent 可以查询所有符合条件的账户，再生成一份待审核清单；真正冻结账户时，应调用受控 Action，而不是让 Agent 尝试拼接 UPDATE 语句。

这种分工比给 Agent 一个可以直接操作所有底层表的数据库连接更符合企业系统的治理要求。

### 7.3 Ontology SQL 与 MCP 的结合

Foundry 的 SQL Studio 文档说明，Ontology SQL 可以通过 Ontology MCP Server 暴露给兼容 MCP 的客户端。这让外部 Agent 有机会通过统一工具协议访问 Ontology SQL，而不必自行实现一整套平台 API 适配。

但需要区分协议与权限：MCP 解决工具发现和调用接口，不能替代 Ontology 的身份认证、对象授权、查询限制和审计。Agent 能否看到某个对象，仍然应由 Foundry 的权限模型决定。

对 Agent 平台的设计者来说，值得借鉴的不是“让 Agent 自由写 SQL”，而是把查询接口、业务函数和写入 Action 分成不同的能力等级。SQL Function 是受控查询能力，Action 是受控写入能力；二者都应该有明确的输入输出和权限边界。

## 8. 它对企业数据架构意味着什么？

Ontology SQL 并没有取代数据仓库，也没有把所有业务逻辑搬进 SQL。它补上的是业务对象模型与关系查询之间的接口。

传统架构中，企业经常同时维护三套模型：

1. 数据仓库中的事实表、维度表和指标定义。
2. 应用中的领域对象、关系和业务规则。
3. API 或服务层中的查询逻辑和聚合逻辑。

这三套模型不可避免地存在重复。业务对象的定义可能在应用 ORM 中一份、数据仓库中一份、API DTO 中又一份。即使有统一的数据目录，也不代表应用能够直接使用同一套业务关系。

Ontology 的目标是把对象、属性、关系、动作和权限集中到一个可执行的业务模型中。Ontology SQL 让这个模型可以通过 SQL 查询；SQL Functions 则把常用查询提升为平台函数。查询入口与应用逻辑因此更容易共享同一套业务语义。

不过，是否应该把企业全部数据模型迁入 Ontology，需要看数据访问模式和业务价值。大型离线分析、复杂 ETL、跨域数据探索、训练数据准备，仍然可能更适合 Snowflake、Spark 或其他分析引擎。Ontology SQL 当前的单条 SELECT、20 秒超时和 10,000 行结果上限，也说明它不是为替代大规模离线计算而设计的。

更合理的分工是：

- 数据仓库负责大规模历史分析、数据加工和跨域统计。
- Ontology 负责可操作的业务对象、关系、权限和业务状态。
- Ontology SQL 负责对这些对象进行关系查询。
- SQL Functions 负责发布可复用的只读业务查询。
- Actions 负责受控写入。
- Agent 和应用通过统一的业务接口完成交互。

## 9. 采用时需要评估什么？

如果企业正在评估 Foundry Ontology SQL，不应只做 SQL 语法兼容性测试。至少需要确认：

**对象模型是否适合查询。** Object Type 的主键、属性 API name、Interface 和 Link 定义是否稳定？多对多关系是否已在 Ontology Manager 中正确建模？

**后端是否满足前提。** 相关对象类型是否运行在 Object Storage v2？数据索引延迟、对象规模和更新频率是否满足应用要求？

**查询是否符合执行边界。** 典型查询能否在 20 秒内完成？是否需要超过 10,000 行？复杂 JOIN 和聚合是否会进入 Spark 路径？过滤条件能否利用索引？

**权限是否能沿调用链保持。** SQL Studio、MCP 客户端、Workshop、SQL Function 和 Action 的访问身份是否清楚？不同用户调用同一函数时，是否只返回其有权访问的对象？

**函数是否值得发布。** 哪些查询是跨应用重复使用的稳定业务逻辑？参数是否足够明确？返回结构是否适合调用方？函数版本变化会不会影响已有应用？

**Agent 是否需要自由查询。** 对于探索性问题，可以考虑让 Agent 生成只读 SQL；对于固定业务规则，应优先提供 SQL Function；任何状态修改都应走 Action，并由独立权限和业务校验控制。

## 10. 如果自己实现，选 PostgreSQL 还是 Snowflake？

前面的架构分析可以进一步落到一个实际问题：如果不使用 Foundry，而是基于现有数据库搭建一套具备 Object Type、Link、SQL 查询和可复用查询函数的系统，应该选什么？

**我的建议是 PostgreSQL。** 如果目标是实现一个可运行的 Ontology Engine，而不是只给数据仓库增加语义查询能力，PostgreSQL 更适合作为第一版的核心存储和查询引擎。Snowflake 也能做，但它更适合以分析数据为中心的 Semantic Layer，或者作为 Ontology 的分析侧，而不是默认承担全部对象运行时职责。

### 10.1 两者解决的问题并不相同

Snowflake 已经有 Semantic Views。它们可以把物理表组织成逻辑表，定义实体之间的关系、Dimensions、Facts 和 Metrics。Cortex Agents 可以读取 Semantic View 中的定义，再针对底层物理表生成 SQL。

这和 Ontology 有交集，但不是同一层东西。Semantic View 主要解决分析语义一致性：业务人员说的 Customer、Revenue、Order，如何映射到仓库里的表、字段和指标。它并不因此成为一个包含对象状态、对象写入、Action、细粒度对象授权和业务流程的完整 Operational Object Store。

Snowflake 也不是完全不能做操作型数据。Hybrid Tables 使用行存储和索引，支持低延迟随机读写、高并发事务，以及主键、唯一键和外键等约束；它们可以和标准分析表在同一个查询引擎中联合使用。因此，不能简单地说 Snowflake 只能做 OLAP。

问题在于，Hybrid Tables 是 Snowflake 中为轻量事务型工作负载增加的一种表类型，而不是一个现成的 Ontology Engine。要实现对象元数据、对象类型版本、关系索引、对象权限、Action 事务和函数注册，仍然需要自己开发大量服务。

PostgreSQL 则天然提供了实现这些能力所需的基础设施：关系模型和事务、索引、视图、函数、JSONB、Row-Level Security，以及成熟的 SQL 查询规划器。它不直接提供 Ontology，但可以在数据库之上建立一层元数据驱动的对象模型，并让原生 SQL Planner 执行查询。

| 比较维度 | PostgreSQL | Snowflake |
| --- | --- | --- |
| 核心优势 | OLTP、事务、关系查询、应用后端 | 分析计算、数据仓库、统一指标和语义查询 |
| 对象存储 | 原生关系表，也可结合 JSONB | Hybrid Tables 可承担轻量事务对象数据 |
| 关系模型 | 外键、JOIN、索引、事务原生支持 | Semantic View 定义逻辑关系；Hybrid Table 支持受约束的物理关系 |
| 动态属性 | JSONB、表达式索引、GIN | VARIANT 等半结构化类型，但 Hybrid Table 索引有类型限制 |
| 权限 | GRANT、RLS、视图和函数权限 | RBAC、Row Access Policy、Masking Policy |
| 可复用查询 | SQL Function、View、应用层函数注册 | Semantic View、UDF、Stored Procedure、Table Function |
| 业务写入 | 事务、约束、锁、函数 | Hybrid Table 支持事务型 DML |
| 典型定位 | Ontology Runtime 的核心数据库 | Semantic Analytics，或混合型分析/轻事务平台 |

### 10.2 PostgreSQL：用原生数据库能力实现一个轻量 Ontology Engine

不建议一开始就自己实现 SQL Parser、Query Optimizer 或执行引擎。PostgreSQL 已经有成熟的 SQL 解析、规划和执行能力。真正需要开发的是：如何把 Ontology 元数据映射为数据库可查询的关系结构。

可以把实现拆成四部分。

**第一部分：Ontology Metadata Registry。**

用普通关系表保存模型定义：

- \`object_type\`：对象类型、API name、主键、版本和状态。
- \`property_definition\`：属性名、数据类型、是否可空、是否可查询以及索引配置。
- \`link_type\`：关系两端的对象类型、基数和关系 API name。
- \`interface_definition\`：接口及其共同属性。
- \`function_definition\`：SQL Function 的参数、返回结构、版本和权限。
- \`action_definition\`：允许修改哪些对象、属性和状态，以及相应校验规则。

这些元数据是系统的模型来源。对象类型的变化应先经过模型版本和兼容性检查，再生成数据库变更，而不是让业务开发人员直接修改底层表结构。

**第二部分：Object Store。**

这里有两种实现方式，不应该混为一谈。

一种是通用对象表：

\`\`\`sql
CREATE TABLE ontology_object (
    tenant_id   UUID NOT NULL,
    object_type TEXT NOT NULL,
    object_id   TEXT NOT NULL,
    properties  JSONB NOT NULL,
    version     BIGINT NOT NULL DEFAULT 1,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, object_type, object_id)
);

CREATE INDEX ontology_object_properties_gin
    ON ontology_object USING GIN (properties);
\`\`\`

这种方式适合早期原型和对象类型变化频繁的场景。JSONB 可以保存动态属性，GIN 索引支持一部分包含、存在性和 JSONPath 查询。但它并不意味着所有属性查询都能获得良好性能：不同属性的数据类型、排序、范围查询和 JOIN 都需要额外设计。

另一种是按 Object Type 建立物理关系表。例如 Customer、Account、Transaction 分别有自己的表，主键和常用属性使用真实的 SQL 类型与 B-tree 索引。这更接近关系数据库的强项，也更容易让 PostgreSQL Planner 做 JOIN、过滤和聚合。

**实际建议采用混合方式：** 元数据集中管理；高频、稳定、需要 JOIN 或范围查询的属性使用类型化列；低频、变化快的扩展属性才放入 JSONB。对象类型可以由模型管理服务生成或迁移物理表，再生成面向 SQL 用户的稳定 View。不要为了追求一个通用表而把所有属性都塞进 JSONB。

多对多关系使用独立关系表，例如 \`customer_account_link\`，保存两端对象 ID、关系类型和必要的有效期属性，并为两端分别建立索引。一对多关系可以通过外键或对象属性 JOIN。Interface 可以在第一版中通过具有统一列结构的 View 或 UNION View 暴露，不需要先实现复杂的多态执行引擎。

**第三部分：SQL Query Layer。**

第一版直接使用 PostgreSQL 原生 SQL 和 Planner。通过生成的 View 把对象类型映射成 SQL 表，通过关系表暴露 Link，通过 Interface View 暴露公共属性。这样开发人员可以直接写普通 SELECT、JOIN、GROUP BY。

例如，内部物理表可以是 \`ontology_customer\` 和 \`ontology_account\`，对外暴露稳定的对象查询视图：

\`\`\`sql
CREATE VIEW customer_object AS
SELECT
    tenant_id,
    customer_id,
    name,
    risk_level
FROM ontology_customer;

CREATE VIEW account_object AS
SELECT
    tenant_id,
    account_id,
    customer_id,
    balance,
    status
FROM ontology_account;
\`\`\`

调用方查询：

\`\`\`sql
SELECT
    c.customer_id,
    c.name,
    a.account_id,
    a.balance
FROM customer_object AS c
JOIN account_object AS a
  ON a.tenant_id = c.tenant_id
 AND a.customer_id = c.customer_id
WHERE c.risk_level = 'HIGH'
  AND a.balance >= 100000;
\`\`\`

这已经实现了 Ontology SQL 最核心的体验：使用业务对象名称和属性进行 SQL 查询，而不需要调用方了解内部物理表的组织方式。

但这里有一个边界：PostgreSQL View 只是对象模型的 SQL 投影，不会自动获得 Palantir 那种 Object Set、Branch、Scenario 或动态对象权限能力。后续如果需要支持 RID 引用、复杂 Object Set 参数、接口多态和查询计划路由，再增加 SQL AST 解析和 Ontology-aware Planner；不应在 MVP 阶段重写一个 SQL 引擎。

**第四部分：SQL Functions 和 Actions。**

SQL Function 不必一开始就动态创建大量数据库函数。可以在 Registry 中保存函数定义：函数 API name、参数类型、默认值、SQL 模板、返回列结构、版本和授权策略。发布时验证 SQL AST，只允许只读查询和批准的对象范围；执行时使用参数化绑定，而不是拼接用户输入。

对于固定、稳定且确实需要数据库内调用的函数，可以生成 PostgreSQL SQL Function。对于需要统一版本、审计、灰度发布和跨服务调用的函数，应用层 Function Registry 往往更容易治理。PostgreSQL 的 \`CREATE FUNCTION\` 已支持参数、默认值、表格返回类型和权限执行上下文，但 \`SECURITY DEFINER\` 必须谨慎使用，并明确设置安全的 \`search_path\`。

对象修改则走独立 Action Service。Action 负责权限检查、前置条件、事务更新、版本校验和审计记录。不要让只读 SQL Function 兼任写入接口，也不要把任意 SQL DML 暴露给 Agent。

### 10.3 PostgreSQL 的权限不能只靠应用层过滤

如果多个业务用户或 Agent 共用一个数据库连接池，仅在 API 层拼接 \`WHERE tenant_id = ?\` 不够。某条路径遗漏过滤条件，就可能跨租户读取数据。

PostgreSQL Row-Level Security 可以把行级访问规则放在数据库中。开启 RLS 后，没有匹配策略的访问默认拒绝；策略可以按角色和 SELECT、INSERT、UPDATE、DELETE 等命令分别定义。

不过，RLS 也有容易被忽略的边界：表所有者通常绕过策略，超级用户和具有 \`BYPASSRLS\` 属性的角色始终绕过策略。使用连接池时，需要在每个事务开始时可靠地设置当前用户和租户上下文，并确保应用连接角色不是表所有者，也没有绕过 RLS 的权限。必要时使用 \`FORCE ROW LEVEL SECURITY\`，并测试连接复用、异常回滚和上下文清理。

还要注意 View 的执行身份：PostgreSQL 15 及以上可以为 View 设置 `security_invoker = true`，让底层权限和 RLS 按调用者身份执行；否则默认 View 权限语义可能让底层访问按 View owner 的权限判断。对外暴露的 View 应明确选择执行身份，并针对 owner、普通用户和连接池角色做权限测试。PostgreSQL 新建函数默认可能向 `PUBLIC` 授予 EXECUTE，发布函数时也应显式 `REVOKE` 默认权限，再只授权给目标角色。\n\nRLS 解决的是行级授权，不等于完整的 Ontology Security。属性级脱敏、对象类型级权限、关系访问权限、Action 授权和审计仍然需要明确设计。

### 10.4 Snowflake：适合把 Semantic View 做深，而不是照搬整个 Ontology Runtime

如果企业已经把主要数据放在 Snowflake，且目标是让 BI、SQL 用户和 AI Agent 对客户、订单、账户、交易等概念使用一致的业务定义，那么 Snowflake 是很有吸引力的选择。

可以把 Semantic View 作为语义元数据层，定义逻辑表、关系、维度、事实和指标；底层使用标准 Snowflake Tables 承担大规模分析。Cortex Agents 可以利用 Semantic View 生成针对物理表的 SQL。对分析型 Agent 来说，这条路径已经覆盖了很大一部分价值。

如果还需要管理对象状态和轻量事务，可以将 Hybrid Tables 用于对象元数据、关系索引、工作流状态或低延迟 API 查询，将标准表用于大规模历史数据和分析。两种表可以在 Snowflake 中联合查询，也可以在同一事务中组合使用。

但这条路线有实际约束，不能把 Hybrid Table 当作无限扩展的通用对象数据库：

- 官方文档给出的默认 Hybrid Storage 配额是每个 Snowflake Database 2 TB；超出后新增数据的写操作会受到阻止，直到释放空间。
- Hybrid Table 的读写请求按 Database 限流，文档给出的均衡读写工作负载参考吞吐约为每个 Database 每秒 16,000 次操作，不应将其当成无条件的容量承诺。
- \`VARIANT\`、\`ARRAY\`、\`OBJECT\` 和 \`VECTOR\` 等半结构化或向量类型不能作为主键或显式索引列。这会影响采用一个通用 JSON 对象表、再依赖动态属性索引的设计。
- Hybrid Tables 不支持部分常见分析和数据工程能力，例如 Materialized Views、Dynamic Tables、Streams、Snowpipe 和 Search Optimization Service；具体限制应按部署区域和当前文档核对。
- Hybrid Table 的一致性默认采用 Session-based 模型，跨会话读取可能存在短暂延迟；需要最新写入可设置 \`READ_LATEST_WRITES\`，但可能增加延迟。

因此，Snowflake 可以承担一部分 Operational Data，但它的语义视图与事务对象存储是两种不同能力。把它们组合起来可以做出一个很实用的企业平台，却不代表已经复刻了 Foundry 的对象索引、权限、动作编排和查询服务。

### 10.5 推荐的实现架构

如果是从零开始做一个可以逐步扩展的 Ontology-inspired 平台，我会采用 PostgreSQL 作为核心，而不是先引入 Snowflake：

| 模块 | 第一版实现 |
| --- | --- |
| Ontology Metadata | PostgreSQL 元数据表，保存 Object Type、Property、Link、Interface |
| Object Store | 类型化关系表为主，JSONB 作为扩展属性 |
| Link Store | 独立关系表，外键和双向索引 |
| SQL Interface | PostgreSQL View + 原生 SQL |
| Query Execution | PostgreSQL Planner；先不自研 SQL Engine |
| SQL Function | Function Registry + 参数化 SQL + 版本和权限 |
| Action | 独立 Action Service + 数据库事务 |
| Security | GRANT + RLS + 应用身份上下文 + 审计 |
| Agent Access | 只读 SQL 工具 + 已发布 Function；写入只能调用 Action |

当数据量和分析复杂度增长后，再把需要大规模扫描、历史分析和跨域指标的数据同步到 Snowflake。Ontology 的事务对象和业务状态仍然以 PostgreSQL 为准，Snowflake 是分析投影，不应反过来成为第二个可独立写入的事实来源。

如果组织本身已经是 Snowflake-first，数据和治理都在 Snowflake，且需求主要是语义查询、指标一致性和 AI SQL，那么可以反过来采用 Semantic Views + Hybrid Tables。但这时应该明确把目标定义为 Semantic Data Platform，而不是宣称已经具备完整 Ontology Runtime。

**最终选择：PostgreSQL 做 Ontology Runtime，Snowflake 按需做 Analytics Layer。** 先用 PostgreSQL 的原生表、View、Planner、事务和 RLS 把对象模型跑通，真正遇到分析规模瓶颈时再增加 Snowflake。这样既能验证 Ontology 的核心价值，也不会在第一版就为一个并不需要的分布式查询引擎付出复杂度。


## 11. Ontology 的数据从哪里来？以投资研究为例

Ontology 不会凭空产生业务数据，也不应该把原始数据复制一遍后就宣布完成建模。它的数据通常来自多个系统：内部交易和投资组合系统、客户与研究管理系统、外部市场数据供应商、监管披露，以及宏观经济数据源。Ontology 的工作是把这些来源中的记录解析成稳定的业务对象，统一身份和关系，再把经过治理的数据与业务规则发布给应用和 Agent。

下面用一个虚构的投资研究场景说明。假设研究团队覆盖一家虚构的上市公司 **Asterion Cloud, Inc.（ASTR）**，维护一只科技成长型投资组合。公司、证券、价格、财务数字、持仓和研究结论均为模拟数据，不代表真实证券或投资建议。

### 11.1 数据源不是一个系统，而是几类不同的事实

| 数据域 | 典型来源 | 进入 Ontology 的对象 | 需要保留的来源信息 |
| --- | --- | --- | --- |
| 发行人和证券主数据 | OpenFIGI、GLEIF、交易所参考数据、商业 Security Master | Issuer、Security、Listing、Identifier | FIGI、LEI、ISIN、CUSIP、Ticker、交易所、有效期、映射来源 |
| 监管披露和财务数据 | SEC EDGAR filings、XBRL；其他市场的监管披露源 | Filing、Financial Fact、Corporate Event | CIK、Accession Number、taxonomy、concept、period、单位、原始文件 URL |
| 市场行情与公司行动 | 有授权的行情供应商、交易所数据 | Price Observation、Corporate Action、Trading Calendar | Vendor、instrument ID、交易时间、币种、调整口径、延迟/实时标记 |
| 投资组合和交易 | 内部 PMS / OMS、托管行或基金会计系统 | Portfolio、Position、Order、Trade、Cash Balance | 内部账户 ID、证券 ID、数量、成本、估值时间、账簿来源 |
| 研究活动 | Research Management System、文档库、研究员提交 | Research Report、Analyst、Recommendation、Thesis、Catalyst、Risk Factor | 作者、团队、版本、发布日期、审批状态、引用材料 |
| 宏观与行业数据 | FRED、统计机构、行业数据供应商 | Economic Series、Observation、Industry、Peer Group | Series ID、发布日期、观测期、修订版本、来源机构 |
| 客户与适当性（如涉及客户投资建议） | CRM、客户主数据、适当性/合规系统 | Client、Mandate、Restriction、Suitability Profile | 客户权限域、适用范围、生效期、敏感级别 |

公共数据源可以帮助构建可演示的基础数据集。SEC 的 EDGAR API 提供申报历史和 XBRL 财务事实，适合取得发行人披露及其原始依据；OpenFIGI 可用于证券标识符映射；GLEIF 提供 LEI 及法律实体参考数据；FRED 提供宏观经济时间序列。市场行情、机构持仓和研究报告则通常需要商业授权或内部数据，不能把公开披露当作实时行情或完整持仓数据。

参考入口：[SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)、[OpenFIGI API](https://www.openfigi.com/api)、[GLEIF API](https://www.gleif.org/en/lei-data/gleif-api)、[FRED API](https://fred.stlouisfed.org/docs/api/fred/)。具体数据集的使用权、再分发限制、刷新频率和历史覆盖范围必须单独确认。

### 11.2 从原始记录到 Ontology 对象

数据进入平台时，不应直接写入最终 Object Store。建议分成五个阶段：

1. **Source Landing**：按来源和批次保存原始响应、文件或事件，保留原文、采集时间、来源主键和校验值。原始记录不可被规范化过程覆盖。
2. **Canonicalisation**：解析字段、单位、币种、时区、会计期间和标识符，把供应商字段映射到内部标准字段。无法确认的值保留原始表达，不做猜测性转换。
3. **Identity Resolution**：解析 Issuer、Security、Listing、Person 等实体身份。先使用权威 ID 和明确映射，再用名称、地址、别名等辅助匹配；模糊匹配进入人工复核队列。
4. **Ontology Publishing**：通过已批准的映射规则创建或更新 Object，并建立 Link。发布前执行主键唯一性、关系完整性、时间有效性、来源覆盖和权限检查。
5. **Derived Data**：在对象层之上生成估值指标、风险暴露、同行比较、研究观点和事件影响等派生对象。派生结果必须记录公式/模型版本、输入对象版本和计算时间。

数据接入与对象发布是两个不同的生命周期。一个来源记录可以被拒绝、隔离或等待人工确认，而不应因为 ETL 成功就自动成为可信业务对象。

![Investment research ontology data ingestion and publishing architecture](/diagrams/palantir-ontology-sql/investment-research-ontology-data-flow.svg)

*图：从外部与内部数据源，经原始接入、标准化、实体解析和治理发布，形成可查询的投资研究对象图。派生研究结论与原始事实分开存储，并保留来源和版本。*

### 11.3 模拟的投资研究 Ontology

这套示例不需要一开始就定义几十种对象。第一版可以围绕以下核心对象建模：

| Object Type | 关键属性 | 主要关系 |
| --- | --- | --- |
| Issuer | issuerId、legalName、LEI、CIK、domicile、sector | ISSUER_HAS_SECURITY、ISSUER_FILED |
| Security | securityId、FIGI、ISIN、CUSIP、assetClass、currency | SECURITY_ISSUED_BY、SECURITY_HAS_LISTING |
| Listing | listingId、ticker、exchange、tradingCurrency、validFrom、validTo | LISTING_REFERENCES_SECURITY |
| Price Observation | securityId、observedAt、close、volume、currency、adjustmentType | PRICE_FOR_SECURITY |
| Filing | accessionNumber、formType、filedAt、periodEnd、documentUrl | FILING_BY_ISSUER、FILING_CONTAINS_FACT |
| Financial Fact | concept、value、unit、periodStart、periodEnd、dimensions、taxonomy | FACT_REPORTED_IN、FACT_FOR_ISSUER |
| Portfolio | portfolioId、baseCurrency、mandate、asOf | PORTFOLIO_HAS_POSITION |
| Position | positionId、quantity、marketValue、costBasis、asOf | POSITION_IN_PORTFOLIO、POSITION_IN_SECURITY |
| Research Report | reportId、title、author、publishedAt、status、version | REPORT_COVERS_ISSUER、REPORT_CITES_SOURCE |
| Thesis | thesisId、stance、horizon、confidence、status、asOf | THESIS_ABOUT_ISSUER、THESIS_SUPPORTED_BY |
| Catalyst / Risk Factor | eventType、description、expectedAt、severity、status | AFFECTS_ISSUER、AFFECTS_SECURITY |
| Analyst | analystId、team、coverageStatus | ANALYST_AUTHORED_REPORT、ANALYST_OWNS_THESIS |

这里的关系不仅是为了方便 JOIN。比如 Position 属于某个 Portfolio、对应某个 Security；Security 由 Issuer 发行；Listing 是 Security 在特定交易所的交易标识。Ticker 不是 Security 的稳定主键：同一证券可能有多个 Listing，Ticker 也可能随时间变化或被不同市场重复使用。

在这张对象图中，Portfolio 通过 Position 持有 Security；Security 由 Issuer 发行，并通过 Listing 对应一个或多个交易市场。Issuer 关联监管 Filing，Filing 提供 Financial Fact；Research Report 覆盖 Issuer 并引用 Filing 或 Market Data；Thesis 则关联支持它的 Financial Fact、Catalyst 和 Risk Factor。这里表达的是业务关系，不是物理表结构。实现时可以把一对多关系放在外键属性上，把真正需要独立身份、双向导航、关系属性或多对多语义的关系定义为 Link Type。

### 11.4 用一组模拟数据串起对象

假设接入后得到以下模拟对象：

| 对象 | 示例数据 |
| --- | --- |
| Issuer | `ISSUER-001`，Asterion Cloud, Inc.，LEI/CIK 使用明确标注的模拟值 |
| Security | `SEC-001`，ASTR 普通股，USD |
| Listing | `LISTING-001`，ASTR / NASDAQ，示例有效期从 2024-01-01 开始 |
| Portfolio | `PORT-TECH-01`，US Technology Growth |
| Position | `POS-001`，持有 12,000 股 `SEC-001`，估值日 2026-11-20 |
| Price Observation | `PRICE-001`，2026-11-20 收盘价 82.40 USD，明确标记为模拟行情 |
| Filing | `FILING-001`，FY2025 10-K，文档 URL 指向模拟测试文件而非真实 SEC filing |
| Financial Fact | `FACT-001`，FY2025 Revenue 2.4bn USD，来源指向 `FILING-001`，标记为模拟事实 |
| Research Report | `REPORT-001`，Cloud infrastructure coverage update，Analyst `ANALYST-07` 编写 |
| Thesis | `THESIS-001`，Positive / 12-month horizon，基于收入增长、毛利率和估值假设形成 |

一个研究问题可以沿着这些关系展开：某组合持有多少 ASTR；该持仓对应哪个发行人和上市地；最近价格和估值日是什么；最新财报披露了哪些财务事实；研究报告引用了哪些披露；当前 Thesis 的观点由哪些事实支持、有哪些尚未解决的风险。

SQL 查询只是读取这张业务关系网的一种方式。实际系统还需要让用户从 Position 跳转到 Security、Issuer、Filing 和 Research Report，并能看到每个属性的来源、时间和权限。

### 11.5 最重要的是事实、观点和计算结果不能混为一谈

投资研究尤其容易把不同性质的数据混在一起。至少要明确区分：

- **Observed Fact**：来源直接披露或测得的事实，例如 SEC XBRL 中的收入、供应商提供的收盘价、PMS 中的持仓数量。
- **Analyst Assertion**：研究员的判断，例如收入质量改善、竞争优势增强、目标价或评级。必须有作者、时间、版本、审批状态和支持材料。
- **Derived Metric**：平台按公式计算的结果，例如持仓市值、收益率、估值倍数、行业暴露。必须记录公式版本、输入数据版本、币种和 as-of 时间。
- **Model Output**：模型生成的分类、情绪、事件抽取或风险信号。必须保留模型版本、提示/规则版本、置信度和人工复核状态，不能伪装成监管披露事实。

建议增加统一的 Provenance / Assertion 机制：每个关键属性或派生对象都能追溯到 Source Record、数据批次、来源时间和转换规则。研究结论通过 `SUPPORTED_BY`、`CONTRADICTED_BY` 等关系连接证据，而不是把引用 URL 放在自由文本里就算完成溯源。

金融数据还必须采用双时间语义：**有效时间（valid time）**表示事实在业务世界何时成立，**记录时间（transaction/record time）**表示平台何时获知或记录它。比如一份 10-K 在 2026-02-20 提交，披露的财年截止日可能是 2025-12-31；后续重述又可能改变历史数字。只保留一个 `updated_at` 无法支持“当时研究员能看到什么”的回溯分析。

### 11.6 需要显式处理的金融领域约束

- **标识符有类型和有效期**：CIK 标识 SEC filer，LEI 标识法律实体，FIGI/ISIN/CUSIP 标识不同层级的金融工具，Ticker 标识某个市场上的交易代码。不要把它们塞进一个 `externalId` 字段后混用。
- **Issuer、Security、Listing 分开**：发行人、证券和上市交易代码不是同一对象。公司可以发行多类证券，一种证券也可能有多个市场 Listing。
- **财务事实需要上下文**：概念、taxonomy、单位、币种、期间、维度、报告日期和是否重述，都是事实含义的一部分。不能只存 `revenue = 2.4bn`。
- **价格需要市场语义**：交易时间、时区、币种、交易所、复权口径、行情类型和供应商延迟状态都应保留。
- **持仓必须有 as-of**：数量、成本和市值属于特定账簿与估值时点；交易、结算、公司行动和估值调整会改变结果。
- **权限与授权要下沉到对象和属性**：研究团队、交易团队、客户团队的访问范围不同；供应商许可可能限制用户、用途、缓存和再分发。RLS 不能替代数据许可和业务授权检查。
- **研究观点必须版本化**：评级变更、目标价调整、报告撤回和合规审批不能覆盖历史版本。Agent 生成的观点不能自动变成正式研究结论。

### 11.7 如何把它映射到 PostgreSQL 实现

前一节建议的 PostgreSQL Runtime 可以承载这套模型，但不要把所有东西都塞进一张 `ontology_object` JSONB 表。对投资研究场景，更实用的第一版是：

- 核心对象采用类型化表：`issuer`、`security`、`listing`、`portfolio`、`position`、`filing`、`research_report`、`thesis`。
- 对象身份和来源记录独立：`external_identifier`、`source_record`、`ingestion_batch`、`object_provenance`。
- 关系按语义建表：`security_issuer`、`portfolio_position`、`position_security`、`report_issuer`、`thesis_evidence`。有关系属性或多对多语义时，不要仅靠 JSON 数组表达。
- 时间序列数据分开管理：`price_observation`、`financial_fact`、`economic_observation`，按 instrument/concept 和时间建立合适索引；大规模行情历史可分区或下沉分析仓库。
- 研究判断和模型输出独立版本化：`analyst_assertion`、`model_assessment`，与客观事实使用不同权限和状态流。
- 元数据 Registry 管理 Object Type、Property、Link Type、Interface、Function 和 Action；不要把业务定义散落在 ETL 代码里。

第一版不需要自研图数据库或 SQL Parser。PostgreSQL 的外键、唯一约束、部分索引、范围类型、JSONB、View、RLS 和事务足以验证核心对象模型。等到跨对象遍历、事件传播或超大规模关系查询确实成为瓶颈，再根据实际查询负载评估专门的图计算或搜索组件。

### 11.8 非结构化材料和不断变化的 Schema 怎么处理

投资研究的大量重要信息并不是整齐的表格：年报和公告是 PDF/HTML，研究报告是 Word，研究员还有会议纪要、邮件、新闻摘录和访谈记录。不同来源的字段也经常变化。实际实现不应要求这些材料先全部变成固定 Schema，更不应该把所有内容直接塞进 Ontology 的 JSONB 属性。

更稳妥的做法是把“材料存储”和“业务对象建模”分开，先解决检索、引用和追溯，再逐步把有稳定业务含义的信息提升为 Ontology 对象：

| 数据 | 第一版存放位置 | 处理方式 |
| --- | --- | --- |
| 原始 PDF、Word、HTML、邮件附件 | S3 / Cloudflare R2 等对象存储 | 原样保存，按文档 ID 和版本管理；PostgreSQL 只保存元数据、权限和对象存储地址 |
| 文档正文、章节和段落 | PostgreSQL 或对象存储 | 保存解析文本及页码、段落号等定位信息；不必一开始就拆成很细的知识图谱节点 |
| 抽取出的实体、事件、观点和数值 | PostgreSQL 候选记录，灵活字段使用 JSONB | 保留抽取类型、Schema 版本、来源文档、证据位置和处理状态 |
| 已确认的 Issuer、Security、Thesis、Risk Factor 等 | Ontology 类型化表 | 通过验证后发布，使用稳定 ID 和明确关系 |
| 全文与语义检索索引 | 初期 PostgreSQL Full Text Search；确有需要再加 pgvector 或专用检索服务 | 索引可以重建，不作为事实或权威数据的唯一存储 |

抽取结果可以采用一个很小的公共结构，例如 `candidate_type`、`schema_version`、`subject_ref`、`attributes`、`evidence_refs`、`status`。其中 `attributes` 允许 JSONB，承接暂时不稳定的字段；但候选类型和 Schema 版本必须明确，不能把含义不同的数据混成一个无类型的大 JSON。证据引用至少要能定位到文档版本、页码或段落，以及原文片段；只有一个文件 URL 通常不够。

例如，研究员在一份报告中写到“公司可能在明年上半年受益于新一代 GPU 供应改善”。系统可以先把它抽取为一个 Catalyst 候选，记录原文位置、作者、报告版本和模型抽取信息。它不应立即变成正式的公司事件，更不能被写成已经发生的事实。经过规则检查或研究员确认后，才发布为正式对象；无法判断的内容继续留在候选区，必要时由人复核。

Schema 演进也不需要一开始就建设复杂的动态类型平台。新增字段先进入候选 JSONB；当某个字段在多个来源和流程中反复出现、语义稳定且确实需要查询、约束或授权时，再迁移为正式属性，并提供兼容期和数据回填。对外部来源保留原始字段和来源版本，避免供应商改字段后无法重放或重新解析。旧版本抽取结果不必强行覆盖，可以按新 Schema 重新处理并保留处理版本。

实现时先做四张基础表通常就够了：`source_document` 管文档及版本，`document_segment` 管可引用的文本片段，`extraction_candidate` 管待验证抽取结果，`evidence_reference` 管候选或正式对象与原文证据的关联。文档文件放对象存储，候选的变化字段放 JSONB，正式业务对象仍使用前面定义的类型化表。不要为了“未来可能出现的任何数据”预先设计通用 Schema Registry、独立知识图谱数据库、消息总线和多套向量服务。

这套方案允许材料和字段持续变化，同时让正式 Ontology 保持可查询、可约束、可授权。全文搜索和向量搜索负责“找到可能相关的材料”；Evidence 负责“指出依据在哪里”；Ontology 负责“哪些业务对象和关系已经被系统确认”。三者职责不同，不应互相替代。

**核心原则：数据源负责提供证据，身份解析负责判断“这是哪个对象”，Ontology 负责表达对象及其业务关系，研究流程负责形成观点，Agent 负责在权限边界内查询和辅助工作。** 这几件事不能交给同一个 LLM 步骤一次性完成。

## 12. Ontology 是否值得建：先算业务账，再谈技术架构

前面的投资研究示例说明了 Ontology 可以怎样构建，但“可以建”不等于“值得建”。业务对象模型本身并不新鲜：关系数据库有表和外键，数据仓库有维度模型和语义层，应用系统有领域模型，搜索系统也能保存和检索文档。Ontology 的额外价值，是让多个系统和角色围绕同一套业务对象、关系、权限和操作协作，而不是让每个应用各自解释一遍数据。

如果只有一个应用、少量数据源、固定报表和简单 CRUD，普通关系模型加 API 通常更便宜，也更容易维护。为了“以后可能接 Agent”先建一套通用 Ontology 平台，往往是把尚不存在的收益提前资本化。

### 12.1 哪些问题值得用 Ontology 解决

判断重点不是数据量有多大，而是业务语义是否需要跨系统共享，以及重复解释同一业务对象是否已经成为成本。

| 业务现状 | Ontology 的价值 | 更合适的起点 |
| --- | --- | --- |
| 单一系统内部使用，数据结构稳定 | 较低，领域模型和关系表通常够用 | PostgreSQL 表、外键、View、应用服务 |
| 多个系统描述同一类业务对象，但 ID、状态和关系不一致 | 较高，统一身份和业务语义能减少重复映射 | 先建立共享对象 ID、主数据映射和少量核心对象 |
| 多个团队需要跨系统查询同一业务关系 | 较高，避免每个团队重复维护 JOIN 和口径 | 核心对象、关系和共享查询接口 |
| 业务流程需要在对象上执行受权限约束的操作 | 较高，统一对象权限、校验和 Action 边界 | 对象模型加独立 Action/API 服务 |
| 主要需求是全文检索、文档问答或相似内容发现 | 通常不需要完整 Ontology | 文档存储、全文/向量检索、证据引用 |
| 主要需求是大规模历史分析和指标计算 | Ontology 不应替代分析平台 | Snowflake 等分析仓库，加语义层或数据产品 |
| 数据含义变化快、对象边界尚未稳定 | 过早固化会增加维护成本 | 原始数据、候选模型和轻量领域模型先行 |

投资研究场景中，Issuer、Security、Portfolio、Position 等对象具有相对稳定的业务含义，且研究、交易、风险和合规团队都需要使用它们，值得优先统一。某篇报告中的临时观点、新闻摘要或模型生成的事件标签则未必需要成为正式对象；如果只需要搜索和引用，保留在 Knowledge Layer 即可。

### 12.2 时效性：不要把所有数据都按同一种节奏建模

Ontology 的对象定义通常比对象属性值稳定，但两者都可能变化。Issuer 和 Security 的身份相对稳定，Listing、公司行动、持仓、行情、研究观点则有各自的变化频率。把这些数据全部按同一套同步周期和更新策略处理，会让系统不是太慢，就是复杂到难以运维。

实际设计应按数据变化方式区分：

- **相对稳定的主数据**：Issuer、Security、行业分类等，发生变化时更新，并保留标识符映射和有效期。
- **周期性业务数据**：财务披露、组合持仓、研究报告，按来源发布时间或业务批次更新，记录 as-of 时间和来源版本。
- **高频时序数据**：行情、报价和交易事件，优先留在适合其吞吐和保留周期的数据管道或时序存储中。Ontology 可以暴露最新快照、必要的聚合结果或可查询引用，不必把每一笔 tick 都建成业务对象。
- **持续变化的观点和模型结果**：保留作者/模型、生成时间、版本和状态。新结论应形成新版本或新记录，不应覆盖历史判断。

还要区分“业务何时成立”和“平台何时知道”。例如财报在某日提交，披露的是上一财年的数据；后续重述可能改变历史数值。至少对关键事实保留有效期间、来源发布时间和平台记录时间，才能回答当时的研究决策依据是什么。

因此，Ontology 并不是天然实时的。数据新鲜度取决于源系统、接入方式、处理延迟和发布策略。对外提供查询时，应明确数据的 as-of 时间、延迟状态和更新 SLA；不能只因为数据已经成为 Ontology 对象，就暗示它是实时数据。

### 12.3 维护成本：真正难的是业务语义，不是建几张表

第一版实现通常不难，长期成本来自业务变化：标识符规则调整、上游字段变更、对象状态增加、关系含义变化、权限边界调整，以及不同团队对同一个指标有不同解释。

如果没有明确的业务负责人，Ontology 很容易变成一份由数据团队维护、业务团队不认领的元数据目录。模型看起来完整，实际查询仍然回到各团队自己的表和 Excel。

维护责任至少应落到三个角色上：业务负责人确认对象和属性的含义；数据/集成负责人维护来源映射、质量和更新；平台负责人维护元数据、权限、版本和发布机制。小团队可以由同一人兼任，但职责不能缺失。新增属性、关系或状态时，要能说明谁提出、谁确认、影响哪些消费者。

不需要为每个字段建立繁重审批。核心身份、财务口径、权限和状态转换需要严格管理；临时研究标签和低风险扩展字段可以宽松一些。按影响面分级，比所有 Schema 变更走同一套流程更实际。

### 12.4 复杂度应由真实使用场景推动

Ontology 的复杂度不只在对象数量，还在元模型和运行时能力。若第一版就同时实现动态类型注册、任意关系推理、通用规则引擎、事件传播、版本分支、复杂函数市场和多租户策略，团队会花大量时间维护平台自身，而不是解决业务问题。

更现实的路径是：

1. 选一个跨系统、反复发生的业务问题，确定少量核心对象和关系。
2. 用 PostgreSQL 类型化表、外键、View 和普通 API 实现；只把确实需要动态扩展的候选属性放入 JSONB。
3. 先统一对象 ID、关键属性口径、来源和权限，再提供共享查询接口。
4. 当多个应用重复实现同一查询或规则时，再把它发布为共享 Function；当对象写入需要统一校验和审计时，再建设 Action 服务。
5. 只有在实际负载证明 PostgreSQL 查询、关系遍历或数据规模成为瓶颈时，才引入专门的图计算、搜索或分析组件。

这不是一个必须逐项完成的产品路线图。若某项能力没有明确消费者、业务问题和运维负责人，就先不做。

### 12.5 业务支持度：模型要进入日常工作，而不是停在架构图里

Ontology 是否成功，不看对象类型定义了多少，也不看图有多大，而看业务团队是否愿意在日常工作中使用它。研究员能否从持仓定位到证券、发行人和财报；风险人员能否复用同一套敞口口径；合规人员能否检查研究结论的来源和访问权限；应用和 Agent 能否调用同一查询与受控操作——这些才是业务支持度。

但统一模型不意味着强迫所有团队使用完全相同的视图。研究、交易和风险可能对同一对象有不同的分析维度。共享的是稳定身份、基本事实和明确关系；团队特有的指标、工作状态和观点仍可以由各自领域管理，再通过清晰接口关联。否则，所谓统一 Ontology 会演变成一个庞大、妥协过多、无人敢改的中央 Schema。

Agent 也不应成为建设 Ontology 的唯一理由。Agent 可以从统一对象和权限中受益，但如果业务人员本身没有稳定的对象模型和工作流程，单靠加一层 Ontology 并不能让 Agent 自动理解业务。

### 12.6 投入产出：看减少了多少重复工作和业务风险

Ontology 的成本比较容易被低估：初始建模、数据映射、身份解析、权限设计、数据质量、版本兼容、运行监控，以及持续的业务协调都需要投入。收益则通常分散在多个团队和应用中，不一定体现在一个项目的交付周期里。

评估时可以从几个可观察指标入手：

- 同一业务对象在不同系统中的重复映射和人工对账是否减少。
- 新应用接入时，是否可以复用现有对象、关系和权限，而不是重新开发一套数据拼接逻辑。
- 核心指标和业务规则是否减少了多个版本，口径争议是否下降。
- 从业务问题到可用查询或流程的交付时间是否缩短。
- 数据来源、权限和操作审计是否更完整，错误决策或合规风险是否下降。
- 模型维护是否有明确负责人，Schema 变更是否造成越来越多的下游破坏。

不要只用“建了多少对象”“接入多少数据源”“Agent 调用了多少次”作为成功指标。它们衡量的是建设活动或使用量，不代表业务收益。可以先选一个流程做基线对比，例如研究员完成一次公司覆盖更新所需的人工查找、数据核对和重复录入时间，再观察统一对象和证据引用是否真正减少这些工作。

### 12.7 一个务实的决策结论

对前面的投资研究场景，我不会一开始就建设完整的 Palantir 式平台。第一阶段只统一 Issuer、Security、Listing、Portfolio、Position、Filing 和 Research Report 等少量核心对象，接入最有价值的内部持仓与公开披露数据；原始研究材料继续放在文档存储中，抽取结果先作为候选，只有经过确认的观点才进入正式模型。PostgreSQL 负责事务对象、关系、权限和常用查询，全文检索负责找材料，分析仓库继续负责大规模历史分析。

先让研究员能可靠地回答几个具体问题：组合持有什么、对应哪家发行人、数据来自哪里、财报何时发布、研究观点依据什么。若这一小套模型被研究、风险和合规等多个流程持续复用，再逐步扩展对象、共享 Function 和 Action。若只有一个团队使用，或现有 SQL/API 已经足够，就没有必要继续抽象成通用 Ontology 平台。

**Ontology 的价值不在于把所有数据都变成对象，而在于让值得共享的业务语义只维护一次，并在多个真实业务流程中持续产生收益。** 如果这项收益无法覆盖建模、治理和维护成本，保持普通数据模型反而是更好的架构选择。

## 14. 结论：SQL 不是重点，业务模型成为可查询接口才是

Ontology SQL 的 GA 不只是给 Ontology 增加了一种语法。它把 SQL 查询能力直接接入 Ontology 对象模型，并通过 Object Storage 和 OSS 的执行路径完成查询；SQL Functions 又把查询封装成平台函数，让不同应用复用同一份逻辑。

从架构上看，它的关键设计有三点：

- SQL 解析层与 Ontology 专用数据提供器分离，既复用已有 SQL 体系，又保留对象模型语义。
- 查询执行与底层计算引擎解耦，由 OSS 为支持的查询形态选择内存计算或 Spark。
- 查询逻辑可以从 Worksheet 发布为函数，进入 Foundry 的应用和自动化体系。

这套设计最值得其他企业平台借鉴的地方，是不要把业务语义层做成一份只供目录浏览的元数据。对象、关系、权限和业务操作如果已经成为组织认可的模型，就应该让查询引擎、应用和 Agent 都能够直接使用它。

但要达到这一点，语义模型本身必须可靠，权限需要贯穿访问链路，查询与写入需要明确分离。SQL 只是入口；真正有价值的是同一套业务模型能够被不同执行环境和应用一致地理解。

## 参考资料

1. [Palantir：Ontology SQL and SQL functions are GA（2026-11-12）](https://www.palantir.com/docs/foundry/announcements/2026-11)
2. [Palantir：Ontology SQL Architecture and Query Reference](https://www.palantir.com/docs/foundry/sql-warehousing/ontology-sql)
3. [Palantir：Ontology SQL Functions](https://www.palantir.com/docs/foundry/sql-warehousing/sql-functions)
4. [Palantir：SQL Studio](https://www.palantir.com/docs/foundry/sql-warehousing/sql-studio)
5. [Palantir：SQL Permissions](https://www.palantir.com/docs/foundry/sql-warehousing/sql-permissions)
6. [Palantir：Ontology Backend Architecture](https://www.palantir.com/docs/foundry/object-backend/overview/index.html)
7. [Palantir：The Ontology System](https://www.palantir.com/docs/foundry/architecture-center/ontology-system)
8. [Palantir DevCon 6：Query the Ontology Directly in Ontology SQL（2026-07-22）](https://www.youtube.com/watch?v=hFbogwIcuEk)
9. [PostgreSQL：JSON Types and JSONB Indexing](https://www.postgresql.org/docs/current/datatype-json.html)
10. [PostgreSQL：Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
11. [PostgreSQL：CREATE FUNCTION](https://www.postgresql.org/docs/current/sql-createfunction.html)
12. [Snowflake：Semantic Views Overview](https://docs.snowflake.com/en/user-guide/views-semantic/overview)
13. [Snowflake：Hybrid Tables](https://docs.snowflake.com/en/user-guide/tables-hybrid)
14. [Snowflake：Hybrid Table Limitations](https://docs.snowflake.com/en/user-guide/tables-hybrid-limitations)
15. [Snowflake：Row Access Policies](https://docs.snowflake.com/en/user-guide/security-row-intro)

*文档状态说明：GA 状态以 2026 年 11 月 12 日官方公告和 Release Notes 为准。部分详细文档页面的 SQL Functions 标题仍显示 Beta，和 GA 公告存在文档更新不同步的情况；本文不据此推断 GA 后所有环境均已启用每项细节。具体可用能力仍应以目标 Foundry enrollment 的版本和配置为准。*
