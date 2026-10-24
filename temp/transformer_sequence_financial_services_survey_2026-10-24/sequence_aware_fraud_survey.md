# 序列感知反欺诈（Sequence-Aware Fraud Detection）技术综述

## 以 Ramp「每笔授权跑一个 Transformer」为锚点：论文地图、业界实践、风险清单与落地手册

**版本**：v1.0　　**日期**：2026-10-24　　**适用读者**：支付/发卡/收单/信贷/AML 方向的风控算法与平台工程师

---

# 摘要：十条结论

1. **Ramp 的核心不是"用 Transformer 替代 GBDT"，而是"用 Transformer 造特征，GBDT 做决策"。** Transformer 输出只占 SHAP 权重的约 15%，却带来 12% 的 AP 提升与全部告警预算下的帕累托改进。
2. **真正把金额指标拉起来的是金额加权损失（+29%），Transformer 是叠加项（到 +32%）。** 序列模型主要改善**排序质量**与**首笔欺诈**（同等预算下 +9%）。
3. **自监督预训练不需要欺诈标签。** 用 next-event / masked fill-in / swap detection 三个目标，两年交易数据，4 张 L40S 上不到 1.5 小时即可训完。
4. **学术路径已经成熟且连续**：TabFormer(2020) → Interleaved RNN(2020) → 微信支付 GPT 预训练(2023) → Featurespace 5.1B 交易预训练(2023) → Visa TREASURE(2025) → FraudTransformer(2025)。
5. **但公开的负结果同样密集**：NICE Actimize 的对比学习嵌入叠加到工程特征上零增益（0.9205 vs 0.9245）；IEEE-CIS 上时序异构图 Transformer 打不过直方图 GBDT（0.8536 vs 0.8722）；树模型在中型表格数据上仍是 SOTA（Grinsztajn et al., 2022）。
6. **业界收敛到"混合架构"**：Stripe 用数百个网络级聚合特征 + embedding + 反事实评估；Mastercard 用生成式模型（平均 +20%，125ms 响应）；Visa 做支付基础模型（异常行为检测 +111%）。
7. **最大的风险不是模型，是标签**：拒付延迟 30–120 天、选择性标签（只调查被拦下的交易）、拒付 ≠ 欺诈。
8. **第二大风险是数据泄漏**：2025 年一篇论文用最小神经网络在泄漏协议下做出 99.9% recall，说明大量已发表结果不可信。
9. **工程上最容易被低估的是延迟**：Ramp 首次上线因"每请求 padding 到 32"与"200 万商户名表被 GC 扫描"，p99 达 180ms 而被迫回滚；修复后 84ms，且 80,149 笔实盘授权分数逐位一致。
10. **决策规则**：若你已有强 GBDT 基线 + 良好特征平台，收益来自"把序列表征当作新特征"；若从零开始且数据量不足千万级，先做窗口聚合特征，不要上 Transformer。

---

# 1. 为什么反欺诈本质上是序列问题

## 1.1 单笔交易的信息上限

一笔授权请求在到达风控系统时，携带的信息大致只有：卡号（token）、商户、MCC、金额、币种、时间、卡呈现方式（插卡/挥卡/线上/钱包）、终端与设备指纹、IP、账单地址、3DS 结果。这些字段的联合分布本身区分度有限——因为**同一笔 1,400 美元的电子消费品订单，对 IT 采购经理是日常，对只买午餐和打车的人是异常**。

Ramp 在原文里把这件事说得很直白：

> "一笔 1,400 美元的电子产品消费，对正在买笔记本电脑的 IT 经理是常规，但对近期只买午餐、打车、软件订阅的人来说很奇怪。"

结论：**判定的信息量主要不在"这笔"，而在"这笔相对于前 N 笔的位置"**。这是序列建模的全部动机。

## 1.2 三类序列信号

| 信号类型 | 具体表现 | 传统窗口特征能做什么 | 序列模型能多学到什么 |
|---|---|---|---|
| **常规断裂（routine break）** | 首次出现在新国家、陌生商户类型、金额量级跳变、卡呈现方式突变 | 计数类特征能统计"过去 24h 是否出现过该国"，但无法表达"以你的历史看，这有多反常" | 条件化于个体历史的条件概率 / surprisal，把"陌生"变成有刻度的量 |
| **速率与连击（velocity / burst）** | 短时间多笔小额试卡后跟一笔大额、跨商户快速切换 | 固定窗口（1h/24h/7d）的 count/sum/distinct，窗口边界会漏、会重 | 学习不规则间隔的时间结构，区分"密集连刷"与"分散在两周" |
| **跨实体关联（network）** | 同一设备多卡、同一商户集中攻击、团伙共享收货地址 | 图特征（度、连通分量、共享属性计数） | 序列 + 图联合建模，让"事件的表示"与"实体的表示"互相校准 |

三类信号对应三种技术：**序列模型、时间点过程、图学习**。Ramp 做的是第一类（并在特征平台里保留了第二、三类的传统特征）。

## 1.3 三代范式

| 范式 | 时间 | 代表 | 特征来源 | 主要瓶颈 |
|---|---|---|---|---|
| 特征工程 + GBDT | 2010–2018 | 银行内部评分卡 + XGBoost/LightGBM | 人工定义窗口聚合（1h/24h/7d/30d 的 count/sum/mean/std/entropy） | 特征空间靠人力堆，无法表达"条件化于个体历史的反常度" |
| RNN/LSTM 序列模型 | 2017–2021 | Feedzai Interleaved RNN（KDD'20）、JD Finance Session-RNN、支付宝 Structure-aware HRNN | 原始事件序列，模型自己学表示 | 长依赖衰减、训练慢、线上推理框架不成熟 |
| Transformer + 自监督 | 2020– | TabFormer、微信支付 GPT、Featurespace、Visa TREASURE、Ramp | 自监督预训练得到通用表征，再接下游 | 标签延迟、数据泄漏、延迟预算、可解释性合规 |

## 1.4 Ramp 案例的定位

Ramp 是一家企业费用管理 / 公司卡公司。它的场景有两个特殊性，值得先记住，因为后面所有"能不能照搬"的判断都依赖它：

1. **主体是"一个人在一个企业内的所有卡"**，不是单卡。同一员工可能同时持有实体卡、虚拟卡、部门卡，历史要跨卡聚合。
2. **B2B 支出分布与 C2C 差异大**：广告投放、SaaS 订阅、差旅、供应商付款的金额量级和节奏完全不同，且合法大额更常见——这直接导致"金额加权损失"成为最大收益项。

---

# 2. Ramp 方案完整拆解

原文：*Putting a Transformer Inside Every Card Authorization*，Ramp Builders Blog，2026-10-08，作者 Dwight Temple、Simon Miller。

## 2.1 整体架构：两阶段，而非端到端替换

```
授权请求到达
   │
   ├─(A) 频率统计特征（直接计数：近 N 笔/近 T 时间的频次、去重数、金额分布）
   │
   ├─(B) 小型 Transformer（3 层注意力）读最近交易序列
   │        └→ 输出 1 个 embedding + 每字段 surprisal + 4 个 swap score
   │
   └─(C) 历史特征（已有，回看数月）+ A + B  →  XGBoost  →  风险分
```

关键判断：**XGBoost 及其全部已有特征保留为最终决策层**，Transformer 只是新增的两类"视图"之一。这个设计选择让项目风险大幅下降——新模型失败时，退化路径是清晰的。

## 2.2 Tokenization：把交易变成"词"

每一步（一笔历史交易）被编码为：

| 字段 | 处理方式 |
|---|---|
| 商户（merchant） | 分层词表，见下 |
| 商户类别（category） | 学习向量 |
| 国家（country） | 学习向量 |
| 金额（amount） | 连续值编码 |
| 时间（time） | 经"小型可学习时间位置编码"，区分密集连刷与长间隔 |
| 卡呈现方式 | 学习向量（插卡 / 挥卡 / 线上 / 数字钱包 …） |
| 是否通过（approved） | 学习向量 |

**商户词表的三层设计（本文最有工程价值的部分）**：

| 层级 | 覆盖 | 表示 |
|---|---|---|
| 高频商户 | 头部（数万量级） | 独立向量 |
| 中频商户 | 约 200 万家 | 按类别哈希到共享槽位（hash bucket within category） |
| 长尾/未见过 | 其余 | 每个类别一个兜底 token |

效果：

- 全量百万级商户被压进 **约 47,000 个 token**；
- **商户词表可以变化而不需要重训模型**（新商户自动落到类别兜底或哈希槽）；
- **超过 80% 的线上权重**集中在"商户 embedding + 预测下一商户的那一层"——也就是说，这个模型绝大多数的参数其实在学"谁在哪儿花钱"。

这是对高基数类别特征的标准解法，但 Ramp 把"兜底层级"做进了结构里，而不是靠 OOV 时的随机初始化。**这一点直接决定了模型能不能周更**。

## 2.3 时间编码

不用绝对时间戳，而用**可学习的时间位置编码**表达"距上一笔多久"。原因很实际：绝对时间会把"2026 年 3 月"这种与欺诈无关的信息编码进去，而 Δt 才是"连刷 vs 分散"的判据。

学术上这条路有更完整的版本：

- **Time2Vec**（时间向量化）——被 THGT-FD 等用于交易表示；
- **Transformer Hawkes Process**（arXiv:2002.09291）——用自注意力参数化点过程强度，天然处理不规则间隔；
- **FraudTransformer**（arXiv:2509.23712）——同时用"时间编码器"（绝对或间隔）+ "学习式位置编码"（保序），并做了消融证明两者都必要。

## 2.4 三个训练目标

| 目标 | 做法 | 类比 | 成本 |
|---|---|---|---|
| **下一笔预测（主任务）** | 三层注意力读全部历史，压成一个 embedding；训练时强制"每次预测只能来自该 embedding" | 自回归语言模型 | 主体 |
| **掩码填空（辅助）** | 遮住若干历史交易，用完整上下文补全 | BERT MLM | 低 |
| **Swap 检测（辅助）** | 一半样本中，把某笔的某个片段（商户/金额/国家/卡呈现方式）替换成**别人的**交易片段，模型判断"哪个不属于" | BERT NSP 的变体 | <1% 训练时间 |

Swap 任务的设计很巧：模型要回答"这笔是不是这段历史的"，唯一可行的方式是**把该笔与前序历史做比对**——这恰好就是欺诈判定的核心运算。原文说它"带来了对用户消费方式更深的理解"。

**这三个目标全部不需要欺诈标签。** 训练语料是两年交易流水，一遍过。

## 2.5 输出给下游的四类信号

| 输出 | 维度 | 特点 |
|---|---|---|
| embedding | 向量 | 信息密度高，但不可单独解释 |
| 每字段 surprisal | 5 个左右（商户/类别/国家/金额/呈现方式） | **可单独解读**——"这笔金额比预期罕见多少" |
| swap score | 4 个（商户/金额/国家/卡呈现方式） | 可单独解读 |
| （隐含）下一笔分布 | 47k 维 | 仅训练用，线上只取打分 |

原文给了两个"概率差"的直观量级：

- 两个电子产品买家，模型对其下一笔的预测概率相差约 **33 倍**；
- 常旅客 vs 只在一个国家消费的人，对"新国家"的 surprisal 相差约 **24 倍**。

以及一组手工构造的示意：

| 场景 | 结果 |
|---|---|
| 常规历史 + 午餐 | 四个 swap score 均 <5% |
| 同一家午餐店，1,400 美元 | amount swap 86%，其余约 1% |
| 手输卡号而非插卡 | 呈现方式 swap 1% → 20% |
| 1,400 美元线上电子消费（常规用户） | 商户 43% / 金额 50% |
| 同上（常规电子产品买家） | 商户 1% / 金额 6% |
| 境外酒店（单国用户） | 国家 58% |
| 境外酒店（常旅客） | 国家 1% |

注意原文声明：这些图是**手工构造的示意，不代表实测**。引用时要标明。

## 2.6 训练成本

| 环节 | 规模 | 成本 |
|---|---|---|
| Transformer 预训练 | 2 年交易，无欺诈标签 | **<1.5 小时 / 4×L40S** |
| XGBoost | 全量交易（**不对负样本采样**） | Ray 集群：1 小时算特征 + 3 小时训练 |
| 模型规模 | 小型（3 层注意力） | 线上**纯 CPU** 打包推理 |

"不采样负样本"这一点值得注意：欺诈标签稀疏且延迟数周，很多团队会下采样负样本以加速，但那会破坏概率校准，进而让"金额加权"失效。Ramp 选择全量训练。

## 2.7 评估方法论（比模型更值得抄）

| 方法 | 具体做法 | 为什么重要 |
|---|---|---|
| **固定告警预算对比** | 让新旧模型各自标记相同数量的最高分交易，比较其中捕获的欺诈笔数与**欺诈金额** | 线上运营容量固定，任何"提高 recall"的宣称在固定预算下才可比 |
| **AP（平均精度）** | 排序质量指标 | 不依赖阈值，适合高度不平衡 |
| **消融** | 同 XGBoost、同损失，仅去掉新特征 | 分离"损失函数贡献"与"序列特征贡献" |
| **SHAP** | 看模型依赖什么 | 定位特征作用，但不能当"独立贡献"读 |

## 2.8 结果

**总量（同等告警预算）**

| 指标 | 相对上一版模型 | 相对"仅金额加权 XGBoost" |
|---|---|---|
| 捕获欺诈金额 | **+32%** | +3%（推算） |
| AP | **+14%** | **+12%** |
| 捕获欺诈笔数 | +6% | +3% |

**归因分解**

| 组成 | 贡献 |
|---|---|
| 仅金额加权损失（同特征） | 欺诈金额 **+29%** |
| 再加 Transformer | 欺诈金额 **+32%** |

即：**大头来自损失函数，序列模型是增量**。这个诚实分解在业界文章里少见，也是本文最该被记住的一句。

**分层效果**

| 交易金额段 | 相对上一版模型 | 备注 |
|---|---|---|
| < \$100 | 基本持平 | 仅金额加权时反而 -6%，Transformer 补回（半预算下 +10%） |
| \$100–\$1,000 | **+16%** | |
| ≥ \$1,000 | **+34%** | 该段占全部欺诈金额的约 3/4 |

**其他关键切片**

| 切片 | 结果 |
|---|---|
| 欺诈连击中的**首笔**（无前置欺诈信号） | 欺诈金额 **+40%**；半预算下比仅金额加权 **+9%** |
| 线上已放行、事后确认欺诈的交易 | 额外捕获金额中约 **80%** 属于此类；比仅金额加权 **+24%** |
| 全告警预算区间 | 旧模型在约 1/3 的预算点上更强；加 Transformer 后在**每个预算点**都更强（帕累托改进） |

**SHAP 归因（对欺诈交易）**

| 输入 | 占总分比例 | 排名 |
|---|---|---|
| Transformer 全部输出 | ~15% | — |
| └ embedding | 8% | — |
| └ surprisal | 5% | 商户 surprisal 第 31、类别第 33 |
| └ swap | 2% | 商户 swap 第 20、金额 swap 第 27 |

原文同时警告：**SHAP 低不等于特征无用**，要按输入归一化后再看；且 SHAP 反映的是"模型在这一次决策中依赖了什么"，不是"这个输入独立贡献了多少"。

## 2.9 延迟事故：一次教科书级的回滚

**现象**：首次上线，模型调用耗时约为前代的 **2 倍**，大量授权触达超时线 → **立即回滚**。

**归因（profile 结果）**：

| 假设 | 实际 |
|---|---|
| 注意力层太慢 | 错。注意力只占约 1/3 模型时间 |
| — | **每个请求被 padding 到 batch=32**，对 padding 位置也要算满 47,000 个商户的 softmax，占 **>1/2 时间** |
| — | 一张 **约 200 万条商户名**的查找表恰好位于 Python GC 会遍历的位置，每轮都被扫描 |

**修复**：

1. 彻底去掉 padding；
2. 把大表移出 GC 可达范围；
3. 小请求直接用 numpy 组装。

**结果**：

| 指标 | 上线初版 | 修复后 | 一周后（数百万请求） |
|---|---|---|---|
| 中位延迟 | 145 ms | 65 ms | **54 ms** |
| p99 | 180 ms | 105 ms | **84 ms** |

**最关键的验证**：修复版与原版在**实盘 80,149 笔授权**上并行运行，**分数逐位一致，无一笔决策改变**，回滚后不到 1 天即重新上线，整体授权总时长未变。

这套"改性能不改分数"的验证纪律，比模型本身更值得抄。

## 2.10 五条可迁移经验

1. **小模型 + 高频重训 > 大模型 + 低频重训。** 原文原话："我们宁可频繁重训这个尺寸的模型，也不愿偶尔重训一个大模型。"
2. **词汇表设计决定可维护性。** 分层 + 哈希 + 类别兜底，让"商户集合变化"不再是重训理由。
3. **把序列模型的产出做成"可分项解读的标量"**（surprisal、swap score），而不是只丢一个 embedding。这让 GBDT 好用，也让风控分析师能讲理由。
4. **特征平台是隐形前提。** 一份特征定义、两种编译（Snowflake 回填 + 流式视图），保证训练/服务一致；且严格定义"只有发生在被评分授权之前、且已到达系统"的交易才算历史。
5. **上线前先做"分数一致性"回归。** 性能优化必须证明零行为变化。

---

# 3. arXiv 论文地图

## 3.0 谱系

```
                    ┌── 推荐系统序列建模（架构源头）
                    │     SASRec 1808.09781 / BERT4Rec 1904.06690
                    │     DIN 1706.06978 / BST 1905.06874 / SIM 2006.05639
                    │
2017  GRU 序列 ──────┤
      (1711.01434)   │
                    ├── 表格 Transformer
2019  HMM 多视角 ────┤     TabFormer 2011.01843（合成信用卡交易）
      (1905.06247)   │
                    ├── 序列 RNN 工业化
2020  ──────────────┤     Interleaved RNN 2002.05988（Feedzai, KDD'20）
                    │
                    ├── 大规模自监督预训练
2023  ──────────────┤     微信支付 GPT 2312.14406
                    │     Featurespace 2401.01641（5.1B 笔 / 180 家发卡行）
                    │     Visa TREASURE 2511.19693
                    │
                    ├── 时间感知 Transformer
2025  ──────────────┤     FraudTransformer 2509.23712
                    │     SOHET 2606.21356（Booking.com）
                    │     TCT 2605.21490（NICE Actimize，负结果）
                    │
                    └── 序列 + 图 / 点过程
                          Transformer Hawkes 2002.09291
                          BRIDGE 2510.25126（Capital One）
                          STA-GT 2307.05121
```

## 3.1 序列 RNN 时代（2017–2021）

| 论文 | 机构 | 方法 | 关键结论 |
|---|---|---|---|
| **Interleaved Sequence RNNs for Fraud Detection**<br>arXiv:2002.05988（KDD'20 Industry Track） | Feedzai | 把每张卡的支付历史视为**无界、不规则的子序列**，多序列交错训练 | **特征无关**（feature-free）的 RNN 优于当时的特征工程 + 树模型，且算力更省；给出从预处理到部署的完整毫秒级框架 |
| Transaction Fraud Detection Using GRU-centered Sandwich-structured Model<br>arXiv:1711.01434 | 京东金融等 | "within→between→within" 三明治结构，GRU + attention | 早期证明序列学习器可嵌入集成框架 |
| Multiple perspectives HMM-based feature engineering<br>arXiv:1905.06247 | 里昂一大 / Worldline | 8 个视角的 HMM 似然作为特征喂随机森林 | PR-AUC **+15%**；说明"序列的统计摘要"本身就有价值 |
| Credit card fraud detection using ML: A survey<br>arXiv:2010.06479 | Worldline / 里昂 | 综述 | 系统梳理类别不平衡、**概念漂移**、序列建模（聚合特征 / LSTM / HMM）三条线 |

## 3.2 表格与交易 Transformer 的起点

| 论文 | 机构 | 方法 | 关键结论 |
|---|---|---|---|
| **Tabular Transformers for Modeling Multivariate Time Series (TabFormer)**<br>arXiv:2011.01843（ICASSP'21） | IBM Research | 两个模型：BERT 式表示学习器 + GPT 式生成器；在**合成信用卡交易数据集**上做欺诈检测与合成数据生成 | 首次系统论证"把表格行当 token"可行；开源的合成交易数据成为后续很多论文的基准 |

## 3.3 大规模自监督预训练（工业级）

| 论文 | 机构 | 规模 | 结论 |
|---|---|---|---|
| **Generative Pretraining at Scale: Transformer-Based Encoding of Transactional Behavior**<br>arXiv:2312.14406 | 腾讯 / 微信支付 | 大规模支付行为序列 | 自回归 GPT + 无监督预训练，解决"token 爆炸"与行为序列重构；引入差分卷积增强异常感知；服务中国最大线上支付商户之一 |
| **Towards a Foundation Purchasing Model**<br>arXiv:2401.01641（ICAIF'23） | Featurespace | **5.1 亿→51 亿笔交易，180 家发卡行** | 生成式自回归预训练产出上下文相关交易嵌入；在**高精度区间显著提升金额捕获率**，且可跨域迁移 |
| **TREASURE: The Visa Payment Foundation Model**<br>arXiv:2511.19693 | Visa | 工业级支付数据 | 静态/动态属性分离的子模块 + 高基数类别预测的高效训练；**异常行为检测较生产系统 +111%**，推荐嵌入 +104% |

这三篇合起来说明一件事：**"支付基础模型"已经是发卡组织与卡组织级别的正式路线**，不再是实验室概念。

## 3.4 时间感知 Transformer

| 论文 | 机构 | 方法 | 结论 |
|---|---|---|---|
| **FraudTransformer: Time-Aware GPT**<br>arXiv:2509.23712（ICAIF'25 workshop） | 伦敦数学科学研究所 / 工业合作方 | GPT 式架构 + **专用时间编码器**（绝对时间或 Δt）+ **学习式位置编码**（保序） | 数千万笔工业交易上，AUROC 与 PRAUC 均优于 LR / XGBoost / LightGBM 及去掉时间/位置的消融版 |
| **SOHET: Sequence Of Heterogeneous Events Transformer**<br>arXiv:2606.21356 | Booking.com | 分层结构：事件类型专属表格编码器 + 时间/类型嵌入 + 因果或双向 Transformer；**三个自监督预训练目标** | 17 类事件的欺诈任务上优于 FlexTPP/NAPPT/CIPPT **5.8%**；预训练再 **+2.6%**、收敛快 **2.4%** |
| Multi-Stream Temporal Fusion<br>arXiv:2606.25007 | — | 融合交易、登录、风险信号三流，时间感知位置编码 + 门控融合 | 报告 AUROC 0.9961（该数值异常偏高，引用需谨慎，疑似数据集过于理想） |
| **TCT: Temporal Contrastive Transformer**<br>arXiv:2605.21490 | NICE Actimize | 自监督对比学习产出交易序列嵌入，再喂 GBDT | **单独用 AUC 0.8644；与工程特征合用 0.9205，反而略低于基线 0.9245**——作者明言"未达生产可用" |

## 3.5 事件序列与点过程理论

| 论文 | 方法 | 与反欺诈的关系 |
|---|---|---|
| **Transformer Hawkes Process**<br>arXiv:2002.09291 | 自注意力参数化 Hawkes 强度 | 给"不规则间隔事件序列"提供概率框架；能算"下一事件在 t 时刻发生的强度"——这正是 surprisal 的理论版 |
| COTIC: Continuous-time convolutions<br>arXiv:2302.06247 | 连续时间卷积层 | 处理非均匀时间戳，平均排名 1.5 vs Transformer 3.714（下一事件时间+类型预测） |
| SeqNAS<br>arXiv:2401.03246 | 事件序列分类的神经架构搜索（attention/conv/RNN 混合空间） | 说明"纯 Transformer 未必最优"，架构应搜索 |
| S2P2: Deep Continuous-Time State-Space Models<br>arXiv:2412.19634 | 随机跳跃微分方程 + 并行扫描 | 线性复杂度处理标记点过程，似然提升 33% |

## 3.6 序列 + 图

| 论文 | 机构 | 方法 | 结论 |
|---|---|---|---|
| **BRIDGE: End-to-End Sequence-Graph Learning**<br>arXiv:2510.25126 | Capital One 等 | 序列模型与图模块**联合训练**，TOKENXATTN 做 token 级跨注意力 | 关系预测与欺诈检测上同时优于静态图、时序图、纯序列基线 |
| STA-GT<br>arXiv:2307.05121 | 同济 | 异构图 + 时间编码 + Transformer | 空间-时间联合建模，优于图基线 |
| THGT-FD<br>arXiv:2609.07100 | 独立作者 | 每笔交易 = 1 个交易 token + 6 类关系 token + Time2Vec | **AUC 0.8536 < 直方图 GBDT 0.8722**（IEEE-CIS 15 万笔）——公开的负结果 |
| VecAug<br>arXiv:2408.00513 | NUS 等 | 用向量检索构造"同类人群"做增强聚合 | 基础模型 AUC 最多 +2.48%，R@P0.9 **+22.5%**——"同侪对照"思路很实用 |

## 3.7 架构源头：推荐系统的序列建模

反欺诈的序列架构几乎全部借自推荐系统。想读懂上面那些论文，先读这五篇：

| 论文 | arXiv | 核心贡献 | 对反欺诈的移植点 |
|---|---|---|---|
| **SASRec** | 1808.09781 | 因果自注意力做下一物品预测 | "下一笔预测"的直接原型 |
| **BERT4Rec** | 1904.06690 | 双向 + 掩码 | 掩码填空目标 |
| **DIN** | 1706.06978 | 注意力按候选物品激活历史行为 | "这笔交易 × 历史"的注意力打分 |
| **BST** | 1905.06874 | Transformer 编码用户行为序列 | 序列编码器结构 |
| **SIM** | 2006.05639 | 检索式长序列建模 | 长历史（千笔以上）的可行做法 |

## 3.8 可解释性

| 论文 | 方法 | 用途 |
|---|---|---|
| **TimeSHAP**<br>arXiv:2012.00073 | KernelSHAP 扩展到"特征 × 时间步 × 单元"三级归因，带剪枝 | 银行账户盗用场景；论文还暴露了基于年龄的歧视性依赖 |
| FinDeepBehaviorCluster<br>arXiv:2101.04285（AAAI'21 KDF） | 时间注意力 Bi-LSTM 序列嵌入 + 专家特征 + **pHDBSCAN**（GPU/FAISS 加速，**500×**） | 数百亿级交易数分钟内聚类，挖掘"闪电欺诈"模式并生成规则叙事 |

## 3.9 反面证据（必读）

| 论文 | 结论 | 对你的意义 |
|---|---|---|
| **Data Leakage and Deceptive Performance**<br>arXiv:2506.02703 | 故意用错误协议，最小神经网络做到 **99.9% recall**；指出四类问题：预处理导致的泄漏、方法描述含糊、缺时间验证、以牺牲精度换召回 | 任何"超越 SOTA"的宣称，先查它的切分与预处理顺序 |
| **Why do tree-based models still outperform DL on tabular data?**<br>arXiv:2207.08815 | 45 个数据集、2 万 GPU 小时调参，**中型数据（~1 万样本）上树模型仍是最优** | 序列模型的收益来自"序列结构"，不是"深度" |
| **TCT**（arXiv:2605.21490） | 学习嵌入在工程特征之上**零增益** | 若你的特征工程已很强，先做消融再投入 |
| **THGT-FD**（arXiv:2609.07100） | 图 Transformer 输给 GBDT | 复杂结构不自动等于更好 |
| **Multi-task CNN Behavioral Embedding**<br>arXiv:2411.19457（ICDMW'24） | 单层多核 CNN + 位置编码 + 多任务，在效率与业务归纳偏置上优于 LSTM/Transformer | 先试 CNN，再上 Transformer |

## 3.10 从论文里能读出的六条规律

1. **有工业数据的论文，几乎都做"预训练 + 下游 GBDT"**，纯端到端替换的很少。
2. **时间编码是刚需**，不是可选装饰；去掉它性能明显下降（FraudTransformer 有消融）。
3. **数据规模决定路线**：<千万笔做窗口特征；千万–十亿做单机构预训练；>十亿才谈"基础模型"。
4. **负结果集中在两个地方**：小数据 + 复杂模型（过拟合）、强特征 + 弱增量（边际收益低）。
5. **多任务/多目标比单目标稳**：掩码、swap、对比、下一笔，本质都是在造"更难但免费的监督信号"。
6. **可解释性研究（TimeSHAP、聚类规则提取）几乎都来自风控厂商**，不是学术兴趣——因为这是合规刚需。

---

# 4. 业界实践地图

## 4.1 公开可查的实践

| 机构 | 场景 | 方法 | 公开数据 | 证据等级 |
|---|---|---|---|---|
| **Ramp** | 企业卡授权实时反欺诈 | 3 层 Transformer（自监督）+ 频率统计 → XGBoost | 同预算下欺诈金额 **+32%**；AP **+12%**；p99 **84ms** | 官方工程博客（含消融与延迟细节） |
| **Stripe（Radar）** | 收单侧支付欺诈 | 数百个**网络级聚合特征** + 类别 embedding + 神经网络；反事实评估 | ML 效果 **每年提升 >20%**；仅重训每月可提 recall 最多 **0.5pp**；**90% 的卡在网络中出现过 >1 次** | 官方技术指南（无架构图与论文） |
| **Mastercard** | 发卡侧交易评分 | Decision Intelligence / **Decision Intelligence Pro**（生成式） | 平均欺诈检测提升 **20%**；响应 **125ms** | 官网产品页 |
| **Visa** | 支付基础模型 | TREASURE（Transformer 编码器，静态/动态属性分离） | 异常行为检测 **+111%**，推荐嵌入 **+104%** | arXiv:2511.19693 |
| **Featurespace** | 银行/收单行为分析 | ARIC 平台，Adaptive Behavioral Analytics（事件序列）+ 生成式预训练 | 5.1B 笔 / 180 家发卡行的预训练语料；高精度区间金额捕获显著提升 | arXiv:2401.01641 + 官网 |
| **Feedzai** | 收单/发卡 | Interleaved RNN（特征无关）+ TimeSHAP 可解释性 | 优于当时 SOTA，算力更省 | arXiv:2002.05988 / 2012.00073 |
| **腾讯 / 微信支付** | 支付欺诈 | GPT 式自回归预训练 + 差分卷积 | 服务头部支付商户 | arXiv:2312.14406 |
| **Capital One** | 关系 + 序列联合 | BRIDGE（序列-图联合训练） | 优于图/序列单独基线 | arXiv:2510.25126 |
| **Booking.com** | 账号/交易欺诈 | SOHET（17 类异构事件） | +5.8%，预训练再 +2.6% | arXiv:2606.21356 |
| **NICE Actimize** | AML / 金融犯罪 | TCT 对比学习嵌入 | 单独 AUC 0.8644，叠加无增益 | arXiv:2605.21490 |
| **支付宝 / Ant Group** | 信贷支付欺诈 | 结构感知分层 RNN、图学习、多视角序列 | 大规模线上部署 | 多篇论文与公开分享 |
| **京东金融** | 电商支付欺诈 | Session-based RNN | 早期工业验证 | 论文 + 公开分享 |

> 说明：Stripe 与 Mastercard 的数字来自其官方页面，但没有公开架构细节与消融，不能与 Ramp 的 +32% 直接横向比较——**基线不同、指标定义不同、客群不同**。

## 4.2 三条技术路线对比

| 维度 | 路线 A：序列特征 → GBDT | 路线 B：端到端序列模型 | 路线 C：序列表征 → GBDT（Ramp 路线） |
|---|---|---|---|
| 典型代表 | 银行评分卡 + 窗口聚合 | Feedzai Interleaved RNN、微信支付 GPT | Ramp、Featurespace、多数工业落地 |
| 上线风险 | 低 | 高 | 中 |
| 可解释性 | 高（特征即理由） | 低 | 中高（surprisal 可单独解读） |
| 冷启动 | 依赖规则兜底 | 差 | 中（类别兜底 token） |
| 迭代速度 | 快（加特征即迭代） | 慢（改结构要重训） | 快（换编码器不动决策层） |
| 延迟 | 最低 | 中高 | 中（Ramp 做到 54ms 中位） |
| 收益上限 | 中 | 高 | 高 |
| 适用条件 | 数据 < 千万、团队小 | 数据 > 十亿、有推理基建 | 已有强 GBDT + 特征平台 |

## 4.3 为什么业界收敛到"混合"

三个结构性原因：

1. **标签延迟**让端到端训练极难收敛：欺诈标签要等拒付，30–120 天。自监督预训练绕开了这个约束，但最终决策层仍需要"标签友好、可增量训练"的模型——GBDT 天然适合。
2. **特征平台已经存在**：大多数风控团队已有窗口聚合特征与实时特征服务。把序列模型塞进现有特征管道，比替换整条决策链便宜一个数量级。
3. **合规要求理由码**：拒付申诉、监管问询、客户解释都需要"为什么拒"。GBDT + SHAP 是当下最成熟的理由码生产线；纯序列模型的注意力权重很难直接转成业务语言。

---

# 5. 设计决策手册（12 个决策点）

| # | 决策点 | 选项 | 推荐与理由 |
|---|---|---|---|
| 1 | **序列主体** | 单卡 / 人 / 人多卡 / 设备 / 商户 | 发卡侧用"人多卡"（Ramp 做法），收单侧用"卡 + 设备 + 邮箱"多主体；单卡会漏掉换卡攻击 |
| 2 | **序列长度** | 16 / 64 / 128 / 256 / 全历史 | 32–128 起步。Ramp 明确截断，理由是"欺诈是近期断裂，且其他特征已回看数月"；长历史用检索式（SIM）而非硬塞 |
| 3 | **时间表示** | 绝对时间 / Δt / Time2Vec / 学习式位置编码 | **Δt + 学习式位置编码**（FraudTransformer 消融证明两者互补）；绝对时间易学到季节性伪相关 |
| 4 | **类别编码** | 独立 embedding / 哈希 / 分层兜底 / 目标编码 | **分层兜底**（高频独立、中频哈希、长尾按类兜底）；目标编码在时序场景极易泄漏 |
| 5 | **预训练目标** | next-event / masked / swap / 对比 / 多任务 | 至少 next-event + masked；**swap 性价比最高**（<1% 训练时间）；对比学习要小心"负样本太易" |
| 6 | **输出形态** | 仅 embedding / embedding + 标量分 | **必须给标量**（surprisal、swap score）。标量可分项解读、可监控、可写理由码 |
| 7 | **下游组合** | 端到端 / 拼接特征 / 残差 / stacking | 拼接特征（路线 C）最稳；端到端只在数据量 > 十亿时考虑 |
| 8 | **损失函数** | BCE / focal / 金额加权 / 代价敏感 | **金额加权**（Ramp 单独贡献 +29%）；可与 focal 叠加，但要在验证集校准 |
| 9 | **模型规模** | 1–3 层 / 6–12 层 / 基础模型 | 3 层、d_model 128–256、4–8 头。原文原话：宁可频繁重训小的 |
| 10 | **重训频率** | 周 / 月 / 季 | 周更（Stripe 数据：仅重训每月可提 recall 0.5pp）；预训练季度级，下游周更 |
| 11 | **推理硬件** | GPU / CPU | **CPU**。Ramp 打包成一个 CPU 包，避免 GPU 排队带来的尾延迟 |
| 12 | **上线方式** | 直接切 / shadow / 小流量 | shadow → 1% → 10% → 50% → 100%，每级验证"分数一致性 + 延迟 + 告警量" |

---

# 6. 风险与坑（12 条）

## 6.1 标签问题（第一大风险）

| 问题 | 表现 | 后果 | 对策 |
|---|---|---|---|
| **标签延迟** | 拒付在交易后 30–120 天才确认 | 训练集"最近的样本"标签不全，模型学不到最新模式 | 用"成熟窗口"（如 T-90 天前）训练；近期样本只用于监控 |
| **选择性标签** | 只有被拦下/被调查的交易才有确定结论 | 模型只学到"上一版模型会拦什么"，形成自我强化 | 保留随机放行样本（exploration budget）；用反事实/倾向加权校正 |
| **拒付 ≠ 欺诈** | 客户忘记、商户未发货、友好欺诈 | 标签噪声，尤其小额 | 区分"欺诈"与"争议"；对友好欺诈单独建模 |
| **退款/撤销未回填** | 授权成功后退款，标签仍为负 | 假阴性 | 事件表要区分 auth / capture / refund / chargeback 四态 |

## 6.2 数据泄漏（第二大风险）

| 泄漏类型 | 具体表现 | 检测方法 |
|---|---|---|
| **时间穿越** | 用整段时期算均值/编码后再切分 | 任何 fit 都必须只用训练期数据；用 expanding-window 验证 |
| **目标编码泄漏** | 用全量标签算类别均值 | 时序场景禁用，或改为 out-of-fold + 时间隔离 |
| **padding 泄漏** | 用 0 填充后，attention mask 写错，模型看到未来 | 单元测试：把未来 token 改成随机值，输出必须不变 |
| **序列内泄漏** | 用同一笔交易的特征去预测它自己 | 严格"历史 = 发生在被评分时刻之前且已到达系统" |
| **预处理在切分前** | 标准化/缺失填充用了全量统计 | 把预处理放进 pipeline，随 fold 重 fit |

**证据**：arXiv:2506.02703 用最小网络在错误协议下拿到 99.9% recall。你看到的"Transformer 把 AUC 刷到 0.99"很可能只是泄漏。

## 6.3 训练/服务偏斜

- 离线用批处理算的"近 24h 笔数"，线上用流式算，**定义必须逐字一致**；
- Ramp 的做法：**一份特征定义，编译两次**（Snowflake 回填 + 流式视图）；
- 上线前必做：**同一批请求，离线与线上分数比对**，容差为 0。

## 6.4 概念漂移与对抗

- 欺诈是**对抗性分布漂移**：攻击者会针对你的模型调整（测试小额、换商户、改设备指纹）；
- 监控指标：分数分布 PSI、特征覆盖率、告警量、拒付率、按商户/国家分组的捕获率；
- 结构上：预训练语料要滚动更新（否则"新商户类别"永远落在兜底 token）；下游模型周更。

## 6.5 冷启动

| 场景 | 问题 | 对策 |
|---|---|---|
| 新持卡人 | 无历史序列 | 用人口统计/企业属性/首笔商户类别做先验；序列模型输出置信度，低置信时降权 |
| 新商户 | 不在词表 | 类别兜底 token（Ramp）；或用商户名文本 embedding 兜底 |
| 新市场 | 分布完全不同 | 分市场建模或加市场 token；不要用单一全局模型硬扛 |

## 6.6 评估陷阱

| 陷阱 | 说明 |
|---|---|
| 只看 ROC-AUC | 高度不平衡下会严重高估；用 **PR-AUC / AP** |
| 只看 recall | 忽略告警容量；用**固定告警预算下的捕获率** |
| 不看金额 | 欺诈金额分布极偏；**必须报告金额加权指标** |
| 单次切分 | 用滚动多折 + bootstrap 置信区间 |
| 忽略延迟 | 一个 p99 超线的模型等于不可用 |

## 6.7 延迟与成本

Ramp 的教训可归纳为三条工程规则：

1. **不要 padding 到固定 batch**。批内 padding 会让小请求付出全 batch 的算力，尤其当输出层是 47k 维 softmax 时。
2. **不要把大表放在 GC 可达路径**。Python 的循环引用扫描会遍历模块级大对象。
3. **线上只算"必要的头"**。训练时要预测 47k 商户，线上只需要 surprisal 与 embedding——不要顺手把完整 softmax 也算一遍。

## 6.8 可解释性与合规

| 要求 | 来源 | 对模型设计的约束 |
|---|---|---|
| 拒付/拒批需给理由 | 卡组织规则、消费者保护 | 输出必须能映射到业务语言（商户/金额/国家/呈现方式 的 surprisal 正好可用） |
| 模型风险管理 | 美联储 SR 11-7 类框架（银行） | 需模型文档、独立验证、持续监控、变更管理 |
| 自动化决策解释权 | GDPR 第 22 条（欧盟） | 需"有意义的解释"，纯黑箱不满足 |
| 公平信贷 | ECOA / 反歧视 | 需检查代理变量（邮编、商户类型可能间接编码族群）；TimeSHAP 论文正是靠时间归因发现了年龄歧视 |
| 数据最小化 | PCI DSS / 隐私法 | 序列里不要放 PAN 明文；商户名要脱敏；跨机构训练考虑联邦学习 |

## 6.9 组织与流程

- **回滚能力是硬要求**：Ramp 从回滚到重新上线不到 1 天，靠的是"配置开关 + 影子流量"。
- **影子模式必须能比分数**：不只是比指标，要比"逐笔分数差异"。
- **模型卡**：记录训练窗口、语料来源、已知失效场景、监控阈值。

## 6.10 "Transformer 不是万能"的负结果清单

1. NICE Actimize：对比学习嵌入 + 工程特征 = 0.9205 < 基线 0.9245。
2. IEEE-CIS：图 Transformer 0.8536 < HGB 0.8722。
3. Grinsztajn et al.：中型表格数据上树模型仍 SOTA。
4. 单层多核 CNN 在效率与归纳偏置上优于 LSTM/Transformer（ICDMW'24）。
5. Ramp 自身：Transformer 只占 SHAP 15%，大头是损失函数。

**共同点**：当特征工程已经很强、数据量不够大、或任务本身是"表格型判别"而非"序列生成"时，Transformer 的边际收益会掉到零甚至为负。

---

# 7. 金融场景实例（8 个）

## 7.1 信用卡/借记卡授权实时反欺诈（发卡侧）

| 项 | 内容 |
|---|---|
| **序列定义** | 持卡人（跨卡）最近 32–128 笔授权，含商户/类别/国家/金额/呈现方式/是否通过 |
| **标签** | 拒付（chargeback）+ 确认欺诈；延迟 30–120 天 |
| **延迟预算** | 端到端 < 200ms，模型步 < 60ms（Ramp 实测中位 54ms） |
| **信号** | 商户、MCC、国家、金额、卡呈现方式、终端、3DS 结果 |
| **已验证增益** | 同预算欺诈金额 +32%（Ramp）；异常检测 +111%（Visa TREASURE） |
| **注意** | 金额加权损失收益可能大于模型本身；首笔欺诈是难点（Ramp 在该切片 +40%） |

## 7.2 收单侧商户欺诈与 CNP

| 项 | 内容 |
|---|---|
| **序列定义** | 卡号在**全网**的支付序列（跨商户），而非单商户视角 |
| **标签** | 争议/拒付、商户投诉、卡组织预警 |
| **延迟预算** | < 100ms |
| **信号** | 数百个网络级聚合特征 + 类别 embedding（Stripe 做法：卡国家、IP 与 IP 国家、IP 与卡一致性（对比该卡历史 top-2 IP）、近 24h 成功授权国家数、设备时钟偏移） |
| **已验证增益** | ML 效果每年 >20% 提升；仅重训每月 recall +0.5pp |
| **注意** | 网络效应是核心资产：**90% 的卡在网络中出现 >1 次**；小商户自建模型无法复制 |

**一个反直觉特征值得单独说**：设备时钟偏移（设备时间与 UTC 的差）。Stripe 明确指出这类"看起来无关"的信号来自对上千个欺诈案例的人工复盘——**特征工程的直觉仍然不可替代**。

## 7.3 账户盗用（ATO）

| 项 | 内容 |
|---|---|
| **序列定义** | 登录事件 + 设备事件 + 交易事件的**异构混合序列**（Booking.com 的 SOHET 用 17 类事件） |
| **标签** | 确认盗号、密码重置、客服工单 |
| **延迟预算** | 登录时 < 300ms |
| **信号** | 设备指纹、IP 跳变、输入节奏（行为生物特征）、改密/改绑手机、首次提现 |
| **已验证增益** | 异构事件 Transformer + 预训练 +5.8%，预训练再 +2.6%（SOHET） |
| **注意** | 必须用"事件类型专属编码器"，不能把 17 类事件塞进同一个 embedding 表 |

## 7.4 反洗钱 / 交易监测（AML）

| 项 | 内容 |
|---|---|
| **序列定义** | 账户级资金流序列 + 交易对手图 |
| **标签** | 可疑活动报告（SAR）后续确认；极度稀疏（万分之一量级） |
| **延迟预算** | 准实时（秒–分钟），可批量 |
| **信号** | 金额结构（拆分）、对手方集中度、跨行快进快出、时间规律性 |
| **已验证增益** | 序列-图联合（BRIDGE）优于单独图/单独序列；TCT 嵌入单独 AUC 0.8644 但叠加无增益 |
| **注意** | 标签极少且噪声大 → 自监督 + 弱监督是主路；可解释性是监管硬要求（要能写出可疑理由） |

## 7.5 信贷申请欺诈 / 团伙欺诈

| 项 | 内容 |
|---|---|
| **序列定义** | 申请行为序列（填表节奏、字段修改次数）+ 设备/联系人图 |
| **标签** | 首期逾期（FPD）、失联、确认伪冒 |
| **延迟预算** | 分钟级 |
| **信号** | 申请字段变更轨迹、设备复用、联系人重叠、地址聚集 |
| **已验证增益** | VecAug 的"同侪增强"：AUC +2.48%，R@P0.9 **+22.5%** |
| **注意** | 团伙欺诈的关键是"同侪对照"——不要只看个体序列，要看"和它相似的人怎么做" |

## 7.6 保险理赔欺诈

| 项 | 内容 |
|---|---|
| **序列定义** | 患者/被保人的就诊/理赔事件序列（ICD 编码序列） |
| **标签** | 调查确认欺诈 |
| **延迟预算** | 小时级（可批量） |
| **已验证增益** | 序列嵌入显著优于传统 ML（arXiv:1910.03072，Allianz 数据）；无监督 LSTM 下一就诊预测可行（arXiv:2007.10098） |
| **注意** | 事件类型离散、时间间隔长，点过程方法（THP）比纯 Transformer 更契合 |

## 7.7 企业费用管理 / B2B 卡（Ramp 特有）

| 项 | 内容 |
|---|---|
| **序列定义** | 一名员工在**一个企业内的全部卡**的最近交易 |
| **标签** | 拒付 + 企业主动上报的滥用（ misuse，如个人消费） |
| **延迟预算** | 与消费卡相同（< 200ms） |
| **特殊信号** | 部门预算、审批流、供应商白名单、差旅政策 |
| **注意** | B2B 的"合法大额"更常见，纯异常检测会误伤；必须与政策引擎结合 |

## 7.8 加密资产 / 链上

| 项 | 内容 |
|---|---|
| **序列定义** | 地址的交易序列 + 交易图 |
| **标签** | 黑名单地址关联、司法确认 |
| **已验证方法** | BERT4ETH 类（交易序列掩码预训练）、交易语言模型 + 图联合（arXiv:2409.07494、2509.03939） |
| **注意** | 地址可无限生成，冷启动极严重；图结构比序列更重要 |

---

# 8. 落地路线图

## Phase 0：基线与可行性（2–4 周）

**目标**：证明"序列信息有增量"，而不是"Transformer 有效"。

| 任务 | 产出 |
|---|---|
| 建时间正确的训练/验证切分（按时间，不随机） | 数据快照 + 切分脚本 |
| GBDT 基线 + 现有窗口特征 | PR-AUC、R@固定预算、金额召回 |
| 加"简单序列特征"（最近 1 笔的商户/金额差、最近 3 笔的国家去重） | 增量表：ΔAP、Δ金额召回 |
| 泄漏审计 | 检查清单逐项签字 |

**验收**：简单序列特征带来可测增量（哪怕 1–2% AP）。若无增量，**停止**，不要上 Transformer。

**常见失败**：直接上模型，结果无法归因；切分随机导致全线虚高。

## Phase 1：数据与特征平台（4–8 周）

| 任务 | 要点 |
|---|---|
| 事件表设计 | 区分 auth / capture / refund / chargeback / adjustment；每行带 `event_time` 与 `ingest_time` |
| Point-in-time join | "历史"定义：`event_time < t_decision` **且** `ingest_time < t_decision` |
| 流批一体 | 一份定义两种编译（Ramp 模式）：批处理回填 + 流式视图 |
| 序列样本生成器 | 给定 (subject_id, t)，返回最近 N 笔的定长数组 + mask + Δt |

**验收**：同一 (subject, t) 在离线和线上取到的序列**完全一致**（逐字段 diff 为 0）。

## Phase 2：序列编码器（4–6 周）

**顺序建议**：先 CNN（ICDMW'24 证明其效率与归纳偏置优势）→ 再 GRU → 最后 Transformer。每一步都要与上一步比。

| 组件 | 起步配置 |
|---|---|
| 层数 / 维度 | 2–3 层，d_model 128–256，4–8 头 |
| 序列长度 | 64（可扩到 128） |
| Dropout | 0.1–0.2 |
| 输出 | embedding（128 维）+ 每字段 surprisal + swap score |
| 训练 | 混合精度；单机 4 卡足够（Ramp: 4×L40S <1.5h） |

**验收**：单独用序列模型（不用任何窗口特征）的 AP 达到 GBDT 基线的 80% 以上——说明表示有效。

## Phase 3：自监督预训练（3–5 周）

| 目标 | 实现要点 |
|---|---|
| Next-event | 因果掩码；对商户/类别/国家/金额分别建头；损失按字段加权 |
| Masked fill-in | 随机遮 15% 历史步，双向注意力 |
| Swap | 一半样本替换某笔的某字段为他人片段，二分类；成本 <1% |
| 课程 | 先短序列后长序列；先高频商户后全量 |

**验收**：冻结编码器 + 线性探针，在下游欺诈任务上优于随机初始化 ≥3% AP。

## Phase 4：上线（3–4 周）

| 步骤 | 检查项 |
|---|---|
| 打包 | 计数 + 编码器 + GBDT 打成**单个 CPU 包** |
| 影子 | 双跑，比逐笔分数分布与 top-k 重叠率 |
| 小流量 | 1% → 10%，看延迟 p50/p99、告警量、拒付率 |
| 全量 | 保留一键回滚开关 |

**验收**：p99 在预算内；同预算捕获金额提升可复现；无异常告警量波动。

## Phase 5：监控与迭代（长期）

| 监控项 | 阈值示例 | 动作 |
|---|---|---|
| 分数分布 PSI | > 0.1 | 排查上游数据 |
| 特征覆盖率（商户兜底 token 占比） | > 30% | 扩充词表 / 重训 |
| 告警量 | 偏离 ±20% | 检查阈值与流量结构 |
| 捕获金额率 | 周环比下降 >5% | 触发重训评估 |
| p99 延迟 | 超预算 80% | 性能回归 |
| 分群捕获率差异 | 某商户/国家显著下降 | 定向排查攻击迁移 |

---

# 9. 参考实现骨架

> 以下为可运行的最小骨架，用于说明结构与关键细节，不含生产级工程（分布式、监控、灰度）。

## 9.1 事件表 schema

```sql
-- 一行 = 一个事件，不是一笔"交易"（退款/拒付是独立事件）
CREATE TABLE card_events (
    subject_id     STRING,   -- 人多卡：企业内员工 ID；发卡侧也可用 card_id
    event_id       STRING,
    event_time     TIMESTAMP, -- 业务发生时间
    ingest_time    TIMESTAMP, -- 系统接收时间（决定是否算"历史"）
    event_type     STRING,    -- auth / capture / refund / chargeback
    merchant_id    STRING,
    mcc            STRING,
    country        STRING,
    amount_usd     DOUBLE,
    currency       STRING,
    card_present   STRING,    -- chip / swipe / online / wallet / manual
    approved       BOOLEAN,
    is_fraud       INT,       -- 0/1，NULL = 标签未成熟
    label_mature_at TIMESTAMP
);
```

## 9.2 分层商户词表

```python
import hashlib
from collections import Counter

class MerchantVocab:
    """高频独立、中频按类别哈希、长尾按类别兜底。词表变化不需重训。"""
    def __init__(self, freq: Counter, n_head=50_000, n_bucket=4_000):
        self.head = {m: i for i, (m, _) in enumerate(freq.most_common(n_head))}
        self.n_head = n_head
        self.n_bucket = n_bucket
        self.n_cat = 512

    def _hash(self, merchant_id: str, mcc: str) -> int:
        h = int(hashlib.blake2b(f"{mcc}|{merchant_id}".encode(), digest_size=8).hexdigest(), 16)
        return self.n_head + int(mcc) % self.n_cat * self.n_bucket + h % self.n_bucket

    def cat_fallback(self, mcc: str) -> int:
        base = self.n_head + self.n_cat * self.n_bucket
        return base + int(mcc) % self.n_cat

    def __call__(self, merchant_id: str, mcc: str) -> int:
        if merchant_id in self.head:
            return self.head[merchant_id]
        if merchant_id:                      # 中频：类别内哈希
            return self._hash(merchant_id, mcc)
        return self.cat_fallback(mcc)        # 长尾/缺失：类别兜底
```

## 9.3 模型

```python
import torch, torch.nn as nn

class SeqEncoder(nn.Module):
    def __init__(self, vocab_size, n_mcc=512, n_country=256, n_present=16,
                 d=192, n_layers=3, n_heads=6, max_len=128):
        super().__init__()
        self.emb_merchant = nn.Embedding(vocab_size, d)
        self.emb_mcc      = nn.Embedding(n_mcc, d)
        self.emb_country  = nn.Embedding(n_country, d)
        self.emb_present  = nn.Embedding(n_present, d)
        self.emb_approved = nn.Embedding(2, d)
        self.amt_proj     = nn.Linear(1, d)          # log1p(amount) 后投影
        self.dt_proj      = nn.Linear(1, d)          # log1p(Δt 秒) 后投影

        layer = nn.TransformerEncoderLayer(
            d_model=d, nhead=n_heads, dim_feedforward=4*d,
            dropout=0.1, batch_first=True, norm_first=True)
        self.encoder = nn.TransformerEncoder(
            layer, num_layers=n_layers, enable_nested_tensor=False)

        self.head_merchant = nn.Linear(d, vocab_size)   # 训练时用于 next-event 损失
        self.head_amt      = nn.Linear(d, 1)
        self.head_country  = nn.Linear(d, n_country)

    def forward(self, b):
        x = (self.emb_merchant(b["merchant"]) + self.emb_mcc(b["mcc"])
             + self.emb_country(b["country"]) + self.emb_present(b["present"])
             + self.emb_approved(b["approved"])
             + self.amt_proj(b["log_amount"]) + self.dt_proj(b["log_dt"]))
        pad = b["key_padding_mask"]                       # True = padding
        causal = torch.triu(torch.ones(b["merchant"].size(1), b["merchant"].size(1),
                                       device=x.device, dtype=torch.bool), diagonal=1)
        h = self.encoder(x, mask=causal, src_key_padding_mask=pad)
        # 取"最后一步有效位置"作为序列摘要（不要用 padding 位置）
        idx = (~pad).sum(1) - 1
        summary = h[torch.arange(h.size(0), device=h.device), idx]
        return summary, h
```

## 9.4 三个训练目标

```python
def next_event_loss(model, batch, w_amt=0.3, w_country=0.1):
    summary, _ = model(batch)
    # 用第 t 步的 summary 预测第 t+1 步 —— 训练时逐位置计算，线上只算最后一步
    logits_m = model.head_merchant(summary)
    loss_m = nn.functional.cross_entropy(logits_m, batch["next_merchant"])
    loss_a = nn.functional.mse_loss(model.head_amt(summary).squeeze(-1), batch["next_log_amount"])
    loss_c = nn.functional.cross_entropy(model.head_country(summary), batch["next_country"])
    return loss_m + w_amt * loss_a + w_country * loss_c

def masked_loss(model, batch):
    """遮 15% 历史步，用完整上下文补全 —— 双向注意力版本"""
    batch = mask_steps(batch, p=0.15)
    _, h = model(batch)                      # 此路径关闭 causal mask
    return nn.functional.cross_entropy(model.head_merchant(h)[batch["masked"]],
                                       batch["merchant"][batch["masked"]])

def swap_loss(model, batch, p=0.5):
    """把某笔的某字段替换成别人的片段，判断是否原装"""
    b, labels = swap_fields(batch, p=p)      # labels: 1 = 未被替换
    _, h = model(b)
    logit = model.head_swap(h[:, -1])        # 只看被判定那一步
    return nn.functional.binary_cross_entropy_with_logits(logit.squeeze(-1), labels)
```

## 9.5 导出给 GBDT 的特征

```python
@torch.no_grad()
def export_features(model, batch, merchant_vocab):
    summary, h = model(batch)
    last = h[:, -1]
    logits_m = model.head_merchant(last)                       # [B, V]
    logp = torch.log_softmax(logits_m, dim=-1)

    feats = {"seq_embedding": summary.cpu().numpy()}           # 128 维
    # 每个字段的 surprisal = -log p(实际发生)
    for name in ["merchant", "country"]:
        idx = batch[f"next_{name}"]
        feats[f"surprisal_{name}"] = -logp.gather(1, idx[:, None]).squeeze(1).cpu().numpy()
    # 金额/时间：用预测分布的残差当 surprisal 代理
    pred_amt = model.head_amt(last).squeeze(-1)
    feats["amt_residual"] = (batch["next_log_amount"] - pred_amt).cpu().numpy()
    # swap score：单独头输出，4 个字段各一个
    feats["swap_scores"] = model.head_swap_multi(last).sigmoid().cpu().numpy()
    return feats
```

## 9.6 低延迟服务要点

```python
# 1) 不 padding：按实际长度逐条组装，或用 length-bucketing
# 2) 线上只算必要头：不要算 47k 维完整 softmax，只取实际商户那一项的 logit
# 3) 大表移出 GC 路径：模块级大 dict/list 改为 numpy 数组或 mmap
# 4) 单进程单线程推理，避免线程池上下文切换
# 5) 预热：启动时跑一次 dummy forward，避免首请求编译/分配开销
```

**性能自查顺序**（照 Ramp 的 profile 结论）：

1. 批内 padding 占比 → 是否小请求陪跑大 batch；
2. 输出层维度 → softmax 是否算满了全词表；
3. Python 对象扫描 → 是否有大 dict 在模块级；
4. 特征取数 → 是否串行多次 IO；
5. 注意力 → 通常不是瓶颈。

## 9.7 评估函数

```python
def metrics_at_budget(y_true, y_score, amount, budgets=(0.001, 0.005, 0.01, 0.02)):
    """固定告警预算下的捕获率——线上运营容量固定，这是唯一可比的指标"""
    order = np.argsort(-y_score)
    n = len(y_true)
    out = {}
    for b in budgets:
        k = max(1, int(n * b))
        idx = order[:k]
        out[f"recall@{b:.3%}"] = y_true[idx].sum() / max(1, y_true.sum())
        hit = amount[idx][y_true[idx] == 1].sum()
        out[f"dollar_recall@{b:.3%}"] = hit / max(1e-9, amount[y_true == 1].sum())
    out["ap"] = average_precision_score(y_true, y_score)
    return out
```

---

# 10. 评估与实验设计

## 10.1 离线

| 项 | 做法 |
|---|---|
| 切分 | 按时间：训练 [T-18m, T-3m)，验证 [T-3m, T-1m)，测试 [T-1m, T) |
| 指标 | AP、R@固定预算、金额召回、按金额分层召回 |
| 置信区间 | Bootstrap 1000 次，报告 95% CI |
| 消融 | (a) 仅旧模型 (b) 旧模型 + 金额加权 (c) + 序列特征 (d) 换编码器 |
| 稳健性 | 按商户/国家/新老用户分群，看是否有群体性退化 |

## 10.2 在线

| 方法 | 用途 | 注意 |
|---|---|---|
| **Shadow** | 双跑比分数 | 只比分布不够，要比逐笔一致性（Ramp: 80,149 笔逐位一致） |
| **Holdback** | 保留 1–5% 流量不拦截，观测真实欺诈率 | 有欺诈成本，需业务签字 |
| **反事实估计** | 被拦交易的真实结果不可观测，用统计方法估计 | Stripe 明确说这是生产指标的前提 |
| **Interleaved** | 两模型交替决策，消除时间混淆 | 适合低风险流量 |

## 10.3 一个必须做的实验

**"金额加权损失 vs 序列模型"的 2×2 消融**。Ramp 的数据显示，如果不做这个消融，团队会把 29% 的收益错误归因给 Transformer，然后在下一个项目里继续加模型层数——这是最常见的资源错配。

---

# 11. 成本与团队

| 项 | 小团队（< 千万笔/年） | 中型（亿级） | 大型（十亿级） |
|---|---|---|---|
| 数据工程 | 1 人 × 2 月 | 2 人 × 3 月 | 平台团队常设 |
| 建模 | 1 人 × 3 月 | 2 人 × 4 月 | 3–5 人常设 |
| 训练算力 | 1 张消费级 GPU 足够 | 4×A10/L40S | 多机多卡 |
| 推理 | CPU，单实例 | CPU 集群 | CPU 集群 + 分级缓存 |
| 年化云成本（估） | \$5k–20k | \$100k–300k | \$1M+ |
| 预期收益 | 若欺诈损失 \$1M/年，改善 10% ≈ \$100k | 显著 | 显著 |

> 成本估算为量级参考，随云厂商与架构差异很大。

**最小可行团队**：1 名懂序列建模的算法 + 1 名懂流式特征的数据工程师 + 0.5 名风控策略（定义标签与告警预算）。**缺了策略角色，模型指标会好看但业务无感。**

---

# 12. 决策树：你该不该做

```
你的欺诈损失规模？
├─ < $500k/年
│   └─ 不值得。用规则 + 现成厂商（Stripe Radar / Mastercard DI / Featurespace）
│
├─ $500k – $5M/年
│   ├─ 已有 GBDT + 窗口特征？
│   │   ├─ 是 → 走 Phase 0，先加"简单序列特征"，有增量再上编码器
│   │   └─ 否 → 先做 GBDT 基线。不要跳步
│   └─ 数据量 < 千万笔 → 用 CNN/GRU，不要 Transformer
│
└─ > $5M/年
    ├─ 有特征平台 + 流式基建？
    │   ├─ 是 → 走完整路线（Phase 0–5），预期收益 10–30% 金额捕获
    │   └─ 否 → 先建平台。序列模型会放大数据问题
    └─ 有合规解释要求？
        ├─ 是 → 必须保留 GBDT 决策层 + 标量输出（surprisal/swap）
        └─ 否 → 可探索端到端
```

**一句话判断**：如果你不能用一句话说清"序列模型比窗口特征多看到了什么"，就不要做。

---

# 13. 参考文献

## 13.1 工程实践（一手来源）

1. Temple, D., Miller, S. *Putting a Transformer Inside Every Card Authorization*. Ramp Builders Blog, 2026-10-08. https://builders.ramp.com/post/sequence-aware-card-fraud
2. Stripe. *Radar Technical Guide: A primer on machine learning for fraud detection*. 2021-12-15. https://stripe.com/radar/guide
3. Mastercard. *Risk Decisioning*（Decision Intelligence Pro：平均 +20%，125ms）. https://www.mastercard.com/us/en/business/cybersecurity-fraud-prevention/risk-decisioning.html
4. Featurespace. *ARIC Platform / Adaptive Behavioral Analytics*. https://www.featurespace.com

## 13.2 核心论文（按主题）

**序列 RNN / 综述**
- 2002.05988 — Interleaved Sequence RNNs for Fraud Detection（Feedzai, KDD'20 Industry）
- 1711.01434 — GRU-centered Sandwich-structured Model
- 1905.06247 — Multiple perspectives HMM-based feature engineering
- 2010.06479 — Credit card fraud detection using ML: A survey

**表格 / 交易 Transformer**
- 2011.01843 — Tabular Transformers (TabFormer)，IBM，ICASSP'21

**大规模自监督预训练**
- 2312.14406 — Generative Pretraining at Scale（腾讯 / 微信支付）
- 2401.01641 — Towards a Foundation Purchasing Model（Featurespace, ICAIF'23）
- 2511.19693 — TREASURE: The Visa Payment Foundation Model

**时间感知 / 异构事件 Transformer**
- 2509.23712 — FraudTransformer: Time-Aware GPT
- 2606.21356 — SOHET（Booking.com）
- 2605.21490 — Temporal Contrastive Transformer（NICE Actimize，负结果）
- 2606.25007 — Multi-Stream Temporal Fusion

**点过程 / 连续时间**
- 2002.09291 — Transformer Hawkes Process
- 2302.06247 — COTIC: Continuous-time convolutions
- 2412.19634 — S2P2: Continuous-Time State-Space Models
- 2401.03246 — SeqNAS

**序列 + 图**
- 2510.25126 — BRIDGE: End-to-End Sequence-Graph Learning（Capital One）
- 2307.05121 — STA-GT
- 2609.07100 — THGT-FD（负结果）
- 2408.00513 — VecAug

**架构源头（推荐系统）**
- 1808.09781 — SASRec
- 1904.06690 — BERT4Rec
- 1706.06978 — DIN
- 1905.06874 — BST
- 2006.05639 — SIM

**可解释性**
- 2012.00073 — TimeSHAP
- 2101.04285 — FinDeepBehaviorCluster（AAAI'21 KDF）

**方法论批判**
- 2506.02703 — Data Leakage and Deceptive Performance
- 2207.08815 — Why do tree-based models still outperform deep learning on tabular data?
- 2411.19457 — Multi-task CNN Behavioral Embedding（ICDMW'24）

**其他场景**
- 1910.03072 — Sequence embeddings for healthcare insurance fraud
- 2007.10098 — Unsupervised anomaly detection for discrete sequence healthcare data
- 2409.07494 / 2509.03939 — 链上交易语言模型 + 图

---

# 附录 A：Ramp 关键数字速查

| 项 | 数值 |
|---|---|
| 模型层数 | 3 层注意力 |
| 商户词表 | 约 47,000 token（含约 200 万商户哈希） |
| 权重集中度 | >80% 在商户 embedding + 下一商户预测层 |
| 预训练数据 | 2 年交易，无欺诈标签 |
| 预训练成本 | <1.5 小时 / 4×L40S |
| XGBoost 训练 | 1 小时特征 + 3 小时训练（Ray），负样本不采样 |
| 欺诈金额提升 | +32%（同告警预算） |
| AP 提升 | +12%（vs 同损失 XGBoost）/ +14%（vs 旧模型） |
| ≥\$1,000 段 | +34% |
| 首笔欺诈 | +40%（vs 旧模型）/ +9%（vs 同损失，半预算） |
| SHAP 占比 | 15%（embedding 8 + surprisal 5 + swap 2） |
| 延迟（修复后） | 中位 54ms / p99 84ms |
| 分数一致性验证 | 80,149 笔逐位一致 |

# 附录 B：术语表

| 术语 | 含义 |
|---|---|
| **Surprisal** | −log p(实际发生的事件)，衡量"以历史看这有多反常" |
| **Swap score** | 模型判断"这笔交易的某个字段是否来自别人"的概率 |
| **AP / PR-AUC** | 平均精度，不平衡数据下的排序质量指标 |
| **Fixed flag budget** | 固定告警数量下比较捕获率，模拟真实运营容量 |
| **Point-in-time correctness** | 特征只能使用决策时刻之前且已到达系统的数据 |
| **Selective labels** | 只有被干预（拦截/调查）的样本才有标签，导致反馈回路偏差 |
| **Concept drift** | 数据分布随时间变化，欺诈场景中由用户习惯与攻击者适应共同驱动 |
| **Interleaved sequence** | 多主体序列交错训练，每个主体的历史是不定长子序列 |
| **Token explosion** | 高基数类别（商户/设备）导致词表爆炸，需哈希或分层兜底 |
