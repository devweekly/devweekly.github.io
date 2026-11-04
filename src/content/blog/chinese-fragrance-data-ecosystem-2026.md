---
author: SW
pubDatetime: 2026-11-04T08:00:00Z
title: "香水数据从哪里来？从中文香调知识到分子气味科学与 AI 推荐"
featured: false
draft: false
tags:
  - AI
  - Data Engineering
  - Knowledge Graph
  - Fragrance
  - Olfactory Science
  - Recommendation Systems
  - Dataset
description: "梳理国内外香水产品库、中文气味科学数据、分子气味数据与商业数据集，分析授权、数据质量和语义差异，并给出构建香水 AI 知识库与推荐系统的数据架构。"
---

# 香水数据从哪里来？从中文香调知识到分子气味科学与 AI 推荐

**研究与链接核对日期：2026 年 11 月 4 日**

## 1. 问题不只是找一份香水 CSV

如果要做一个香水搜索或推荐系统，最先想到的通常是找一份包含品牌、香水名称、前调、中调、后调和价格的数据集。这些字段确实构成了产品目录，但它们并不能完整表达一款香水闻起来是什么感觉。

消费者描述气味时，可能会说“雨后森林”“晒过太阳的棉被”“旧书纸张”“干净的皂感”“奶油和木头混合的味道”。香水数据库则通常使用 Woody、Floral、Powdery、Aquatic、Gourmand 等标准化词汇。调香原料数据库记录的是具体物质、化学结构和气味描述；嗅觉科学研究还会涉及分子与嗅觉受体之间的响应。

这些信息处于不同层次，不能直接拼成一个字段：

- **香水产品数据**描述市场上有哪些产品，以及公开资料如何描述它们。
- **香调与 Accord 数据**描述人们如何归纳和表达气味。
- **原料与分子数据**描述可能参与气味形成的物质及其化学属性。
- **感官与嗅觉实验数据**描述人在实验条件下如何感知气味，或分子与嗅觉受体的响应。
- **用户评论与投票**描述消费者在特定语境下的主观体验。

本文关注的重点是：现有公开数据能支持什么，国内有哪些资源，商业数据如何采购，以及如何把这些数据组合成一个可持续维护的香水知识系统。

先给出一个实际判断：**国内已经有值得使用的气味科学和分子气味资源，但公开可获得的中国香水产品数据库、中文消费者评论库和标准化中文嗅觉语义体系仍然相对分散。** 不能把科研气味数据库当成香水产品目录，也不能把海外社区的香调分类直接当成完整的中文嗅觉词典。

## 2. 先区分四种容易混淆的数据

### 2.1 香水产品的公开香调不是配方

一款香水的产品页可能标注玫瑰、茉莉、檀香、香草和麝香。这些信息通常是品牌或社区对气味结构的描述，不代表公开了实际配方，更不代表每个 Note 都对应一种直接加入的原料。

例如，产品资料中的 Rose 可能表达玫瑰气息，也可能由多种天然或合成材料共同构建。一个 Rose Accord 是气味效果或组合印象，不等于某个单一化学分子。

因此，数据模型至少应区分：

| 概念 | 含义 | 示例 |
|---|---|---|
| Note | 香水资料中用于描述气味的主题或原料印象 | Rose、Sandalwood |
| Accord | 多种气味材料形成的整体嗅觉印象 | Floral、Amber、Chypre |
| Ingredient | 配方或原料体系中的具体材料 | Rose oil、Vanillin |
| Molecule | 具有化学结构定义的物质 | Linalool、Limonene |
| Olfactory descriptor | 对气味感知的描述词 | Powdery、Green、Earthy |

同一个词在不同数据库中的含义也可能不同。比如 Vanilla 可以作为 Note，也可以出现在气味描述中；Vanillin 则是一个具体化学物质。数据整合时不能只靠字符串相同就建立实体等同关系。

### 2.2 前调、中调、后调是产品表达模型

Top / Heart / Base Notes 是香水行业常见的表达方式，用来说明香气随时间展开时的主要印象。它不是一份经过实验验证的完整挥发曲线，也不意味着每种香料只会出现在一个阶段。

产品数据可以保存这种金字塔结构，但要保留来源和证据类型，例如品牌官方描述、零售商描述、社区整理或用户推断。不同来源发生冲突时，不应该把它们覆盖成一个看似确定的事实。

### 2.3 气味标签不是化学性质

Woody、Fresh、Sweet、Animalic 等词属于感官描述或分类标签。它们不是分子本身的化学属性，也不是可以直接从分子结构无误推导出来的确定答案。

机器学习模型可以根据分子结构预测某些气味标签，但预测结果是模型输出，需要记录训练数据、标签体系、置信度和适用范围。

### 2.4 用户评价不是客观测量

“留香很久”“扩散很强”“闻起来很甜”都可能受到使用量、皮肤、气候、嗅觉适应、产品批次和个人偏好的影响。用户评价适合做偏好建模和体验分析，不应直接作为实验测量数据。

## 3. 国际香水产品数据库

### 3.1 FragDB：规模较大的多语言产品数据集

项目地址：[FragDB – Fragrance Database](https://github.com/FragDB/fragrance-database)  
数据说明：[FragDB Data Dictionary](https://github.com/FragDB/fragrance-database/blob/main/DATA_DICTIONARY.md)  
商业数据页面：[fragdb.net](https://www.fragdb.net/)  
Hugging Face 样例：[FragDB multilingual sample](https://huggingface.co/datasets/FragDBnet/fragrance-database)

FragDB 是目前值得优先评估的结构化香水产品数据集之一。其 2026-11-01 的 v5.20 快照披露了以下规模：

| 数据类型 | 记录数 |
|---|---:|
| 香水 | 143,855 |
| 品牌 | 8,501 |
| 调香师 | 3,198 |
| Notes | 2,626 |
| Accords | 92 |
| 用户评论 | 5,026,322 |
| 编辑文章 | 25,981 |
| 社区新闻评论 | 280,874 |

数据按多个 CSV 和 Parquet 文件组织，包含产品、品牌、调香师、香调、Accord 和翻译词汇。项目说明支持 23 种语言，包括中文和日文，产品记录之间通过 ID 关联。

它的主要价值不是单纯的产品数量，而是关系结构和多语言字段：香水可以关联品牌、调香师、Note 和 Accord，词汇也可以映射到多种语言。对跨语言检索和构建产品目录来说，这比一个只有产品名称和描述的 CSV 更有用。

不过，使用前要认真核对授权。FragDB 的更新记录曾明确修正过授权展示，指出完整数据实际采用 CC BY-NC 4.0，而不是此前页面显示的 MIT。免费样例、代码、完整数据和 API 的授权条件不能混为一谈。**CC BY-NC 4.0 不适合未经额外许可的商业产品使用。** 采购完整数据时还要确认评论、图片和上游来源是否有独立限制。

数据规模和版本数字来自项目自己的变更记录，属于数据发布方披露，不等于第三方独立审计结果。

### 3.2 ParfumDB：另一个商业数据方向

[ParfumDB](https://www.parfumdb.net/) 提供基于 Parfumo 产品资料整理的香水数据。公开产品介绍涵盖香水、品牌、调香师、Notes、Accords、评分、留香、扩散性、季节、场合和用户内容。

这类数据适合用于产品目录、相似香水检索和用户偏好分析。采购前应要求供应商提供数据字典、样本、更新频率、字段覆盖率、来源说明和授权合同。特别需要确认能否用于商业推荐、模型训练、缓存、衍生数据以及向最终用户展示评论。

不要仅凭网站公布的记录总数判断采购价值。对于推荐系统，评论是否有文本、语言分布如何、产品 ID 是否稳定、重复产品如何处理，往往比总记录数更重要。

### 3.3 Scento：适合快速验证数据模型的小型开放数据

项目地址：[Scento Perfume Dataset](https://github.com/Scento-com/perfume-dataset)  
Hugging Face：[Scento perfume database](https://huggingface.co/datasets/scento/perfume-database)

Scento 的公开数据规模比大型商业库小，适合用于 PoC 和数据模型验证。项目提供香水、品牌和材料相关数据，字段涉及前中后调、香调家族、次级香调、季节、使用时间、材料分类和气味描述。

它的优势是结构较容易理解，可以用来验证 Perfume、Brand、Note、Material 和 Accord 之间的关系。公开页面标注 CC BY 4.0，但实际使用仍应以仓库当前 LICENSE 和数据来源说明为准，保留署名和来源信息。

### 3.4 doevent/perfume：规模较大的公开样例，但不是中国本土数据库

[Hugging Face – doevent/perfume](https://huggingface.co/datasets/doevent/perfume)

这个数据集的说明称其包含 26,000 多款香水，数据字段包括品牌、产品名、香调家族、子家族、香气描述、成分列表、产地、性别定位、年份和图片信息，并提供 SQLite、JSON、CSV 等格式。

需要澄清：它托管在 Hugging Face，不意味着它是中国机构建设的中文香水数据库。数据卡将其标记为英文数据，创建日期为 2024-05-01，页面声明 MIT。MIT 声明也不能自动解决原始图片、产品描述和上游抓取数据的权利问题。商业使用前仍需检查数据来源和具体文件的权利状态。

## 4. 中国有哪些值得关注的数据资源？

国内公开资源的特点是科研数据比商品目录更有特色。它们可以补足气味分子、感官标签和嗅觉机理，却不能直接替代香水产品数据库。

### 4.1 CSLOdorDB / Atomevo-Odor：中国气味分子与嗅觉受体数据

数据库入口：[CSLOdorDB](http://cslodordatabase.7fx.cn/)  
国家基因组科学数据中心 Database Commons：[CSLOdorDB 数据库档案](https://ngdc.cncb.ac.cn/databasecommons/database/id/9908)  
论文：[Atomevo-odor: A database for understanding olfactory receptor-odorant pairs with multi-artificial intelligence methods](https://pubmed.ncbi.nlm.nih.gov/39977983/)

CSLOdorDB 是国内科研团队建设的气味数据库。Database Commons 的数据库档案将其归属地标记为中国、机构标记为佛山大学，数据集于 2025 年建立。论文发表于 2025 年的 Food Chemistry。

数据库档案介绍的内容包括：

- 超过 2,500 种挥发性化合物的化学结构和理化属性；
- 标准化气味描述；
- 气味分子与嗅觉受体（Olfactory Receptors）的关系；
- 气味相似性检索和可视化；
- SDF 化学结构文件及标准化描述符矩阵下载；
- 基于实验数据和 AI 方法的受体响应预测。

它的价值在于把“某种气味描述”向下连接到“可能产生这种感知的分子”以及“嗅觉受体如何响应”。这对气味科学、分子特征分析和原料知识库有帮助。

但不能把受体响应预测解释为“模型已经知道人闻到的完整香味”。嗅觉感知还涉及多种受体的组合响应、浓度、混合物相互作用、个体差异和实验条件。它也不是香水产品库，不提供某款商业香水的真实配方。

### 4.2 南开大学 OdorNet：标准化分子气味标签

项目地址：[NKU-DOIE/OdorNet](https://github.com/NKU-DOIE/OdorNet)  
数据归档与来源：[Zenodo](https://zenodo.org/records/19838455)

OdorNet 由南开大学电子信息与光学工程学院数字嗅觉与智能装备实验室维护，目标是把不同来源的分子气味描述整理为统一的层级标签体系。

其 GitHub 公开的机器学习数据版本包含 8,892 条分子记录，每条记录包括 SMILES 和 12 个一级气味类别标签：

| 一级分类 | 含义 |
|---|---|
| Animalic & Ambery | 动物香与琥珀 |
| Sweet & Gourmand | 甜香与美食调 |
| Floral | 花香 |
| Fruity & Vegetable | 果香与蔬菜气味 |
| Pungent & Disagreeable | 刺激性或令人不悦的气味 |
| Green & Herbal | 青绿与草本 |
| Nutty | 坚果 |
| Woody & Mossy | 木质与苔藓 |
| Resinous & Balsamic | 树脂与香脂 |
| Cooked | 熟食气味 |
| Odorless | 无气味 |
| Spice | 辛香 |

项目使用 SEA 方法组织异构标签：统计共现（Statistical co-occurrence）、专家校正（Expert correction）和 AI 辅助语义对齐（AI-assisted semantic alignment）。

公开数据按 7:2:1 划分为训练、验证和测试集，分别为 6,224、1,778 和 890 条。项目文档特别提醒：某条记录的 12 个标签全部为 0，不一定代表分子无气味，也可能是原始描述无法映射到当前标签空间。因此不能把缺失或无法归类的数据直接当作“无气味”的负样本。

仓库将代码和文档采用 MIT License，处理后的数据采用 CC BY 4.0；Zenodo 归档中的原始来源数据还应按其来源说明引用。使用时应保留数据集版本、来源和标签缺失策略。

OdorNet 适合做分子气味多标签分类、标签体系研究和分子检索，但它的 12 个一级类别并不是完整的香水行业香调体系。它也不包含大规模商业香水产品、调香师资料或消费者评论。

### 4.3 上海交通大学食品风味研究资源

入口：[上海交通大学食品风味创新团队数据库](https://mffi.sjtu.edu.cn/database)

食品风味与香水不是同一个行业，但在挥发性化合物、气味描述、感官评价和化学分析上有交叉。食品风味数据可以作为香料原料和气味语义知识的补充来源。

评估这类资源时，重点检查字段是否包含中文和英文名称、CAS Number、化学分类、气味或滋味描述、感官特性和文献来源。不同数据表可能面向不同食品研究任务，不应假定所有记录都可以直接用于香水推荐。

它的作用更接近原料与感官知识补充，而不是香水产品目录。若需要商业使用，应以数据库具体页面的授权和团队许可为准。

### 4.4 CosmeticsKG：中国科学院大学的化妆品知识图谱项目

项目地址：[5KG-UCAS/CosmeticsKG](https://github.com/5KG-UCAS/CosmeticsKG)

CosmeticsKG 是中国科学院大学 2019 年秋季学期自然语言处理课程项目。仓库介绍称，项目包含约 3,000 个节点和 15,000 条关系，覆盖口红和香水两个品类，支持图谱检索、可视化和问答。

项目的数据来源说明涉及化妆品官网、美妆 App 和电商网站；知识图谱实体包括品牌、国家、香水产品、口红系列、价格区间、评论等。它展示了如何把产品目录、品牌和评论组织成可查询的图结构。

它更适合作为领域知识图谱的教学和原型参考，不宜当作当前中国香水市场的完整数据库。项目年代较早，仓库说明也提到在线 Demo 已失效。原始数据采集方式涉及第三方 App 和电商平台，今天重新采集时必须遵守平台条款、个人信息保护要求和数据授权边界。

### 4.5 国内资源的能力边界

| 资源 | 产品目录 | 分子结构 | 气味标签 | 嗅觉受体 | 用户评价 | 主要用途 |
|---|---|---|---|---|---|---|
| CSLOdorDB | 否 | 是 | 是 | 是 | 否 | 分子与嗅觉科学 |
| OdorNet | 否 | 是（SMILES） | 是 | 非核心字段 | 否 | 分子气味分类 |
| 上交大食品风味资源 | 否 | 视具体数据表 | 是 | 非核心字段 | 感官研究数据视具体项目 | 食品风味与原料研究 |
| CosmeticsKG | 是，规模有限 | 否 | 有限 | 否 | 有限 | 产品知识图谱原型 |
| doevent/perfume | 是 | 部分字段为成分列表 | 是 | 否 | 未明确 | 产品目录样例 |
| FragDB | 是 | 不是完整配方库 | 是 | 否 | 是 | 多语言产品与社区数据 |

这张表反映的是各项目公开说明中的主要数据方向，不代表每个字段都有完整覆盖，也不代表所有数据都能自由下载或商业使用。

## 5. 数据采购不能只看记录数量

如果准备采购商业数据，建议先拿到一份样本和完整数据字典，再讨论价格。以下问题应写进采购评估：

| 评估项 | 需要供应商回答的问题 |
|---|---|
| 数据来源 | 来自品牌官网、零售商、社区、第三方数据库还是抓取？ |
| 覆盖范围 | 国际品牌、独立品牌、中国品牌和小众品牌分别覆盖多少？ |
| 产品粒度 | 同一香水的 EDT、EDP、Parfum、不同容量是否分别建档？ |
| 标识符 | 是否有稳定的产品 ID、品牌 ID、调香师 ID？ |
| 香调质量 | 前中后调是品牌资料、社区投票还是编辑推断？ |
| 中文字段 | 是人工翻译、机器翻译还是行业术语校订？ |
| 评论数据 | 是否包含原文、语言、时间、评分、用户标识和来源链接？ |
| 更新机制 | 增量更新频率如何？产品改名、停产和品牌合并如何处理？ |
| 权利边界 | 是否允许商业展示、缓存、模型训练、衍生数据和再分发？ |
| 可审计性 | 是否有来源字段、采集时间、版本号、删除记录和数据血缘？ |

对于商业产品，数据许可是架构约束，不是上线前补一份法律说明就能解决的问题。尤其是评论、图片和第三方社区内容，数据库供应商拥有数据副本不一定意味着它可以把所有上游内容再许可给客户。

还要避免将“可下载”误认为“可商业使用”，将“代码 MIT”误认为“数据 MIT”。代码、结构化数据、图片、评论和原始来源可能有不同的授权。

## 6. 构建中文嗅觉语义体系，比简单翻译香调更有价值

国际香水数据中的分类词汇通常围绕行业惯用表达。中文消费者的描述则经常是生活经验和联想，例如：

- 雨后泥土、潮湿森林、苔藓；
- 洗净衣物、肥皂、晒过太阳的棉被；
- 旧书、纸张、铅笔、木质家具；
- 奶油、牛奶、香草甜点；
- 金属、烟熏、灰烬、皮革；
- 清凉、刺鼻、药感、消毒水。

这些表达不能都直接归到一个传统香调分类中。“像旧书”可能同时涉及纸张、木质、粉感、干燥和微弱的烟熏联想；“干净的味道”也可能指皂感、白麝香、柑橘或清新花香。

### 6.1 不要把中文词汇做成一对一翻译表

建议建立多层语义模型：

| 层次 | 示例 | 作用 |
|---|---|---|
| 原始表达 | 雨后森林、晒过太阳的棉被 | 保存用户原话 |
| 感官维度 | 湿润、干燥、清凉、甜、粉 | 描述感知属性 |
| 标准气味描述 | Earthy、Mossy、Green、Powdery | 连接国际词汇 |
| 香调分类 | Woody、Fresh、Floral | 产品级分类 |
| 原料关联 | Geosmin、Moss materials、Musk materials | 关联原料知识 |
| 分子关联 | 具体分子及其结构 | 连接化学数据 |

其中，原始表达必须保留。标准化不是把用户的话改写成几个英文标签，而是建立可追溯的映射关系，并允许一个表达关联多个概念。

### 6.2 给每个映射增加证据和置信度

例如“雨后泥土”可以关联 Earthy、Wet Soil 和 Petrichor 等描述，但不能据此断定某款香水含有 Geosmin。Geosmin 是一种具有典型土腥气味的分子，它可以作为知识解释中的候选关联，却不能仅凭消费者描述推断产品配方。

建议映射记录包含：

- 原始中文词汇和语言；
- 规范化概念及其版本；
- 关联关系类型（同义、近义、上位、下位、联想或候选原料）；
- 证据来源；
- 人工审核状态；
- 置信度和适用语境。

这样才能区分“语义相似”和“化学成分相同”。

## 7. 推荐的数据架构：关系模型为主，语义检索为辅

不建议一开始就把所有数据切块后放进向量数据库。香水产品、品牌、调香师、Note、分子和评论之间存在大量明确关系，关系型数据和知识图谱更适合保存事实、标识符和来源。

可以采用以下分层结构：

~~~mermaid
flowchart TD
    A["产品数据<br/>品牌、香水、调香师、版本"] --> G["统一香水知识层"]
    B["香调词典<br/>Note、Accord、中文语义"] --> G
    C["原料数据<br/>Ingredient、CAS、来源"] --> G
    D["分子数据<br/>SMILES、结构、理化属性"] --> G
    E["嗅觉科学<br/>气味标签、受体、实验"] --> G
    F["消费者数据<br/>评论、评分、投票"] --> G
    G --> H["关系查询与过滤"]
    G --> I["全文检索与同义词检索"]
    G --> J["语义 Embedding 检索"]
    H --> K["相似香水推荐"]
    I --> K
    J --> K
    H --> L["产品解释与知识问答"]
    I --> L
    J --> L
    K --> M["个性化推荐与反馈"]
    L --> M
~~~

### 7.1 核心实体与关系

| 实体 | 主要属性 |
|---|---|
| Perfume | 产品名、品牌、浓度、年份、市场、状态 |
| Brand | 品牌名称、国家或地区、官网、母公司 |
| Perfumer | 调香师、履历、关联作品 |
| Note | 标准名称、语言、分类、来源 |
| Accord | 香气组合、分类、定义 |
| Ingredient | 原料名称、别名、CAS、来源 |
| Molecule | SMILES、分子式、结构和理化属性 |
| OlfactoryDescriptor | 气味描述、语言、语义关系 |
| SensoryObservation | 实验条件、感官结果、样本和方法 |
| Review | 评论原文、语言、评分、时间、来源 |

Perfume 与 Note 之间还应保留 Top、Heart、Base 等角色；Perfume 与 Accord 之间应保存来源和权重（如果来源提供）；Ingredient 与 Molecule 之间应根据具体数据定义关系，不能假定一个原料只对应一个分子。

### 7.2 数据存储选择

第一阶段可以使用 PostgreSQL 保存规范化实体、关系、来源、版本和审核状态。评论全文可以使用 PostgreSQL Full Text Search 或独立搜索引擎。需要语义召回时，再为中文原始描述、规范化气味描述和评论生成 Embedding。

向量检索只解决语义相似候选召回，不应成为事实存储。用户问“某款香水的后调是什么”，应查询有来源的产品字段；用户问“有没有像雨后森林的香水”，才适合把语义检索与产品属性过滤结合起来。

对于需要多跳关系探索的场景，例如“找出具有某类气味印象、关联某些原料知识、且用户评价中经常出现某些描述的香水”，可以在关系模型上实现，也可以在数据复杂度和查询需求足够明确后引入图数据库。没有必要一开始就部署多个数据库。

## 8. 一个可落地的 AI 香水搜索流程

假设用户输入：

> 想找一款雨后森林的味道，带一点湿润泥土、苔藓和木头，不要太甜。

系统不应该只把整句话转换成一个向量，然后直接取 Top-K 产品。更稳妥的流程是先识别约束，再进行混合检索：

~~~mermaid
flowchart TD
    A["用户自然语言描述"] --> B["提取偏好与排除条件"]
    B --> C["中文嗅觉语义映射"]
    C --> D["生成标准概念集合"]
    D --> E["关键词与同义词召回"]
    D --> F["语义向量召回"]
    E --> G["候选香水合并"]
    F --> G
    G --> H["结构化过滤<br/>甜度、品牌、浓度、价格等"]
    H --> I["依据来源与评价重新排序"]
    I --> J["生成推荐理由与证据"]
~~~

检索系统可以把请求转换为如下概念：

| 用户表达 | 规范化候选概念 | 约束类型 |
|---|---|---|
| 雨后森林 | Petrichor、Earthy、Mossy、Green | 正向偏好 |
| 湿润泥土 | Wet Soil、Earthy | 正向偏好 |
| 苔藓 | Mossy、Woody | 正向偏好 |
| 木头 | Woody、Cedar、Sandalwood 等候选 | 正向偏好 |
| 不要太甜 | Sweet、Gourmand 权重降低 | 排除或降权 |

这里的映射是检索假设，不是对香水配方的判断。推荐结果应展示产品资料来源、匹配的公开香调、用户评论中的相关描述，以及数据缺失或来源冲突。系统不能把模型生成的解释包装成品牌公开声明。

## 9. 数据治理和质量检查

香水数据看起来是消费品目录，但在合并多个来源时也会遇到典型主数据问题。

### 9.1 产品身份和版本

同一款香水可能有 EDT、EDP、Parfum、不同容量、不同年份版本和地区版本。产品名称相同不代表它们是同一条记录。建议至少保留品牌、产品名、浓度、版本、容量、市场、来源 ID 和规范化产品 ID。

### 9.2 同名异物与多语言别名

不同品牌可能使用相同产品名；同一品牌也可能改名或重新发布产品。中文译名可能有多个版本，音译、意译和市场常用名也不一致。名称匹配应结合品牌、浓度、年份和来源链接，而不是只依赖字符串相似度。

### 9.3 字段来源与置信度

每一个关键字段都应能够回答：谁提供的、何时采集、是否人工校验、是否被其他来源冲突、最后一次更新是什么时候。

可以把字段来源建模为独立记录，而不是只在产品表放一个 source_url。不同来源对同一款香水的香调描述可能不一致，保留多条声明比强行合并更可靠。

### 9.4 评论清洗和偏差

评论可能包含重复文本、广告、机器翻译、极端情绪和产品批次差异。评论数据应保留原文、语言、来源、时间和评分，同时把情感分析、气味主题抽取结果作为派生数据保存。模型抽取结果不能覆盖原文。

### 9.5 数据许可与删除机制

来源许可应与数据记录绑定。若上游要求删除或限制再分发，系统需要知道哪些产品、评论、图片和衍生记录受影响。商业系统还需要处理用户个人信息、平台条款和数据主体请求，不能因为数据是公开页面就默认可以无限制抓取和训练。

## 10. 推荐的实施顺序

如果目标是先验证一个可用的香水 AI 搜索和推荐系统，不需要第一天就采购最大的数据库或训练分子模型。

| 阶段 | 数据与工作 | 交付结果 |
|---|---|---|
| 1. 产品 PoC | 使用许可明确的小型产品数据集，建立 Perfume、Brand、Note、Accord 模型 | 可检索的香水目录 |
| 2. 中文语义 | 建立中文嗅觉词汇、同义词、近义词和多对多映射 | 中文自然语言搜索 |
| 3. 用户反馈 | 接入有授权的评论和偏好反馈 | 偏好画像与排序 |
| 4. 科学知识 | 接入 CSLOdorDB、OdorNet 和风味数据 | 原料与分子解释能力 |
| 5. 商业数据 | 评估 FragDB、ParfumDB 或其他供应商的授权与覆盖率 | 扩展产品规模 |
| 6. 评估优化 | 建立人工标注查询集，测量召回率、排序质量和解释正确性 | 可量化的推荐质量 |

第一阶段的验收不应该是“收录了多少款香水”，而应当包括：产品身份是否准确、前中后调来源是否可追溯、中文同义表达能否召回合理结果、错误推荐是否可解释，以及数据授权是否满足实际用途。

## 11. 结论：产品数据库与气味科学数据库需要连接，但不能混成一张表

国际市场已有规模较大的香水产品数据库和社区内容数据。国内则有 CSLOdorDB、南开大学 OdorNet 等值得关注的分子气味科学资源，也有 CosmeticsKG 这样的早期产品知识图谱原型，以及食品风味研究数据。

这些资源解决的问题不同：

- 产品数据库回答“市场上有什么香水，公开资料如何描述它”；
- 气味本体回答“人们用什么词表达气味，这些词之间是什么关系”；
- 原料和分子数据库回答“哪些物质与哪些气味描述相关”；
- 嗅觉科学回答“分子、受体和感官实验之间有哪些可研究的关系”；
- 用户评论回答“消费者在具体使用条件下如何描述体验”。

如果要做中文香水 AI，真正的基础工作不是简单翻译一份 Fragrantica 数据，而是建立一套可追溯的中文嗅觉语义体系，把用户的生活化表达连接到标准气味描述、产品香调和科学数据，同时保留它们之间的不确定性。

这套系统可以使用关系数据库保存事实和来源，使用全文与向量检索处理自然语言表达，再根据业务复杂度决定是否需要知识图谱或分子模型。向量相似不等于气味相同，产品香调不等于真实配方，模型预测也不等于感官实验结果。这三条边界决定了系统能否给出可信的推荐和解释。

## 12. 从香型检索到个性化推荐：系统应该怎样设计？

前面的数据模型解决了“如何描述一款香水”，推荐系统还要回答另一个问题：给定一个用户、一段自然语言描述和一组约束，如何从目录中找到合适的候选，并按用户真正关心的因素排序？

这不是一个单一算法问题。一个可维护的系统至少要拆开四件事：**理解用户意图、召回候选、过滤硬约束、对候选排序**。把它们放在一个 LLM Prompt 或一个向量查询里，会让结果难以评估，也很难解释为什么某款香水排在前面。

### 12.1 推荐系统的参考架构

下图把事实存储、查询理解、混合召回和排序拆开。关系数据库仍然是产品事实的来源；全文和向量索引只是检索投影，可以从规范数据重建。

<iframe src="/diagrams/fragrance-recommender-architecture.html" title="香水推荐系统参考架构" loading="lazy" width="100%" height="660" style="border:0;max-width:100%;"></iframe>

主要组件的职责如下：

| 组件 | 职责 | 不应该承担的职责 |
|---|---|---|
| Query Understanding | 解析气味偏好、否定、预算、场景、浓度 | 编造产品事实 |
| Ontology Resolver | 将中文表达映射为标准概念及关系 | 把近义词当成严格同义词 |
| Candidate Retrieval | 从 SQL、全文和向量索引召回候选 | 决定最终排序 |
| Constraint Filter | 执行预算、市场可购买性、浓度等硬约束 | 把模糊偏好一律当硬过滤 |
| Ranker | 组合气味匹配、个人偏好、证据质量和多样性 | 用一个不可解释的总分掩盖数据缺失 |
| Explanation | 说明命中的公开属性和来源 | 将推断写成配方事实 |
| Feedback | 记录曝光、点击、收藏、试香、购买和明确不喜欢 | 把一次点击直接视为喜欢 |

### 12.2 推荐请求的处理顺序

<iframe src="/diagrams/fragrance-recommendation-flow.html" title="香水推荐请求处理流程" loading="lazy" width="100%" height="700" style="border:0;max-width:100%;"></iframe>

推荐流程分为两个核心阶段。

**Recall（召回）**的目标是尽可能找全可能相关的候选。可以并行执行：

1. 结构化过滤：价格、浓度、品牌、市场、产品状态等；
2. 词汇检索：中文别名、英文标准词、Note、Accord 和评论关键词；
3. 全文相关性：对评论和描述执行 BM25 等文本检索；
4. 向量检索：对“像雨后森林”“晒过太阳的棉被”等自然语言描述进行语义召回；
5. 相似产品召回：从用户收藏或明确喜欢的产品出发，寻找属性邻居。

多路结果按 canonical perfume ID 合并，保留每条候选来自哪条召回通道、原始排名和分数。召回阶段不宜过早使用复杂权重，否则某一条通道的分数尺度可能压制其他通道。

**Rank（排序）**负责对合并后的候选重新打分。预算上限、不可接受的浓度、配送地区和明确排除项属于硬约束；“不太甜”“更偏木质”一般属于软偏好，适合降权而不是一刀切。除非用户明确表达绝对禁忌，否则不要把模糊的自然语言自动转成硬过滤。

### 12.3 用户偏好应该是结构化、可更新的状态

推荐请求不应该只有一个 query 字符串。建议把一次请求解析成一个临时 Preference，同时维护用户长期偏好档案：

```json
{
  "include": [
    {"concept": "earthy", "weight": 1.0},
    {"concept": "mossy", "weight": 0.9},
    {"concept": "woody", "weight": 0.7}
  ],
  "exclude": [
    {"concept": "gourmand", "weight": 0.8}
  ],
  "constraints": {
    "max_price": 800,
    "concentration": ["EDP", "EDT"],
    "available_market": ["CN"]
  },
  "context": {
    "occasion": ["daily"],
    "season": ["autumn"]
  }
}
```

需要区分三个来源：用户明确告诉系统的偏好、从用户行为推断的偏好、模型从文本中抽取的临时意图。三者的可信度不同。用户明确说“不喜欢甜香”应高于一次浏览记录；模型抽取的“可能喜欢木质”只能作为低置信度候选。

偏好档案还应有时间衰减和用户可编辑能力。用户对某个场景的偏好不一定适用于所有场景；购买记录也不一定代表长期喜欢，可能只是送礼或一次性需求。

### 12.4 一个可解释的基线排序模型

在数据量不大时，不需要一开始训练深度学习模型。可以先使用明确的特征和加权评分：

```
score =
    3.0 * accord_match
  + 2.0 * descriptor_match
  + 1.5 * note_match
  + 1.0 * personal_preference
  + 0.5 * review_evidence
  - 2.5 * negative_accord_penalty
  - 1.5 * negative_descriptor_penalty
```

这里的系数只是启动实验的初始值，不是行业通用参数。实际项目应使用标注查询集和用户反馈调参。不同特征必须先归一化，否则一个数值范围很大的字段会不合理地主导总分。

可以把排序拆成特征计算和排序策略两层。第一版用线性加权，后续数据充足时再比较 Logistic Regression、LambdaMART / LightGBM Ranker 或神经排序模型。模型升级不应改变产品实体、证据和反馈事件的基础契约。

### 12.5 数据库设计：产品事实、来源和用户反馈分开保存

下面给出 PostgreSQL 的核心表结构示意。重点不是把所有信息塞进 perfume 表，而是保留多对多关系和字段来源。

```sql
CREATE TABLE perfume (
  id              UUID PRIMARY KEY,
  brand_id        UUID NOT NULL,
  name            TEXT NOT NULL,
  concentration   TEXT,
  release_year    SMALLINT,
  price_amount    NUMERIC(12, 2),
  currency        CHAR(3),
  market_code     CHAR(2),
  status          TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE scent_concept (
  id              TEXT PRIMARY KEY,
  canonical_name  TEXT NOT NULL,
  concept_type    TEXT NOT NULL, -- accord / descriptor / note / sensory
  ontology_version TEXT NOT NULL
);

CREATE TABLE perfume_concept (
  perfume_id      UUID REFERENCES perfume(id),
  concept_id      TEXT REFERENCES scent_concept(id),
  role            TEXT NOT NULL, -- top / heart / base / accord / descriptor
  weight          NUMERIC(5, 4),
  source_id       UUID NOT NULL,
  PRIMARY KEY (perfume_id, concept_id, role, source_id)
);

CREATE TABLE source_record (
  id              UUID PRIMARY KEY,
  source_name     TEXT NOT NULL,
  source_url      TEXT,
  license_id      TEXT,
  retrieved_at    TIMESTAMPTZ NOT NULL,
  dataset_version TEXT
);

CREATE TABLE user_preference (
  user_id         UUID NOT NULL,
  concept_id      TEXT REFERENCES scent_concept(id),
  polarity        SMALLINT NOT NULL CHECK (polarity IN (-1, 1)),
  weight          NUMERIC(5, 4) NOT NULL,
  confidence      NUMERIC(5, 4) NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, concept_id)
);

CREATE TABLE recommendation_event (
  event_id        UUID PRIMARY KEY,
  user_id         UUID,
  request_id      UUID NOT NULL,
  perfume_id      UUID REFERENCES perfume(id),
  event_type      TEXT NOT NULL, -- impression / click / save / sample / purchase / dislike
  position        INTEGER,
  context         JSONB NOT NULL DEFAULT '{}',
  occurred_at     TIMESTAMPTZ NOT NULL
);

CREATE INDEX perfume_concept_by_concept
  ON perfume_concept (concept_id, perfume_id);
CREATE INDEX recommendation_event_by_user_time
  ON recommendation_event (user_id, occurred_at DESC);
```

生产系统还需要品牌表、调香师表、产品版本表、价格历史、用户授权与数据保留策略。这里把来源绑定到每条产品概念声明，是为了在两个来源对同一款香水的描述冲突时保留双方证据，而不是覆盖成一个无来源的“最终值”。

向量表可以单独存放，例如 perfume_id、document_id、embedding_model、embedding_version、content_hash 和向量值。Embedding 是可重建索引，不应成为产品事实的唯一存储。

### 12.6 可运行的 Python 示例

仓库提供了一个小型 FastAPI 示例，展示从中文描述提取概念、执行约束、对香调/气味描述/Note 进行解释性打分，并返回命中依据。示例目录：

[examples/fragrance-recommender](https://github.com/devweekly/devweekly.github.io/tree/main/examples/fragrance-recommender)

安装和启动：

```bash
cd examples/fragrance-recommender
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --reload
```

调用接口：

```bash
curl -X POST http://127.0.0.1:8000/recommend \
  -H 'content-type: application/json' \
  -d '{
    "query": "想找雨后森林、湿润泥土、苔藓和木头，不要太甜",
    "preference": {"max_price": 800},
    "limit": 5
  }'
```

示例返回产品 ID、品牌、分数、匹配概念、推荐理由和证据来源。目录中的产品是**虚构的演示数据**，不能作为真实香水推荐或真实产品资料引用。代码实现的是确定性基线，不声称已经完成向量语义检索；这样可以先验证数据契约和排序逻辑，再替换候选召回实现。

### 12.7 从 Demo 走向生产：如何接入 Embedding 和学习排序？

生产环境应把召回接口抽象成独立组件。例如：

```python
class CandidateRetriever:
    async def retrieve(self, query, preference, limit=200):
        # 1. SQL: structured filters and exact concept matches
        # 2. BM25: product descriptions and licensed review text
        # 3. Vector: multilingual semantic descriptions
        # 4. Merge by canonical perfume_id, preserve channel scores
        ...
```

向量文档不应该只拼接一条产品名称。可以为每款香水生成多种检索文档：官方产品描述、香调结构、经过许可的评论摘要、人工审核的中文气味描述。不同文档类型分别保存来源和内容版本，避免评论语义覆盖官方产品属性。

向量召回可用 pgvector、OpenSearch 或专门的向量服务实现。选择取决于数据规模、现有平台、过滤能力、运维成本和多语言模型表现，不是推荐系统的先决条件。上线前应以真实中文查询集比较 BM25、向量召回和混合召回，而不是仅凭几个 Demo 查询决定。

当积累足够的曝光与反馈后，可以训练 Learning-to-Rank。训练样本必须记录当时展示了哪些候选、位置、用户上下文和反馈时间。购买、试香、收藏、明确不喜欢的信号强度不同；点击还受到排序位置影响，不能直接当作正样本。没有曝光日志就无法正确估计“没点”究竟是不喜欢，还是根本没看到。

### 12.8 评估指标和上线门槛

| 评估层 | 指标 | 需要回答的问题 |
|---|---|---|
| 召回 | Recall@K、Hit Rate@K | 人工认为相关的香水是否进入候选集？ |
| 排序 | NDCG@K、MAP、MRR | 更符合偏好的产品是否排在前面？ |
| 约束 | Constraint violation rate | 是否推荐超预算、错误浓度或不可购买产品？ |
| 解释 | Evidence coverage、unsupported claim rate | 推荐理由是否能追溯到数据？ |
| 多样性 | Intra-list diversity、coverage | 是否总是推荐同一类香水或头部品牌？ |
| 业务 | Save、sample、purchase conversion | 用户是否愿意进一步试香或购买？ |

测试集应包含生活化中文表达、同义改写、否定句、混合偏好、价格约束和数据缺失场景。例如“想要干净但不要皂感”“喜欢木质但不要烟熏”“有雨后泥土感但不要太甜”都比单独输入“woody”更接近真实使用。

最重要的上线门槛不是某个离线指标达到一个漂亮数字，而是硬约束违规率可控、推荐解释有证据、数据许可清楚，并且系统能识别“没有足够信息作出可靠推荐”的情况。

### 12.9 推荐系统的演进路线

| 阶段 | 方法 | 适用条件 |
|---|---|---|
| Baseline | 规则 + 结构化过滤 + 加权排序 | 产品数据少、需要可解释和快速验证 |
| Hybrid Search | SQL + BM25 + Embedding 召回 | 用户开始用自然语言描述气味 |
| Personalization | 用户偏好向量 + 行为特征重排 | 有稳定用户反馈和足够曝光 |
| Learning-to-Rank | LambdaMART / LightGBM Ranker 等 | 有质量合格的 query-candidate-label 数据 |
| Advanced | 多目标排序、因果评估、上下文 bandit | 流量和实验治理成熟，能正确处理探索与偏差 |

对大多数早期项目，最值得先完成的是高质量产品数据、中文嗅觉本体、可解释的混合召回和反馈事件。训练一个复杂推荐模型并不能弥补产品身份错误、香调来源不明或中文概念映射混乱。


## 参考资料与数据入口

1. [FragDB – Fragrance Database](https://github.com/FragDB/fragrance-database)
2. [FragDB Data Dictionary](https://github.com/FragDB/fragrance-database/blob/main/DATA_DICTIONARY.md)
3. [FragDB v5.20 multilingual sample](https://huggingface.co/datasets/FragDBnet/fragrance-database)
4. [ParfumDB](https://www.parfumdb.net/)
5. [Scento Perfume Dataset](https://github.com/Scento-com/perfume-dataset)
6. [Scento Perfume Database – Hugging Face](https://huggingface.co/datasets/scento/perfume-database)
7. [doevent/perfume – Hugging Face](https://huggingface.co/datasets/doevent/perfume)
8. [CSLOdorDB](http://cslodordatabase.7fx.cn/)
9. [CSLOdorDB – Database Commons](https://ngdc.cncb.ac.cn/databasecommons/database/id/9908)
10. [Atomevo-odor: A database for understanding olfactory receptor-odorant pairs with multi-artificial intelligence methods](https://pubmed.ncbi.nlm.nih.gov/39977983/)
11. [NKU-DOIE/OdorNet](https://github.com/NKU-DOIE/OdorNet)
12. [OdorNet – Zenodo](https://zenodo.org/records/19838455)
13. [上海交通大学食品风味创新团队数据库](https://mffi.sjtu.edu.cn/database)
14. [5KG-UCAS/CosmeticsKG](https://github.com/5KG-UCAS/CosmeticsKG)
