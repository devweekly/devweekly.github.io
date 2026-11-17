---
author: W
featured: false
draft: false
description: 从存储布局、微分区、元数据、事务与历史版本机制出发，比较 Snowflake、PostgreSQL、Oracle、DuckDB 和湖仓表格式，解释列存储、Time Travel 与数据湖究竟有什么区别。
pubDatetime: 2026-11-17T00:00:00Z
title: Snowflake 的底层数据库究竟是什么？从 PostgreSQL、Oracle 到 DuckDB 与数据湖
tags:
  - tech
  - data
  - database
  - architecture
  - snowflake
  - postgresql
  - oracle
  - duckdb
---

# Snowflake 的底层数据库究竟是什么？从 PostgreSQL、Oracle 到 DuckDB 与数据湖

Snowflake 经常被描述为云数据仓库，也经常被拿来和 PostgreSQL、Oracle、Redshift、BigQuery、Databricks 放在一起比较。初学者最容易记住的几个词是列式存储、Micro-partition、Time Travel、存算分离和 Virtual Warehouse。但这些词单独拿出来并不新鲜：Parquet 早就支持列式文件布局，PostgreSQL 和 Oracle 都有多版本并发控制，Iceberg 和 Delta Lake 也能提供快照与时间旅行，DuckDB 同样拥有列式执行和向量化查询。

那么 Snowflake 的技术差异究竟在哪里？

答案不在某一个存储格式或 SQL 特性，而在于它把数据库拆成了三个相互配合的系统：**云对象存储负责持久化数据，独立的 MPP 计算集群负责执行查询，云服务层负责元数据、事务协调、身份权限、查询优化和资源调度。** 这套架构围绕分析型负载设计，并作为一个托管服务交付。PostgreSQL 和 Oracle 则从通用事务数据库出发，在同一个数据库系统中处理数据页、事务、索引、日志、缓存和查询执行。

理解这个差异后，Time Travel、列存储和 DuckDB 的位置就比较容易判断了。

## 1. 先把比较对象放在同一张图上

PostgreSQL、Oracle 和 Snowflake 都是关系数据库系统，支持 SQL、事务、约束、并发访问和查询优化。但它们的默认工作负载不同。PostgreSQL 和 Oracle 首先要高效地完成在线业务中的小事务：按主键找一行、更新几个字段、检查约束、提交事务。Snowflake 首先要高效地完成分析任务：扫描大量记录中的少数列，执行过滤、Join、聚合和窗口计算，再把结果返回给 BI 或应用。

这并不意味着 PostgreSQL、Oracle 不能做分析，也不意味着 Snowflake 不能执行 INSERT、UPDATE 或 DELETE。差异在于默认的数据布局、资源组织方式和系统优化目标。

| 系统 | 主要定位 | 默认存储与执行特点 | 更典型的负载 |
| --- | --- | --- | --- |
| PostgreSQL | 通用关系数据库 | Heap 行存储、B-tree 等索引、WAL、MVCC | OLTP、应用数据库，也可承担中小规模分析 |
| Oracle Database | 企业级通用关系数据库 | 默认行式数据块、Undo/Redo、丰富的事务与恢复能力；可选 In-Memory 列存 | OLTP、复杂企业事务、混合业务与分析 |
| Snowflake | 云原生分析数据平台 | 内部压缩列式格式、自动微分区、对象存储、独立 MPP Warehouse | 大规模扫描、数据整合、数仓、BI |
| DuckDB | 嵌入式分析数据库引擎 | 单机优先、列式存储与向量化执行，可直接查询 Parquet 等文件 | 本地分析、数据处理、嵌入式分析、单机 ETL |

这里先限定范围：本文讨论 Snowflake 的标准 Snowflake Table，不把 Hybrid Table 当作其标准表的存储实现来分析。Hybrid Table 有不同的行式存储和事务特征，适合另一类工作负载。Snowflake 的 Iceberg Table 也会单独讨论，因为它使用开放湖仓表格式，不能与 Snowflake 原生表的内部存储格式混为一谈。

## 2. Snowflake 的三层架构：数据库不再是一台机器

传统数据库部署通常围绕一个数据库实例或一组紧密协作的数据库节点展开。数据文件、缓存、事务日志、后台维护和 SQL 执行都由数据库集群管理。即使使用 RAC、主从复制或分片，存储与计算之间也存在明确的部署和运维关系。

Snowflake 从一开始就把云环境当作基础设施。官方将其架构划分为三个部分：Database Storage、Compute 和 Cloud Services。它同时具有 shared-disk 与 shared-nothing 的特点：持久数据放在多个计算集群都能访问的中心存储中，查询执行则由 MPP 集群并行完成。[Snowflake 官方架构说明](https://docs.snowflake.com/en/user-guide/intro-key-concepts)

![Snowflake 三层架构](/diagrams/snowflake-three-layer-architecture.svg)

完整图示：[HTML 交互查看](/diagrams/snowflake-three-layer-architecture.html)

### 2.1 Storage：持久数据放在云对象存储

Snowflake 使用 AWS、Azure 或 Google Cloud 提供的对象存储作为持久数据层。用户看到的是 Database、Schema、Table 等逻辑对象；实际文件的组织、压缩、微分区、元数据和统计信息由 Snowflake 管理。用户不会像管理 PostgreSQL 那样登录主机查看数据文件，也不需要自己维护数据文件的目录结构。

这一点与把数据库文件放在 EBS 或本地 NVMe 上有明显区别。对象存储提供高耐久性和相对独立的容量扩展，Snowflake 可以在不搬迁整个数据库文件的情况下启动新的计算集群访问数据。对象存储本身并不执行 SQL，也不理解一张关系表的事务语义；这些能力由 Snowflake 的元数据和查询服务补上。

计算节点可以使用本地缓存减少远端数据读取，但缓存不是权威持久副本。Warehouse 暂停或销毁后，持久数据仍在存储层；重新启动计算资源时，缓存可能需要重新预热。

### 2.2 Compute：Virtual Warehouse 是独立计算集群

Snowflake 的 Virtual Warehouse 不是数据库，也不是数据存储空间，而是一组用于执行 SQL、数据加载和转换任务的计算资源。一个 Warehouse 内部有多个节点，查询可以被拆成多个执行片段并行处理。多个 Warehouse 可以同时访问同一份持久数据，却不必共享同一组计算资源。

例如，BI 用户在早上集中刷新报表时，可以使用独立的 BI Warehouse；夜间的数据转换任务使用另一个 ETL Warehouse；数据科学家运行临时分析时再使用第三个 Warehouse。某个 Warehouse 的查询排队或资源竞争，不必直接挤占另一个 Warehouse 的计算能力。

这就是 Snowflake 存算分离的实际价值：计算容量可以按工作负载单独扩缩，数据不需要随计算资源复制一份。它也意味着计算并非免费。Warehouse 运行时间、规模、自动挂起策略和并发配置会直接影响成本。存储和计算分开，不等于查询不再需要扫描数据，也不等于所有查询都会自动变快。

### 2.3 Cloud Services：真正让它成为数据库服务的控制面

Cloud Services 负责用户认证、权限、元数据管理、SQL 解析与优化、基础设施协调、查询分发等工作。用户执行一条 SQL 时，系统需要知道当前角色能访问哪些对象、表的当前版本是什么、哪些微分区可能包含目标数据、应该把任务派发给哪个 Warehouse，以及执行结果如何返回。

这一层不是一个普通的 SQL Proxy。它是数据库控制面，维护了大量跨计算集群共享的状态。

Snowflake 曾公开披露其使用 FoundationDB 作为元数据存储。2018 年的工程文章说明，Snowflake 自 2014 年起使用 FoundationDB 保存元数据，原因之一是元数据访问模式更接近 OLTP：大量小型、高频读写，需要事务和低延迟。文章还提到对象目录、用户、会话、访问控制、复制历史、语句执行统计、事务状态和锁队列等元数据。[Snowflake：How FoundationDB Powers Snowflake Metadata Forward](https://www.snowflake.com/en/blog/how-foundationdb-powers-snowflake-metadata-forward/)

这个公开资料很有价值，因为它说明一个分析数据库并不意味着所有内部组件都采用分析型存储。Snowflake 的大规模事实数据适合列存储和对象存储；元数据却需要高频小事务。需要注意，这篇文章描述的是 2018 年公开的实现情况，不能据此推断今天所有内部服务仍然采用完全相同的组件和拓扑。

## 3. 行存储与列存储：差异来自访问模式

考虑一张包含一亿条交易记录的表：

`TRADE(id, account_id, trade_date, instrument, quantity, price, currency, status, ...)`

在线交易应用经常通过 `id` 或 `account_id` 找到少量记录，并读取或修改一行中的多个字段。报表却可能只需要 `trade_date`、`instrument` 和 `quantity`，扫描几千万条记录，按日期和证券汇总。

这两类访问模式对物理布局的要求不同。

### 3.1 PostgreSQL：Heap 页面里保存完整行

PostgreSQL 的普通表采用 Heap 组织。表由固定大小的数据页组成，默认页面大小通常为 8 KB；每个页面包含页头、行指针和实际 Tuple 数据。Tuple 保存一行的字段值以及 MVCC 所需的事务可见性信息。[PostgreSQL：Database Page Layout](https://www.postgresql.org/docs/current/storage-page-layout.html)

假设一行有 20 列，查询只需要其中两列，数据库仍然需要定位包含目标 Tuple 的页面，并读取 Tuple 中相应字段。索引可以帮助快速找到少量行，但索引并不改变 Heap 本身的行式布局。对于大范围扫描，索引也未必比顺序扫描更划算。

行存储适合按主键读取和修改少量记录。一次更新可以围绕少量数据页、索引项和事务日志完成，不必把整张表重新组织成列式文件。

### 3.2 列存储：把同一列的值放在一起

列存储将一批记录按列组织。上面的交易表可以在物理上形成独立的日期列、证券代码列、数量列和价格列。执行月度交易量统计时，数据库只需读取相关列，不必把客户地址、备注、状态描述等无关字段一并读入。

列式布局还有利于压缩。相邻数据往往具有相似类型和分布，例如日期、状态码、币种或证券代码。数据库可以对每列采用适合其数据分布的编码与压缩方式。扫描时，执行引擎也可以批量处理一组同类型值，减少逐行解释和函数调用的开销。

这并不是说列存储对所有操作都更快。更新一行中的一个字段，可能涉及相应列段、压缩块和索引或元数据的重写；需要一次读取很多列的点查也未必有优势。因此，传统 OLTP 数据库通常以行存储作为默认布局，分析型数据库则倾向于列存储。

### 3.3 把列式存储展开看：一批行如何变成多个列数据流

下面把一张 6 行、4 列的交易表展开。逻辑层仍然是二维表；写入 Snowflake 标准表后，系统会把数据组织进 Micro-partition。每个微分区包含一组完整行，但在微分区内部，DATE、REGION、STATUS、AMOUNT 等列分别组织和压缩。

![列式存储的内部结构](/diagrams/columnar-storage-internals.svg)

完整图示：[HTML 交互查看](/diagrams/columnar-storage-internals.html)

从物理布局看，关键变化不是“把表转成一条很长的列”，而是每个微分区中存在多个独立的列数据流。每个列流可以选择适合自身分布的编码与压缩方式。例如，REGION 只有 US、JP 两种值，可以用字典保存 `US → 0`、`JP → 1`，数据区只保存 `[0, 0, 1, 0, 1, 1]`；日期可能利用相邻值的规律做差分编码；数值列也可以选择适合其分布的压缩方式。这些是解释列存储的通用示例，Snowflake 没有公开其每种列、每个微分区实际选择的编码算法和完整二进制布局。

微分区旁边还有一组列级元数据，例如最小值、最大值、不同值数量等。查询 `WHERE trade_date >= ...` 时，优化器先用这些统计信息判断哪些微分区可能匹配；确定需要读取某个微分区后，再只取查询引用的列。也就是说，先做横向的微分区裁剪，再做纵向的列裁剪。对于只读取日期和金额的聚合查询，客户名称、备注等列可以完全不读。

Snowflake 官方确认了微分区中的列独立存储和独立压缩，以及按分区统计信息进行裁剪；但没有公开内部文件格式的完整规范。因此，图中编码和压缩块是用于理解的概念模型，不应被视为 Snowflake 文件格式的逆向还原。[Snowflake：Understanding Table Structures](https://docs.snowflake.com/en/user-guide/tables-micro-partitions) · [Micro-partitions & Data Clustering](https://docs.snowflake.com/en/user-guide/tables-clustering-micropartitions)

### 3.4 Oracle 不是只能使用行存储

Oracle Database 的普通持久表数据块仍然以行式组织为主，但 Oracle Database In-Memory 可以在内存中维护一份列式副本。数据库缓冲区缓存保留行式数据，In-Memory Area 则保存列式数据；优化器可以根据查询类型选择合适的表示。[Oracle：In-Memory Column Store Architecture](https://docs.oracle.com/en/database/oracle/oracle-database/26/inmem/in-memory-column-store-architecture.html)

这说明行存储与列存储不是两种数据库产品之间不可跨越的界限。Oracle 可以在一个数据库系统中同时维护两种表示。Snowflake 的不同在于，它将列式数据布局作为标准分析表的默认持久化方式，并把计算集群与持久存储进一步分离。

## 4. Snowflake Micro-partition：不是传统分区表的另一个名字

Snowflake 的标准表会自动拆分为 Micro-partitions（微分区）。官方文档给出的典型大小是每个微分区 50–500 MB 未压缩数据；实际存储大小会因为压缩而更小。一个微分区包含一组完整行，但微分区内部的列是独立组织和压缩的。[Snowflake：Micro-partitions & Data Clustering](https://docs.snowflake.com/en/user-guide/tables-clustering-micropartitions)

因此可以把它理解为一种分层布局：先把一批行组织成微分区，再在每个微分区内部按列存储。它既有行集合的边界，又具备列式扫描的效率。

![Snowflake 微分区与查询裁剪](/diagrams/snowflake-micro-partition-pruning.svg)

完整图示：[HTML 交互查看](/diagrams/snowflake-micro-partition-pruning.html)

### 4.1 微分区元数据为什么重要

Snowflake 不只保存数据，还会为微分区记录列级统计信息，例如每列的最小值、最大值、不同值数量以及其他用于优化的数据。查询优化器可以先判断哪些微分区有可能满足过滤条件，再决定是否读取其中的数据。

例如：

```sql
SELECT instrument, SUM(quantity)
FROM ANALYTICS.TRADES
WHERE trade_date >= '2026-10-01'
  AND trade_date <  '2026-11-01'
GROUP BY instrument;
```

如果某些微分区的 `trade_date` 最大值早于 2026 年 10 月，或最小值已经晚于目标范围，优化器就能排除这些微分区。真正执行时只读取剩余微分区中需要的列。这个过程叫 Partition Pruning（分区裁剪）。

它与传统数据库分区的区别在于，用户通常不需要先设计按月、按年或按地区的物理分区，也不需要自己维护大量分区 DDL。Snowflake 根据数据写入顺序自动创建微分区，并收集统计信息。用户仍然可以通过 Clustering Key 等机制改善数据聚集程度，但这属于进一步的物理优化，不是创建普通表的前置条件。

### 4.2 自动分区不代表任何查询都能高效裁剪

微分区的统计信息只有在数据布局有利于过滤时才有价值。如果一张表按时间顺序持续写入，那么每个微分区的日期范围可能比较集中，按日期查询就容易排除大量微分区。如果数据持续以随机顺序写入，许多微分区的日期范围可能高度重叠。此时即使只查询某一个月，也可能需要读取很多微分区。

因此，数据写入顺序、批次大小、聚类情况和查询谓词会影响裁剪效果。Snowflake 自动完成了分区管理，却没有消除数据布局对查询性能的影响。

这也解释了为什么 Snowflake 提供 Clustering Information、Automatic Clustering 和 Query Profile 等能力。遇到慢查询时，不能只看 Warehouse 是否足够大，还应观察扫描了多少微分区、实际读取多少字节、过滤后剩余多少行，以及 Join 是否产生了数据膨胀。

## 5. 一条 Snowflake SQL 实际经过什么路径

把前面的三层架构和微分区结合起来，一条查询大致经过以下过程：

1. Cloud Services 完成认证、权限检查、SQL 解析和逻辑优化。
2. 优化器读取表定义、微分区统计信息和相关元数据，生成执行计划。
3. 查询被派发到指定 Virtual Warehouse。
4. Warehouse 中的多个计算节点并行读取需要的微分区和列数据；本地缓存可能减少对象存储访问。
5. 各节点执行过滤、Join、聚合等操作，并在需要时交换中间结果。
6. 结果汇总并返回客户端，同时记录查询 ID、执行统计和资源消耗。

这里有两个常见误解。

第一个误解是“Snowflake 把所有数据都放在内存里”。实际并非如此。持久数据在对象存储，计算节点可能使用本地缓存和内存执行查询；缓存命中与否会影响性能，但缓存不是数据的唯一存放位置。

第二个误解是“存算分离意味着计算可以无限横向扩展”。Warehouse 可以调整规模，也可以增加集群以处理并发，但查询仍受到数据分布、网络交换、Join 策略、内存、单查询并行度和服务配额的约束。增加 Warehouse 规模不保证所有 SQL 按比例加速。

## 6. Time Travel：它和 PostgreSQL MVCC 是一回事吗？

不是。两者都涉及数据的多个版本，但设计目的和版本保留机制不同。

### 6.1 PostgreSQL MVCC：为并发事务提供一致性快照

PostgreSQL 使用 MVCC（Multi-Version Concurrency Control，多版本并发控制）维护事务可见性。更新一行时，通常不会直接把旧 Tuple 原地覆盖成新值，而是产生新的 Tuple 版本。Tuple Header 中的事务信息（例如 xmin、xmax）帮助数据库判断某个事务能否看到这个版本。

假设事务 A 正在读取一行，事务 B 同时更新这行并提交。A 仍然可以根据自己的 Snapshot 看到符合其可见性规则的旧版本，避免读到一个不一致的中间状态。PostgreSQL 官方文档明确说明，MVCC 使每条 SQL 语句看到一个历史快照，从而减少读写之间的锁冲突。[PostgreSQL：Introduction to MVCC](https://www.postgresql.org/docs/current/mvcc-intro.html)

旧 Tuple 不能永久保留。等到没有任何有效事务需要它时，VACUUM 才能回收 dead tuples 和相关空间。WAL（Write-Ahead Logging）则用于崩溃恢复和复制。WAL 记录与 MVCC Tuple 版本有关，但 WAL 不是一个让用户任意查询多年历史数据的审计库。

所以，PostgreSQL 的 MVCC 首先解决的是并发事务隔离和一致性。事务结束后，旧版本可能在后续 VACUUM 中被清理。若应用需要查询几个月前的业务状态，通常还需要审计表、事件表、历史表、逻辑复制归档或其他时间建模机制。

### 6.2 Oracle：Undo 既服务事务，也支持 Flashback

Oracle 使用 Undo 保存事务修改前的数据。Undo 一方面用于回滚未提交事务，另一方面为一致性读提供旧版本。Flashback Query 可以利用保留的 Undo 数据查询过去某个时间点的状态，例如：

```sql
SELECT *
FROM trades AS OF TIMESTAMP
  TO_TIMESTAMP('2026-11-01 12:00:00', 'YYYY-MM-DD HH24:MI:SS')
WHERE trade_id = 1001;
```

Oracle 的 Flashback 技术还包括 Version Query、Transaction Query、Flashback Table 等能力。它们依赖 Undo 保留策略、数据库配置和具体功能条件。Oracle 还提供 Flashback Time Travel 等能力，用于更长期的历史跟踪，但需要单独配置和评估。[Oracle：Using Flashback Technology](https://docs.oracle.com/en/database/oracle/oracle-database/26/adfns/flashback.html)

因此，Oracle 早就具备历史查询和恢复能力。Snowflake 的 Time Travel 并不是“第一个能查历史数据的数据库”。

### 6.3 Snowflake Time Travel：保留历史表状态

Snowflake 的标准表使用微分区作为数据组织单元。表发生更新、删除或对象被删除时，Snowflake 会在保留窗口内保存变更前的历史数据状态，使用户可以按时间、偏移量或语句 ID 查询历史版本，也可以从过去的时间点创建 Clone 或恢复被删除的对象。

概念上可以把它理解为：一次提交改变了表当前引用的数据版本，旧版本的数据文件和元数据关系在保留期内仍然可用。历史查询选择过去的逻辑版本，而不必让用户自己维护一张复制的历史表。这里是帮助理解的逻辑模型，并不是对 Snowflake 内部文件格式或元数据表结构的完整描述。

![Snowflake Time Travel 版本模型](/diagrams/snowflake-time-travel-version-model.svg)

完整图示：[HTML 交互查看](/diagrams/snowflake-time-travel-version-model.html)

Snowflake 的语法包括：

```sql
-- 查询 1 小时前的表状态
SELECT *
FROM ANALYTICS.TRADES
AT (OFFSET => -3600);

-- 按语句 ID 查询执行前的历史状态
SELECT *
FROM ANALYTICS.TRADES
BEFORE (STATEMENT => '01b...');

-- 从历史时间点创建 Clone
CREATE TABLE ANALYTICS.TRADES_DEBUG
CLONE ANALYTICS.TRADES
AT (TIMESTAMP => '2026-11-16 10:00:00'::TIMESTAMP);
```

标准保留期为 1 天。Enterprise Edition 及更高版本的永久表可以将保留期设置为最长 90 天；Standard Edition 的标准保留期为 1 天，也可以设置为 0 关闭 Time Travel。临时表和 Transient 表有不同限制，不能直接套用永久表的 90 天规则。[Snowflake：Time Travel](https://docs.snowflake.com/en/user-guide/data-time-travel)

### 6.4 Time Travel 与 Fail-safe 不要混淆

Time Travel 是用户可以主动查询、克隆和恢复历史数据的窗口。超过这个窗口后，符合条件的历史数据进入 Fail-safe。Fail-safe 是 Snowflake 提供的 7 天 best-effort 灾难恢复服务，需要联系 Snowflake Support；它不是用户可以继续执行历史 SELECT 的第二个窗口。[Snowflake：Fail-safe](https://docs.snowflake.com/en/user-guide/data-failsafe)

两者也会影响存储费用。历史版本在 Time Travel 和 Fail-safe 生命周期中仍然占用存储空间。频繁更新大表、删除大量数据或长期保留历史版本，都可能增加存储成本。Zero-copy Clone 初始共享底层数据，但克隆表后续发生修改时会产生新的存储数据。[Snowflake：Storage Costs](https://docs.snowflake.com/en/user-guide/data-cdp-storage-costs)

### 6.5 Snowflake 有 ACID 事务，但不等于传统 OLTP 并发模型

Snowflake 官方说明其事务具备 ACID 属性，但标准表当前只支持 READ COMMITTED 隔离级别。它与 PostgreSQL、Oracle 一样能保证事务内语句的提交与回滚边界，却不意味着它提供了相同的行级锁定和并发更新模型。标准表在修改资源时会获取资源锁；`UPDATE`、`DELETE` 和 `MERGE` 通常不能在同一张表上并行执行，`INSERT` / `COPY` 则经常可以并行。`SELECT ... FOR UPDATE` 只支持 Hybrid Table，Hybrid Table 才提供行级锁。因此，标准 Snowflake Table 不应被当作依赖行锁协调高频热点记录的 OLTP 表。[Snowflake Transactions](https://docs.snowflake.com/en/sql-reference/transactions) · [FOR UPDATE](https://docs.snowflake.com/en/sql-reference/constructs/for-update)

另一个容易踩坑的地方是 DDL 的事务语义。Snowflake 的 DDL 语句各自作为独立事务执行；如果在显式事务中执行 DDL，活动事务会先被隐式提交，DDL 随后单独执行。因此，不能照搬 PostgreSQL 中“把一组 DDL 和 DML 放进一个事务，失败后整体回滚”的脚本假设。部署工具、迁移脚本和回滚方案需要按 Snowflake 的事务规则设计。

这也解释了 Snowflake 与 PostgreSQL / Oracle 的定位差异：Snowflake 标准表有事务能力，但它的主要优化目标仍然是分析型查询和批量数据处理。对于需要频繁锁定单行、多个事务竞争更新同一业务记录、强约束在线写入的场景，仍应优先使用传统 OLTP 数据库。

### 6.6 三种机制的差异

| 机制 | 主要目的 | 历史版本从哪里来 | 用户能否任意查询历史 |
| --- | --- | --- | --- |
| PostgreSQL MVCC | 并发事务一致性 | Heap Tuple 旧版本 | 受 Snapshot 和旧版本回收影响，不是长期历史服务 |
| Oracle Undo / Flashback | 一致性读、回滚和历史查询 | Undo 数据及相关 Flashback 能力 | 在 Undo/Flashback 保留策略允许的范围内 |
| Snowflake Time Travel | 历史查询、误操作恢复、历史 Clone | 保留期内的历史表状态及相关数据版本 | 可以，受对象类型和配置的保留期约束 |

它们的共同点是都要保留足以重建某个旧状态的信息；不同点在于保留版本的目的、数据组织方式、清理策略以及对用户暴露的接口。不能因为 PostgreSQL 有 MVCC，就认为它天然等同于 Snowflake Time Travel；也不能因为 Snowflake 有 Time Travel，就把它当作无限期审计日志。

## 7. 这些特性是不是数据湖也有？

这是另一个容易混淆的地方。数据湖、文件格式和湖仓表格式不是同一个概念。

**数据湖**通常指以对象存储或分布式文件系统为基础的数据存放体系，里面可以放 Parquet、ORC、Avro、CSV、JSON、图片和其他文件。它本身不自动提供关系数据库的事务、表目录、并发写入协调和历史版本语义。

**Parquet**是列式文件格式。它将数据组织成 Row Group，每个 Row Group 内有多个 Column Chunk，文件元数据记录列块的位置。读取者可以先读取文件元数据，再只读取需要的列块。[Apache Parquet File Format](https://parquet.apache.org/docs/file-format/)

所以列存储不是 Snowflake 的独家能力。Snowflake 原生表采用自己管理的内部列式格式；Parquet 是开放格式，DuckDB、Spark、Trino 等引擎都能读取。Snowflake 的 Iceberg Table 也使用开放湖仓表格式和外部云存储。

### 7.1 Iceberg：把一组文件管理成一张有版本的表

如果只有 Parquet 文件，系统仍然需要知道哪些文件属于一张表、当前表有哪些文件、Schema 是什么、分区规则如何变化，以及多个写入者如何提交数据。

Apache Iceberg 就是为解决这类问题而设计的表格式。它通过 metadata file、snapshot、manifest list 和 manifest 来描述一张表当前引用的数据文件。一个 Snapshot 表示某个提交时刻的完整表状态；新的写入通常先生成数据文件和新元数据，再通过原子更新元数据指针提交。读者读取当前元数据所指向的 Snapshot，不会看到尚未提交的文件集合。[Apache Iceberg Table Specification](https://iceberg.apache.org/spec/)

Iceberg 因此具备快照、Schema 演进、并发提交控制和 Time Travel 等湖仓能力。它和 Snowflake Time Travel 在用户可见的目标上有相似之处，但实现模型并不一样：Iceberg 的数据文件通常是 Parquet、Avro 或 ORC 等开放文件；Snowflake 原生表的数据文件则由 Snowflake 自己管理。

### 7.2 Delta Lake 也有事务日志和历史版本

Delta Lake 使用带版本的 Parquet 文件保存数据，并通过事务日志记录每次提交对文件集合的增加和移除。它与 Iceberg 的元数据组织方式不同，但都在解决同一类问题：对象存储上的一组文件，如何被多个计算引擎可靠地当成一张表来读写。[Delta Lake FAQ](https://docs.delta.io/delta-faq/)

Delta 的写入流程更具体地体现了乐观并发控制：先读取当前表版本和相关文件，写出新的数据文件，再检查自读取快照以来是否有其他事务提交了冲突变更；没有冲突才发布新版本，有冲突则失败并由调用方决定重试。Delta 文档把它概括为 Read、Write、Validate and Commit 三个阶段。[Delta Lake：Concurrency Control](https://docs.delta.io/concurrency-control/)

这里还有一个经常被忽略的前提：Delta 的 ACID 保证依赖底层存储提供原子可见性、互斥创建和一致的目录列表等能力。不同对象存储的保证并不完全相同，Delta 通过 LogStore 等机制适配；例如官方文档对 S3 多集群并发写入就列出了额外配置要求。因此，“用了 Delta”不代表可以忽略底层存储和提交协调器的正确配置。[Delta Lake：Storage Configuration](https://docs.delta.io/delta-storage/)

因此，下面这些能力并不是 Snowflake 独有的：

| 能力 | Snowflake 原生表 | Parquet + 对象存储 | Iceberg / Delta Lake |
| --- | --- | --- | --- |
| 列式文件布局 | 有，Snowflake 内部格式 | Parquet 有 | 通常使用 Parquet 等列式文件 |
| 压缩与编码 | 自动管理 | 文件格式支持 | 依赖底层文件格式 |
| 过滤与文件裁剪 | 微分区统计与裁剪 | 依赖引擎读取文件统计信息 | Snapshot、Manifest、文件统计和分区信息 |
| 表级事务 | Snowflake 管理 | 单纯文件集合没有完整表事务 | 支持，具体隔离与并发语义看格式和 Catalog 实现 |
| 历史快照 / Time Travel | 原生支持，受保留期约束 | 对象版本控制不等于表事务 | 支持 Snapshot / Log 版本查询 |
| 统一身份、权限、审计和资源管理 | 平台提供 | 需要外围系统 | 需要 Catalog、计算引擎与治理系统配合 |

最需要记住的是：**对象存储 + Parquet 不等于 Iceberg，Iceberg 也不等于 Snowflake。** Parquet 负责描述文件里的数据如何排列；Iceberg 负责描述一张表由哪些文件构成、当前版本是什么；计算引擎负责执行 SQL；Catalog 和治理系统则负责目录、权限与服务管理。

### 7.3 Snowflake 的 Iceberg Table 是什么位置

Snowflake 支持 Apache Iceberg Table。它让 Snowflake 查询引擎能够访问由 Iceberg 元数据管理、存放在外部云存储中的数据。这样企业可以保留开放数据格式，让其他兼容引擎也能访问数据，而不必把所有数据都转换成 Snowflake 原生表。

但这也意味着 Iceberg Table 与 Snowflake 原生表的存储和生命周期管理并不完全相同。原生表的内部数据布局、微分区和历史版本由 Snowflake 管理；Iceberg 表的数据文件和元数据位于外部存储，表状态由 Iceberg 规范和相应 Catalog 管理。使用时应明确谁拥有 Catalog、谁负责提交、哪些引擎可以写入，以及权限与维护任务在哪里执行。[Snowflake：Iceberg Tables](https://docs.snowflake.com/en/user-guide/tables-iceberg)

### 7.4 湖仓表的事务与 PostgreSQL / Oracle 有什么本质区别？

先把“数据湖里的普通表”说清楚。如果它只是一个目录，下面放着若干 Parquet 文件，那么它并没有自动获得数据库事务能力。Parquet 定义的是文件内部如何存储列数据，不定义多个文件如何作为一张表一起提交。一个写入任务可能先写出三个新文件，再更新某个目录或清单；如果没有表格式、Catalog 或外部协调协议，读者可能看到新旧文件混杂的状态，两个写入者也可能互相覆盖或留下重复数据。对象存储的单个对象写入成功，不等于一组对象具备原子提交能力。

Iceberg 和 Delta Lake 正是补上这一层。它们不把每一行都变成一个带锁的数据库记录，而是把表当前包含哪些数据文件、删除文件和 Schema 信息，组织成一个有版本的快照或事务日志。写入者先在对象存储中生成新的数据文件，再构建新的元数据；最后通过 Catalog 的原子 compare-and-swap，或事务日志的原子提交机制，发布一个新的表版本。提交前写出的文件还不是当前表快照的一部分；提交成功后，新读者看到新快照，已经开始读取的读者仍可以沿用之前固定的快照。

![湖仓表格式与传统数据库事务流程](/diagrams/lakehouse-vs-rdbms-transaction-flow.svg)

完整图示：[HTML 交互查看](/diagrams/lakehouse-vs-rdbms-transaction-flow.html)

Iceberg 规范明确描述了这种乐观并发提交：写入者基于当前元数据版本构建新版本，提交时原子替换元数据指针；如果基础版本已经变化，写入者需要重新验证、重试，或者报告冲突。Snapshot 由 Manifest 和数据文件组成，读者通过当时读取的元数据定位一组一致的数据文件。[Apache Iceberg Specification：Snapshots and Optimistic Concurrency](https://iceberg.apache.org/spec/)

Delta Lake 的组织方式不同：它以事务日志记录每个版本对数据文件集合的添加和移除，读者根据日志构建某一版本的表状态。它与 Iceberg 都提供表级提交边界，但不能把两者的日志结构、冲突检测和隔离保证当成完全相同的实现。具体行为还取决于使用的 Catalog、存储系统、引擎版本和并发写入配置。

PostgreSQL 和 Oracle 的事务边界则更深入到数据库存储引擎内部。PostgreSQL 更新一行时会产生新的 Tuple 版本，并通过行锁协调冲突写入；WAL 记录需要恢复的变更。事务提交时写入 Commit Record，之后由 MVCC Snapshot 决定其他事务是否能看到新版本。默认同步提交配置下，提交确认前会等待相关 WAL 持久化；调整 `synchronous_commit` 可以改变这个延迟与持久性边界。旧版本在不再被有效快照需要时才可由 VACUUM 回收。WAL 主要负责崩溃恢复与持久性，MVCC 负责版本可见性，两者不是同一个机制。[PostgreSQL：WAL](https://www.postgresql.org/docs/current/wal-intro.html) · [PostgreSQL：MVCC](https://www.postgresql.org/docs/current/mvcc-intro.html)

Oracle 的实现不同于 PostgreSQL。事务修改记录时会持有相应的行锁；修改数据块时，Oracle 生成 Undo 信息以支持回滚和一致性读，同时生成 Redo 记录用于崩溃恢复。事务提交时分配 SCN，并将包含提交信息的 Redo 写入 Online Redo Log；读操作依据查询开始时的 SCN，必要时使用 Undo 重建一致性读所需的旧版本。[Oracle：Transactions and SCNs](https://docs.oracle.com/en/database/oracle/oracle-database/21/cncpt/transactions.html) · [Oracle：Data Concurrency and Consistency](https://docs.oracle.com/en/database/oracle/oracle-database/21/cncpt/data-concurrency-and-consistency.html)

因此，湖仓表格式与传统数据库的差异可以归纳为三个方面：

| 比较点 | Iceberg / Delta Lake | PostgreSQL / Oracle |
| --- | --- | --- |
| 事务提交对象 | 一组数据文件对应的表快照 / 日志版本 | 事务修改的记录、索引和数据库内部状态 |
| 并发协调 | 以乐观提交、元数据版本冲突检测为核心；具体隔离语义依实现和配置 | 数据库事务管理器协调锁、版本可见性和提交顺序 |
| 历史版本 | 保留旧 Snapshot / Log 版本，按策略清理文件 | PostgreSQL 保留 Tuple 版本；Oracle 使用 Undo 重建旧版本 |
| 持久性与恢复 | 数据文件先写入，提交元数据版本；失败文件可能成为待清理的孤儿文件 | WAL 或 Redo 保障崩溃恢复；Undo 参与回滚和一致性读 |
| 更新粒度 | 通常通过新增文件、删除文件标记或文件重写表达变更 | 面向行 / 数据块进行记录级修改与并发控制 |
| 典型适用负载 | 分析、批量写入、流式摄取、多引擎共享数据 | 高频小事务、记录级更新、约束检查和在线业务 |

这里不能得出“Iceberg 没有 ACID”或“数据湖事务不可靠”的结论。Iceberg 可以提供强表级原子提交和明确的快照隔离语义；Delta Lake 也提供 ACID 表事务。真正的差别是事务实现的层次和目标：湖仓格式主要保证一张表的文件集合不会以半提交状态暴露给读者；传统 RDBMS 还要在同一个事务管理体系内处理行级锁、并发更新、约束、回滚和故障恢复。

这也带来一个实际边界：不能因为 Iceberg 或 Delta 表支持事务，就默认它等同于 PostgreSQL 的 OLTP 表。默认的文件系统管理型 Delta 表以单表事务为边界；Delta 4.0.1 及以上还提供 Catalog-managed Tables，由 Catalog 协调提交并支持跨表事务，但这类表必须通过管理它的 Catalog 访问，不能再假设任意引擎都能直接按文件路径读写。[Delta Lake：Catalog-managed Tables](https://docs.delta.io/delta-catalog-managed-tables/)

Iceberg 多表事务、复杂外键约束、热点行更新和低延迟点写入，也都需要单独核实具体引擎与 Catalog 是否支持，不能从“ACID”三个字直接推导出来。数据湖上的表格式是分析数据的事务层，不是自动替代完整数据库事务管理器。

## 8. DuckDB 和 Snowflake 差异大吗？

如果只看 SQL 分析能力，两者并没有想象中那么遥远。DuckDB 是专门为分析型查询设计的数据库引擎，支持列式数据处理、向量化执行、并行扫描、过滤下推、Join 优化和聚合。它可以直接查询 Parquet 文件，也能访问对象存储中的数据。

DuckDB 官方文档描述了它的查询处理过程：Parser、Binder、Logical Planner、Optimizer、Physical Plan Generator，最后由执行算子处理 DataChunk。它采用向量化执行模型，算子以批次数据而不是逐行处理记录。[DuckDB Internals](https://duckdb.org/docs/current/internals/overview)

这与 Snowflake 在分析查询上的基本思路有相似之处：尽量减少无关数据读取，以批量方式处理列式数据，并通过优化器决定过滤、Join 和聚合的执行计划。差异主要不在 SQL 是否能写出来，而在引擎部署方式和完整平台能力。

![DuckDB 与 Snowflake 架构边界](/diagrams/duckdb-vs-snowflake-system-boundaries.svg)

完整图示：[HTML 交互查看](/diagrams/duckdb-vs-snowflake-system-boundaries.html)

### 8.1 DuckDB 是一个嵌入式分析引擎

传统使用方式下，DuckDB 运行在应用进程内部。Python、R、Node.js 或其他程序可以直接加载 DuckDB 库，在本地文件或内存数据库上执行 SQL。它不要求先部署一个独立数据库服务器，也不需要为每次查询都经过网络访问远程服务。

这让 DuckDB 在本地分析、数据清洗、批量转换和开发者工具中非常高效。比如一个 Python 程序可以直接读取数十个 Parquet 文件，执行 Join、窗口计算和聚合，再把结果写回 Parquet。对单机内存、CPU 和磁盘能够容纳的工作负载，它的部署成本和操作复杂度都很低。

DuckDB 的并发模型也有明确边界。官方 2.0 文档说明，在嵌入式 read-write 模式下，一个进程可以由多个线程并发读写；多个进程可以只读访问数据库文件，但原生数据库文件的多进程写入需要采用额外的服务或协调方式。DuckDB 使用 MVCC 和乐观并发控制处理进程内并发写入，多个线程同时修改相同记录时仍可能发生事务冲突。[DuckDB Concurrency](https://duckdb.org/docs/2.0/connect/concurrency.html)

### 8.2 DuckDB 2.0 已经可以作为服务运行

不能再简单地把 DuckDB 描述成“只能嵌入进程的本地库”。DuckDB 2.0 在 2026 年 10 月发布，进一步完善了 Quack 远程协议和 Server 模式，允许客户端连接一个 DuckDB 服务，由服务端管理数据库访问。对于需要多个进程或客户端访问同一数据库的场景，这比过去自行编写文件锁和访问代理更直接。[DuckDB 2.0 Release](https://duckdb.org/2026/10/21/announcing-duckdb-200.html)

此外，DuckLake 将 DuckDB 的分析引擎与开放湖仓表格式结合起来。DuckLake 可以使用 PostgreSQL 等 SQL 数据库作为中心 Catalog，把数据文件放在对象存储中。DuckLake 1.1 与 DuckDB 2.0 同期发布，目标是支持更完整的生产使用场景；多个 DuckDB 实例可以通过共享 Catalog 协调表元数据和并发读写。[DuckLake](https://ducklake.select/) · [DuckLake 1.1](https://ducklake.select/2026/10/21/ducklake-11/)

这已经不是一个简单的本地 SQL 库，而是一套可以组合出服务化分析平台的技术栈。

### 8.3 但 DuckDB 仍然不是 Snowflake 的同类完整平台

DuckDB 的执行能力可以很强，Quack 也增加了服务访问方式，但它的核心设计仍然是单机分析引擎。增加线程可以利用单机多核 CPU；增加多个 DuckDB Server 可以提高多条查询的并发处理能力，但不会自动把一条超大 SQL 拆到多台机器上形成 Snowflake 那样的 MPP 执行集群。

如果把 DuckDB 部署成企业数据服务，还需要自行设计统一认证、用户和租户隔离、查询排队、资源配额、审计、元数据管理、缓存、数据共享、备份恢复、监控和升级策略。使用 Iceberg 或 DuckLake 能解决部分表格式和快照问题，却不会自动提供完整的企业控制面。

这才是两者最大的差异。Snowflake 不只是一个更快的 DuckDB，它是把计算、存储、元数据、权限、调度、并发隔离和运维责任整合到一个托管平台中的产品。

### 8.4 两者在什么场景下会有接近的表现

如果数据量能够放进一台机器可处理的范围，查询主要是扫描 Parquet、过滤、Join 和聚合，且并发量不高，DuckDB 完全可能达到很好的性能。它省去了远程服务调用、集群调度和部分平台开销；对本地 ETL、数据探索、开发者工具和离线分析而言，往往比连接一个远程数仓更简单。

如果一条查询需要跨多台机器并行，或者几十、几百个用户同时执行查询，企业需要不同团队之间的计算隔离、统一权限、审计、弹性资源管理和托管 SLA，Snowflake 的平台能力就更重要。这里的差距不是某个 SQL 算子快了多少，而是整个系统是否已经把这些工作做成可运营的服务。

已有文章《[用 DuckDB + S3 搭一个轻量版 Snowflake](./duckdb-s3-lite-snowflake-report)》讨论了如何使用 DuckDB、对象存储和 Catalog 组合轻量分析平台。那篇文章关注自建系统需要补齐的组件；本文关注的是这些组件背后的数据库实现差异。

## 9. 最后如何选择：不要只比较 SQL 性能

在企业架构中，这几种技术通常不是互相替代的关系。

如果应用需要频繁创建订单、修改账户、维护状态和保证业务不变量，PostgreSQL 或 Oracle 仍然是更自然的权威写入端。它们的行存储、索引、事务隔离、约束和恢复机制就是为这种工作负载设计的。

如果企业需要汇总多年历史数据、整合多个系统、执行大范围分析和支撑大量 BI 查询，Snowflake 可以承担独立的分析平台。它将持久存储与计算资源分离，减少在线业务数据库被分析查询拖慢的风险。数据同步和建模仍需要单独设计，不能把 CDC 成功等同于历史模型正确。

如果数据希望保留在开放对象存储中，同时让 Spark、Trino、DuckDB 等多个引擎共享同一份数据，Iceberg 或 Delta Lake 会更合适。此时需要认真设计 Catalog、文件维护、快照过期、权限和多引擎写入协议。

如果主要工作是单机数据处理、开发者本地分析、批量 Parquet 读写或低并发的内部数据服务，DuckDB 值得优先评估。它的成本和运维负担都低，但当它被包装成多人共享的企业服务时，认证、资源隔离、审计和故障恢复就必须由平台层承担。

这几种技术真正的分界线可以归纳为：

- PostgreSQL / Oracle 解决通用事务数据库问题，重点是记录级读写、并发控制和业务一致性。
- Snowflake 解决托管云分析平台问题，重点是列式数据布局、微分区裁剪、MPP 执行、独立计算资源和统一控制面。
- Parquet / Iceberg / Delta Lake 解决开放文件和湖仓表管理问题，重点是文件布局、快照、元数据与多引擎协作。
- DuckDB 解决高效嵌入式分析问题，重点是单机列式执行、向量化和低部署成本。

因此，Snowflake 的技术价值不在于它独占了某项数据库理论，而在于它把已经成熟的数据库技术重新组织成适合云环境的大规模分析服务。Time Travel、列存储和快照在其他数据库与湖仓系统中都能找到对应实现；真正需要比较的是这些能力由谁管理、版本如何提交、计算如何扩展、权限在哪里执行，以及系统故障时由谁负责恢复。

## 参考资料

### Snowflake
- [Key Concepts and Architecture](https://docs.snowflake.com/en/user-guide/intro-key-concepts)
- [Understanding Snowflake Table Structures](https://docs.snowflake.com/en/user-guide/tables-micro-partitions)
- [Micro-partitions & Data Clustering](https://docs.snowflake.com/en/user-guide/tables-clustering-micropartitions)
- [Time Travel](https://docs.snowflake.com/en/user-guide/data-time-travel)
- [Fail-safe](https://docs.snowflake.com/en/user-guide/data-failsafe)
- [Transactions](https://docs.snowflake.com/en/sql-reference/transactions)
- [Storage Costs for Time Travel and Fail-safe](https://docs.snowflake.com/en/user-guide/data-cdp-storage-costs)
- [How FoundationDB Powers Snowflake Metadata Forward](https://www.snowflake.com/en/blog/how-foundationdb-powers-snowflake-metadata-forward/)

### PostgreSQL 与 Oracle
- [PostgreSQL MVCC Introduction](https://www.postgresql.org/docs/current/mvcc-intro.html)
- [PostgreSQL Write-Ahead Logging](https://www.postgresql.org/docs/current/wal-intro.html)
- [PostgreSQL synchronous_commit](https://www.postgresql.org/docs/current/runtime-config-wal.html#GUC-SYNCHRONOUS-COMMIT)
- [PostgreSQL Database Page Layout](https://www.postgresql.org/docs/current/storage-page-layout.html)
- [Oracle Transactions and System Change Numbers](https://docs.oracle.com/en/database/oracle/oracle-database/21/cncpt/transactions.html)
- [Oracle Data Concurrency and Consistency](https://docs.oracle.com/en/database/oracle/oracle-database/21/cncpt/data-concurrency-and-consistency.html)
- [Oracle Flashback Technology](https://docs.oracle.com/en/database/oracle/oracle-database/26/adfns/flashback.html)
- [Oracle In-Memory Column Store Architecture](https://docs.oracle.com/en/database/oracle/oracle-database/26/inmem/in-memory-column-store-architecture.html)

### Data Lake、Iceberg 与 DuckDB
- [Apache Parquet File Format](https://parquet.apache.org/docs/file-format/)
- [Apache Iceberg Table Specification](https://iceberg.apache.org/spec/) — Snapshot、Manifest、原子元数据提交与乐观并发控制
- [Delta Lake FAQ](https://docs.delta.io/delta-faq/)
- [Delta Lake Concurrency Control](https://docs.delta.io/concurrency-control/)
- [Delta Lake Storage Configuration](https://docs.delta.io/delta-storage/)
- [Delta Lake Catalog-managed Tables](https://docs.delta.io/delta-catalog-managed-tables/)
- [DuckDB Internals](https://duckdb.org/docs/current/internals/overview)
- [DuckDB Concurrency](https://duckdb.org/docs/2.0/connect/concurrency.html)
- [DuckDB 2.0 Release](https://duckdb.org/2026/10/21/announcing-duckdb-200.html)
- [DuckLake](https://ducklake.select/)
