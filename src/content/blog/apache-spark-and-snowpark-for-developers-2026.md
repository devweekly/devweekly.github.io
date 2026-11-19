---
author: W
featured: false
draft: false
description: 面向熟悉编程、SQL 和分布式系统但尚未接触 Spark 的开发者，从 DataFrame、惰性执行和分布式任务调度讲清 Apache Spark，再对比 Snowpark Python 与 Snowpark Connect for Apache Spark 的执行模型、适用场景和迁移边界。
pubDatetime: 2026-11-19T00:00:00Z
title: 从零理解 Apache Spark 与 Snowpark：给开发者的分布式数据计算入门
tags:
  - tech
  - data
  - spark
  - pyspark
  - snowflake
  - snowpark
  - data-engineering
---

# 从零理解 Apache Spark 与 Snowpark：给开发者的分布式数据计算入门

如果你熟悉 Python、TypeScript、C++、SQL、数据库和常规后端系统，但没有使用过 Spark，那么第一次接触它时很容易产生几个疑问：Spark 是数据库吗？为什么 Python 代码能在几十台机器上执行？DataFrame 看起来像 pandas，为什么一次 `show()` 可能触发集群任务？Snowpark 又是什么，它和 Spark 是竞争关系，还是 Snowflake 版本的 Spark？

这些问题需要从执行模型开始理解。Spark 是一个分布式计算引擎，负责把数据处理任务拆分、调度到集群执行；Snowpark 是 Snowflake 提供的一组开发 API 和代码运行环境，让开发者使用 Python、Java 或 Scala 操作 Snowflake 中的数据。两者都能用 DataFrame 风格表达转换，但它们并不运行在同一种计算架构上。

本文以 Python 为主，不要求 Java 或 Scala 背景。示例尽量使用开发者熟悉的 SQL、函数调用和数据处理逻辑，再逐步展开分区、DAG、Shuffle、Catalyst、Executor、Warehouse 等概念。读完后，应该能够判断什么时候需要 Spark，什么时候直接使用 Snowpark，什么时候才值得研究 Snowpark Connect。

**资料核对日期：2026 年 11 月 19 日。** Apache Spark 文档当前展示的版本为 4.3.0；Snowpark Connect 的兼容性文档目前说明支持 Apache Spark 3.5。产品支持范围可能变化，部署或迁移前应以目标环境的官方文档为准。

## 1. 先从熟悉的代码开始：Spark 到底解决什么问题？

假设有一份交易明细，包含数十亿行数据。我们要按交易日期、账户和币种汇总金额，并剔除无效交易。

用 SQL 表达非常自然：

```sql
SELECT trade_date, account_id, currency, SUM(amount) AS total_amount
FROM trades
WHERE status = 'VALID'
GROUP BY trade_date, account_id, currency;
```

如果数据只有几十万行，PostgreSQL、DuckDB 或 pandas 都可能轻松处理。数据增长到数十 TB，计算需要并行跨越多台机器，数据还分散在对象存储、数据湖或不同系统中时，单机程序就不再是合适的默认选择。

Spark 的工作是把这个逻辑变成分布式执行计划：读取数据时将数据切成多个 partition（分区），为每个分区生成任务，让多个 Executor 并行处理。需要按账户聚合时，同一账户的数据必须汇集到一起，Spark 会在网络和本地磁盘之间进行数据重分布，这一步通常称为 Shuffle。

Spark 不是某一种文件格式，也不是一个必须取代 PostgreSQL 的数据库。它是一个可以读取多种数据源、执行 SQL 和程序化转换、再把结果写回文件或数据库的计算引擎。常见数据源包括 Parquet、ORC、JSON、CSV、Hive 表、对象存储，以及通过 Connector 接入的数据库和消息系统。

![Spark 集群执行架构](/diagrams/spark-cluster-execution.svg)

完整图示：[HTML 查看 Spark 集群执行架构](/diagrams/spark-cluster-execution.html)

### Spark 与数据库、ETL 工具的关系

可以把 Spark 放在数据平台的计算层理解。数据库通常同时管理数据存储、索引/元数据、事务和查询执行；Spark 更关注如何在集群上执行一项计算。它可以读取数据库的数据，但通常不会接管源数据库的事务和数据权威。

传统 ETL 产品常把数据源、转换步骤、调度和运行环境封装成可配置流程。Spark 提供的是更底层、更通用的计算运行时：开发者可以用 SQL 或 Python 编写转换逻辑，再由 Airflow、Dagster、Databricks Workflows、Kubernetes CronJob 等外部调度器安排运行。Spark 本身也有 Structured Streaming 等持续处理能力，但它不等同于完整的数据治理或工作流平台。

一个常见的数据平台会把职责分开：对象存储保存原始文件，Iceberg/Delta Lake/Hive Metastore 等提供表和元数据语义，Spark 承担批处理或流处理，Catalog 管理表的发现和权限，调度器管理任务依赖与重试，BI 或应用消费处理结果。具体组合取决于组织希望自己运维多少基础设施。

## 2. 第一个核心概念：DataFrame，不必从 RDD 学起

如果你写过 pandas，Spark DataFrame 的外观会非常熟悉：

```python
from pyspark.sql import functions as F

trades = spark.read.parquet("s3://lake/raw/trades/")

result = (
    trades
    .filter(F.col("status") == "VALID")
    .groupBy("trade_date", "account_id", "currency")
    .agg(F.sum("amount").alias("total_amount"))
)
```

这段代码描述了读取数据、过滤记录、分组和聚合。它没有要求你指定每个线程处理哪几行，也没有告诉 Spark 如何在机器之间传输数据。你表达的是“要什么”，Spark SQL 引擎负责分析和规划“怎么做”。

这里的 DataFrame 是带有列名和类型信息的分布式数据集合。它看起来像 pandas DataFrame，但执行语义完全不同。pandas 通常在当前 Python 进程中持有数据；Spark DataFrame 通常只是一个分布式计算计划的入口，数据实际保存在文件系统、对象存储或集群执行过程中产生的中间结果里。

这也解释了为什么 Spark DataFrame 不能随便当作 Python list 使用。你不能假设所有行都在当前进程内，也不能把一个几十 TB 的 DataFrame 转换成 Python 对象再操作。需要返回到 Driver 的数据应该是明确受控的小结果集。

### RDD 是什么？为什么入门时可以先放一边

RDD（Resilient Distributed Dataset）是 Spark 较早期的底层抽象：一个分布在多个节点、可以并行操作并能在故障后重新计算的集合。它让开发者可以用 map、filter、flatMap 等函数定义任意转换。

例如：

```python
rdd = spark.sparkContext.textFile("s3://lake/logs/")
errors = rdd.filter(lambda line: "ERROR" in line)
counts = errors.map(lambda line: (line.split()[0], 1)).reduceByKey(lambda a, b: a + b)
```

RDD 灵活，但引擎看到的通常是通用函数，难以理解函数内部到底访问了哪些列、是否可以下推过滤、是否可以裁剪不需要的字段。DataFrame 则保留了结构化信息，Spark SQL 可以据此做更完整的查询优化。官方文档也建议结构化数据处理优先使用 DataFrame，而不是低层 RDD API。

因此，现代 Spark 开发的主线是 Spark SQL + DataFrame。RDD 仍然有用，例如某些非结构化或需要精细控制的转换，但不应把它当成所有新项目的默认入口。

参考：[Spark SQL、DataFrame 与 Dataset 指南](https://spark.apache.org/docs/latest/sql-programming-guide.html) · [PySpark 概览](https://spark.apache.org/docs/latest/api/python/)

## 3. 为什么代码还没执行？理解惰性计算与 Action

这是第一次使用 Spark 最容易踩到的认知差异。

```python
df = spark.read.parquet("s3://lake/trades/")
valid = df.filter(F.col("status") == "VALID")
by_account = valid.groupBy("account_id").agg(F.sum("amount").alias("total"))
```

执行到这里，Spark 通常只是构建转换计划。它不会因为你调用了 `filter()` 就立刻把整份数据读入 Python，也不会每写一行就启动一个集群任务。这种行为叫 Lazy Evaluation（惰性计算）。

当你调用 Action，Spark 才需要真正得到结果：

```python
by_account.show(20)
by_account.count()
by_account.write.mode("overwrite").parquet("s3://lake/curated/account_totals/")
```

`show()`、`count()`、`collect()`、`write` 等操作会触发执行。一个 Action 会提交相应的执行工作；如果你连续执行 `show()` 和 `write()`，而中间没有缓存或持久化结果，Spark 可能重新计算上游计划。

这和普通函数调用的直觉不同。普通 Python 函数通常在调用时立即执行；Spark DataFrame API 更接近构建一个可优化的查询表达式。它和 ORM QuerySet、LINQ IQueryable、SQL AST 或编译器的中间表示有些相似：先描述操作，最后统一分析和执行。

![Spark DataFrame 惰性执行与任务生成](/diagrams/spark-lazy-execution.svg)

完整图示：[HTML 查看惰性执行与任务生成](/diagrams/spark-lazy-execution.html)

### Transformation、Action 与缓存

Transformation 是构建新计划的操作，例如 `select`、`filter`、`join`、`groupBy`。Action 是要求执行并产生外部可见结果的操作，例如显示数据、返回计数、写文件或写表。

缓存并不是越多越好。若一个中间 DataFrame 被多个下游 Action 重复使用，`cache()` 或 `persist()` 可以避免重复计算；如果只用一次，缓存反而可能消耗 Executor 内存，并引入缓存管理开销。缓存也不是数据库事务或可靠的长期存储：Executor 丢失时，Spark 可以根据 lineage 重新计算丢失的分区。

```python
enriched = (
    spark.read.parquet("s3://lake/raw/trades/")
    .filter(F.col("status") == "VALID")
    .join(accounts, "account_id")
    .select("trade_date", "account_id", "segment", "amount")
    .cache()
)

# 两个下游分支复用相同的中间结果
enriched.groupBy("segment").agg(F.sum("amount")).show()
enriched.write.mode("overwrite").parquet("s3://lake/curated/trades/")
```

### 看执行计划，而不是猜测代码快不快

`explain()` 可以显示 Spark 的逻辑计划和物理计划：

```python
by_account.explain("formatted")
```

刚入门时重点看三件事：过滤和列裁剪是否尽早发生；Join 使用了什么策略；聚合或 Join 是否引入 Shuffle。执行计划是判断引擎将如何处理数据的第一手信息，代码行数和链式 API 的长短并不能说明执行成本。

## 4. 集群如何真正跑起来：Driver、Executor、Task 和 Partition

Spark 应用通常有一个 Driver 进程和多个 Executor 进程。Driver 负责创建 SparkSession、构建并分析执行计划、协调 Job/Stage/Task 的调度，并收集少量最终结果。Executor 运行在工作节点上，负责执行任务、缓存分区数据、读写数据并向 Driver 汇报状态。

一个 Job 通常由某个 Action 触发。DAG Scheduler 会根据依赖关系把 Job 拆成 Stages；Stage 内再按分区生成 Tasks。Task 是实际分配给 Executor 执行的最小调度单元之一。假设某个 Stage 有 200 个输入分区，就可能产生约 200 个 Task；这些 Task 会在可用 Executor 的执行槽位上并行运行。

Partition 是逻辑数据切片，不等同于一台机器，也不等同于一个文件。一个 Executor 可以处理多个 Partition，一个 Partition 也可能在不同时间被不同 Executor 处理。增加分区通常能增加并行度，但分区太多会增加调度和小文件开销；分区太少则可能让集群资源闲置。

### Shuffle：分布式计算真正昂贵的地方

过滤、选择列等操作通常可以在每个分区本地完成，不需要机器之间重新分配数据。按 key 聚合、按 key Join、全局排序等操作则经常需要 Shuffle：上游任务把数据按目标分区规则重新分组，写出中间数据，随后下游任务通过网络读取这些数据。

Shuffle 的代价不仅是网络流量，还包括序列化、磁盘 I/O、数据排序/哈希、内存压力和任务间同步。数据倾斜会让问题更严重：例如某个账户或某个状态值占据数据的 40%，按 key 分组时一个分区可能远大于其他分区，最终形成长尾 Task。集群平均 CPU 利用率看起来不高，作业却一直被少数慢任务拖住。

![Spark 分布式执行中的 Shuffle 边界](/diagrams/spark-shuffle-boundary.svg)

完整图示：[HTML 查看 Shuffle 数据重分布](/diagrams/spark-shuffle-boundary.html)

工程上应当关注 Spark UI 中的 Stage 时间、Shuffle Read/Write、Spill、Task Duration 分布、输入记录数和数据倾斜，而不是仅仅增加 Executor 数量。扩容无法修复不合理的 Join、倾斜 key 或大量小文件；它有时只会让更多资源等待同一个瓶颈。

## 5. Spark 为什么能优化 SQL：Catalyst、物理计划与 AQE

Spark SQL 不会简单地把 Python 的每个函数逐条解释执行。对于 DataFrame 的结构化操作，Spark 会形成逻辑计划，经过分析、规则优化和物理计划选择，再由执行引擎运行。

可以用编译器来类比：Python DataFrame API 是一种表达计算意图的前端；逻辑计划类似中间表示；Catalyst Optimizer 对表达式和关系操作做分析与重写；物理规划器选择 Join、Aggregate 等算子的执行方式；最后由 Spark 执行运行时在分区上执行任务。无论你使用 PySpark 还是 Spark SQL，结构化查询最终都进入同一个 Spark SQL 执行引擎。

Catalyst 能做的优化包括谓词下推（尽量提前过滤）、列裁剪（只读取需要的列）、常量折叠、表达式简化、Join 重排以及选择不同的物理算子。对于 Parquet 这样的列式格式，列裁剪意味着可以避免读取不需要的列；谓词下推和文件/分区元数据则可能进一步减少扫描的数据量。

Adaptive Query Execution（AQE）允许 Spark 在执行过程中根据运行时统计调整部分物理计划，例如合并过小的 Shuffle 分区、处理部分倾斜 Join、调整 Join 策略。它并不意味着任何计划都能自动变好：错误的统计信息、复杂 UDF、资源不足或数据布局问题仍可能让查询表现不佳。

### PySpark 的 Python 代码到底在哪运行？

PySpark 的 DataFrame 操作大多是在 Python 侧构建表达式，Spark SQL 引擎负责执行结构化算子。不是每一行数据都要从 JVM 传到 Python，再由 Python 循环处理。对于 `select`、`filter`、`groupBy` 等内置函数，尽量让它们保持在 Spark SQL 可识别的表达式中，才能让优化器看到完整逻辑。

如果使用 Python UDF，执行过程可能需要在 JVM Executor 与 Python Worker 之间传递数据。数据序列化、进程间通信和 Python 函数调用会带来额外成本，也可能限制优化器对函数内部逻辑的理解。能用 `pyspark.sql.functions` 表达的转换，通常不应该改写成逐行 Python UDF。需要批量执行 Python 函数时，可以评估 Pandas UDF 和 Arrow，但它们仍有数据转换、批大小和内存方面的成本。

```python
# 优先：SQL 引擎能识别表达式
clean = df.withColumn("net_amount", F.col("amount") - F.col("fee"))

# 谨慎：每行调用 Python 函数，可能跨 JVM/Python Worker 边界
from pyspark.sql.functions import udf
from pyspark.sql.types import StringType

@udf(StringType())
def normalize_status(value):
    return value.strip().upper() if value else None
```

这不是说 Python 不适合 Spark。PySpark 是正式支持的主流 API，支持 SQL、DataFrame、Structured Streaming 和 MLlib 等功能。关键是区分“用 Python 写计划”和“让 Python 逐行执行数据逻辑”。

## 6. Snowpark 是什么？它不是把 Spark 改个名字

Snowpark 是 Snowflake 提供的开发 API 和代码运行环境。Snowpark Python 允许开发者在 Python 中创建 DataFrame、调用 select/filter/join/groupBy 等操作，构建数据转换逻辑。其目标是让代码在 Snowflake 中处理数据，而不是把大批数据下载到本地 Python 进程再计算。

```python
from snowflake.snowpark import Session
from snowflake.snowpark.functions import col, sum as sum_

session = Session.builder.configs(connection_parameters).create()

trades = session.table("RAW.TRADES")

result = (
    trades
    .filter(col("STATUS") == "VALID")
    .group_by("TRADE_DATE", "ACCOUNT_ID", "CURRENCY")
    .agg(sum_("AMOUNT").alias("TOTAL_AMOUNT"))
)

result.show()
```

代码表面上和 PySpark 很像，但背后的运行方式不同。Snowpark DataFrame 主要是 Snowflake SQL 的程序化构建接口：开发者通过 Python API 组合表达式，Snowpark 将可下推的转换转换为 SQL，由 Snowflake 的计算引擎在 Virtual Warehouse 上执行。数据通常留在 Snowflake 内部，不需要额外部署一套 Spark 集群。

![Spark 与 Snowpark Python 的执行边界比较](/diagrams/spark-vs-snowpark-execution.svg)

完整图示：[HTML 查看 Spark 与 Snowpark 的执行边界](/diagrams/spark-vs-snowpark-execution.html)

### Snowpark Python 与 pandas 的差别

Snowpark DataFrame 也不是 pandas DataFrame。它通常是一个尚未执行的查询表达式，数据存储在 Snowflake 表或 Stage 中。调用 `collect()` 会把结果拉回 Python 客户端；如果结果很大，这可能造成客户端内存压力和网络成本。应优先使用 `save_as_table()`、`write` 或其他服务端操作，让结果继续留在 Snowflake。

```python
# 在 Snowflake 内构建转换
df = session.table("RAW.TRADES").filter(col("STATUS") == "VALID")

# 把结果写回 Snowflake 表，计算仍由 Snowflake 执行
df.write.save_as_table("ANALYTICS.VALID_TRADES", mode="overwrite")

# 只在明确需要时把结果取回 Python
small_result = df.limit(100).collect()
```

Snowpark 的价值在于把 Python 的可组合性、IDE 类型提示和单元测试习惯带进数据工程，同时复用 Snowflake 的仓库计算、权限、审计和治理能力。它不是一个可以任意访问集群节点、控制每个分区和 Executor 的通用分布式计算框架。其优化边界是 Snowflake SQL 和 Snowflake 的运行环境。

官方文档：[Snowpark API](https://docs.snowflake.com/en/developer-guide/snowpark) · [Snowpark Python Developer Guide](https://docs.snowflake.com/en/developer-guide/snowpark/python/index)

## 7. Spark 与 Snowpark：相似的 DataFrame，不同的计算责任

开发者很容易只看 API：两边都有 `filter`、`select`、`join`、`groupBy`，代码也都能用 Python 写。但架构比较应该看数据在哪里、谁负责执行、谁负责扩展、哪些资源由谁运维。

| 比较维度 | Apache Spark / PySpark | Snowpark Python |
| --- | --- | --- |
| 产品性质 | 开源分布式计算引擎 | Snowflake 的开发 API 与代码执行环境 |
| 计算位置 | Spark 集群的 Driver / Executors | Snowflake Virtual Warehouse 或对应 Snowflake 执行环境 |
| 数据位置 | 对象存储、HDFS、表格式、数据库等多种来源 | 主要围绕 Snowflake 表、Stage 和受支持的数据源 |
| 并行模型 | 分区、Task、Stage、Executor、Shuffle | Warehouse 的计算资源与 Snowflake 内部执行计划 |
| 查询优化 | Catalyst、物理计划、AQE | Snowflake SQL 优化器和执行引擎 |
| 资源管理 | 组织需要选择和运维集群/托管 Spark 服务 | Warehouse 尺寸、自动暂停/恢复、并发和资源策略 |
| 代码自由度 | 可运行更广泛的分布式 Python/JVM 逻辑及扩展 | 以可转换为 Snowflake 操作的 DataFrame/SQL 为主；自定义代码受运行时边界约束 |
| 典型使用场景 | 多源数据湖、复杂 ETL、流批处理、分布式算法 | Snowflake 内的数据转换、数据产品、特征工程和 Python 化的数据管道 |
| 运维重点 | 集群容量、Executor、Shuffle、依赖、日志、版本与任务调度 | Warehouse 成本/并发、Query History、SQL 计划、权限和包依赖 |

Spark 的主要优势是计算环境和数据源的开放性。它可以在 Kubernetes、YARN 或 Standalone 集群运行，也有托管服务；你可以对分区、并行度、执行资源和数据读写路径做更多控制。代价是需要负责更多基础设施和作业运营。

Snowpark 的主要优势是计算靠近 Snowflake 中的数据。若数据本来就在 Snowflake，转换逻辑又主要是 SQL 能表达的关系操作，通常没有必要为了执行 DataFrame 风格的 Python 代码再部署 Spark 集群。代价是计算模型受 Snowflake 引擎、支持的 API 和运行环境约束，不能把 Spark 的集群控制能力直接带过来。

两者也不是简单的性能高低关系。对一份已经在 Snowflake 中的表做筛选、Join 和聚合，Snowpark 避免了把数据搬出平台再计算；如果任务需要读取多个对象存储位置、执行复杂分布式算法，或者必须运行依赖特定 Python 库的分布式代码，Spark 的适用范围通常更广。真实性能仍取决于数据位置、数据规模、计算形态、并发、仓库/集群配置和数据布局，不能仅凭产品名称判断。

## 8. 容易混淆的第三个名字：Snowpark Connect for Apache Spark

Snowpark Connect for Apache Spark 是另一个产品边界。它不是 Snowpark Python 的别名，也不是在 Snowflake 里面启动一套普通 Spark Executor 集群。

它实现 Spark Connect 协议，让 PySpark/Spark Connect 客户端提交 Spark DataFrame 计划，由 Snowflake 端承接并把受支持的操作映射到 Snowflake 执行引擎。对已有 PySpark 代码而言，这提供了一条复用部分 DataFrame 逻辑的路径；但执行引擎已经不是 Apache Spark，因此兼容性和语义差异必须认真评估。

当前 Snowflake 文档列出的 Spark 版本支持范围是 Apache Spark 3.5；Spark 3.4 及更早版本、Spark 4.0 及更新版本不在该兼容范围内。不能因为本地 PySpark 已经升级到 4.x，就假设 Snowpark Connect 也能直接运行。

还有几个重要差异：

- **Spark Classic 与 Spark Connect 的客户端边界不同。** Spark Connect 通过 gRPC 把客户端计划发送到服务端，部分错误会推迟到 Action 执行时才暴露。
- **Snowflake 是底层执行引擎。** 数据类型、SQL 翻译、文件 I/O、Catalog 元数据和部分 API 的行为与 Apache Spark 不完全相同。
- **Spark 的分区控制不等于 Snowflake Warehouse 并行控制。** `repartition()` 不会像 Spark 集群那样决定 Executor 并行度；某些写入路径中反而可能产生多个顺序执行的 COPY 操作。
- **缓存语义不同。** Snowflake 文档说明，Snowpark Connect 的缓存会物化为临时表，并不等同于 Spark Executor 的纯内存缓存；重复 Action 也可能重复执行查询计划。
- **可观测性需要换工具。** `explain()` 看到的是 Snowflake 执行计划，不是 Spark 的物理计划；应结合 Snowflake Query History 和 Query Tag 关联作业。

![Snowpark Connect 的客户端与 Snowflake 执行边界](/diagrams/snowpark-connect-boundary.svg)

完整图示：[HTML 查看 Snowpark Connect 执行边界](/diagrams/snowpark-connect-boundary.html)

这意味着 Snowpark Connect 的迁移策略应该是“逐项验证可复用的 PySpark 逻辑”，而不是“把 Spark 作业地址改一下”。先确认 API 覆盖、数据源和文件路径、UDF、临时视图、缓存、事务语义和监控方式，再用真实数据做结果一致性与成本性能对比。

官方资料：[Snowpark Connect for Spark](https://docs.snowflake.com/en/developer-guide/snowpark-connect/snowpark-connect-overview) · [与 Apache Spark 的已知差异和限制](https://docs.snowflake.com/en/developer-guide/snowpark-connect/snowpark-connect-limitations)

## 9. 另一个经常被误认为 Snowpark 的组件：Snowflake Connector for Spark

Snowflake Connector for Spark 与 Snowpark Connect 是不同的集成方式。

Snowflake Connector for Spark 的典型用途，是让外部 Spark 作业读取或写入 Snowflake 数据。Spark 仍然是计算引擎，Spark 集群仍然承担计算；Connector 负责在 Spark 与 Snowflake 之间传输数据或下推部分操作。它适合 Spark 数据管道需要访问 Snowflake 表的场景。

Snowpark 则把开发 API 和计算放在 Snowflake 侧。Snowpark Connect 又进一步提供 Spark Connect 兼容客户端，让一部分 PySpark DataFrame 工作负载在 Snowflake 执行。三者的边界可以概括为：

| 组件 | 谁执行计算 | 谁持有主要数据 | 常见用途 |
| --- | --- | --- | --- |
| Spark + Snowflake Connector | 外部 Spark 集群 | Spark 可访问的数据源与 Snowflake 表 | Spark 作业读写 Snowflake |
| Snowpark Python | Snowflake 引擎 | Snowflake | 在 Snowflake 内用 Python API 构建数据转换 |
| Snowpark Connect for Spark | Snowflake 引擎 | Snowflake | 复用受支持的 PySpark/Spark Connect 代码 |

不要把 Connector 的“Spark 可以访问 Snowflake”误读成“Snowflake 提供了 Spark 计算集群”。这会直接影响架构、网络、成本和运维责任。

## 10. 如何选择：把计算放在数据旁边，还是把数据交给计算集群？

选择时先问数据权威在哪里，以及计算是否必须离开数据所在平台。

如果数据已经在 Snowflake，任务主要是清洗、Join、聚合、构建分析表或特征表，且可以由 SQL/DataFrame 表达，那么优先评估 Snowpark Python 或原生 SQL。这样可以减少数据移动、外部集群和额外身份/网络边界。Snowpark 并不意味着所有 Python 包都能随意运行；复杂的自定义逻辑要先确认适合 UDF、Stored Procedure、Container Runtime 还是外部计算服务。

如果数据主要位于 S3、ADLS、GCS 或开放湖仓表，处理需要跨多个存储和系统，或者需要 Structured Streaming、复杂分布式算法、特殊 Python/JVM 库及对执行拓扑的控制，那么 Spark 更自然。此时需要把 Spark 集群管理、依赖打包、作业调度、监控、权限、成本和故障恢复作为平台职责设计，而不是只把 notebook 代码搬到生产。

如果组织已经有大量 PySpark 作业，数据又希望逐步迁移到 Snowflake，可以把 Snowpark Connect 作为候选迁移路径，但前提是代码使用的 API 在支持范围内，并且作业不依赖 Spark 专属执行语义。迁移不是简单的语法兼容问题，而是执行引擎和运营模型的改变。

### 一个简化的决策矩阵

| 需求 | 优先评估 |
| --- | --- |
| 数据在 Snowflake，主要是 SQL 型转换 | Snowflake SQL / Snowpark Python |
| 数据在对象存储和开放表格式，跨源批量处理 | Apache Spark / PySpark |
| Kafka 等流数据需要持续计算与状态处理 | Spark Structured Streaming，或按现有平台评估专用流处理引擎 |
| 复杂 Python 算法，需要分布式执行和自定义依赖 | Spark；若数据在 Snowflake，进一步比较 Snowpark Container Runtime/Services |
| 已有 PySpark DataFrame 代码，希望在 Snowflake 执行 | Snowpark Connect，先做 API 与语义验证 |
| Spark 作业需要读取/写入 Snowflake | Spark + Snowflake Connector |
| 只有几 GB 的本地文件，单机可以完成 | pandas、Polars 或 DuckDB，通常不需要 Spark |

对金融服务数据平台，还应增加数据授权、审计、数据驻留、PII 处理、血缘和恢复要求。把数据复制到外部 Spark 集群，可能扩大数据暴露边界；把转换放在 Snowflake 内，也不代表自动满足所有控制要求，仍需验证角色权限、网络策略、日志保留、包依赖来源和数据共享策略。

## 11. 动手学习：先在本地跑 PySpark，再用 Snowpark 操作同一类数据

学习 Spark 不必先搭建 Kubernetes 或云端集群。可以在本地安装 PySpark，用少量数据观察 DataFrame API、惰性执行和执行计划。下面的示例不依赖 Java 代码；Spark 的运行时仍然需要 JVM 环境，但开发者只需通过 Python API 交互。

```bash
python -m venv .venv
source .venv/bin/activate
pip install pyspark
pyspark
```

在交互式环境中：

```python
from pyspark.sql import SparkSession, functions as F

spark = SparkSession.builder.appName("spark-intro").getOrCreate()

rows = [
    ("2026-11-01", "A100", "USD", 120.0, "VALID"),
    ("2026-11-01", "A100", "USD", 80.0, "VALID"),
    ("2026-11-01", "B200", "EUR", 50.0, "INVALID"),
    ("2026-11-02", "A100", "USD", 40.0, "VALID"),
]

df = spark.createDataFrame(
    rows,
    ["trade_date", "account_id", "currency", "amount", "status"]
)

summary = (
    df.filter(F.col("status") == "VALID")
      .groupBy("trade_date", "account_id", "currency")
      .agg(F.sum("amount").alias("total_amount"))
)

summary.explain("formatted")
summary.show()
```

先不要急着调参数。观察 `explain()` 输出，理解过滤和聚合如何出现在计划中；然后尝试加入 Join、排序和写入操作，再到 Spark UI 查看 Job、Stage、Task。最后把数据规模放大，比较分区数量、Shuffle 和倾斜对执行时间的影响。

Snowpark Python 的入门方式不同：需要 Snowflake 账号、角色、Warehouse 和连接配置。可以在本地 VS Code 或 Jupyter 安装 Snowpark Python 客户端，通过 Session 连接 Snowflake；代码在本地构建 DataFrame 表达式，查询执行由 Snowflake 负责。官方 Quickstart 包含数据工程管道和 Python/Streamlit 示例，适合沿着实际平台流程学习。

建议按这个顺序学习，避免一开始被集群配置和各种组件淹没：

1. **PySpark DataFrame**：读取 Parquet/CSV，练习 select、filter、join、groupBy、窗口函数和写入。
2. **惰性执行与执行计划**：区分 Transformation 和 Action，学会使用 explain。
3. **分区与 Shuffle**：观察 repartition/coalesce、Join、聚合的任务变化和数据倾斜。
4. **Spark SQL 与性能诊断**：理解 Catalyst、AQE、广播 Join、列裁剪、谓词下推和小文件问题。
5. **Structured Streaming**：理解流式 DataFrame、Checkpoint、Watermark、状态与输出模式。
6. **生产部署**：再学习 Kubernetes/YARN、依赖分发、作业调度、日志和资源隔离。
7. **Snowpark Python**：在 Snowflake 内用相同的数据转换思路实现 SQL 型管道，观察 Query History 和 Warehouse 消耗。
8. **Snowpark Connect**：只有在确实存在 PySpark 迁移需求时，再研究 Spark Connect 协议和 API 兼容矩阵。

参考学习入口：[Spark Quick Start](https://spark.apache.org/docs/latest/quick-start.html) · [PySpark 官方文档](https://spark.apache.org/docs/latest/api/python/) · [Structured Streaming](https://spark.apache.org/docs/latest/streaming/index.html) · [Snowpark Python Developer Guide](https://docs.snowflake.com/en/developer-guide/snowpark/python/index) · [Snowpark Python 数据工程 Quickstart](https://quickstarts.snowflake.com/guide/data_engineering_with_snowpark_python/)

## 12. 最后厘清三个概念

Apache Spark 是分布式计算引擎。PySpark 是它的 Python API；DataFrame 是现代 Spark 开发最常用的结构化编程接口。理解 Spark 的关键，是理解数据分区、惰性计划、Driver/Executor、Task/Stage、Shuffle 和 SQL 优化器，而不是先学习 Java。

Snowpark Python 是 Snowflake 的 Python 开发 API。它让开发者用 DataFrame 风格编写数据转换，但主要由 Snowflake SQL 引擎执行，适合把计算留在 Snowflake 数据旁边。它不是一套通用 Spark 集群，也不提供相同的分区与 Executor 控制模型。

Snowpark Connect for Apache Spark 则是面向 Spark Connect/PySpark 工作负载的兼容入口。它可以复用部分 Spark DataFrame 代码，但执行引擎、API 支持和部分语义都不同。把它视为迁移工具和兼容层更准确，不应把它理解成“完整 Apache Spark 被内置到 Snowflake”。

对开发者来说，最值得先掌握的是 Spark DataFrame 的声明式计算方式和执行计划。掌握之后再看 Snowpark，会很容易理解两者为何 API 相似、系统边界却不同。
