# Personal Preference Model — staged reference implementation

这是文章“从简单规则到模型训练”对应的可运行 Python 示例。它演示如何把明确规则、自然语言反馈、A/B 选择和当前任务上下文组织成一个有证据链的 User Model。

实现采用 Python 3.11+ 和标准库，不依赖 LangChain、LangGraph、数据库服务器或外部模型。它先用 SQLite 做本地 System of Record，并提供 OpenAI-compatible LLM adapter。Jev 如果使用不同 SDK，只需实现 JsonCompletionClient 接口即可接入。

## 目录结构

~~~text
personal-preference-model/
  pyproject.toml
  src/personal_preference_model/
    __init__.py
    types.py
    store.py
    interpreter.py
    learner.py
    active_learning.py
    validation.py
    resolver.py
    demo.py
  tests/
    test_pipeline.py
~~~

## 快速运行

~~~bash
cd temp/personal-preference-model
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
python -m personal_preference_model.demo
python -m unittest discover -s tests -v
~~~

默认数据库和 JSON 模型权重写到系统临时目录，不会把用户数据写进仓库。Demo 将目标用户最后两个 A/B 样本留作小型 hold-out，仅展示评估流程；由于样本极少且全部为合成数据，输出准确率不具备统计意义，不能把演示权重当作任何真实用户的画像。

## 分阶段实现

### Stage 1 — Explicit rules + evidence store

对应文件：types.py、store.py、resolver.py。

- 用户明确要求成为 source_kind=explicit 的 Preference Claim。
- 每个 Claim 带 user_id、dimension、scope、confidence、strength 和有效时间。
- Interaction Event 是独立记录，原始反馈不被模型总结覆盖。
- 新 Claim 形成新 revision，旧 Claim 标记 superseded，保留历史。
- Resolver 对用户、任务、项目、文体、文本类型和时间进行确定性检查。

这一阶段不需要 LLM，也不需要向量数据库。它先保证明确指令不会丢失、不同用户不会串数据、项目偏好不会泄漏到其他项目。

### Stage 2 — LLM / Jev semantic feedback extraction

对应文件：interpreter.py。

LLM 把自然语言反馈转成候选 Preference Evidence，包括维度、倾向方向、候选适用范围和解释。Evidence 只是候选证据，并不自动修改长期 Claim。EvidencePromotionPolicy 再按置信度、偏好方向和上下文范围执行确定性门禁；弱证据或无 scope 的推断只保留为 evidence，不升级为长期 Claim。

离线默认使用 DemoInterpreter。需要接入模型时，可使用 OpenAI-compatible endpoint：

~~~bash
export PREFERENCE_LLM_ENDPOINT="https://your-jev-compatible-endpoint/v1/chat/completions"
export PREFERENCE_LLM_MODEL="your-model-name"
export PREFERENCE_LLM_API_KEY="your-api-key"
python -m personal_preference_model.demo --use-llm
~~~

这里假定你的 Jev 服务兼容 Chat Completions 的请求和返回格式。若不是，写一个类实现 JsonCompletionClient.complete_json()，把其 SDK / SmartFunc 调用封装起来即可；不要把 Jev 供应商 API 写进 User Model 核心层。

CandidateFeatureExtractor 可用同一 JSON client 评估原文与候选译文，输出 0–1 的近似特征。LLM 的特征分值不是客观质量标签，需要用人工偏好样本检查和校准。

### Stage 3 — Classic ML: pairwise preference learning

对应文件：learner.py。

PairwisePreferenceModel 是一个简单的 Bradley–Terry / Logistic 成对比较模型。Demo 会先使用三组虚构 reference users 建立 population prior，再用 demo 用户的独立样本学习 user delta；这些虚构样本仅演示层次结构，不能用于推断真实用户偏好。

- population weights 从所有训练样本学习；
- user delta 从单用户样本学习，并用 L2 正则向 population prior 收缩；
- context interaction 将 text_type、genre、task_type 等上下文与文本特征组合；
- predict 返回 A/B 选择概率、置信度代理值和用户样本数。
- save/load 将 population prior 和 user-specific deltas 序列化为 JSON，支持进程重启后的推理。
- evaluate_pairwise_accuracy 用独立留出样本检查选择准确率；不要在训练数据上报告它作为泛化成绩。
- save/load 将 population prior 和 user-specific deltas 序列化为 JSON，支持进程重启后的推理。
- evaluate_pairwise_accuracy 用独立留出样本检查选择准确率；不要在训练数据上报告它作为泛化成绩。

这不是完整 Bayesian posterior，也不应把 confidence_proxy 当作校准概率。正式系统需要按作品和时间分割训练/测试集，检查概率校准、样本覆盖与跨场景泛化。

PairwiseSample 应保存同一源文的两个候选、候选特征、当前任务上下文和用户选择。不能将“用户没有修改”伪装为 A/B 正向反馈。

### Stage 4 — Preference Resolver

对应文件：resolver.py。

Resolver 将三类输入分开处理：

1. 规则：显式覆盖、Claim 状态、时间有效性和 scope。
2. 统计模型：当前上下文下用户更可能选择哪个候选。
3. 证据：Claim 支持和反驳它的原始 Event IDs。

输出包含 applied、excluded、uncertain、pairwise_estimate 和 active_question。被检索到但不适用的偏好会列入 excluded，并给出原因。

当前示例将规则检查作为确定性门禁；统计模型只估计候选偏好，不直接覆盖硬规则。生产系统应增加冲突等级和可配置策略，而不是把三个分数简单平均。

### Stage 5 — Active Preference Learning

对应文件：active_learning.py。

当预测接近 0.5、任务影响高、用户数据少时，系统可以生成一个 A/B 问题；任务影响低或模型已有足够区分度时则不打扰用户。这里使用简化阈值策略，正式系统可以替换为 Bayesian Active Learning / Expected Information Gain。



### Stage 6 — Personal Adapter / Transformer fine-tuning（意图上保留，暂不提供伪训练脚本）

本参考项目没有用合成 Demo 数据训练 LoRA、Transformer 或个人 Reward Model。那样会造成一个错误印象：仿佛几条模拟 A/B 样本就足以训练出真实的个人审美模型。

只有在真实反馈量、跨作品覆盖和独立测试样本足够时，才应增加这一阶段。进入 Stage 6 前，至少需要：

- 一个已经稳定的偏好维度体系和上下文 Schema；
- 用户真实选择、理由和修改所形成的高质量训练记录；
- 按作品、时间和文本类型进行隔离的 train / validation / test；
- 对比 Rule-only、LLM + Profile、Retrieved Examples 和 Classic ML 的基线；
- 对生成输出做用户 A/B 评估，而不是只看 Reward Model 的离线排序准确率。

优先训练共享 Preference Encoder / Reward Feature 或轻量 Adapter，再用少量目标用户数据进行校正；不建议从零训练单用户 Transformer。跨用户样本可以学习群体先验，但不能简单视为目标用户的负样本。

2026 年相关研究给出了可扩展方向：CAPE 可将冷启动提问升级为群体先验 + Bayesian Adaptive Questioning；PLUS / POPI 可学习如何形成用户摘要；C-BPO 可从跨用户二元反馈学习个人差异。它们是进一步的研究实现，不是本仓库当前代码已经复现的算法。


## 完整链路

~~~mermaid
flowchart TB
    A["Explicit rule / rating / A-B choice / rewrite"] --> B["Immutable Event Store"]
    B --> C["Jev / LLM evidence extraction"]
    C --> D["Evidence validation"]
    D --> E["Versioned Preference Claims"]
    F["Task context"] --> G["Scope and time resolver"]
    E --> G
    H["Pairwise comparison events"] --> I["Bradley-Terry learner"]
    I --> J["User-specific preference estimate"]
    G --> K["Preference Snapshot"]
    J --> K
    K --> L{"Enough evidence?"}
    L -->|"Yes"| M["Apply relevant preferences"]
    L -->|"No"| N["Ask a targeted A/B question"]
    M --> O["User feedback"]
    N --> O
    O --> B
~~~

## 运行输出的关键字段

- applied：本次任务实际采用的偏好和证据。
- excluded：被排除的偏好及原因，例如 SCOPE_MISMATCH、CURRENT_EXPLICIT_OVERRIDE、STALE_OR_NOT_YET_VALID。
- uncertain：证据不足或置信度低的 Claim。
- pairwise_estimate：统计偏好模型的候选选择估计。
- active_question：是否应该主动询问用户。

## 当前代码覆盖范围

当前仓库提供 Stage 1–5 的可运行参考实现：证据存储、LLM/Jev 语义提取、Evidence Promotion Gate、层次 Bradley–Terry、权重保存/加载、留出样本评估、Resolver 和阈值式主动询问。Stage 6 仅定义了进入条件和技术方向，不包含用合成数据伪训练的 Transformer / LoRA 脚本。当前单元测试文件包含 14 个 unittest 用例；仓库另有 GitHub Actions 工作流自动运行该测试命令。

## 生产化边界

这个参考项目重点是完整的领域逻辑闭环，不是完整的线上服务。正式部署前还需补充：

- PostgreSQL、事务隔离、租户/RLS 和数据删除策略；
- LLM 输出 Schema 校验、超时、重试、审计、Prompt/模型版本；
- 生产认证、授权、租户隔离/RLS 与数据保留；本地示例已加入 Event、Evidence、Claim 的同用户归属校验；
- Claim 更新审批策略和冲突检测；
- 独立验证集、按作品/时间切分、概率校准和误用率监控；
- 任务侧完整的 Preference Snapshot 冻结与版本绑定；
- Jev 特定适配器及对应集成测试。

不要用合成 Demo 样本训练真实用户模型。真实用户的偏好样本必须来自明确的评分、比较、修改或经过解释的交互反馈。
