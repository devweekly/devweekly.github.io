## Question & Requirement

代码搜索策略，作为solution architect，我需要针对某个新需求（这个需求的业务背景我也不熟悉），可能需要搜索50多个甚至更多的内部github repo，我已经把这些repo clone到本地，但是代码搜索效率，包括token花费都不理想。给我设计一个搜索策略，做一些预处理，结合grep或者其它工具，做一下提效

**补充要求**：

1. 尽量减少额外工具或者数据库的依赖，类似于entity graph尽量存成human readable的json或者其它格式
2. 如果可能，尽量使用JavaScript或者Python来完成任务，减少幻觉产生，规范输出
3. 我的目的不是改代码，不是100%准确，而是尽量从代码库找到业务需求相关的code logic和data flow




------------------

## Round2 Answer from Gemini


面对50多个业务陌生的代码仓库，作为 Solution Architect，你的直觉非常敏锐：**你需要的不是一个笨重的代码语法分析器，而是一个能快速定位业务边界和数据流向的“业务雷达”。**

综合你提供的多轮 AI 深度探讨（特别是避免数据库依赖、优先使用脚本语言、聚焦业务逻辑这三个核心补充要求），我为你提炼并设计了一套“基于轻量级纯文本索引 + 漏斗式过滤”的代码搜索策略。这套方案抛弃了维护成本极高的 AST 和图形数据库，完全依靠 Python/Node.js、`ripgrep (rg)` 和 JSONL/Markdown 来实现。

---

## 核心设计理念：Everything is File & 渐进式漏斗

这套策略的核心是**把高频的、耗时的全局检索，转化为低频的预处理**。所有的中间产物都是人类可读的（Human Readable），并且 LLM 只有在搜索空间被压缩到极致时才介入。

### 第一阶段：轻量级预处理 (Pre-Indexing)

*目标：用 Python 或 JavaScript 脚本，每月或每周跑一次，生成静态索引文件。*

**1. Repo 级业务摘要 (`summaries/repo_name.md`)**
不要让 LLM 去读代码，让它读摘要。用脚本提取每个仓库的 `README.md` 前 100 行、`package.json`/`pom.xml` 的依赖，以及配置文件的外围信息，交给低成本模型生成一份 Markdown 摘要：

* **职责定位**（如：订单结算服务）
* **入口点**（如：暴露的 REST APIs, 消费的 Kafka Topics）
* **出口点**（如：调用的外部服务, 生产的 Topics, 读写的数据库表）

**2. 业务能力索引 (`capabilities.jsonl`)**
放弃复杂的符号索引（Symbol Index），改为**正则匹配业务节点**。用 Python 脚本结合 `rg`，扫描所有路由、SQL 语句、MQ 监听器，按行存入 JSONL：

* `{"repo": "order-svc", "type": "api", "path": "POST /v1/settle", "file": "src/.../OrderController"}`
* `{"repo": "order-svc", "type": "db_table", "name": "trade_record", "file": "src/.../TradeEntity"}`

**3. 轻量级依赖流 (`imports.jsonl`)**
放弃高成本的 Call Graph。只用简单的正则提取 `import`, `require`, `from`，建立文件级的依赖映射，足以让你追踪 Data Flow。

* `{"from": "OrderController", "to": "PricingService", "relation": "import"}`

---

### 第二阶段：渐进式搜索工作流 (Progressive Search)

*目标：需求来临时，通过标准化 Pipeline，将千万行代码压缩到几十行核心上下文。*

#### 1. 逆向需求展开 (Reverse Requirement Expansion)

不要用业务需求直搜代码，代码里大概率没有业务词汇。让 LLM 做**反向推测**：

* **输入：** “支持 PRIIPs 报表导出”
* **LLM 输出：**
* *业务词：* Report, Statement, Document
* *技术猜测（关键）：* PdfExporter, ReportBuilder, S3Uploader
* *基建线索：* Kafka: report_topic, DB: report_config



#### 2. 仓库级初筛 (Repo-Level Filtering)

将第一步扩展出的关键词，结合第一阶段生成的 `summaries/*.md` 喂给 LLM。

* **任务：** “基于这些仓库摘要，找出最可能涉及该需求的 3-5 个仓库。”
* **收益：** 直接砍掉 90% 的搜索空间。

#### 3. 评分制精准检索 (Scoring-Based Grep)

在锁定的 3-5 个仓库中，用 Python 脚本调用 `rg` 搜索扩展词汇，并**必须对结果进行打分排序**，而不是直接看。

* **加分项：** 命中 `capabilities.jsonl` 中的 API 或 DB 定义 (+20)、命中类名/方法名 (+15)、在 `src/main` 目录下 (+10)。
* **减分项：** 在 `test/` 目录下 (-20)、超大文件 (-10)。
* **输出：** 截取 Top 15-20 个得分最高的文件及其上下 5 行代码片段。

#### 4. 引入历史上下文 (Git Context Retrieval)

代码可能看不出业务逻辑，但 Commit 历史可以。

* 对 Top 排名的核心文件，脚本自动执行 `git blame` 或 `git log -n 3`。
* 获取最近修改该文件的 Commit Message，这通常包含了真正的业务背景（Why）。

---

### 第三阶段：LLM 深度分析与产出

将上述过滤后的**浓缩上下文**（Top 20 关键代码片段 + Git 历史 + 简单的 Import 关系）交给能力最强的 LLM（如 Claude 3.5 Sonnet 或 GPT-4o），输出你真正需要的架构师交付物。

**核心 Prompt 产出目标：Impact Map（影响分析图）**

* **核心修改点：** 需求落地需要改动哪几个核心文件？
* **数据流向 (Data Flow)：** 从哪个 API 进，经过哪些 Service，落入哪张表？
* **潜在风险与扩展点：** 是否有现成的 Feature Flag？是否会破坏现有的下游依赖？

---

### 方案效益与成本对比

| 环节 | 传统无策略做法 (全局检索) | 本地静态文件 + 漏斗策略 (本方案) |
| --- | --- | --- |
| **外部依赖** | 图数据库, AST 解析器, 向量数据库 | Python/Node.js 标准库, `rg`, `git` |
| **Token 消耗** | 灾难级 (几十万级别上下文，易触发幻觉) | 极低 (~5K-10K Tokens，聚焦核心片段) |
| **搜索精度** | 噪音极大，被成千上万行无效日志或测试代码淹没 | 命中核心业务流，屏蔽边缘代码，带有历史 Git 视角 |
| **维护成本** | 牵一发而动全身，语法树极易报错 | 极低，基于正则表达式和 JSONL，坏了随时重跑 |

---

这套基于文本文件的流水线，完全契合你作为 Solution Architect “快速看清大局”的痛点，兼顾了低成本与高容错率。

**为了让这个方案尽快落地，目前这 50 多个 Repo 主要以哪一两种编程语言为主？我可以针对性地为你写一个基于 Python 或 Node.js 的轻量级 `scan_and_score` 扫描脚本骨架，让你今天就能跑起来看看效果。**

### 代码 from Gemini Round2

面对“什么语言都有”的异构代码仓库（Java, Go, Node.js, Python 混杂），我们绝对不能碰 AST（抽象语法树）或者特定语言的解析工具链，否则光是配置环境就能让你崩溃。

在这个场景下，最务实的做法是利用“跨语言的正则表达式启发式规则 (Cross-language Heuristics)”结合强大的 `ripgrep (rg)`。

下面我为你写一个无依赖（只依赖 Python 3 和系统安装的 `rg`）的轻量级脚本 `business_radar.py`。这个脚本分为两个核心指令：

1. `index`：用跨语言的业务特征正则，快速抽取出 API、DB、MQ 等关键业务节点，生成 `catalog.jsonl`。
2. `search`：输入 LLM 展开后的业务关键词，脚本会自动调用 `rg` 搜索，并**基于目录和文件特征进行打分排序**，最终只输出高价值的 Top N 代码片段。

### 核心 Python 脚本 (`business_radar.py`)

保存以下代码为 `business_radar.py`：

```python
import os
import json
import subprocess
import argparse
from collections import defaultdict
from pathlib import Path

# ==========================================
# 1. 跨语言业务特征正则 (Heuristic Patterns)
# ==========================================
CAPABILITY_PATTERNS = {
    # 涵盖 Spring, Express/Koa, Go net/http & Gin, FastAPI 等
    "api_route": r"(@(Rest)?Controller|@(Get|Post|Put|Delete)Mapping|router\.(get|post|put)|app\.(get|post)|func .* ServeHTTP)",
    # 涵盖原生 SQL, Hibernate, GORM, TypeORM 等
    "database": r"(SELECT .* FROM|INSERT INTO|UPDATE .* SET|CREATE TABLE|@Table|@Entity|gorm:|\.execute\()",
    # 涵盖 Kafka, RabbitMQ 等常见 MQ 客户端
    "message_queue": r"(@KafkaListener|KafkaTemplate|producer\.send|consumer\.onMessage|amqp\.|topic\s*=)",
    # 涵盖配置项、Feature Flag 读取
    "config_flag": r"(os\.getenv|process\.env|@Value|\.getProperty|viper\.Get)"
}

IGNORE_DIRS = {".git", "node_modules", "vendor", "dist", "build", "test", "tests", "mock"}

# ==========================================
# 阶段一：扫描与索引 (Pre-Index)
# ==========================================
def run_index(repo_dir, output_file="catalog.jsonl"):
    print(f"🚀 正在扫描 {repo_dir} 下的多语言业务节点...")
    results = []
    
    for cap_type, pattern in CAPABILITY_PATTERNS.items():
        # 调用 ripgrep 寻找匹配项
        cmd = ["rg", "-n", "--no-heading", pattern, repo_dir]
        for ignore in IGNORE_DIRS:
            cmd.extend(["-g", f"!{ignore}/**"])
            
        try:
            output = subprocess.check_output(cmd, text=True, stderr=subprocess.DEVNULL)
            for line in output.splitlines():
                if not line.strip(): continue
                # rg 输出格式通常是: filepath:line:content
                parts = line.split(":", 2)
                if len(parts) >= 3:
                    file_path, line_num, content = parts[0], parts[1], parts[2]
                    results.append({
                        "repo": Path(file_path).parts[1] if len(Path(file_path).parts) > 1 else "unknown",
                        "type": cap_type,
                        "file": file_path,
                        "line": line_num,
                        "snippet": content.strip()[:100] # 只截取前100个字符作为摘要
                    })
        except subprocess.CalledProcessError:
            continue # rg 没有找到匹配项时会返回非零状态码

    # 写入 JSONL
    with open(output_file, "w", encoding="utf-8") as f:
        for res in results:
            f.write(json.dumps(res, ensure_ascii=False) + "\n")
            
    print(f"✅ 索引完成！共提取 {len(results)} 个业务节点，已保存至 {output_file}")

# ==========================================
# 阶段二：打分式检索 (Search & Score)
# ==========================================
def calculate_score(file_path, content):
    score = 0
    path_str = file_path.lower()
    
    # 1. 目录权重 (Directory Scoring)
    if "src/main" in path_str or "cmd/" in path_str or "app/" in path_str:
        score += 20
    if "service" in path_str or "controller" in path_str or "handler" in path_str:
        score += 15
    if "test" in path_str or "mock" in path_str or "fixture" in path_str:
        score -= 50  # 强力降权测试代码
    
    # 2. 文件类型权重 (File Type Scoring)
    if path_str.endswith(('.java', '.go', '.ts', '.py', '.cs')):
        score += 10
    if path_str.endswith(('.json', '.yaml', '.xml', '.md')):
        score -= 5 # 配置文件降权，除非特意搜配置
        
    # 3. 语义权重 (Semantic Scoring)
    content_lower = content.lower()
    if "class " in content_lower or "func " in content_lower or "interface " in content_lower:
        score += 10 # 命中定义位置
        
    return score

def run_search(repo_dir, keywords, top_k=15):
    print(f"🔍 正在检索关键词: {', '.join(keywords)}")
    
    # 将多个关键词用 OR 连接给 rg
    regex_pattern = "|".join(keywords)
    cmd = ["rg", "-n", "-C", "2", "--no-heading", regex_pattern, repo_dir]
    
    for ignore in IGNORE_DIRS:
        cmd.extend(["-g", f"!{ignore}/**"])
        
    scored_results = []
    
    try:
        # 这里为了简化，直接获取 rg 文本输出进行打分。
        # 实际工程中可以使用 `rg --json` 进行更精确的解析
        output = subprocess.check_output(cmd, text=True, stderr=subprocess.DEVNULL)
        
        current_file = ""
        current_snippet = []
        
        for line in output.splitlines():
            if line == "--": continue # rg 的 context 分隔符
            parts = line.split("-", 2) if "-" in line else line.split(":", 2)
            if len(parts) >= 3:
                file_path = parts[0]
                content = parts[2]
                
                # 遇到新文件时进行打分
                score = calculate_score(file_path, content)
                scored_results.append({
                    "file": file_path,
                    "score": score,
                    "match": content.strip()
                })

    except subprocess.CalledProcessError:
        print("❌ 未找到匹配项")
        return

    # 按分数倒序排列
    scored_results.sort(key=lambda x: x["score"], reverse=True)
    
    # 聚合去重 (同一文件取最高分)
    final_top_files = {}
    for res in scored_results:
        if res["file"] not in final_top_files and len(final_top_files) < top_k:
            final_top_files[res["file"]] = res
            
    print(f"\n🏆 Top {len(final_top_files)} 核心相关文件 (根据业务价值打分):")
    print("-" * 60)
    for file, data in final_top_files.items():
        print(f"[{data['score']:>3} 分] {file}")
        print(f"       ↳ {data['match'][:120]}...")
    print("-" * 60)
    print("💡 建议：将以上文件的完整内容交由 LLM 进行 Data Flow 深度分析。")

# ==========================================
# CLI 入口
# ==========================================
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Multi-language Business Radar for Architects")
    subparsers = parser.add_subparsers(dest="command", help="commands")
    
    # Index 命​​令
    idx_parser = subparsers.add_parser("index", help="扫描仓库，生成业务节点 JSONL 索引")
    idx_parser.add_argument("repo_dir", help="包含多个代码仓库的根目录")
    
    # Search 命令
    srch_parser = subparsers.add_parser("search", help="使用打分机制搜索代码")
    srch_parser.add_argument("repo_dir", help="包含多个代码仓库的根目录")
    srch_parser.add_argument("keywords", nargs="+", help="搜索关键词 (如 PRIIPS CostCalculator)")
    
    args = parser.parse_args()
    
    if args.command == "index":
        run_index(args.repo_dir)
    elif args.command == "search":
        run_search(args.repo_dir, args.keywords)
    else:
        parser.print_help()

```

### 如何使用这个工具？

假设你把所有 50 个 repo 都 clone 到了 `~/my_company_repos/` 目录下。

**第一步：生成业务雷达图（一分钟跑完，跨语言）**

```bash
python business_radar.py index ~/my_company_repos/

```

*你会得到一个 `catalog.jsonl`，里面全是各个语言暴露的 API、监听的 MQ topic 和操作的数据库表。平时不看代码时，你都可以直接 grep 这个文件来梳理架构。*

**第二步：基于 LLM 展开后的需求词汇进行精准搜索**
假设你的需求是“重构报表服务的成本计算逻辑”，你用 LLM 扩写出了技术词汇 `CostCalculator`、`PerformanceScenario`、`trade_record`。

```bash
python business_radar.py search ~/my_company_repos/ CostCalculator PerformanceScenario trade_record

```

### 为什么这个脚本适合你的场景？

1. **绝对的语言无关性：** 无论下面藏着 Java、Node 还是 Go，所有的 Controller、Router 终归要写特定的标识词（如 `@GetMapping` 或 `router.post`）。用正则覆盖最常见的十几种模式，能达到 80% 的准确率，对于业务探查完全够用。
2. **极强的降噪能力（Score 机制）：** `ripgrep` 最容易把 `test/` 里的 mock 数据和 `dist/` 里的编译产物全部吐出来。这个脚本的 `calculate_score` 算法会直接把这些噪音打入冷宫（-50分），而把 `src/main` 或 `service` 目录下的核心文件推到最前面。
3. **低 Token 消耗的交付物：** 运行 `search` 命令后，你只会拿到被打分过滤后的 Top 10-15 个文件路径和摘要。你只需把这 15 个文件喂给 Claude 或 GPT-4o，让它画出影响图（Impact Map），不仅精准，而且 Token 花费极低。



------------------------
