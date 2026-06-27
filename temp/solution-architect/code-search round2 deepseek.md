## Question & Requirement

代码搜索策略，作为solution architect，我需要针对某个新需求（这个需求的业务背景我也不熟悉），可能需要搜索50多个甚至更多的内部github repo，我已经把这些repo clone到本地，但是代码搜索效率，包括token花费都不理想。给我设计一个搜索策略，做一些预处理，结合grep或者其它工具，做一下提效

**补充要求**：

1. 尽量减少额外工具或者数据库的依赖，类似于entity graph尽量存成human readable的json或者其它格式
2. 如果可能，尽量使用JavaScript或者Python来完成任务，减少幻觉产生，规范输出
3. 我的目的不是改代码，不是100%准确，而是尽量从代码库找到业务需求相关的code logic和data flow



-------------

## Round2 Answer from DeepSeek

Round1 我讲了"搜不到怎么办"和"验证回路",Round2 前三位已经把索引、打分、骨架讲透了。我不重复,我补三个他们都没提、但 architect 在实际使用中会卡住的**"搜索之后"**的问题。

---

### 一、搜索之后：从"找到文件"到"理解数据流"

前三位都在讲"怎么搜",但 architect 真正的工作流是这样的:

> 搜到 5 个相关文件 → 看完 → 发现 5 个文件里引用了 3 个没见过的服务 → 继续搜 → 又发现 2 个 Kafka topic → 再搜 → 终于拼出完整数据流。

这个"搜 → 发现新线索 → 再搜 → 再发现"的循环,才是 architect 真实的时间黑洞。前三位给的 pipeline 只优化了第一轮搜索,但没优化后续的**线索追踪循环**。

落地建议:在 `search.py` 输出 Top 20 文件后,加一个**自动线索发现**步骤。规则不 hardcode,而是复用前面 GLM-5.2 的 `recipes.yaml` 配方表——线索发现本质上就是"用同一套配方再跑一遍 Top 文件,但这次只取下游引用"。配方表里加一个 `flow` 字段即可:

```yaml
# recipes.yaml 扩展:每个配方标注它是"入口"还是"出口"线索
- name: spring_kafka_consumer
  pattern: '@KafkaListener\(.*?topics\s*=\s*["\']([^"\']+)'
  type: kafka_consumer
  flow: in          # 数据流入——这是"谁在消费"

- name: spring_kafka_producer
  pattern: '(?:kafkaTemplate|KafkaProducer)\.send\(["\']([^"\']+)'
  type: kafka_producer
  flow: out         # 数据流出——这是"谁在生产"

- name: rest_call
  pattern: 'RestTemplate.*?(?:getFor|postFor)[^\(]*\(["\']([^"\']+)'
  type: downstream_api
  flow: out         # 调用外部——这是"下游依赖谁"

- name: feign_client
  pattern: '@FeignClient\(.*?name\s*=\s*["\']([^"\']+)'
  type: downstream_api
  flow: out
```

```python
# trace.py - 从 recipes.yaml 读取规则,不做 hardcode
def extract_clues(top_files, recipes):
    """对 Top 文件重跑配方,只取 flow=out 的出口线索"""
    clues = set()
    for f in top_files:
        text = Path(f).read_text(errors="ignore")
        for recipe in recipes:
            for m in re.finditer(recipe["pattern"], text):
                clues.add((recipe["flow"], recipe["type"], m.group(1), f))
    return clues  # 交给 LLM: "(flow=out, downstream_api, report-svc) 要继续追踪吗?"
```

这样加新框架只需改 `recipes.yaml`,不改代码。architect 接手一个 Go 项目,加几行 Go 配方就行,不用改 `trace.py`。

---

### 二、跨 repo 数据流追踪：用 jsonl 做轻量图遍历

前三位建的索引都是**单 repo 视角**。但 architect 最常问的是:

> "TradeCreated 这个 Kafka topic,哪些 repo 在生产、哪些在消费?"

这不是"搜代码"能直接回答的,因为生产者和消费者往往在不同 repo 里。你需要一个**跨 repo 的简单图**。

但不要建图数据库。从 `capabilities.jsonl` 里就能做——因为它已经按 `type` 分类了:

```bash
# 从 jsonl 中直接 grep 跨 repo 关系
# 谁在生产 TradeCreated topic?
rg '"type":"kafka_producer".*"value":"TradeCreated"' index/capabilities.jsonl

# 谁在消费 TradeCreated topic?
rg '"type":"kafka_consumer".*"value":"TradeCreated"' index/capabilities.jsonl

# TradeCreated 跟哪些表有关?(先搜 topic,再搜同文件里的 table)
# 用 jq 或 python 做个简单的两步关联
```

具体做法:在 `capabilities.jsonl` 里,对于每个 `type=kafka_*` 的记录,额外加一个 `flow` 字段:

```jsonl
{"repo": "order-svc", "type": "kafka_producer", "value": "TradeCreated", "flow": "out"}
{"repo": "pricing-svc", "type": "kafka_consumer", "value": "TradeCreated", "flow": "in"}
{"repo": "pricing-svc", "type": "api", "value": "POST /pricing", "flow": "in"}
{"repo": "pricing-svc", "type": "kafka_producer", "value": "PricingCompleted", "flow": "out"}
```

然后一个简单的 `rg` 就能画出跨 repo 数据流:

```
TradeCreated:  order-svc (out) → pricing-svc (in)
PricingCompleted:  pricing-svc (out) → report-svc (in)
```

**不需要图数据库,一个 jsonl + 一个 rg 就搞定了跨 repo 追踪**。前三位都在教你怎么建索引,但没告诉你索引建好之后怎么用——这就是用法。

---

### 三、80% 准确率的真实边界：三种会漏的场景及其兜底

前三位都说"80% 准确就够了",但没说这 20% 漏在哪儿。我从正则配方表的实际经验出发,列出三种最常漏的场景和兜底策略:

**漏场景 1:动态生成的代码**

Spring `@Configuration` 类里用 `@Bean` 注解动态创建的对象,正则配方完全抓不到。比如:

```java
@Bean
public KafkaTemplate<String, TradeEvent> tradeKafkaTemplate() {
    return new KafkaTemplate<>(producerFactory);
}
```

这里 `TradeEvent` 和 `KafkaTemplate` 都是业务关键词,但 `capabilities.jsonl` 里不会有。

兜底:在 `search.py` 的 Top 20 输出后,加一行提示:

```
[info] 2 of 20 files are @Configuration classes.
  → LLM cannot infer full data flow from annotations alone.
  → Consider running: rg "new KafkaTemplate" in these repos.
```

**不是让脚本自动修复,而是让脚本告诉 architect 这里可能有漏**。architect 再决定是否要手动查。

**漏场景 2:框架约定的路由**

NestJS 的 `@Controller('orders')` + `@Get(':id')` 组合出 `GET /orders/:id`,正则配方如果只匹配 `@Get`,会漏掉 Controller 前缀。Express 的 `router.get('/orders/:id', ...)` 写法更灵活。

兜底:配方表里加一个 `combine` 标记,标注哪些配方需要跟父级路径组合:

```yaml
- name: nestjs_route
  type: api
  pattern: '@(Get|Post|Put|Delete)\(["\']([^"\']+)'
  combine_with: parent_controller_path  # 提示脚本需要组合
```

**漏场景 3:外键和间接关联**

两个表通过 `trade_id` 关联,但 SQL 里没有 `FOREIGN KEY` 声明,正则配方只能抓到表名,抓不到关联关系。

兜底:这个不要用正则修。architect 在验证阶段,LLM 输出 Impact Map 后,如果提到"涉及表 X 和表 Y",再手动查一下 DDL 确认关联。属于 20% 不值得自动化的部分。

---

### 四、跟前面三位的关键差异

| 维度 | 前三位 Round2 | 我 Round2 |
|------|--------------|-----------|
| 优化目标 | 搜索效率 | **搜索之后:线索追踪循环** |
| 索引用法 | 怎么建索引 | **怎么用索引做跨 repo 图遍历** |
| 80% 准确率 | "够用了" | **具体列出三种漏的场景 + 兜底策略** |
| LLM 角色 | 关键词展开 + 最终分析 | 加一个:**筛选自动发现的线索,减少人工"搜→发现→再搜"循环** |

---

### 一句话总结

前三位教你"把 50 个 repo 的代码压成 20 个文件",我教你的是——**拿到这 20 个文件之后,怎么用 jsonl 里的 `type` 和 `flow` 字段,在 3 次 rg 内画出跨 repo 数据流,而不是再花一下午人肉追踪**。索引的价值不在建,在用。

