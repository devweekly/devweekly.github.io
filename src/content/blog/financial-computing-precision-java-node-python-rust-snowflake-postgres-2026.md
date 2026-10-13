---
author: W
featured: false
draft: false
description: 面向金融服务架构师和工程团队，比较 Java、Node.js、Python、Rust、Snowflake SQL 与 PostgreSQL 在金融计算中的精度、舍入、类型转换、日期规则和可审计性，并区分不依赖第三方库与使用第三方库的实现方案。
pubDatetime: 2026-10-13T10:00:00Z
title: 金融服务中的数值计算工程：Java、Node.js、Python、Rust、Snowflake 与 PostgreSQL 实战指南
tags:
  - tech
  - data
  - finance
  - architecture
---

# 金融服务中的数值计算工程：Java、Node.js、Python、Rust、Snowflake 与 PostgreSQL 实战指南

**资料核对日期：2026 年 10 月 13 日。**

本文讨论投资组合、证券交易、费用与佣金、利息计提、外汇换算、税务、估值、账务和分析数据处理中容易被忽略的计算问题。比较范围包括 Java、C#/.NET、Node.js/TypeScript、Python、Rust、Snowflake SQL 和 PostgreSQL，重点回答：

- 每种语言或平台的原生数值模型有什么限制？
- 不引入第三方库时，怎样把风险降到可接受的程度？
- 哪些第三方库值得考虑，分别解决什么问题、又带来什么边界？
- 当同一计算跨越应用、数据库、JSON API 和数据管道时，怎样确保结果一致、可复算、可对账？
- 应该在什么地方舍入，什么地方保留中间精度？

本文是工程设计指南，不是投资、会计、税务或法律意见。具体舍入规则、利息日计数约定、税务规则、支付渠道金额单位和估值政策，应以产品合同、适用法规、业务政策及经过批准的模型规范为准。

## 一、先明确一个判断：金融计算不是简单地把 double 换成 decimal

金融系统最容易暴露的问题，通常不是某一行代码写错，而是不同组件分别做了“看起来合理”的处理，最后结果却对不上。

例如，一个组合管理系统可能通过 Python 计算研究指标，由 Node.js API 提供服务，Java 交易服务负责费用与账务处理，PostgreSQL 保存交易状态，Snowflake 汇总历史数据。每个系统都能正常执行自己的计算，但仍可能出现：

- 同一个金额在 API 中是 JSON number，进到 Node.js 后变成 IEEE 754 双精度浮点数；
- PostgreSQL 列是 NUMERIC，ORM 或驱动返回应用后却转成浮点数；
- Java 使用 BigDecimal，Python 使用 Decimal，但二者的舍入模式或中间精度不同；
- Snowflake NUMBER 运算与 PostgreSQL NUMERIC 运算对除法的输出 scale 处理不同；
- 某个服务逐行舍入，另一个服务先汇总后舍入，最终相差几分；
- 同一笔利息在工作日、日历日、时区截止点或 day-count convention 不同的条件下被重复计提或少计一天；
- 外汇汇率、价格、数量或费用的单位没有写清楚，数值没有丢精度，但业务结果仍然错误；
- 代码升级或数据重放后，重新计算的历史结果与原账务记录不一致。

所以需要将三个目标分开：

1. **数值精度（precision）：** 内部表示与运算能保留多少位、是否发生二进制近似、溢出或截断。
2. **业务舍入（rounding）：** 哪个阶段按什么规则舍弃哪些位，以及舍入差额归属谁。
3. **业务正确性（business semantics）：** 用什么币种、单位、利率定义、估值时间点、市场日历、公式版本与业务规则进行计算。

使用十进制定点数可以减少第一类风险，却不会自动解决第二和第三类问题。

## 二、先建立跨语言的计算规则

### 1. 区分四种数值表示

| 表示方式 | 典型形式 | 适合什么 | 主要风险 |
| --- | --- | --- | --- |
| 二进制浮点数 | Java double、JS Number、Python float、Rust f64、SQL FLOAT | 统计、数值分析、模型计算以及有明确误差容忍度的算法 | 多数十进制小数不能被二进制精确表示；比较、累加及不同计算顺序会产生差异 |
| 十进制定点/十进制数 | Java BigDecimal、Python Decimal、Rust Decimal、Snowflake NUMBER、PostgreSQL NUMERIC | 金额、费率、价格、税额与要求精确十进制语义的计算 | 仍然需要控制精度、scale、除法和舍入策略；部分类型的精度范围有限 |
| 定标整数（scaled integer） | 整数分、以微单位计价的价格、整数 basis points | 明确量纲和小数位的金额、费率或部分固定精度数据 | 乘法中间值可能溢出；并非所有货币都是两位小数；除法仍会产生余数 |
| 有理数 | 分子/分母，例如 1/3 | 需要精确保留分数关系的计算 | 分子分母可能快速增长；最终进入货币单位时仍须舍入；平方根、对数等一般不能用有限有理数表示 |

二进制浮点不是“坏技术”。它广泛用于科学计算和定量模型，在明确接受误差并经过数值稳定性验证的风险模型中可以是正确选择。错误在于把它不加区分地用于需要逐分对账的账务金额、费用、结算和支付金额。

Python 的官方文档用 0.1 说明这一点：其真实二进制值不是精确的十分之一。JavaScript Number 也是 IEEE 754 双精度数，Rust f64 同样是 binary64；PostgreSQL 的 real/double precision 及 Snowflake FLOAT 也属于近似浮点语义。参见 [Python 浮点数说明](https://docs.python.org/3/tutorial/floatingpoint.html)、[MDN Numbers](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Numbers_and_strings)、[Rust f64](https://doc.rust-lang.org/std/primitive.f64.html)、[PostgreSQL 数值类型](https://www.postgresql.org/docs/current/datatype-numeric.html) 和 [Snowflake 数值类型](https://docs.snowflake.com/en/sql-reference/data-types-numeric)。

### 2. 钱不是一个数字

一个可用于金融业务的金额至少应该包含：

- 数值；
- 币种代码；
- 计量单位或小数位约定；
- 对应的业务语义，例如成交金额、应计利息、费用、净资产或可用余额。

USD 100.00、JPY 100 和 KWD 100.000 都是“100”，但币种和最小货币单位不同。不能把“金额统一乘 100”作为通用规则。币种小数位应该基于受版本管理的货币元数据（例如 ISO 4217），同时核对支付服务商或产品合同是否有自己的接口金额单位约定。支付渠道的特殊规则应放在该渠道适配器内，而不是悄悄改变核心账本的货币语义。

类似地，下面这些数字也不能随意互换：

- 5% 与 5（小数表示是 0.05）；
- 125 basis points 与 1.25%；
- 股价、每份额价格、份额数量与成交总额；
- 基础货币/报价货币方向相反的 FX 汇率；
- 年利率、日利率、月利率和有效年化利率；
- 市场价格、账面价格、净值、应计利息与已结算现金。

为核心模型建立 Money、Rate、Quantity、Price、Currency、ExchangeRate、AccruedAmount 这类明确的领域类型，比在业务代码中四处传递普通 number / double / decimal 更重要。领域类型应阻止币种不匹配、单位混用以及不合规的隐式转换。

### 3. 不要把所有金额都强行限制在货币最小单位

定标整数适合已经明确量纲的结算金额，例如以分表示的 USD 账面金额。但下面这些值通常需要保留中间精度：

- 每股价格、基金份额或部分资产的 fractional quantity；
- 利率、收益率、折扣、税率、FX 汇率；
- 逐日利息计提中尚未到入账舍入阶段的金额；
- 比例分摊和组合权重；
- 曲线插值、收益率曲线、贴现因子及定量模型的中间结果。

例如，一笔 USD 余额最终只需要精确到 0.01，并不意味着计算每日应计利息时也必须每天先舍入到 0.01。这样会把每天的舍入误差累积进业务结果。通常应保留适当的中间精度，在业务规定的计提、过账或支付边界舍入，并能说明这个边界为什么在这里。

### 4. 把舍入规则当成显式业务规则

“保留两位小数”是不完整的需求。至少要明确：

- 目标 scale：保留到整数、分、毫，还是更多位；
- 舍入模式：HALF_UP、HALF_EVEN、向零截断、向正无穷或向负无穷等；
- 半值的定义与负数行为；
- 舍入发生在哪个阶段：逐行、逐笔、逐日、逐账户、逐批次还是汇总之后；
- 舍入差额由谁承担，如何分配给明细；
- 舍入策略是否会随产品、市场、税务规则或政策版本变化。

常见差异如下：

| 输入 | HALF_UP / half away from zero | HALF_EVEN | 向零截断 |
| --- | ---: | ---: | ---: |
| 2.5 舍入到整数 | 3 | 2 | 2 |
| 3.5 舍入到整数 | 4 | 4 | 3 |
| -2.5 舍入到整数 | -3 | -2 | -2 |
| -3.5 舍入到整数 | -4 | -4 | -3 |

不同运行时的默认规则不同。Python Decimal 的默认 context 是 HALF_EVEN；Java BigDecimal 必须在涉及舍入时明确传入 RoundingMode，或用明确配置的 MathContext；Snowflake ROUND 默认采用 HALF_AWAY_FROM_ZERO，也支持对定点数指定 HALF_TO_EVEN；PostgreSQL NUMERIC 的 round 在半值时远离零，而 double precision 的半值行为通常更接近 ties-to-even，但平台行为应核实。参见 [Java BigDecimal](https://docs.oracle.com/en/java/javase/26/docs/api/java.base/java/math/BigDecimal.html)、[Python Decimal](https://docs.python.org/3/library/decimal.html)、[Snowflake ROUND](https://docs.snowflake.com/en/sql-reference/functions/round) 和 [PostgreSQL 数学函数](https://www.postgresql.org/docs/current/functions-math.html)。

**不要依赖默认值。** 不同系统即使都使用十进制精确类型，也有可能因为舍入模式、scale 或舍入时点不一致而生成不同的账务结果。

### 5. 中间过程必须有精度预算

把最终结果定义为两位小数，不代表每一步都应该保留两位。假设要计算：

价格 × 数量 × 汇率 − 费用 + 应计利息

每一个输入字段可能各有 scale；乘法会增加小数位，除法可能产生无限循环小数，累加又可能增加整数位。若中间步骤太早把精度压缩，后面的高精度计算无法恢复已被丢弃的数字。

需要为计算链设计精度预算：

- 输入允许多大数值范围、最多多少位；
- 哪些字段是金额，哪些是价格、数量或比率；
- 中间结果预留多少整数位与小数位；
- 何处使用高精度中间结果；
- 哪一步必须舍入，使用何种模式；
- 超过精度或范围时是拒绝交易、进入异常队列，还是按经过批准的降级策略处理。

尤其要区分“精度位数（significant digits）”与“scale（小数点后的位数）”。一个 NUMERIC(18, 8) 只有 10 位整数位；一个精度为 18 的十进制浮点 context 则不是同样的约束。

### 6. 精确类型也会溢出、截断或产生不适当的结果

BigDecimal、Decimal、NUMERIC 或定标整数不能代表“绝不会错”：

- 固定宽度 Decimal 仍有最大有效位数和 scale；
- 定标整数相乘时，中间值可能超出 64 位或 128 位；
- 数据库列可能因精度不足而拒绝或舍入输入；
- BigDecimal 的除法在没有规定结果精度时遇到无限循环小数会抛异常；
- Python Decimal 会按当前 context 的 precision 和 rounding 处理运算，并可针对 Inexact 等信号配置 trap；
- 某些计算可能输出 NaN、Infinity 或负零。不同语言、驱动和数据库处理这些值的方式不同；
- 类型转换、序列化和格式化可能再次丢精度。

金融路径中应该把溢出、无效输入、意外舍入和精度不足变成可观察的错误，而不是让其静默变成 0、NULL、浮点近似值或被截断的金额。

## 三、金融计算常见问题清单

以下清单可以用于架构评审、代码审查和系统迁移检查。

| 问题类别 | 常见错误方式 | 推荐工程控制 |
| --- | --- | --- |
| 二进制浮点误差 | 用 double/Number/float/f64 计算费用、应付金额或账面余额 | 对需要逐分一致的金额使用定标整数或精确十进制类型；浮点只用于经过误差验证的数值模型 |
| 隐式类型转换 | 精确 decimal 被转换为 float，或精度数被拼接为 JSON number | 在接口与驱动边界显式指定类型，金融数值优先用十进制字符串或经验证的 decimal 编码 |
| 非安全整数/溢出 | JS Number 超出安全整数范围；int64 乘法溢出 | 明确范围，用 checked arithmetic 或更宽中间类型；超范围时失败而非环绕 |
| 舍入模式差异 | Java、Python、Snowflake、PostgreSQL 使用不同默认舍入 | 统一命名业务舍入模式并以测试向量验证各端 |
| 舍入时点差异 | 先舍入每行再汇总，和先汇总后舍入 | 业务规则指定计算阶段，保留未舍入中间值，并用明细合计校验总额 |
| 余数分配 | 把 100.00 按比例分成几份后，合计为 99.99 或 100.01 | 明确差额分配算法，采用稳定排序与确定性 tie-breaker；分配结果必须精确等于原总额 |
| 除法与比例 | 1/3、利率换算、FX 换算没有规定 scale | 指定输出精度和舍入模式；内部按足够精度计算，最终只在规定边界舍入 |
| 货币单位 | 假设所有货币都以两位小数表示 | 货币元数据版本化；内部币种与支付渠道接口单位分开管理 |
| 利率与百分比单位 | 5 被理解为 5% 而不是 500% | Rate / Percentage / BasisPoints 使用明确类型和转换函数，不让普通数字跨单位流动 |
| 日期和时区 | 使用服务器本地时间作为估值时点，日界线发生偏差 | 区分 instant、业务日期、市场日期；时区、cut-off、假日日历及生效时间显式化 |
| 利息日计数 | 用自然日计算代替 ACT/360 或 30/360 | 明确产品约定、起止日是否包含、闰年处理、复利频率和日历规则 |
| FX 报价方向 | 把 base/quote 方向反了，或用倒数代替有 bid/ask 的市场报价 | 记录货币对方向、买卖方向、报价源、时间戳与精度，不默认汇率可直接互逆 |
| SQL 精度规则 | NUMBER / NUMERIC 除法输出 scale 不同，隐式 cast 改变精度 | 重要表达式显式 CAST、指定目标 precision/scale 和舍入点；跨库进行黄金样例比对 |
| NULL / 零 / 缺失 | 将缺报价、无交易和金额为零混为一谈 | 定义缺失语义；拒绝把 NULL、0、NaN 或空字符串随意互换 |
| 求和顺序 | 浮点聚合顺序变化导致结果尾数不同 | 对账金额使用精确类型；对浮点模型控制归并次序和容差，必要时使用补偿求和 |
| JSON 与消息队列 | 高精度数被消费端解析为浮点数 | 精度要求高的金额以 string 或受控 decimal schema 传输；明确版本和量纲 |
| 重试与重复执行 | 超时后重试，重复记账或重复支付 | 业务幂等键、唯一约束、状态机和原子事务；数值精度不能代替交易幂等性 |
| 公式与政策变更 | 新规则重算旧数据，无法解释历史差异 | 保存公式/政策版本、输入快照、数据时间点、原始值、中间审计信息及结果 |
| 浮点特殊值 | NaN 在比较中表现异常，Infinity 意外通过校验 | 入口验证有限值，阻止 NaN/Infinity 进入账务字段；为模型数值定义专用规则 |
| 显示与存储混淆 | 仅格式化显示到两位，误以为内部已舍入 | 存储值、业务舍入值和显示字符串分开；界面格式化不能充当计算规则 |

### 一个简单但有用的例子：整数分也会遇到舍入问题

将 USD 10.00 存为 1000 分，能够精确加减。但如果分成三份：

- 每份精确数学值为 333.333… 分；
- 三份都直接截断为 333 分，合计为 999 分；
- 每份独立四舍五入为 333 分，仍然合计为 999 分；
- 某一份补 1 分，才能使分配总和严格等于 1000 分。

所以整数分解决的是“金额如何精确存储与加减”，不解决“不可整除的金额如何公平而确定地分配”。对分摊、分红、费用分配与部分退款，应定义剩余单位的分配规则，并保证所有明细之和等于总额。

一种常见模式是先使用高精度计算每份的理想值，再将结果量化到货币单位，把余数按小数余量排序后分配；余量相同时必须用稳定的业务键打破平局。是否适合具体业务，还需要符合产品和会计规则。

## 四、Java：BigDecimal 是原生工具，但必须用对

Java 的标准库提供 BigDecimal 和 BigInteger，不需要引入第三方库即可做任意精度整数和十进制计算。BigDecimal 内部使用未缩放整数和 scale 表示数值，并允许显式控制精度与舍入。[官方 BigDecimal API](https://docs.oracle.com/en/java/javase/26/docs/api/java.base/java/math/BigDecimal.html)。

### 不依赖第三方库

金额、费率和需要精确十进制语义的计算，优先使用 BigDecimal。关键规则包括：

- 从字符串或原始十进制文本创建 BigDecimal，不要从已经是 double 的值创建；
- 有舍入的计算必须显式指定 scale 和 RoundingMode；
- 除法若结果不终止，必须指定 scale / rounding mode，或用明确的 MathContext；
- 对金额量纲建立 Money 等领域对象，避免任意 BigDecimal 混用不同币种；
- 需要任意精度整数时用 BigInteger；固定宽度 long 运算可使用 Math.addExact / Math.multiplyExact 做溢出检查；
- 区分数值相等和表示相等。BigDecimal 的 compareTo 比较数值；equals 还考虑 scale，所以 2.0 和 2.00 的 equals 结果不同。

示例：

~~~java
import java.math.BigDecimal;
import java.math.RoundingMode;

BigDecimal amount = new BigDecimal("10.00");
BigDecimal rate = new BigDecimal("0.0725");

// 中间结果不提前舍入。
BigDecimal rawFee = amount.multiply(rate);

// 仅在经过业务规则批准的边界量化到两位小数。
BigDecimal fee = rawFee.setScale(2, RoundingMode.HALF_UP);
~~~

不要这样创建金额：

~~~java
// double 里的近似值会被完整带入 BigDecimal。
BigDecimal wrong = new BigDecimal(0.1);

// 从十进制文本构造，保留输入表达的精确十进制值。
BigDecimal right = new BigDecimal("0.1");
~~~

BigDecimal.valueOf(double) 使用 double 的规范字符串表示，通常比 new BigDecimal(double) 更易理解；但如果原始数据最初已经经过 double 转换，那么原始精度可能早已丢失。最好的办法仍然是在入口使用原始十进制字符串或精确整数单位。

还要注意：BigDecimal 的“任意精度”不是没有代价，也不代表每一步都应无限保留位数。业务应定义允许的精度与最终量化规则，控制运算成本及数据库映射。

### 借助第三方库

第三方库的价值主要在于 Money/Currency 类型、币种元数据、格式化与业务 API，而非 BigDecimal 本身缺乏十进制能力。

- [Joda-Money](https://www.joda.org/joda-money/)：提供 Money 和 Currency 等领域抽象；适合希望限制币种与金额混用的应用。对高精度利息中间值、汇率与价格，仍需明确选用的数值表示以及如何进入或退出 Money 类型。
- [JSR 354 / javax.money](https://javamoney.github.io/) 及其实现（例如 Moneta）：提供货币金额与货币算术的 API 抽象。需在项目中明确使用的实现、舍入策略和货币元数据版本。

引入 Money 库也不能替代业务规则设计。库知道“金额和币种”不代表它知道某个债券采用什么 day-count convention、税务舍入规则或交易市场的结算日历。

## 五、Node.js / TypeScript：没有内置 Decimal，BigInt 只能解决整数问题

JavaScript 的 Number 是 IEEE 754 双精度浮点数。它的最大安全整数是 2^53 − 1；大于该范围的整数不一定能够准确区分。BigInt 可以表示任意大的整数，但不能表示十进制小数；BigInt 除法会得到整数结果，例如 5n / 2n 为 2n。[MDN：Numbers and strings](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Numbers_and_strings)；[MDN：BigInt](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt)。

### 不依赖第三方库

核心方案有两种：

**方案 A：用安全范围内的整数存储货币最小单位。**

对于最大值有明确上限的结算金额，可以用 number 表示整数分，但必须在入口和计算后检查 Number.isSafeInteger，并且每个中间结果也要保持在安全范围内。只检查最后结果不够，因为中间值可能已经失真。

**方案 B：用 BigInt 表示定标整数。**

对于金额较大或乘法中间值可能超过安全整数范围的场景，使用 BigInt 作为整数金额单位、bps 或其他明确 scale 的定标数。用整数乘法和除法处理 rate，并自行实现经过测试的舍入规则。BigInt 与 Number 不能混用；序列化时通常需要把金额编码为十进制字符串，因为 JSON.stringify 默认不能直接序列化 BigInt。

~~~javascript
const amountMinor = 1000n; // 例如 USD 10.00，对应 1000 分
const rateBps = 725n;     // 725 bps = 7.25%
const denominator = 10000n;

const numerator = amountMinor * rateBps;
const whole = numerator / denominator;
const remainder = numerator % denominator;

// 这里仅演示 HALF_UP 的正数路径。
// 正负数、负值的半值、溢出和目标 scale 必须由完整的领域函数处理。
const roundedMinor =
  whole + (remainder * 2n >= denominator ? 1n : 0n);

const apiValue = {
  amountMinor: roundedMinor.toString(),
  currency: "USD"
};
~~~

这个例子故意不把舍入逻辑封装成通用函数：生产实现应支持正负金额，明确 HALF_EVEN / HALF_UP / 向零截断等政策，且为除数为零、币种 scale、负数和最大范围写测试。BigInt 的整数精确性并不会自动让比例计算正确。

对需要股价、数量、FX 率等超过币种最小单位精度的输入，不能简单转成分再计算；要使用更高 scale 的定标数或十进制库。

### 借助第三方库

- [decimal.js](https://github.com/MikeMcl/decimal.js)：基于可配置精度的十进制运算。适合需要高精度小数、比率和计算链的应用。要集中设置 precision 与 rounding，避免不同模块各自使用默认配置。
- [bignumber.js](https://github.com/MikeMcl/bignumber.js)：提供任意精度的十进制数值运算，支持可配置舍入。适用于不能只用最小货币单位表达的计算。
- [big.js](https://github.com/MikeMcl/big.js)：较轻量的任意精度十进制库，适合基础十进制运算需求。
- [Dinero.js](https://dinerojs.com/)：更关注货币、币种与金额运算抽象，适合应用层 Money 领域模型；应核实所用版本的金额表示、舍入和扩展方式。

库的引入不应导致系统同时出现多种互不兼容的 decimal 规则。应确定核心数值类型，并将输入解析、数据库映射和 API 序列化集中处理。特别要检查金额是否被 JSON parser、ORM、日志模板或前端再次转换为 Number。

**Node.js 的特别风险：** JSON 数字字面量本身没有携带一个强制的任意精度十进制类型。若对端只提供 JSON number，而金额必须精确，接收服务可能在业务代码运行前就失去原始十进制文本。优先要求上游将金额作为字符串传输，或使用支持任意精度数字原文的解析方案；单纯执行 String(parsedNumber) 不能恢复丢失的精度。

## 六、Python：标准库 Decimal 能力很强，但默认 context 不是无限精度

Python 同时提供 int、float、decimal.Decimal 和 fractions.Fraction。int 可自动扩展任意精度（受可用资源限制）；float 使用二进制浮点；Decimal 是标准库十进制算术；Fraction 表示有理数。[Python Decimal 文档](https://docs.python.org/3/library/decimal.html)、[Python 浮点数说明](https://docs.python.org/3/tutorial/floatingpoint.html)。

### 不依赖第三方库

对金额、费用、费率和十进制计算链，通常可以直接使用标准库 Decimal：

- 从字符串构造，例如 Decimal("0.1")，不要直接把 float 传入；
- 理解当前 context 的 precision、rounding、exponent 范围和 traps；
- 在特定计算中用 localcontext 明确精度与舍入模式，避免依赖被其他代码更改的全局状态；
- 在审核严格的计算中，可对 Inexact、Rounded 或 FloatOperation 信号设置监控或 trap；
- 用 quantize 将结果舍入到规定 scale，而不是仅使用 format 显示两位小数。

~~~python
from decimal import Decimal, localcontext, ROUND_HALF_UP, Inexact

amount = Decimal("10.00")
rate = Decimal("0.0725")

with localcontext() as ctx:
    ctx.prec = 40
    # 如业务要求异常结果必须显式暴露，可开启 Inexact trap。
    # 需要注意：开启后，非终止除法也可能直接抛出异常。
    # ctx.traps[Inexact] = True

    raw_fee = amount * rate
    fee = raw_fee.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

print(fee)  # Decimal('0.73')
~~~

Decimal 构造自 float 时，会准确保留该 float 的二进制近似值，而不是自动猜测开发者原本想输入的十进制数字。例如，Decimal(0.1) 会带入一长串十进制数字；这不是 Decimal 出错，而是输入转换已经明确了一个不同的值。

Decimal 的 context precision 影响运算结果，不只是限制输入。默认 precision 通常是 28 位有效数字；对长精度的组合计算、汇率和中间步骤，应根据数值范围设定 context，并处理除法等可能产生非终止小数的运算。如果只把最终结果 quantize 到两位，但运算过程的 context 太小，早期丢掉的有效数字仍然无法恢复。

Fraction 可以在不引入第三方库的情况下精确表示 1/3 等有理数，适合某些份额和比例算法。可是分子分母可能膨胀，且平方根、对数等运算不一定能保持有限有理数。它并不是所有金融算法的通用替代品。

### 借助第三方库

- [py-moneyed](https://github.com/py-moneyed/py-moneyed)：提供货币和 Money 类型，帮助把金额与币种绑定；数值运算仍需和 Decimal 等精确表示协作，货币元数据及舍入政策也要经过业务校验。
- [NumPy / pandas](https://numpy.org/)：对统计、行情分析和批量数值计算很有用，但常见的 float64 数组仍然是近似二进制浮点。不要因为数据在 DataFrame 里就把 float64 用作账务金额。Python Decimal 放进通用数组中也可能退化为 object 类型并影响性能，需要在准确性和效率之间进行明确设计。
- 面向数值模型的第三方数学库可以扩展算法能力，但若返回 float，结果仍需要按模型的误差标准处理；这类库本身不会赋予结果精确的货币语义。

Python 的优势是 Decimal 在标准库中，不意味着每个 Pandas/Spark/JSON/数据库接口都会自动保留 Decimal。对所有转换边界都要做类型和往返验证。

## 七、Rust：标准库没有十进制 Decimal，需要明确选择整数还是第三方类型

Rust 标准库的 f32/f64 是二进制浮点类型；标准库没有通用 Decimal 类型。无第三方依赖时，Rust 可以通过 i64 / i128 定标整数、checked arithmetic 与明确的比例算法，准确处理范围内的整数运算。使用时必须明确整数单位和溢出策略。

### 不依赖第三方库

- 对金额使用 minor units，或对价格、数量、费率采用明确 scale 的整数；
- 对乘法使用更宽的中间类型（例如输入为 i64 时，部分场景先转为 i128），并使用 checked_add、checked_mul 等方法检测溢出；
- 进入输出货币单位时，显式处理除法余数和舍入模式；
- 把币种、scale、单位及舍入模式封装为领域结构体，而不是让各模块独立约定整数含义；
- 对定量模型使用 f64 时，应明确可接受的误差、稳定性和跨版本再现要求。

定标整数的核心难点是范围和中间运算。例如两个合法 i64 值相乘，结果仍可能超出 i64。溢出检查需要发生在结果产生之前，而不应寄希望于最后再验证。

### 借助第三方库

- [rust_decimal](https://docs.rs/rust_decimal/latest/rust_decimal/)：面向金融用途的定精度十进制类型，采用有限宽度的整数系数与 scale。基本算术很方便，但其有效位数和 scale 上限是实实在在的限制。必须测试极大本金、长精度价格、复合比例和中间乘积，不能仅看库名中的 Decimal 就假定精度无限。
- [bigdecimal](https://docs.rs/bigdecimal/latest/bigdecimal/)：用大整数系数和十进制位置支持更广的精度范围，适合需要更大精度/scale 的场景。性能、分配成本和运算复杂度应在代表性负载下测量。
- 若需要额外的 Money/Currency 抽象，优先考察能明确表达币种、scale 与序列化语义的类型设计。不要只包装一个 Decimal 字段就认为单位不可能混淆。

特别注意 Rust 的 serde JSON 配置。一些 Decimal 类型可以配置为输出 JSON 数字，也可以配置为输出字符串。若消费者是 JavaScript，输出为 JSON number 可能再次失去精度；必须根据接口契约选择格式，并在端到端测试中验证。

## 八、C# / .NET：decimal 很适合金额，但它不是任意精度数值类型

C# 的 System.Decimal 是 .NET 标准库提供的十进制数值类型。它由 96 位整数系数、符号和 scale 组成，scale 可表示 0 到 28 位小数；有效精度大约为 28–29 位十进制数字，最大绝对值约为 7.9228 × 10^28。它能精确表示常见的十进制金额输入，但范围和精度都有限，并不像 Java BigDecimal 或 Python Decimal 一样支持任意大的系数。

Microsoft 将 decimal 明确定位于金额、利率等需要十进制精度的计算。文档同时提醒，decimal 仍然需要舍入：例如 1 / 3 的结果只能保留有限位，随后再乘以 3 也可能得到 0.9999999999999999999999999999，而不是数学意义上的 1。[Microsoft：System.Decimal](https://learn.microsoft.com/en-us/dotnet/fundamentals/runtime-libraries/system-decimal)

### 不依赖第三方库

对金额、费用、税额和固定精度比率，优先使用 C# 的 decimal，而不是 double 或 float。

~~~csharp
using System;
using System.Globalization;

decimal amount = 10.00m;
decimal rate = 0.0725m;

// decimal 运算，保留中间值，不立即量化到货币单位。
decimal rawFee = amount * rate;

// 仅在业务规定的边界进行舍入。
// AwayFromZero 只是本例选择；生产策略要由业务规则决定。
decimal fee = Math.Round(rawFee, 2, MidpointRounding.AwayFromZero);

// 从 API 文本解析时，显式指定文化设置，不依赖服务器当前区域。
decimal parsed = decimal.Parse(
    "1234.56",
    NumberStyles.Number,
    CultureInfo.InvariantCulture);
~~~

关键事项：

- **使用 decimal 字面量后缀 m。** 例如 0.1m 会按 decimal 字面量处理；不要先把值放入 double，再强制转换成 decimal，转换不能恢复已丢失的原始十进制输入。
- **舍入模式要显式指定。** Math.Round(decimal, digits) 默认使用 MidpointRounding.ToEven，也就是 ties-to-even / banker’s rounding。它不一定符合产品要求。若规则规定半值远离零，应使用 MidpointRounding.AwayFromZero；其他模式需按运行时支持情况选择并建立测试。
- **decimal 不意味着除法无限精确。** 除法结果需要落入有限的 precision/scale；不能在一串计算的每个步骤都随意舍入。用领域函数定义最终量化边界，并用边界测试检查结果。
- **范围仍然有限。** 超出 decimal 可表达范围的运算会触发 OverflowException。不要在捕获异常后把结果静默替换为 0 或默认值；应明确失败、拒绝输入或进入异常处理流程。
- **不要依赖当前区域解析机器接口数据。** 小数分隔符可能是点，也可能是逗号。数据库和 API 的机器格式需要固定文化规则；货币符号和本地化格式只用于展示。
- **存储精度和金额精度不是一回事。** .NET decimal 可保留到 28 位小数，但这不代表所有币种都应该保留 28 位，也不代表价格、利率、中间值和最终可支付金额使用同一个 scale。
- **对宽整数乘法另行检查范围。** 若用 long 存储定标整数，乘法中间值可能溢出。现代 .NET 提供 BigInteger，可在不引入第三方库时做任意精度整数计算；但 BigInteger 本身不包含小数点、币种或舍入规则，需要自己封装系数和 scale。

C# 与 Java/Python 的差异是值得注意的：Java BigDecimal 和 Python Decimal 都提供更灵活的 precision 控制；C# decimal 的常见算术更直接，但固定的数值范围可能不适合所有高精度估值、长链中间运算或极大累计值。对于绝大多数日常金额、订单、费用和账务字段，decimal 通常足够；对于高精度定量计算或需要超出其范围的数值，应先定义实际精度需求，再选择 BigInteger 定标整数或经过评估的高精度库。

### 借助第三方库

- [NodaMoney](https://github.com/RemyDuijkeren/NodaMoney)：为 .NET 提供 Money 和 Currency 类型、货币元数据、解析/格式化、舍入策略以及金额拆分能力，避免业务代码把币种规则散落在各处。它不是任意精度数学引擎，金额运算仍受其底层数值类型和配置约束。
- 如果系统需要更复杂的多币种金额、汇率或特定业务约定，应把第三方 Money 类型放在领域模型层，并检查该库对 currency minor unit、scale、JSON 序列化、金额拆分和 context 的具体行为。Money 类型可以减少单位混用，但不能代替利息日计数、税务规则和估值政策。
- 对科学计算、风险模型或矩阵运算，应单独选择经过验证的数值算法和相关库。不要因为这些库提供高性能 double 运算，就用它们计算应付金额、佣金或账面余额。

NodaMoney 的发布说明提供了一个值得注意的工程案例：库的 MoneyContext、舍入和反序列化行为曾随版本演进；例如，反序列化的 Money 值可能根据当前 context 应用舍入。升级库版本时，不应只跑编译与基本加减测试，还要验证 JSON/数据库往返后金额是否变化，context 是否隐式影响业务结果，以及拆分金额是否仍然满足“所有份额之和等于原金额”。[NodaMoney releases](https://github.com/RemyDuijkeren/NodaMoney/releases)

**C# 的核心建议：** 用 decimal 解决常规十进制金额计算，用显式的 MidpointRounding 和统一的金额领域类型约束业务；不要把 decimal 当成无限精度；对外部输入、数据库映射、序列化、版本升级与边界溢出建立自动化测试。

## 九、Snowflake：NUMBER 很适合精确数值计算，但精度和 scale 有上限

Snowflake 的 NUMBER/DECIMAL/NUMERIC 是定点数，最大 precision 为 38 位，scale 最多可达 37；默认 NUMBER 的精度/scale 为 NUMBER(38,0)。FLOAT、DOUBLE 等是近似浮点数。Snowflake 文档也说明，不同算术运算的结果 precision 和 scale 依赖输入类型，不能把 NUMBER(38, 18) 理解为每次运算都能无损保留任意多位小数。[Snowflake Numeric Data Types](https://docs.snowflake.com/en/sql-reference/data-types-numeric)、[Arithmetic Operators](https://docs.snowflake.com/en/sql-reference/operators-arithmetic)。

### 不依赖第三方库

业务数值建议优先使用明确的 NUMBER(p,s)，并在关键表达式中控制精度：

~~~sql
-- 原始字段保留合理的业务精度和范围
CREATE TABLE trade_input (
    quantity       NUMBER(20, 8),
    price          NUMBER(20, 8),
    fee_rate       NUMBER(12, 10),
    currency_code  VARCHAR(3)
);

-- 关键表达式明确类型，并在业务指定的舍入边界量化
SELECT
    ROUND(
        CAST(quantity AS NUMBER(20, 8))
        * CAST(price AS NUMBER(20, 8)),
        2,
        'HALF_EVEN'
    ) AS rounded_trade_amount
FROM trade_input;
~~~

示例仅演示显式类型与舍入位置；NUMBER 的精度和 scale 应按实际字段范围、乘法中间精度和后续运算推导，不能复制后不做容量分析。

实践中要注意：

1. 避免将关键金额列、费率列和计算表达式转为 FLOAT。只把最后结果 CAST 回 NUMBER，并不能修复中途已经发生的近似误差。
2. 对乘法和除法，检查输出 precision/scale 规则和精度上限；若后续还要多次运算，需留出中间精度，而不是在每一条 SQL 的每个字段上都直接限定为两位。
3. 明确 CAST 与 ROUND 的位置。把字段存为 NUMBER(18,2) 会把字段 scale 作为存储契约；这与保存高精度中间值再在支付/入账边界舍入不是一回事。
4. Snowflake ROUND 默认采用 HALF_AWAY_FROM_ZERO。若业务规定 HALF_TO_EVEN，应显式指定舍入模式；该参数适用于定点数，不能直接用于 FLOAT。
5. 处理除零时，不要仅为了避免 SQL 报错就无条件改成 DIV0 或 DIV0NULL。它们对除零情况的处理意味着业务语义变化；如果比率无法计算，应判断是无效数据、缺失值还是有业务定义的零值。
6. 注意 NULL 传播与聚合语义。缺失价格、缺失汇率不能随意变成零；SUM 忽略 NULL 也不等于“数据完整”。

Snowflake 官方还列有 DECFLOAT 数据类型，具有动态十进制指数和最多 38 位有效数字。是否用于核心业务字段，应结合目标 Snowflake 环境、版本支持、驱动映射及团队规范验证；对明确固定 scale 的金额，NUMBER(p,s) 通常更容易表达 schema 契约。不能假设每个客户端版本都用相同方式把新的数值类型映射为语言对象。

### 借助第三方库

Snowflake SQL 计算本身通常无需第三方十进制库：精确数值应优先用 Snowflake 原生 NUMBER/DECFLOAT 能力。第三方组件更可能存在于应用端或数据转换层，例如 Python Decimal、Java BigDecimal、Node.js Decimal 库、Rust Decimal 类型。

需要关注的其实是跨系统映射：

- Connector 返回 NUMBER 时，应用中究竟收到 Decimal、整数还是字符串？
- NUMBER(38, n) 是否被某个驱动或 ORM 无损映射？
- SQL 查询结果导出到 Arrow、pandas、Node.js 对象或 JSON 时，scale 与精度是否保留？
- 客户端重新计算同一个公式时，是否用了和 SQL 相同的舍入策略？

这些都应通过使用真实最大值与小数位的 round-trip test 验证，而不是依靠驱动“支持 Snowflake”这一描述。

## 十、PostgreSQL：优先 NUMERIC，而不是把 money 当作通用财务模型

PostgreSQL 提供整数类型、real/double precision 以及 NUMERIC/DECIMAL。NUMERIC 支持精确十进制运算，并且可容纳的精度范围很大；real 和 double precision 是近似浮点类型。官方明确建议要求精确存储和计算的货币金额使用 NUMERIC，而不是浮点数。[PostgreSQL Numeric Types](https://www.postgresql.org/docs/current/datatype-numeric.html)。

### 不依赖第三方库

常规账务金额可使用 NUMERIC(p,s)；当中间值需要更大精度时，也可以评估未显式限定 precision/scale 的 NUMERIC，并设置合理的数据边界及应用校验。

~~~sql
CREATE TABLE account_posting (
    posting_id    BIGINT PRIMARY KEY,
    currency_code CHAR(3) NOT NULL,
    amount        NUMERIC(24, 8) NOT NULL,
    posted_amount NUMERIC(20, 2) NOT NULL
);

-- 应按业务规则在指定阶段舍入，而不是对所有中间字段一律保留两位。
SELECT
    ROUND(SUM(amount), 2) AS total_amount
FROM account_posting
WHERE currency_code = 'USD';
~~~

同样，这里的精度只是示例，不是所有金融系统的推荐固定值。对于交易金额、费用、证券价格、利息和比率，字段应分别设计。

PostgreSQL 特别容易踩到的几个点：

1. **NUMERIC 与 DOUBLE 的舍入规则不一样。** PostgreSQL 的 ROUND(numeric) 在半值时远离零；double precision 的半值处理通常是 ties-to-even，但具体行为由平台决定。跨系统复算必须显式定义业务模式，而不是依赖 SQL 函数的默认值。
2. **整数除法会截断。** 两个整数相除可能不是你想要的小数比例；在表达式中使用明确的 NUMERIC 类型，并验证除法结果 scale。
3. **NUMERIC(p,s) 的 scale 是契约。** 输入超过 scale 时会被量化到所需 scale；超出整数位范围可能报错。存储列的定义应该与字段允许范围和业务规则一致。
4. **money 类型不是多币种领域建模。** 它的 fractional precision 受 lc_monetary 配置影响，输入/输出与本地化有关；不同环境间迁移或比较时容易引起歧义。PostgreSQL 文档也提醒不要用浮点数处理 money。对跨币种、多种金额精度以及可审计计算，一般优先考虑 NUMERIC 配合 currency_code 和明确的金额模型。[PostgreSQL Monetary Types](https://www.postgresql.org/docs/current/datatype-money.html)。
5. **检查客户端驱动的数据映射。** 数据库列是 NUMERIC，不代表每个客户端都会以无损的语言类型返回。有些驱动会将任意精度 numeric 返回字符串，正是为了避免先转换到有限精度浮点类型。不要为了方便而无条件 parseFloat。

### 借助第三方库

PostgreSQL 内部没有必要为 NUMERIC 再装一套第三方十进制算术库。第三方库主要用于应用客户端对数据库数值的无损映射和领域类型封装。

例如，Rust 的 rust_decimal 提供可选的 PostgreSQL 集成能力，但其自身的数字范围小于 PostgreSQL NUMERIC 的完整能力范围，读取超出 rust_decimal 范围的数据库值可能失败或需要改用更宽的表示。若要求保留数据库可存储的完整精度，可以考虑 BigDecimal 类型映射或直接以字符串/系数+scale 形式处理，再根据业务边界转换。

同理，Java BigDecimal、Python Decimal 与 Node.js 的十进制库都可以用于客户端计算，但必须验证 ORM / driver 的实际映射，而不是只看数据库 schema。

## 十一、跨语言和跨数据库的一致性：应如何设计系统？

### 1. 定义计算契约，而不是仅定义字段类型

每一项重要金融计算应说明：

- 输入字段、类型、单位和范围；
- 公式及操作顺序；
- 精度和 scale 规则；
- 舍入模式及舍入节点；
- 处理空值、除零、负值、溢出和异常市场数据的方式；
- 使用的交易日期、估值日期、时区、市场日历及 day-count convention；
- 公式、数据、市场数据及业务政策的版本；
- 需要保证哪些不变量，例如交易分配总额等于母交易总额。

对于投资组合估值，至少要区分 instrument price、quantity、currency、FX rate、accrued interest、market value 和 base-currency value。不同资产可能使用不同数量精度、价格精度和应计利息规则。不能把一个通用的 Money 类型当作所有字段的统一替代品。

### 2. 明确哪个组件是权威计算方

如果同一个公式由 Java 服务、PostgreSQL、Snowflake 和 Python Notebook 分别计算，系统很容易产生“每个都算得通，但互相对不上”的问题。

可以采用以下原则：

- 交易记账、费用、余额、已实现损益等需要即时一致的核心结果，应有明确的权威计算服务或事务边界；
- 需要数据库内处理的大规模聚合，可以由 SQL 计算，但公式应有版本管理和对账测试；
- Snowflake 与 PostgreSQL 如果都计算相同财务指标，应明确哪边是权威值，哪边是验证或分析值；
- AI Agent 可以生成查询、提出解释、调用被授权的计算接口，但不能自己改变金额精度、舍入模式、授权边界或经过批准的业务口径。

不要把“把 SQL 搬进 Snowflake”视为纯性能重构。如果计算原来由 Java BigDecimal 完成，迁移到 Snowflake NUMBER 后，要验证除法 scale、ROUND 模式、NULL 处理及汇总位置，不能只检查 SQL 的语法等价。

### 3. 建立跨栈黄金测试向量（golden vectors）

把典型输入、预期输出、舍入政策和异常结果固定下来，供 Java、Node.js、Python、Rust、PostgreSQL 和 Snowflake 共用。测试集至少包括：

- 0.1 + 0.2 与精确十进制语义；
- 2.675 舍入到两位小数；
- 正数和负数的半值边界；
- 0、负数、最大金额、最大合法数量和最小非零价格；
- 1/3、汇率换算和不能整除的金额分摊；
- 最大 precision 和 scale 边界、整数溢出及除数为零；
- NULL、缺失价格、NaN、Infinity 和负零的处理；
- 不同币种的 minor unit；
- 交易跨越市场日界线、闰年、假日和夏令时；
- 重新执行同一个输入时产生完全相同的账务结果。

对账金额应按业务要求逐单位精确比较，而不是统一使用“误差小于 0.0001 就算相等”。浮点模型可以使用有依据的绝对和相对误差阈值，但这个阈值必须属于模型验证的一部分，不应外溢到账务金额核对。

### 4. 浮点模型要关注算法稳定性与运行可重复性

在风险、量化研究、蒙特卡洛模拟或统计计算中，浮点数可能是适当选择，但还应注意：

- 大数和小数相加会丢失低位；不同的聚合顺序可能生成不同结果；
- 直接减去两个接近的数会产生 catastrophic cancellation；
- 迭代算法、函数库、CPU 与运行时版本可能影响部分数值结果；
- 单纯增加小数位显示精度不会增加已经丢失的信息；
- 对需要跨运行完全复现的计算，要记录参数、随机种子、算法版本、运行环境和数据快照。

可以考虑 Kahan / Neumaier 等补偿求和算法或稳定的数值算法，但这些方法是降低特定数值误差，不是把浮点数变成精确十进制账务类型。

### 5. 结果需要能复算、能对账、能解释

对于重要的金额结果，建议保存或能够追溯：

- 原始输入与单位；
- 输入来源及业务时间点；
- 使用的公式和政策版本；
- 经过必要规范化的中间值；
- 最终未舍入值（在政策和存储要求允许时）、舍入值及舍入模式；
- 执行服务/数据库查询的版本或标识；
- 对应的 transaction ID / calculation ID / Snowflake query ID；
- 与交易总额、订单总额、持仓估值或总账控制值进行的校验结果。

这并不意味着把所有中间值无限期复制到每张表。应根据可审计性、隐私、成本和保留策略决定存储方式，但至少必须能够在授权范围内用原始输入和对应版本重现结果。

## 十二、金融计算常见场景的额外注意事项

### 利息计提与复利

利息不是简单的本金乘年利率。要明确年利率是名义利率还是有效利率、起止日是否包含、是否使用 ACT/360、ACT/365F、ACT/ACT 或 30/360 等 day-count convention、如何处理闰年、利息多久资本化，以及周末和假日是否改变计息区间。对于按日计提的金额，还需要区分每天保留的精度和实际入账的舍入点。

一个公式即使在所有语言中完全一致，只要日期计数规则不同，结果也会不同。因此 day-count convention 和市场日历需要成为有版本的业务配置，不应埋在各个服务的方法里。

### 外汇换算

FX 相关字段必须记录币种对方向、报价方式、bid/ask 或 mid、数据源、时间戳和精度。把 1 个 base currency 对应多少 quote currency 与倒过来的汇率混淆，会造成数量级或方向错误。市场存在 bid/ask spread 时，也不能简单通过取倒数来代替反向报价。

汇率通常比货币金额需要更多小数位。计算过程中保留 rate 精度，在产品规定的换汇/结算边界量化到目标货币单位，并将输入汇率及其时间点保留到可追溯记录。

### 费用、税务和比例分摊

应区分费用计算、逐行税额、票据总税额和最终结算金额。逐项舍入再汇总与汇总后舍入可能不同，不能让界面、支付服务和账务系统分别决定各自的舍入点。具体规则应遵从适用法规与产品政策。

对于按比例分配的金额，必须制定差额分配规则，并通过不变量确保分配总和等于母总额。不能简单把尾差一律塞给最后一行，除非这就是经过批准且可稳定重现的业务规则。

### 投资组合估值与持仓

持仓估值通常涉及价格、份额、应计利息、汇率、公司行动、市场时间戳与估值政策。证券价格与持仓数量可能有比法币金额更多的小数位；不能在计算前就把价格和数量都量化到货币最小单位。应明确每一项数值字段的单位、精度和更新时点，并针对拆股、分红、债券应计利息和多币种组合建立业务校验。

组合的市值汇总、交易账簿和总账对账需要清晰分工：某个系统的聚合值可以是分析结果，但不能未经规则定义就覆盖权威记账事实。

### 反复执行、事件重放与并发

精确计算也可能被重复执行。网络超时后，服务可能不知道数据库是否已经成功记账；工作流重跑可能把同一事件重复应用；两个并发退款都通过了“余额足够”的检查，最后却超出可退金额。

处理这些风险要用幂等键、唯一业务标识、事务、并发控制和明确状态机。舍入规则和数值类型只能保证每次计算的数学行为，不会自动提供交易幂等性或防止重复记账。

## 十三、业界实践：真实系统暴露的问题，往往不只是浮点数

官方文档解释了类型的规则；支付与账务工程团队的实践，则更能说明为什么“所有金额都存整数分”或“全部改成 Decimal”仍然可能不够。下面选取公开的工程经验和支付平台文档，重点关注可以转化为架构约束的教训。

### 1. Modern Treasury：用整数最小单位做账务金额，把精确性作为账本不变量

Modern Treasury 在其工程文章 [Floats Don’t Work For Storing Cents](https://www.moderntreasury.com/journal/floats-dont-work-for-storing-cents) 中介绍了自身的货币表示实践：支付订单中主要使用 64 位整数表示货币最小单位，在 PostgreSQL 中用 BIGINT 存储，并连同货币代码记录小数位语义。美元 12.34 这样的金额会保存为 1234，而不是浮点数 12.34。

这个决策有非常直接的工程收益：

- 金额加减与相等判断是精确整数运算；
- 数据库、应用和下游支付接口之间，不需要反复从近似浮点转换成金额；
- BIGINT 适用于有明确范围的支付金额，存储和运算成本也比较可控；
- 对账与账本不变量不必靠浮点容差掩盖一分钱的差异。

但这并不是“所有金融数值都应该是整数”的证据。整数表示有一个前提：必须定义整数的单位，且能表达目标值。对于价格、FX 汇率、比例、应计利息中间值和非整数份额，可能需要比结算货币最小单位更高的精度；整数乘法也会遇到范围和余数问题。若使用 64 位整数，需推导最大允许金额并验证运算中间值；不能只检查最终余额。

### 2. Neon Commerce：扩展到 JPY 时，“一律存分”把简单问题变成了隐式转换陷阱

Neon Commerce 的两篇公开工程文章 [Representing money at scale is hard (part 1)](https://www.neonpay.com/blog/representing-money-at-scale-is-hard) 和 [More money, more problems (part 2)](https://www.neonpay.com/blog/more-money-more-problems-part-2-of-2) 记录了一个很具体的多币种设计教训。

最初用整数 cents 表示金额时，USD/EUR/GBP 的主路径很简单。扩展到日元后，团队为避免重写显示逻辑，把 JPY 金额也存成“乘以 100”的数字，例如 123 日元存为 12300。这样虽然能让显示逻辑继续除以 100，却也允许系统表示根本不合法的值，例如 JPY 1.23。之后折扣、税额和对外 API 又需要在不同位置重复判断“这个币种要不要除以 100”，规则分散后很容易漏掉。

他们后来采用了更明确的分层：使用支持精确十进制运算的 big.js 承载一般数值，封装带有 amount 与 scale 的 Decimal，再用 Money 对象把币种和其规定的 scale 绑定；在边界处转换成支付 API 要求的整数最小单位，并拒绝那些会悄悄丢精度的转换。文章还强调，不同币种的 Money 不能相加，即使它们恰好有相同的 scale；将 10 元折扣分给三行，也必须分配余数，确保份额合计仍为 10 元。

这段经验说明了两点：

1. **整数最小单位是边界协议和账务金额的好选择，不是所有中间数值的通用表示。**
2. **币种 scale 必须进入类型与领域规则。** 不要在每个函数里散落着 if JPY then divide by 100 这样的特殊逻辑。

### 3. Stripe Tax：真实税务计算会“先汇总再舍入”，再把舍入差额分回明细

Stripe 的 [Calculate tax 文档](https://docs.stripe.com/tax/calculating) 描述了其自动税计算的一种路径：保留计算精度，按适用税率分组计算税额总量，再将税额舍入到币种最小单位，随后将舍入后的税额分配回各个明细行。某一行可能需要调整一个最小货币单位，才能让所有行项目重新加总到交易总额。

这不是可以无条件复制到所有税务辖区的通用税法规则，但它说明一个重要事实：**逐行 ROUND 与先计算汇总税额再分摊，可能产生不同金额。** 即使每一步都使用精确 Decimal，算法顺序不同仍然会造成差异。

产品、税务和账务团队应决定哪个金额是权威值，以及采用行级、税率组级、发票级还是其他规定的舍入层级。如果将某个税务或计费系统的实现迁移到 Java、C#、PostgreSQL 或 Snowflake，不应只复制公式，还要复现它的舍入节点和余数分配规则。否则新旧系统都“计算正确”，却无法对账。

### 4. 支付服务商：内部金额模型和外部 API 单位不是同一个概念

[Stripe 的币种文档](https://docs.stripe.com/currencies) 说明，API 金额通常以币种 minor unit 传入：1000 表示 USD 10.00，而 JPY 10 代表 10 日元。同时还存在特殊情况：部分币种在支付和提现场景中的单位规则不同，兼容旧规则的币种可能要求使用固定的末尾零，或只允许 certain increments。换句话说，外部支付 API 的金额格式不仅取决于 ISO 4217 的一般币种信息，还取决于服务商、交易类型与具体 API 的契约。

建议将内部 Money 领域模型与支付渠道适配器隔离：

- 内部记录统一的 currency code、金额值、单位和政策版本；
- 每个 PSP adapter 按其官方契约转换到 API 所要求的 minor unit 或十进制字符串；
- 记录发送给服务商的金额与内部金额的对应关系；
- 明确处理不支持的 scale、超过支付上限的金额以及无效单位，不要自动猜测或默默舍入；
- 对支付成功、部分捕获、退款、冲正和结算报告使用相同的金额语义与稳定交易标识进行对账。

这比让核心账本永久采用某个支付供应商的字段格式更稳健，也便于将来切换服务商或接入多渠道。

### 5. C# Money 库：库的默认 Context 也可能悄悄改变数据

NodaMoney 的 [发布记录](https://github.com/RemyDuijkeren/NodaMoney/releases) 和实现文档可以看到，MoneyContext 用于配置舍入、scale 与精度；Money 的拆分必须处理舍入余数；序列化与反序列化也可能按当前 context 应用金额规则。相关版本变化曾影响反序列化时的舍入行为。

这提供了一个适用于所有语言的教训：不要把舍入策略作为不可见的全局默认值。特别是当应用将 Money 对象写入 JSON、消息队列或数据库，再由另一服务读取时，应明确反序列化会不会量化金额、是否保留输入 scale，以及 context 是否由环境配置隐式决定。

对第三方数值库做升级时，应加入如下契约测试：同样的金额经过 encode → decode 后必须保持预期数值；同样的输入使用批准的舍入策略必须得到相同输出；Money split 的所有份额之和必须严格等于原始金额；无效币种 scale 或超范围金额必须显式失败。

### 6. 账本经验：精确金额不能替代双重记账、幂等性和不可变事件

Modern Treasury 的 [How to Scale a Ledger](https://www.moderntreasury.com/journal/how-to-scale-a-ledger-part-i) 讨论了可扩展账本中的不变性、双重记账和并发控制。实际金融系统除了要防止每笔金额因舍入而变化，还必须防止同一业务事件被重复记账、余额被并发写坏，或无法从历史记录解释某个余额为何形成。

在核心账务路径中，应把数值规则与状态/交易规则一起设计：

- 使用明确的事务边界与幂等键处理超时重试；
- 保存不可变的记账事件或可审计的冲正事件，不通过直接改写历史值来“抹平”差异；
- 对借贷平衡、分配合计、退款不超过可退金额等不变量实施数据库约束或事务性校验；
- 保留源事件、计算政策版本、交易状态和对账结果的关联；
- 将无法对齐的记录放进异常处理流程，而不是通过浮点容差或人工改数自动消掉差异。

这些经验将金融计算从“数字类型正确”推进到“整个资金流可验证”。后者才是生产系统需要保证的结果。

## 十四、落地建议：如何在新系统和遗留系统中应用

### 新建金融服务

1. 先定义金额、价格、数量、费率、汇率和日期语义，确定每种字段的允许范围、scale 和币种/单位。
2. 为每个核心计算确定权威执行位置、精度预算和舍入规则。
3. 为各个语言选择唯一的主要数值表示，避免一个服务同时随意混用 Number、BigInt、Decimal 和字符串。
4. 对数据库 schema、SQL 表达式、驱动映射和 API 序列化做端到端验证。
5. 把黄金测试向量和金额不变量放入 CI，且在升级语言、驱动、数据库版本或数值库时重跑。
6. 为溢出、无效价格、缺失汇率和计算不一致建立明确失败路径与告警。

### 遗留系统现代化

不要先对所有 double 做全局替换。先分类使用场景：

- 已记账余额、交易费用、现金、支付和结算：优先精确类型并做历史对账；
- 价格、数量、收益率、利率、FX 率：先制定允许的 scale 与中间精度；
- 分析、风险模型与统计数据：评估浮点误差是否在模型容忍范围内；
- 只用于显示与报表的值：确保显示格式没有被误认为业务舍入；
- 跨语言与数据库边界：查明实际运行时类型而不只是数据库列类型。

之后从高风险金额路径开始建立回归测试，用典型历史交易和边界数据对比旧结果与新结果。差异必须分类为旧系统错误、业务规则修正、舍入规则变化、数据源变化或实现差异。不要通过容差掩盖本应精确一致的账务差额。

### 监控什么

除了服务错误率与执行时间，还应监控：

- 计算失败、溢出和被拒绝的无效数值；
- 非预期的舍入或精度信号；
- 源系统与目标系统的金额不一致笔数及金额总量；
- 交易、费用、持仓、现金和总账对账差异；
- 缺失价格、缺失汇率和过期市场数据；
- 重新计算与历史记录之间的差异；
- API 数值解析异常、数据库类型转换异常和超时重试导致的重复请求。

任何“容差”都应该有明确的业务含义。它可能适用于统计模型的近似输出，但不应该用来让本应精确相等的同币种账务金额通过对账。

## 十五、技术选择矩阵

| 平台 | 不借助第三方库 | 借助第三方库 | 最需要防范的问题 |
| --- | --- | --- | --- |
| Java | BigDecimal、BigInteger；固定范围时 checked long 运算 | Joda-Money、JSR 354 实现用于 Money/Currency 抽象 | double 构造、除法异常、equals 与 compareTo、scale 和舍入时点 |
| Node.js / TypeScript | 安全范围内的整数，或 BigInt 定标整数；自行实现明确舍入 | decimal.js、bignumber.js、big.js；Dinero.js 用于货币抽象 | Number 精度、BigInt 序列化、JSON 数值解析、库默认 precision 与 rounding |
| Python | Decimal、int、Fraction | py-moneyed 管理 Money/Currency；NumPy/pandas 用于适合浮点的分析 | Decimal context、从 float 构造、与 DataFrame/JSON/数据库之间的类型退化 |
| Rust | i64/i128 定标整数、checked_* 运算；f64 仅用于经过验证的近似模型 | rust_decimal、bigdecimal | 固定 Decimal 的范围上限、整数中间值溢出、serde 数值序列化与数据库映射 |
| C# / .NET | decimal、BigInteger；明确 Math.Round 的 MidpointRounding | NodaMoney；Money/Currency 领域抽象 | decimal 不是任意精度；默认 ToEven 舍入、区域化解析、溢出和 Context/JSON 映射 |
| Snowflake | NUMBER(p,s)，必要时评估 DECFLOAT；显式 CAST/ROUND | SQL 数值计算通常不需要第三方十进制库；应用层仍要选精确类型 | 38 位 precision 上限、scale 传播、FLOAT 隐式参与、ROUND 模式、NULL/除零语义 |
| PostgreSQL | NUMERIC/DECIMAL、整数类型；显式 ROUND/CAST | 客户端 Decimal/BigDecimal 类型映射与 Money 领域库 | NUMERIC(p,s) 约束、NUMERIC 与 FLOAT 的舍入差异、整数除法、money 的 locale/固定 scale |

表中的“无第三方库”不意味着零工程成本。尤其是 Node.js 和 Rust，如果选择定标整数，就必须自己实现并彻底测试舍入、单位转换、溢出和余数分配；若采用十进制库，也必须锁定版本并明确配置。对跨应用和数据库边界的金融数值，类型和规则的统一通常比某个库的 API 更重要。

## 十六、最终结论

金融服务中的数值正确性，不是“全部改成 decimal”这么简单，也不是某种语言天然优于其他语言。真正可靠的设计应同时做到：

- 账务金额、价格、数量、费率和汇率有明确类型和单位；
- 在需要逐单位精确一致的路径中避免二进制浮点；
- 定义中间精度、舍入模式、舍入时点和余数分配规则；
- 对各语言与数据库的类型转换、SQL scale 规则和序列化做端到端测试；
- 为溢出、缺失数据、重复执行和规则版本提供明确控制；
- 用黄金测试向量、业务不变量和对账监控证明行为，而不是相信一套类型声明。

技术选择上，Java 可以用标准库 BigDecimal/BigInteger；Python 可以优先用标准库 Decimal；Snowflake 与 PostgreSQL 可通过原生定点/精确数值类型进行计算。Node.js 原生缺少 Decimal，需要在受控范围内选择安全整数/BigInt，或者统一采用十进制第三方库；Rust 则通常需要定标整数或 Decimal crate。

但无论用什么语言，最终需要回答的都一样：**输入是什么、单位是什么、何时舍入、用什么规则舍入、超出范围怎么办、结果能否跨系统复算和对账。** 这些规则如果没有明确下来，换用任意精度 Decimal 也只是把一部分错误变少，而不是让金融计算自动正确。

---

## 参考资料

### 语言与运行时

- [Java BigDecimal API](https://docs.oracle.com/en/java/javase/26/docs/api/java.base/java/math/BigDecimal.html)
- [Java BigInteger / BigDecimal 数学包](https://docs.oracle.com/en/java/javase/26/docs/api/java.base/java/math/package-summary.html)
- [Python Decimal 标准库](https://docs.python.org/3/library/decimal.html)
- [Python 浮点数：误差与限制](https://docs.python.org/3/tutorial/floatingpoint.html)
- [MDN JavaScript Numbers and strings](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Numbers_and_strings)
- [MDN BigInt](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt)
- [Rust f64](https://doc.rust-lang.org/std/primitive.f64.html)
- [rust_decimal 文档](https://docs.rs/rust_decimal/latest/rust_decimal/)
- [bigdecimal 文档](https://docs.rs/bigdecimal/latest/bigdecimal/)

### C# / .NET 与 Money 类型

- [Microsoft: System.Decimal](https://learn.microsoft.com/en-us/dotnet/fundamentals/runtime-libraries/system-decimal)
- [Microsoft: Decimal.Round](https://learn.microsoft.com/en-us/dotnet/api/system.decimal.round?view=net-10.0)
- [Microsoft: MidpointRounding](https://learn.microsoft.com/en-us/dotnet/api/system.midpointrounding?view=net-10.0)
- [NodaMoney 源码与发布记录](https://github.com/RemyDuijkeren/NodaMoney)
- [NodaMoney releases：Context、拆分与序列化行为变更](https://github.com/RemyDuijkeren/NodaMoney/releases)

### 业界经验与支付实践

- [Modern Treasury: Floats Don’t Work For Storing Cents](https://www.moderntreasury.com/journal/floats-dont-work-for-storing-cents)
- [Modern Treasury: How to Scale a Ledger, Part I](https://www.moderntreasury.com/journal/how-to-scale-a-ledger-part-i)
- [Neon Commerce: Representing money at scale is hard (part 1)](https://www.neonpay.com/blog/representing-money-at-scale-is-hard)
- [Neon Commerce: More money, more problems (part 2)](https://www.neonpay.com/blog/more-money-more-problems-part-2-of-2)
- [Stripe: Supported currencies and API amount units](https://docs.stripe.com/currencies)
- [Stripe: Calculate tax and allocate rounded tax totals](https://docs.stripe.com/tax/calculating)

### 数据库

- [Snowflake Numeric Data Types](https://docs.snowflake.com/en/sql-reference/data-types-numeric)
- [Snowflake Arithmetic Operators: precision and scale](https://docs.snowflake.com/en/sql-reference/operators-arithmetic)
- [Snowflake ROUND 和舍入模式](https://docs.snowflake.com/en/sql-reference/functions/round)
- [PostgreSQL Numeric Types](https://www.postgresql.org/docs/current/datatype-numeric.html)
- [PostgreSQL Monetary Types](https://www.postgresql.org/docs/current/datatype-money.html)
- [PostgreSQL Mathematical Functions and Operators](https://www.postgresql.org/docs/current/functions-math.html)

### 金额与币种建模

- [Joda-Money](https://www.joda.org/joda-money/)
- [JSR 354 / JavaMoney](https://javamoney.github.io/)
- [py-moneyed](https://github.com/py-moneyed/py-moneyed)
- [decimal.js](https://github.com/MikeMcl/decimal.js)
- [bignumber.js](https://github.com/MikeMcl/bignumber.js)
- [big.js](https://github.com/MikeMcl/big.js)
- [Dinero.js](https://dinerojs.com/)

在决定生产实现之前，请再次核对目标语言版本、第三方库版本、Snowflake 驱动兼容性及 PostgreSQL 版本。数值库的精度、舍入与序列化选项可能随版本变化，核心金融规则应通过自己的回归测试固定，而不是只依靠外部文档。
