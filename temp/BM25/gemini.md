这里为你准备了一份专门为“小白”量身定制的 Python 版 BM25 实现代码。

为了让你能看懂，我**没有使用任何复杂的第三方库**，只用了 Python 自带的基础功能，并且在每一步都加上了详细的中文注释。它完全对应了我们之前讲过的三个核心点：**词频（TF）、逆文档频率（IDF）和文档长度惩罚**。

你可以直接把这段代码复制到你的 Python 环境中（比如 PyCharm、Jupyter Notebook 或者随便一个在线 Python 编译器）运行。

### 🐍 BM25 极简 Python 实现代码

```python
import math
from collections import Counter

class SimpleBM25:
    def __init__(self, corpus):
        """
        初始化 BM25 模型
        :param corpus: 我们的文档库（文章集合），格式是一个二维列表，比如 [['苹果', '财报'], ['发布', '手机']]
        """
        self.corpus_size = len(corpus) # 统计一共有多少篇文章
        self.avg_doc_len = sum(len(doc) for doc in corpus) / self.corpus_size # 计算所有文章的平均长度
        
        # BM25 的两个核心可调参数（这里用的是经验默认值）
        self.k1 = 1.5  # 控制词频（TF）的上限，防止词堆砌
        self.b = 0.75  # 控制文章长度惩罚的力度，b 越大，对长文章的惩罚越重

        self.doc_freqs = [] # 记录每篇文章里每个词出现了多少次
        self.idf = {}       # 记录每个词的“稀有程度”（IDF）
        self.doc_lens = []  # 记录每篇文章的长度

        self._initialize(corpus)

    def _initialize(self, corpus):
        """内部方法：计算好各种基础数据，方便后面快速打分"""
        word_doc_count = {} # 记录每个词在多少篇文章中出现过
        
        for doc in corpus:
            self.doc_lens.append(len(doc)) # 记录这篇文章的长度
            freq = Counter(doc) # 统计这篇文章里每个词的出现次数（TF）
            self.doc_freqs.append(freq)
            
            # 统计这个词在整个库里多少篇文章中出现过
            for word in freq.keys():
                word_doc_count[word] = word_doc_count.get(word, 0) + 1

        # 计算每个词的 IDF（逆文档频率：词越稀有，分数越高）
        for word, count in word_doc_count.items():
            # 这是一个标准的 IDF 数学公式计算
            self.idf[word] = math.log(1 + (self.corpus_size - count + 0.5) / (count + 0.5))

    def get_score(self, query, doc_index):
        """
        计算一篇文章的得分
        :param query: 搜索词列表，比如 ['苹果', '财报']
        :param doc_index: 要打分的文章在列表中的序号
        """
        score = 0.0
        doc_len = self.doc_lens[doc_index] # 当前文章长度
        freqs = self.doc_freqs[doc_index]  # 当前文章的词频字典
        
        for word in query:
            if word not in freqs:
                continue # 如果这篇文章没有这个词，直接跳过
            
            # 1. 拿到词频 (TF)
            tf = freqs[word]
            
            # 2. 拿到稀有度 (IDF)
            idf = self.idf.get(word, 0)
            
            # 3. 结合文档长度惩罚，计算最终得分 (BM25 核心公式)
            numerator = idf * tf * (self.k1 + 1)
            denominator = tf + self.k1 * (1 - self.b + self.b * (doc_len / self.avg_doc_len))
            score += numerator / denominator
            
        return score

# ==========================================
# 下面是测试和使用这段代码的例子
# ==========================================

if __name__ == "__main__":
    # 1. 准备我们的“迷你图书馆”（也就是文档库）
    # 为了方便处理，我们已经提前把句子切分成了词汇列表
    documents = [
        ["苹果", "公司", "发布", "2025", "财报", "利润", "大增"],  # 文档 0
        ["苹果", "发布", "了", "最新", "款", "手机"],            # 文档 1
        ["微软", "公司", "的", "2025", "财报", "也", "很", "好"],  # 文档 2
        ["我", "今天", "吃", "了", "一个", "很", "甜", "的", "苹果"] # 文档 3
    ]

    # 2. 实例化 BM25 模型，让它把书看完，脑子里记住各个词的权重
    bm25 = SimpleBM25(documents)

    # 3. 假设用户的搜索词是：“苹果 2025 财报”
    search_query = ["苹果", "2025", "财报"]

    # 4. 给每一篇文章打分
    print(f"搜索词: {search_query}\n" + "-"*30)
    scores = []
    for i in range(len(documents)):
        score = bm25.get_score(search_query, i)
        scores.append((i, score))
        print(f"文档 {i} 得分: {score:.4f}  | 内容: {''.join(documents[i])}")

    # 5. 把结果按照分数从高到低排序，排在最前面的就是最相关的！
    print("-" * 30)
    scores.sort(key=lambda x: x[1], reverse=True)
    best_doc_index = scores[0][0]
    print(f"🌟 最符合的文档是: 文档 {best_doc_index}，内容是: {''.join(documents[best_doc_index])}")

```

### 💡 给小白的补充提示：

上面的代码是为了让你看懂底层逻辑。在真正的大型项目开发中，程序员通常“不造轮子”。

如果你以后要在真实项目里用 BM25，Python 已经有一个写得非常成熟、速度极快的第三方库叫 `rank_bm25`。你只需要在命令行运行 `pip install rank_bm25`，然后写三四行代码就能直接调用它，效果和我们上面写的一样，但能处理几十万字的文章！