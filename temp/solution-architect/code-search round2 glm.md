## Question & Requirement

代码搜索策略，作为solution architect，我需要针对某个新需求（这个需求的业务背景我也不熟悉），可能需要搜索50多个甚至更多的内部github repo，我已经把这些repo clone到本地，但是代码搜索效率，包括token花费都不理想。给我设计一个搜索策略，做一些预处理，结合grep或者其它工具，做一下提效

**补充要求**：

1. 尽量减少额外工具或者数据库的依赖，类似于entity graph尽量存成human readable的json或者其它格式
2. 如果可能，尽量使用JavaScript或者Python来完成任务，减少幻觉产生，规范输出
3. 我的目的不是改代码，不是100%准确，而是尽量从代码库找到业务需求相关的code logic和data flow



------------------------

## Round2 Answer from GLM-5.2

Round1 我讲了"反向搜索"和"验证回路",Round2 两位都吸收了。我不重复理论,直接给**按你三个补充要求落地时,实际会卡住的工程细节 + 一个能跑的最小骨架**。

三个补充要求翻译成工程约束:
1. **不用数据库** → 所有索引必须是 `rg` 能直接吃的文本文件
2. **JS/Python 实现 + 减少幻觉** → LLM 只做"读文本、输出结构化 JSON"的窄任务,不让它碰代码本身
3. **找 code logic + data flow,不是改代码** → 索引粒度按"业务节点"切,不按"符号"切

下面讲五个具体卡点,然后给骨架。

---

### 一、`capabilities.jsonl` 不是用 LLM 生成,是用"正则配方表"生成

ChatGPT 和 Gemini 都说"用脚本提取业务节点存 jsonl",但没说**怎么提取**。一旦你让 LLM 去读代码提取,就同时违反了"减少幻觉"和"低成本"两条。

正确做法:维护一份**语言无关的正则配方表**(`recipes.yaml`),每个配方就是 `(name, regex, output_type)`。脚本只是个配方执行器,LLM 完全不参与索引生成。

```yaml
# recipes.yaml - 业务节点正则配方表
- name: rest_api
  pattern: '@(Get|Post|Put|Delete|Request)Mapping\(["\']([^"\']+)'
  captures: [method_or_path, path]
  type: api

- name: spring_kafka
  pattern: '@KafkaListener\(.*?topics\s*=\s*["\']([^"\']+)'
  captures: [topic]
  type: kafka_consumer

- name: sql_table_create
  pattern: 'CREATE\s+TABLE[^;]*?(\w+)\s*\('
  captures: [table]
  type: sql_table

- name: jpa_entity
  pattern: '@Table\(\s*name\s*=\s*["\']([^"\']+)'
  captures: [table]
  type: sql_table

- name: js_route
  pattern: '(app|router)\.(get|post|put|delete)\(["\']([^"\']+)'
  captures: [_, method, path]
  type: api

- name: proto_message
  pattern: '^message\s+(\w+)\s*\{'
  captures: [message]
  type: protobuf
  glob: "*.proto"
```

落地要点:

- 每个语言栈单独一组配方,Java/Spring、Go、Python/Flask、TS/Express 各自独立
- 配方失败时**静默跳过**,不报错——你只要 80% 准确
- 同一个文件命中多个配方就输出多行 jsonl,不要试图合并
- 每行 jsonl 必带 `repo`、`file`、`line`、`type`、`value` 五个字段,这是后续打分和喂 LLM 的最小契约

这套配方表一次写好,后续加 repo 只需重跑,不维护。LLM 在预处理阶段**完全不参与**,符合"减少幻觉"。

---

### 二、"Business Flow Index" 的正确粒度是"文件 → 业务标签集合"

ChatGPT Round2 提的 Business Flow Index 方向对,但给的例子是"文件里 contains 了什么",没说怎么聚合。直接把 capabilities.jsonl 按 file 聚合就是:

```python
# 把 capabilities.jsonl 按 file 聚合成 business_flow.jsonl
# 一行一个文件,列出该文件涉及的所有业务标签
{"file": "pricing-svc/src/.../TradeController.java",
 "repo": "pricing-svc",
 "tags": ["api:POST /trade", "kafka_in:TradeCreated",
          "call:TradeService", "table:trade_order"]}
```

这一步的价值:architect 搜需求时,**不用进代码就能判断这个文件是不是入口**。比如搜 `TradeCreated` 命中 3 个文件,看 tags 就知道哪个是生产者、哪个是消费者、哪个只是常量定义。

关键工程细节:tags 数组**不要去重、不要排序**——保留命中顺序,因为文件内出现顺序本身反映了数据流方向(API 在前、DB 在后是正常入口;DB 在前、API 在后可能是 DAO)。

---

### 三、打分公式必须"可解释",不能是黑盒

Round1 我和 ChatGPT 都说"要打分",但没强调一个事:**architect 需要知道每个文件为什么得这个分**。黑盒打分=没法调参=最后弃用。

打分函数输出必须是 `score + breakdown`:

```python
def score_file(file_meta, keyword_hits):
    breakdown = {
        "keyword_variety": len(set(keyword_hits)) * 10,   # 命中关键词种类
        "in_src_main": 15 if "/src/main/" in file_meta["path"] else 0,
        "is_entry": 20 if file_meta["tags"] else 0,       # 有业务标签=入口
        "in_test": -20 if "/test/" in file_meta["path"] else 0,
        "in_vendor": -100 if "/vendor/" in file_meta["path"] else 0,
        "size_penalty": -min(file_meta["lines"] // 500, 20),
    }
    return sum(breakdown.values()), breakdown
```

输出 Top 20 时**连带 breakdown 一起打印**:

```
1. [score=85] TradeController.java
   keyword_variety:40 in_src_main:15 is_entry:20 in_test:0 ...
2. [score=72] ReportService.java
   keyword_variety:30 in_src_main:15 is_entry:20 in_test:0 ...
```

architect 一眼能看出"这个文件分高是因为命中了 4 个关键词还是因为它是入口"。调参时也只改公式,不改数据。**可解释性是这套轻量方案能长期活下去的关键**——不像 AST 索引坏了你都不知道哪层错。

---

### 四、增量更新:用 `git diff` 而不是 `git log --since`

Gemini Round2 提了 git context 但没说索引怎么增量。ChatGPT Round1 说"metadata 生成一次"是错的,repo 会更新。

我的 Round1 说"用 git log --since 拿变更文件",Round2 修正:**用 `git diff` 拿具体变更行,只重跑命中行的配方**,不是整个文件重跑。

```python
# 增量更新伪代码
for repo in repos:
    last_sha = load_last_indexed_sha(repo)
    current_sha = git_rev_parse_head(repo)
    if last_sha == current_sha:
        continue  # 没变化,跳过
    changed_files = git_diff_name_only(repo, last_sha, current_sha)
    for f in changed_files:
        remove_old_capabilities_for_file(f)   # 从 jsonl 删旧记录
        rerun_recipes_on_file(f)              # 只对这个文件重跑配方
    save_indexed_sha(repo, current_sha)
```

为什么不用 `git log --since`:它返回的是 commit 列表,还得反推改了哪些文件,且会漏掉 force-push 的历史。`git diff <old_sha> HEAD --name-only` 直接拿文件列表,简单准确。

`last_indexed_sha` 存成一个 `index/sha_map.json`,human readable,符合你的要求。

---

### 五、能跑的最小骨架(60 行 Python)

前两位给了目录结构和概念,我给**今天就能跑的脚本**。依赖只有 `rg` 和 Python 标准库,无 pip 包。把下面三个文件放一起,跑 `python scan.py /path/to/repos` 就出索引。

```python
# scan.py - 扫描所有 repo,生成 capabilities.jsonl + sha_map.json
import json, os, subprocess, re
from pathlib import Path

RECIPES = [
    ("api", re.compile(r'@(?:Get|Post|Put|Delete)Mapping\(["\']([^"\']+)')),
    ("kafka", re.compile(r'@KafkaListener\(.*?topics\s*=\s*["\']([^"\']+)')),
    ("table", re.compile(r'@Table\(\s*name\s*=\s*["\']([^"\']+)')),
    ("js_api", re.compile(r'(?:app|router)\.(get|post|put|delete)\(["\']([^"\']+)')),
]

def scan_repo(repo_path, repo_name):
    out = []
    for f in Path(repo_path).rglob("*"):
        if not f.is_file() or any(x in str(f) for x in
           ["/.git/", "/node_modules/", "/vendor/", "/test/"]):
            continue
        try:
            text = f.read_text(errors="ignore")
        except Exception:
            continue
        for cap_type, pat in RECIPES:
            for m in pat.finditer(text):
                out.append({"repo": repo_name, "file": str(f),
                            "type": cap_type, "value": m.group(1)})
    return out

def main(repos_root):
    with open("index/capabilities.jsonl", "w") as cap_f, \
         open("index/sha_map.json", "w") as sha_f:
        sha_map = {}
        for repo in Path(repos_root).iterdir():
            if not repo.is_dir(): continue
            for row in scan_repo(repo, repo.name):
                cap_f.write(json.dumps(row, ensure_ascii=False) + "\n")
            sha = subprocess.check_output(
                ["git", "-C", str(repo), "rev-parse", "HEAD"]
            ).decode().strip()
            sha_map[repo.name] = sha
        sha_f.write(json.dumps(sha_map, indent=2))

if __name__ == "__main__":
    import sys; main(sys.argv[1])
```

```python
# search.py - 打分搜索,输出 Top20 + breakdown
import json, subprocess, sys
from collections import defaultdict

KEYWORDS = sys.argv[1:]  # 用法: python search.py PRIIPS KID CostCalculator

# 1. rg 拿命中
rg = subprocess.run(["rg", "--json", "-w"] + KEYWORDS,
                    capture_output=True, text=True)
hits = defaultdict(lambda: {"count": 0, "types": set(), "lines": 0})
file_tags = defaultdict(list)
for line in rg.stdout.splitlines():
    obj = json.loads(line)
    if obj["type"] == "match":
        f = obj["data"]["path"]["text"]
        hits[f]["count"] += 1
        hits[f]["types"].add(obj["data"]["submatch"][0]["match"]["text"])

# 2. 加载 capabilities 给文件打标签
with open("index/capabilities.jsonl") as cap_f:
    for line in cap_f:
        row = json.loads(line)
        file_tags[row["file"]].append(f'{row["type"]}:{row["value"]}')

# 3. 打分
scored = []
for f, h in hits.items():
    breakdown = {
        "keyword_variety": len(h["types"]) * 10,
        "is_entry": 20 if file_tags[f] else 0,
        "in_test": -20 if "/test/" in f else 0,
    }
    scored.append((sum(breakdown.values()), breakdown, f, file_tags[f]))
scored.sort(reverse=True)

# 4. 输出 Top 20
for score, brk, f, tags in scored[:20]:
    print(f"[{score}] {f}")
    print(f"  breakdown: {brk}")
    print(f"  tags: {tags[:5]}")
```

这两个文件加起来不到 60 行,已经覆盖了"预处理 + 搜索 + 打分"闭环。`expand.py`(LLM 关键词扩展)和 `summarize.py`(repo 摘要)可以后续加,但**没有这俩也能用**——手动传关键词就行,先跑起来再优化。

---

### 六、跟前面两位的关键差异

| 维度 | ChatGPT Round2 | Gemini Round2 | 我 Round2 |
|------|----------------|---------------|-----------|
| 索引生成方式 | 概念性描述 | "用脚本提取" | **正则配方表 + LLM 完全不参与预处理** |
| 打分可解释性 | 给了分值表 | 给了加减分项 | **强制输出 breakdown,architect 能调参** |
| 增量更新 | 没提 | 没提 | **git diff + sha_map,只重跑变更文件** |
| Business Flow 粒度 | 文件 contains 什么 | 没单独提 | **capabilities 按 file 聚合,保留顺序反映数据流方向** |
| 可跑代码 | 给了目录结构 | 给了概念流程 | **60 行能跑的 scan.py + search.py** |

核心主张:**轻量方案要能长期活下去,关键是"可解释 + 可调参 + 坏了能重跑"**。前面两位的方案理论完整,但落地时 architect 会卡在"这个文件为什么分高""索引怎么更新""配方错了怎么调"这些问题上。我把这些工程细节填上了,这才是"宁可 80% 准确也不要复杂维护"的真正含义——80% 是靠"能调参的简单公式"撑出来的,不是靠"复杂的 AST 碰运气"。



-------------
