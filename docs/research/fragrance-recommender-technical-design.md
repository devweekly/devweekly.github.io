# 香水推荐系统：数据模型、检索与个性化排序技术设计



> 本文是《香水数据从哪里来？从中文香调知识到分子气味科学与 AI 推荐》的技术附录，保存在仓库文档目录，不进入 Astro 博客发布流程。内容覆盖数据模型、检索、排序、评估、API 与示例代码。



原文与配套文章：[香水数据从哪里来？](../../src/content/blog/chinese-fragrance-data-ecosystem-2026.md)



## 7. 数据模型与存储：关系数据作为事实源

不建议一开始就把所有数据切块后放进向量数据库。香水产品、品牌、调香师、Note、分子和评论之间存在大量明确关系，关系型数据和知识图谱更适合保存事实、标识符和来源。

可以采用以下分层结构：

![香水推荐系统参考架构](/diagrams/fragrance-recommender-architecture.svg)

*图源：[diagram-design HTML 版本](/diagrams/fragrance-recommender-architecture.html)。*

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

## 8. 自然语言检索示例：寻找雨后森林气味

假设用户输入：

> 想找一款雨后森林的味道，带一点湿润泥土、苔藓和木头，不要太甜。

系统不应该只把整句话转换成一个向量，然后直接取 Top-K 产品。更稳妥的流程是先识别约束，再进行混合检索：

![香水推荐请求处理流程](/diagrams/fragrance-recommendation-flow.svg)

*图源：[diagram-design HTML 版本](/diagrams/fragrance-recommendation-flow.html)。*

检索系统可以把请求转换为如下概念：

| 用户表达 | 规范化候选概念 | 约束类型 |
|---|---|---|
| 雨后森林 | Petrichor、Earthy、Mossy、Green | 正向偏好 |
| 湿润泥土 | Wet Soil、Earthy | 正向偏好 |
| 苔藓 | Mossy、Woody | 正向偏好 |
| 木头 | Woody、Cedar、Sandalwood 等候选 | 正向偏好 |
| 不要太甜 | Sweet、Gourmand 权重降低 | 排除或降权 |

这里的映射是检索假设，不是对香水配方的判断。推荐结果应展示产品资料来源、匹配的公开香调、用户评论中的相关描述，以及数据缺失或来源冲突。系统不能把模型生成的解释包装成品牌公开声明。

## 9. 数据质量与治理

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

## 10. 分阶段实施

验证第一版搜索和推荐系统，不必先采购最大的数据集或训练分子模型。

| 阶段 | 数据与工作 | 交付结果 |
|---|---|---|
| 1. 产品 PoC | 使用许可明确的小型产品数据集，建立 Perfume、Brand、Note、Accord 模型 | 可检索的香水目录 |
| 2. 中文语义 | 建立中文嗅觉词汇、同义词、近义词和多对多映射 | 中文自然语言搜索 |
| 3. 用户反馈 | 接入有授权的评论和偏好反馈 | 偏好画像与排序 |
| 4. 科学知识 | 接入 CSLOdorDB、OdorNet 和风味数据 | 原料与分子解释能力 |
| 5. 商业数据 | 评估 FragDB、ParfumDB 或其他供应商的授权与覆盖率 | 扩展产品规模 |
| 6. 评估优化 | 建立人工标注查询集，测量召回率、排序质量和解释正确性 | 可量化的推荐质量 |

第一阶段应检查产品身份准确率、香调来源可追溯性、中文表达召回质量、错误推荐的可解释性，以及数据许可是否覆盖目标用途。

## 11. 产品目录、气味本体与分子数据的边界

国际市场已有规模较大的香水产品数据库和社区内容数据。国内则有 CSLOdorDB、南开大学 OdorNet 等值得关注的分子气味科学资源，也有 CosmeticsKG 这样的早期产品知识图谱原型，以及食品风味研究数据。

各类数据的职责可以概括为：

- 产品数据库回答“市场上有什么香水，公开资料如何描述它”；
- 气味本体回答“人们用什么词表达气味，这些词之间是什么关系”；
- 原料和分子数据库回答“哪些物质与哪些气味描述相关”；
- 嗅觉科学回答“分子、受体和感官实验之间有哪些可研究的关系”；
- 用户评论回答“消费者在具体使用条件下如何描述体验”。

中文香水搜索的基础工作，是建立可追溯的嗅觉语义映射：把生活化表达连接到标准气味描述、产品香调和科学数据，同时保留映射的不确定性。简单翻译一份海外产品库解决不了这个问题。

实现上，可由关系数据库保存产品事实和来源，全文检索与向量检索处理自然语言表达；只有在多跳关系查询或分子建模确有需求时，再引入知识图谱或分子模型。向量相似不等于气味相同，产品香调不等于真实配方，模型预测也不等于感官实验结果。这三条边界决定了系统能否给出可信的推荐和解释。

## 12. 个性化推荐的实现

产品目录和气味语义建好后，推荐系统还要处理用户意图、候选召回、硬约束和个性化排序。

这几步应分开实现：**理解用户意图、召回候选、过滤硬约束、对候选排序**。如果全部交给一个 LLM Prompt 或单次向量查询，召回质量、约束执行和排序结果就难以分别评估。

### 12.1 组件边界

下图把事实存储、查询理解、混合召回和排序拆开。关系数据库仍然是产品事实的来源；全文和向量索引只是检索投影，可以从规范数据重建。

产品事实保存在 PostgreSQL；全文和向量索引只是可重建的检索投影。

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

### 12.2 召回与排序分开处理

第 8 节的查询示例展示了意图解析和混合检索。实现时仍应把 Recall 和 Rank 分开，以便分别评估候选覆盖率和排序质量。

推荐请求分为召回和排序两个阶段。

**Recall（召回）**的目标是尽可能找全可能相关的候选。可以并行执行：

1. 结构化过滤：价格、浓度、品牌、市场、产品状态等；
2. 词汇检索：中文别名、英文标准词、Note、Accord 和评论关键词；
3. 全文相关性：对评论和描述执行 BM25 等文本检索；
4. 向量检索：对“像雨后森林”“晒过太阳的棉被”等自然语言描述进行语义召回；
5. 相似产品召回：从用户收藏或明确喜欢的产品出发，寻找属性邻居。

多路结果按 canonical perfume ID 合并，保留每条候选来自哪条召回通道、原始排名和分数。召回阶段不宜过早使用复杂权重，否则某一条通道的分数尺度可能压制其他通道。

**Rank（排序）**负责对合并后的候选重新打分。预算上限、不可接受的浓度、配送地区和明确排除项属于硬约束；“不太甜”“更偏木质”一般属于软偏好，适合降权而不是一刀切。除非用户明确表达绝对禁忌，否则不要把模糊的自然语言自动转成硬过滤。

### 12.3 将用户偏好保存为可更新状态

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

### 12.4 从规则评分开始

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

这些系数只用于启动实验，不是通用参数。实际项目应使用标注查询集和用户反馈调参。不同特征必须先归一化，否则一个数值范围很大的字段会不合理地主导总分。

可以把排序拆成特征计算和排序策略两层。第一版用线性加权，后续数据充足时再比较 Logistic Regression、LambdaMART / LightGBM Ranker 或神经排序模型。模型升级不应改变产品实体、证据和反馈事件的基础契约。

### 12.5 产品事实、来源和用户反馈分表保存

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

生产系统还需补充品牌、调香师、产品版本、价格历史、用户授权和数据保留策略。这里把来源绑定到每条产品概念声明，是为了在两个来源对同一款香水的描述冲突时保留双方证据，而不是覆盖成一个无来源的“最终值”。

向量表可以单独存放，例如 perfume_id、document_id、embedding_model、embedding_version、content_hash 和向量值。Embedding 是可重建索引，不应成为产品事实的唯一存储。

### 12.6 Python 示例

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

接口返回产品 ID、品牌、分数、匹配概念、推荐理由和证据来源。目录中的产品是**虚构的演示数据**，不能作为真实产品资料引用。当前代码实现确定性基线，没有向量语义检索；它用于验证数据契约和排序逻辑。

### 12.7 接入语义召回和学习排序

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

向量召回可用 pgvector、OpenSearch 或独立向量服务。选择时比较数据规模、过滤能力、现有平台、运维成本和多语言模型效果；小规模系统不必为了使用 Embedding 单独部署向量数据库。上线前应以真实中文查询集比较 BM25、向量召回和混合召回，而不是仅凭几个 Demo 查询决定。

当积累足够的曝光与反馈后，可以训练 Learning-to-Rank。训练样本必须记录当时展示了哪些候选、位置、用户上下文和反馈时间。购买、试香、收藏、明确不喜欢的信号强度不同；点击还受到排序位置影响，不能直接当作正样本。没有曝光日志就无法正确估计“没点”究竟是不喜欢，还是根本没看到。

### 12.8 评估推荐质量

| 评估层 | 指标 | 需要回答的问题 |
|---|---|---|
| 召回 | Recall@K、Hit Rate@K | 人工认为相关的香水是否进入候选集？ |
| 排序 | NDCG@K、MAP、MRR | 更符合偏好的产品是否排在前面？ |
| 约束 | Constraint violation rate | 是否推荐超预算、错误浓度或不可购买产品？ |
| 解释 | Evidence coverage、unsupported claim rate | 推荐理由是否能追溯到数据？ |
| 多样性 | Intra-list diversity、coverage | 是否总是推荐同一类香水或头部品牌？ |
| 业务 | Save、sample、purchase conversion | 用户是否愿意进一步试香或购买？ |

测试集应包含生活化中文表达、同义改写、否定句、混合偏好、价格约束和数据缺失场景。例如“想要干净但不要皂感”“喜欢木质但不要烟熏”“有雨后泥土感但不要太甜”都比单独输入“woody”更接近真实使用。

上线门槛应包括硬约束违规率、解释证据覆盖率、数据许可，以及系统识别证据不足的能力。单个离线指标不能代替这些检查。

### 12.9 演进顺序

| 阶段 | 方法 | 适用条件 |
|---|---|---|
| Baseline | 规则 + 结构化过滤 + 加权排序 | 产品数据少、需要可解释和快速验证 |
| Hybrid Search | SQL + BM25 + Embedding 召回 | 用户开始用自然语言描述气味 |
| Personalization | 用户偏好向量 + 行为特征重排 | 有稳定用户反馈和足够曝光 |
| Learning-to-Rank | LambdaMART / LightGBM Ranker 等 | 有质量合格的 query-candidate-label 数据 |
| Advanced | 多目标排序、因果评估、上下文 bandit | 流量和实验治理成熟，能正确处理探索与偏差 |

对大多数早期项目，最值得先完成的是高质量产品数据、中文嗅觉本体、可解释的混合召回和反馈事件。训练一个复杂推荐模型并不能弥补产品身份错误、香调来源不明或中文概念映射混乱。

## 电商商品评估的实现补充

### 14.6 商品评估流程

~~~mermaid
flowchart TD
    A["淘宝/天猫链接、截图或复制文本"] --> B["商品身份与 SKU 识别"]
    B --> C["详情字段提取 / OCR"]
    C --> D["品牌官网与香水数据库交叉核验"]
    D --> E["评论中的具体气味体验抽取"]
    E --> F["标准气味概念映射"]
    F --> G["按来源类型和置信度保留证据"]
    G --> H["与个人偏好匹配"]
    H --> I{"证据是否充分？"}
    I -->|是| J["可能匹配 / 可能冲突"]
    I -->|否| K["信息不足与待核验项"]
    J --> L["试香、购买或忽略"]
    K --> L
    L --> M["个人实际反馈"]
    M --> N["更新偏好档案"]
~~~

数据层可拆分为以下实体：

| 实体 | 核心字段 | 作用 |
|---|---|---|
| Product | product_id、brand、SKU、product_type、market、price | 统一商品身份；区分香水和蜡烛 |
| ProductAssertion | product_id、field、value、source_id、evidence_type、confidence | 保存品牌、卖家和数据库各自的声明 |
| ScentFeature | product_id、concept_id、intensity、evidence_id | 保存标准化气味特征，但不抹掉原始证据 |
| ReviewObservation | source、original_text、sentiment、concepts、context | 保存用户评论中的具体体验 |
| ProductPerformance | product_type、cold_throw、hot_throw、longevity、projection 等 | 按产品类别保存表现指标 |
| UserPreference | concept_id、polarity、weight、confidence、updated_at | 记录个人喜欢与排斥 |
| UserFeedback | product_id、tried_at、actual_perception、would_rebuy | 用试香和使用反馈更新模型 |

ProductAssertion 与 ReviewObservation 不应合并。前者是产品资料声明，后者是用户体验；即使它们对同一款商品说法不同，也应该同时保留。还应保留原始商品 URL、SKU、录入时间、语言、地区、数据许可和删除状态，便于处理商品改版、来源失效和权利要求。

### 14.7 商品评估 API 示例

仓库中的 examples/fragrance-recommender 在原有目录推荐 Demo 之外，增加了 /assess 接口。它接收从商品详情页、OCR 或评价中整理出的结构化信息，返回可能匹配、可能冲突或信息不足的判断，并保留每条证据的类型、来源和置信度。

运行方式仍然是：

~~~bash
cd examples/fragrance-recommender
pip install -r requirements.txt
uvicorn app:app --reload
~~~

示例请求（省略部分可选字段）：

~~~json
{
  "query": "喜欢木质和茶香，不要太甜",
  "preference": {
    "include": ["woody", "tea"],
    "exclude": ["sweet"]
  },
  "product": {
    "name": "某品牌白茶香氛蜡烛",
    "product_type": "candle",
    "features": [
      {
        "concept": "woody",
        "evidence": {
          "evidence_type": "seller_description",
          "source_name": "Taobao product detail",
          "claim": "商品详情称含雪松木质香调",
          "confidence": 0.55
        }
      }
    ],
    "reviews": [
      {
        "text": "点燃后木质感明显，甜度不高",
        "sentiment": "like",
        "concepts": ["woody"],
        "confidence": 0.7
      }
    ],
    "cold_throw": 2.5,
    "hot_throw": 3.5
  }
}
~~~

该示例不会自动访问淘宝或抓取买家评价，也没有实现 OCR、外部数据库查询、Embedding 召回和学习排序。平台接入应通过授权 API 或用户主动提供的内容完成；评估逻辑不依赖某个电商页面的 DOM 结构。当前代码只验证证据记录、产品类型区分和“信息不足”判断。

### 14.8 实施顺序

| 阶段 | 工作 | 交付 |
|---|---|---|
| P0 | 商品链接/截图/文本输入；商品身份与 SKU；人工或 OCR 字段提取 | 能对一件真实商品形成结构化档案 |
| P0 | 证据来源、来源 URL、时间、置信度 | 推荐理由可以审计，不把推断伪装成事实 |
| P0 | 个人喜欢/排斥档案；香水与蜡烛分别建模 | 能解释“为什么适合/不适合/无法判断” |
| P1 | 品牌官网和专业香水数据库交叉查询 | 补齐国际品牌产品信息和同款识别 |
| P1 | 合法取得的商品评价与气味观察抽取 | 从评价中提取甜度、粉感、扩香等体验 |
| P2 | 经授权的电商商品/API 数据接入 | 减少手工录入，覆盖更多 SKU |
| P2 | 多语言 Embedding 和个人反馈排序 | 改善生活化描述和跨语言检索 |

个人工具可以先从用户提交商品页和记录试香反馈开始，不必先覆盖全网商品。商业服务则需要在接入前明确商品数据、评论展示与训练、平台访问和用户隐私的许可边界。
