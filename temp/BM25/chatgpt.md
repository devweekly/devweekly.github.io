如果把搜索引擎比作图书馆，那么 BM25 就是图书管理员用来判断：

> **“在这 100 万本书里，哪一本最可能回答你的问题？”**

它是目前搜索领域最经典、最成功的排序算法之一。

你每天用到的很多搜索系统，本质上都在用 BM25 或它的变种：

* Elasticsearch
* OpenSearch
* Lucene
* Solr
* Vespa
* SQLite FTS5
* GitHub Code Search（部分场景）
* 各种 RAG 系统 Hybrid Search

---

# 一、BM25 是干什么的？

假设你搜索：

```text
apple revenue 2025
```

数据库里有三篇文档：

### 文档A

```text
Apple revenue reached record high in 2025.
```

---

### 文档B

```text
Apple released new iPhone products.
```

---

### 文档C

```text
Microsoft revenue increased in 2025.
```

BM25 要做的事情：

给每篇文档打分。

结果可能：

| 文档 | 分数   |
| -- | ---- |
| A  | 12.5 |
| C  | 7.2  |
| B  | 3.1  |

然后排序：

```text
A
C
B
```

因为：

A同时包含：

```text
apple
revenue
2025
```

最相关。

---

# 二、为什么需要 BM25？

最早搜索引擎很简单：

## 方法1：数关键词

搜索：

```text
apple
```

文档：

```text
apple apple apple apple apple
```

出现5次。

得分=5

---

另一个文档：

```text
Apple Inc. reported annual revenue and earnings.
```

只出现1次。

得分=1

---

结果：

```text
垃圾文档 > 有价值文档
```

显然不合理。

所以需要更聪明的方法。

---

# 三、BM25 的核心思想

BM25主要考虑三个因素：

---

## 1 词频（TF）

Term Frequency

一个词出现越多：

```text
apple
```

通常越重要。

例如：

```text
Apple revenue...
```

出现1次

比

```text
Apple Apple Apple revenue...
```

相关性低一些。

---

但是：

出现100次不一定比10次好10倍。

所以BM25会限制增长。

类似：

```text
1次 → 1分
2次 → 1.5分
10次 → 2分
100次 → 2.2分
```

逐渐饱和。

---

## 2 逆文档频率（IDF）

Inverse Document Frequency

这是BM25最聪明的部分。

---

假设有100万篇文章。

### 词1

```text
the
```

出现：

```text
999999篇
```

---

### 词2

```text
kubernetes
```

出现：

```text
500篇
```

---

显然：

```text
kubernetes
```

更有价值。

因为它更能区分文档。

---

所以：

| 词          | IDF |
| ---------- | --- |
| the        | 很低  |
| and        | 很低  |
| is         | 很低  |
| kubernetes | 很高  |
| snowflake  | 很高  |
| BM25       | 很高  |

---

# 举例

搜索：

```text
snowflake iceberg
```

文档：

```text
the and is snowflake
```

虽然有很多词。

但：

```text
the
and
is
```

权重几乎为0。

真正有价值的是：

```text
snowflake
```

---

# 3 文档长度惩罚

这是很多人忽略的部分。

---

文档A：

```text
10个词
```

匹配2个关键词。

---

文档B：

```text
10000个词
```

也匹配2个关键词。

---

直觉上：

A更精准。

B可能只是碰巧出现。

---

因此BM25会对长文档降权。

叫：

```text
Length Normalization
```

长度归一化。

---

# 四、BM25名字从哪来？

BM = Best Matching

25 = 第25版实验模型

来自英国信息检索学者：

Stephen Robertson

和同事在90年代提出。

结果效果太好。

用了30多年。

至今仍是搜索行业标准。

---

# 五、BM25 公式长什么样？

真正公式：

[
Score(D,Q)=\sum IDF(q_i)\times
\frac{TF(q_i)(k_1+1)}
{TF(q_i)+k_1(1-b+b\frac{|D|}{avgDL})}
]

别被吓到。

实际上就是：

```text
相关度

=

词的重要性(IDF)

×

词出现次数(TF)

×

长度修正
```

仅此而已。

---

# 六、怎么实现？

假设有三篇文档：

```javascript
docs = [
  "apple revenue 2025",
  "apple iphone launch",
  "microsoft revenue 2025"
]
```

---

第一步：

建立倒排索引（Inverted Index）

```javascript
apple
  -> doc1
  -> doc2

revenue
  -> doc1
  -> doc3

2025
  -> doc1
  -> doc3
```

---

搜索：

```javascript
"apple revenue"
```

---

找到候选文档：

```javascript
doc1
doc2
doc3
```

---

计算：

```javascript
BM25(doc1)
BM25(doc2)
BM25(doc3)
```

---

排序：

```javascript
doc1
doc3
doc2
```

返回结果。

---

# 七、为什么 RAG 又开始流行 BM25？

因为 Embedding 并不能解决所有问题。

例如：

搜索：

```text
GLM-5.2 IndexShare
```

---

向量搜索可能找：

```text
attention optimization
sparse attention
transformer acceleration
```

这些语义接近。

---

但：

```text
IndexShare
```

是专有名词。

向量模型未必理解。

---

BM25反而很强：

```text
谁包含 IndexShare
谁排前面
```

---

所以现在流行：

## Hybrid Search

混合搜索

```text
BM25
+
Vector Search
```

例如：

```text
OpenSearch
Elasticsearch
Weaviate
Vespa
Milvus
Azure AI Search
```

都支持。

---

# 八、对于你的翻译项目有什么用？

结合你之前提到的：

* Repo 分析
* 技术文档搜索
* PDF 翻译
* 研究报告检索
* RAG

BM25非常值得用。

例如：

### 技术文档搜索

用户搜：

```text
Cloudflare D1 UPSERT
```

BM25能快速找到：

```text
INSERT OR REPLACE
ON CONFLICT
UPSERT
```

所在文档。

---

### Repo搜索

搜索：

```text
IndexShare
```

BM25比Embedding更准。

因为代码中的：

```cpp
class IndexShare
```

属于精确匹配。

---

### 研究报告搜索

基金经理搜：

```text
Nvidia Blackwell
```

BM25立即找到包含该词的报告。

然后再结合Embedding做语义排序。

---

# 九、现代搜索架构长什么样？

现在最常见的架构其实是：

```text
用户查询
      │
      ▼

 BM25召回
      │
      ▼

 Vector召回
      │
      ▼

 合并结果
      │
      ▼

 Cross Encoder重排
      │
      ▼

 Top N结果
```

也就是：

```text
BM25
+
Embedding
+
LLM Rerank
```

三层结构。

对于你现在做的研究报告搜索、代码搜索、RAG 检索，这基本已经是业界主流方案。

一句话概括：

> BM25 是一种“关键词相关度评分算法”，通过“词频 + 稀有度 + 文档长度修正”来判断文档与查询的匹配程度。它是 Elasticsearch/OpenSearch 的核心，也是现代 Hybrid Search（BM25 + Vector）的基础组件。对于专有名词、代码符号、产品名、金融术语等精确检索场景，BM25 往往比 Embedding 更可靠。
