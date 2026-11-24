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

## 10. 结论：SQL 不是重点，业务模型成为可查询接口才是

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

*文档状态说明：GA 状态以 2026 年 11 月 12 日官方公告和 Release Notes 为准。部分详细文档页面的 SQL Functions 标题仍显示 Beta，和 GA 公告存在文档更新不同步的情况；本文不据此推断 GA 后所有环境均已启用每项细节。具体可用能力仍应以目标 Foundry enrollment 的版本和配置为准。*
