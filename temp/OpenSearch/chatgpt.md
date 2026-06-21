这是搜索领域里最重要的概念之一。

如果你真正理解了 **Bi-Encoder 和 Cross-Encoder** 的区别，你基本就理解了：

* 为什么 Embedding Search 有局限
* 为什么 RAG 要做 Rerank
* 为什么 OpenSearch 要同时提供两种模型
* 为什么 BM25 至今没有消失

---

# 先说结论

可以把它们理解成：

| 类型           | Bi-Encoder    | Cross-Encoder   |
| ------------ | ------------- | --------------- |
| 中文           | 双塔模型          | 交叉编码模型          |
| 用途           | 召回（Retrieve）  | 重排序（Rerank）     |
| 速度           | 快             | 慢               |
| 精度           | 中             | 高               |
| 适合           | 百万文档搜索        | Top100重新排序      |
| OpenSearch位置 | Neural Search | Rerank Pipeline |

OpenSearch文档也是这么设计的：

* Neural Sparse Search → Bi-Encoder ([OpenSearch Documentation][1])
* Rerank Processor → Cross-Encoder ([OpenSearch Documentation][2])

---

# 用找老婆举例

假设你要找对象。

有100万人。

你不可能：

```text
100万人
逐个面试
```

成本太高。

所以分两步：

---

第一步：

快速筛选

```text
年龄
学历
城市
收入
```

100万人

↓

100人

---

第二步：

详细面试

```text
三观
性格
兴趣
价值观
```

100人

↓

1人

---

搜索系统也是一样。

```text
100万文档
    ↓
Bi-Encoder
    ↓
100篇候选

    ↓
Cross-Encoder
    ↓
Top10
```

这就是现代RAG。

---

# Bi-Encoder到底干什么

先看你的查询：

```text
Cloudflare D1 UPSERT
```

文档：

```text
D1 supports UPSERT via ON CONFLICT
```

---

Bi-Encoder会这样处理：

```text
Query
    ↓
Encoder
    ↓
向量Q

Document
    ↓
Encoder
    ↓
向量D
```

两边完全独立。

---

例如：

```text
Query
Cloudflare D1 UPSERT
```

变成：

```text
[0.23, 0.44, -0.18, ...]
```

---

文档：

```text
D1 supports UPSERT via ON CONFLICT
```

变成：

```text
[0.25, 0.41, -0.21, ...]
```

---

然后：

```text
cosine(Q,D)
```

计算相似度。

---

注意：

这里有个关键点：

```text
Query 和 Document
从来没有见过面
```

各自编码。

最后比较向量。

---

所以叫：

```text
Bi Encoder
```

两个编码器。

实际上很多时候权重是共享的。

但逻辑上：

```text
Query Tower
Document Tower
```

两座塔。

---

# 为什么Bi-Encoder快？

因为：

文档只需要算一次。

---

假设：

```text
1000万篇文档
```

提前算好：

```text
embedding
```

存起来。

---

用户查询：

```text
GLM5 IndexShare
```

只需要：

```text
编码Query
```

一次。

然后：

```text
HNSW
```

找最近向量。

---

复杂度大约：

```text
O(log N)
```

而不是：

```text
O(N)
```

所以非常快。([arXiv][3])

---

# Bi-Encoder的问题

因为：

```text
Query
Document
```

没有交互。

---

举例：

Query

```text
Apple revenue
```

---

文档A

```text
Apple revenue increased 20%
```

---

文档B

```text
Microsoft revenue exceeded Apple
```

---

Bi-Encoder可能觉得：

```text
Apple
Revenue
```

都有。

差不多。

---

但人类知道：

```text
A明显更相关
```

---

因为：

Bi-Encoder只看：

```text
向量距离
```

没有逐词分析。

---

# Cross-Encoder干什么

Cross-Encoder完全不同。

它让：

```text
Query
+
Document
```

一起输入模型。

OpenSearch 的 Cross Encoder Rerank 就是这么工作的。([OpenSearch Documentation][2])

---

输入：

```text
[CLS]

Apple revenue

[SEP]

Apple revenue increased 20%

[SEP]
```

---

模型直接判断：

```text
相关度 = 0.97
```

---

对于文档B：

```text
[CLS]

Apple revenue

[SEP]

Microsoft revenue exceeded Apple

[SEP]
```

---

模型可能给：

```text
0.52
```

---

因为模型能看到：

```text
Apple
Revenue
```

和

```text
Microsoft revenue exceeded Apple
```

之间真正的关系。

---

# Transformer内部发生了什么

这里才是核心。

Cross Encoder允许：

```text
Query Token
```

和

```text
Document Token
```

互相Attention。

---

例如：

```text
Apple revenue
```

里的

```text
Apple
```

可以直接关注：

```text
Apple revenue increased
```

里的

```text
Apple
```

---

也可以关注：

```text
Microsoft revenue exceeded Apple
```

里的

```text
Apple
```

---

模型会学习：

```text
哪个匹配更合理
```

---

而Bi-Encoder做不到。

因为：

```text
Query先编码完

Document再编码完

最后才比较
```

---

# 为什么Cross Encoder更准

因为它实际上在回答：

```text
Query和Document是否匹配？
```

而不是：

```text
两个向量是否接近？
```

---

可以理解成：

Bi Encoder：

```text
先给两个人拍证件照

再比较照片
```

---

Cross Encoder：

```text
让两个人坐一起聊天

再判断是否合适
```

---

显然第二种更准确。

这也是为什么 Cross-Encoder 通常作为 Reranker 使用。([OpenSearch Documentation][2])

---

# 为什么不能直接用Cross Encoder搜索100万文档？

假设：

```text
100万篇文档
```

---

Bi Encoder

```text
Query编码一次

向量搜索

结束
```

可能：

```text
20ms
```

---

Cross Encoder

必须：

```text
Query + 文档1
跑一次Transformer

Query + 文档2
跑一次Transformer

...

100万次
```

---

直接爆炸。

学术界反复提到：

Cross Encoder 精度更高，但计算成本太高，因此通常只能用于召回后的重排序。([arXiv][4])

---

# OpenSearch为什么两个都支持

因为它们解决不同问题。

## 第一阶段

Neural Sparse Search

使用 Bi-Encoder

```text
100万
 ↓
100
```

OpenSearch Neural Sparse 的 bi-encoder 模式，就是对 Query 和 Document 都生成 sparse embedding，再检索。([OpenSearch Documentation][1])

---

## 第二阶段

Rerank Pipeline

使用 Cross-Encoder

```text
100
 ↓
10
```

OpenSearch 的 rerank processor 会拿到候选结果，再用 Cross Encoder 重新打分排序。([OpenSearch Documentation][2])

---

# 对你现在的研究报告搜索最重要的理解

你之前提到：

```text
研究报告
PDF
技术文档
代码搜索
```

如果规模是：

```text
10万 Chunk
```

最佳实践其实已经比较固定：

```text
BM25
    +
Embedding/BiEncoder
    ↓

Top100

    ↓

Cross Encoder

    ↓

Top10

    ↓

LLM
```

其中：

* BM25负责专有名词（IndexShare、Blackwell、D1）
* Bi-Encoder负责语义召回
* Cross-Encoder负责最终判断“这个Chunk到底是不是答案”

很多团队把精力放在换 Embedding 模型上，但实际检索质量提升最大的步骤，经常是：

```text
加入 Cross Encoder Rerank
```

因为它第一次让 Query 和 Chunk 真正发生了“面对面交流”。这也是 OpenSearch 把 Cross-Encoder 放在 Search Pipeline 末端而不是检索阶段的根本原因。([OpenSearch Documentation][2])

[1]: https://docs.opensearch.org/latest/vector-search/ai-search/neural-sparse-with-pipelines/?utm_source=chatgpt.com "Generating sparse vector embeddings automatically - OpenSearch Documentation"
[2]: https://docs.opensearch.org/3.1/search-plugins/search-relevance/rerank-cross-encoder/?utm_source=chatgpt.com "Reranking using a cross-encoder model - OpenSearch Documentation"
[3]: https://arxiv.org/abs/2408.01094?utm_source=chatgpt.com "An Encoding--Searching Separation Perspective on Bi-Encoder Neural Search"
[4]: https://arxiv.org/abs/2305.02996?utm_source=chatgpt.com "Efficient k-NN Search with Cross-Encoders using Adaptive Multi-Round CUR Decomposition"
