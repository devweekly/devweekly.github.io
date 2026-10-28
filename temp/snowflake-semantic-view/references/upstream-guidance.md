# 上游 Snowflake Semantic View Skills 与 Guidance 调研

调研日期：2026-10-28

本文记录与本目录 `semantic-view-generator` Skill 相关的公开 GitHub 资料，区分 Snowflake 官方维护的资源、Snowflake Labs 示例和社区实现。外部 Skill 是参考实现，不应未经审查直接复制或视为 Snowflake 产品承诺。

## 结论

我们的方案方向是合理的：业务设计文档 + 真实元数据快照 + 显式审批的 mapping manifest + 生成 YAML + 脚本检查 + Snowflake verify-only + 数据/业务回归。上游资源提供了几项值得补强的内容：

1. 不要只检查物理表列是否存在；还要验证关系键、连接基数、事实表粒度和多事实表 fan trap。
2. 为 Semantic View 建立已知问题与可信 SQL 的回归集；对关键自然语言问题比较生成 SQL 和可信 SQL 的结果，不能只测 YAML 能否部署。
3. 生成前优先读取目标环境已有 Semantic View / YAML，修改现有模型时做最小 diff，避免覆盖不相关定义。
4. 把验证与部署分开。先用 `SYSTEM$CREATE_SEMANTIC_VIEW_FROM_YAML(..., TRUE)` verify-only，再部署到隔离开发环境，运行真实查询和回归，经过审批后才能晋级。
5. 业务描述、同义词、指标定义、过滤器和关系都是语义质量的一部分。不能因为物理列存在就自动把它纳入语义模型。
6. 权限策略必须由 Snowflake 的数据层强制执行，不能依赖 LLM Prompt 或语义层指令作为安全边界。

## 重点上游资源

### 1. Snowflake Labs：semantic-view-patterns（优先参考）

仓库：<https://github.com/Snowflake-Labs/coco-skills>

Skill：<https://github.com/Snowflake-Labs/coco-skills/blob/main/skills/semantic-view-patterns/SKILL.md>

该 Skill 面向 Semantic View 建模，提供 25 类模式，每种模式有带注释的 DDL/YAML、种子数据和可执行查询。值得参考的模式包括：

- `multi_fact_table`、`fact_as_relationship_key`：多事实表和关系键设计。
- `semi_additive_metric`、`window_metrics`、`derived_metrics`、`time_intelligence`：指标聚合、时间和派生指标语义。
- `range_join`、`asof_join`、`role_playing_dimensions`、`accumulating_snapshot`：复杂关系与时间有效性模式。
- `sv_diagnostics`、`system_explain_semantic_query`：诊断与查询解释。
- `row_access_policies`、`caller_rights`：安全和执行身份相关模式；部分示例要求高权限，不能直接在生产环境照搬。

它的 Apply Workflow 先把模式角色映射到用户的实际列，再生成适配结果；明确提醒错误的关系基数会膨胀指标，两个事实表通过共享维度连接时可能产生 fan trap，并要求用行数核对。这与本项目的 mapping manifest 非常契合。

**采纳方式：**不复制整套 Skill 或示例数据；将这些模式整理为本项目的审查清单和后续测试用例。只有在确实遇到相应关系或指标需求时才引入模式，避免为了覆盖模式而过度建模。

### 2. Snowflake Labs：coco-skills 仓库与 Skill 开发规范

仓库：<https://github.com/Snowflake-Labs/coco-skills>

贡献与格式指南：<https://github.com/Snowflake-Labs/coco-skills/blob/main/CONTRIBUTING.md>

可借鉴的 Skill 工程实践：

- 一个 Skill 只负责一个明确能力，触发条件要具体。
- 把细节放入 `references/`，主 `SKILL.md` 负责流程路由和硬约束。
- 明确记录工具调用方式、输入输出、边界情况和可运行示例。
- 发布前检查格式、公共网络上是否已有重复能力、数据政策和范围重叠，并用具体案例测试行为。

本项目可以保留独立的 Semantic View Generator Skill，并将官方规范、关系/指标模式、验证和常见失败整理到 references，而不是无限膨胀主文件。

### 3. Snowflake Labs：Semantic Model Generator（历史资源，谨慎参考）

仓库：<https://github.com/Snowflake-Labs/semantic-model-generator>

仓库 README 明确说明：旧的 Streamlit Semantic Model Generator 已被 Snowsight 中原生的 Cortex Analyst Semantic View Generator 替代，建议新工作流使用原生生成器。因此不应把旧工具当成当前推荐部署方案。

它仍有可借鉴的生成原则：自动生成的模型只是最小初稿；生成后要补充业务上下文、清理无关列，并人工确认自动生成的描述。项目还会标出需要填写的业务信息。这支持本项目的观点：自动生成不能代替业务定义和人工审批。

### 4. 社区 Skill：snowflake-semantic-view-skill（补充参考，非官方）

仓库：<https://github.com/MiguelElGallo/snowflake-semantic-view-skill>

Skill：<https://github.com/MiguelElGallo/snowflake-semantic-view-skill/blob/main/.github/skills/snowflake-semantic-views/SKILL.md>

该实现补充了实用的工作流：创建新模型时优先考虑 FastGen（仅在目标账号支持时）；编辑现有模型前先读取当前定义；YAML 变更使用 verify-only；部署后运行 Semantic View 查询；有 Verified Query Repository（VQR）时做编译和结果等价检查。它也建议优先使用明确的语义元素，再考虑宽泛的 AI SQL generation instructions。

这是社区项目，不是 Snowflake 官方承诺。采用前应逐项与当前官方文档和目标账号的功能支持情况核对；尤其不要把第三方脚本、CLI 参数或功能可用性当成所有账号都适用。

### 5. Snowflake Labs：sfguides

仓库：<https://github.com/Snowflake-Labs/sfguides>

Cortex Agents 教程示例：<https://github.com/Snowflake-Labs/sfguides/tree/main/cortex-agents-tutorial>

它展示了 Skill 主文件配合 `references/` 深入材料的组织方式，以及分步骤执行、检查环境、解释结果和最后验证的教学流程。对本项目而言，最值得借鉴的是把验证步骤做成可复现的操作清单；教程中可能使用较高权限的示例设置，不应照搬其权限要求到日常生成流程。

## 官方文档基线

以下文档应作为语法与产品行为的最终依据，而不是任何第三方 Skill：

- YAML 规范：<https://docs.snowflake.com/en/user-guide/views-semantic/semantic-view-yaml-spec>
- 建模最佳实践：<https://docs.snowflake.com/en/user-guide/views-semantic/best-practices-modeling>
- 开发与部署最佳实践：<https://docs.snowflake.com/en/user-guide/views-semantic/best-practices-dev>
- 从 Semantic View 读取 YAML：<https://docs.snowflake.com/en/sql-reference/functions/system_read_yaml_from_semantic_view>
- 从 YAML 创建/验证 Semantic View：<https://docs.snowflake.com/en/sql-reference/stored-procedures/system_create_semantic_view_from_yaml>

官方建模指南强调以业务用户和业务领域组织语义模型，只纳入真正用于业务查询的列，写清描述、同义词、关系、指标与过滤器，并持续测试和迭代。官方开发指南建议把 YAML/DDL 放进 Git，进行同行评审，在 CI/CD 中运行测试与准确性检查，通过后再部署，并保留可回滚版本。

## 对本项目的具体改进清单

### 立即落实到生成流程

- [ ] 将关系两端的列、键声明、基数证据、预期粒度和 fan-out 风险加入 mapping manifest。
- [ ] YAML 静态检查必须验证所有表达式中的物理列引用，而不仅是 `base_table`。无法可靠解析的表达式应明确标为未覆盖并阻止自动通过，不能静默跳过。
- [ ] 将设计文档中的每个关键指标关联到至少一个已批准的 known-answer query 或独立参考 SQL；没有可用测试时标为待补充，而不是宣称业务验证完成。
- [ ] 现有 Semantic View 修改前先导出/读取当前定义，生成最小 diff；不应默认覆盖未纳入当前 mapping 的语义元素。
- [ ] 将 verify-only、开发环境部署、语义查询、结果对账和发布审批分成独立门禁。
- [ ] 在安全检查中明确：Prompt、AI instructions 和语义过滤不是访问控制；行级/列级安全必须由 Snowflake 权限、Row Access Policy、Masking Policy 或经过审查的安全视图实现。

### 后续可以增加的测试夹具

1. 连接键不是唯一键时，检查 fan-out 和指标膨胀。
2. 两张事实表经共享维度关联时，检查 fan trap 和 `USING`/关系限定行为。
3. 半可加指标（如期末持仓）跨日期聚合时，拒绝不合适的简单求和。
4. 时间有效维度和 ASOF/range join 的边界条件。
5. 维度表 Row Access Policy 过滤后事实表行仍可能通过 LEFT JOIN 以 NULL 维度出现的安全风险。
6. 关键自然语言问题的可信 SQL 对账，以及 VQR 的编译/结果回归。

## 采用原则

- 官方 Snowflake 文档定义当前语法和产品能力。
- Snowflake Labs Skill/示例用于学习模式和构建可复现的测试夹具。
- 社区 Skill 只作为工程实践参考，需审查、注明来源并验证兼容性。
- 任何模型生成的对象名、列名、关系、指标公式或业务描述都不能自动升级为事实；必须来自真实元数据、设计依据或明确审批。
- 不要把整份外部 Skill 原样复制进仓库。保留本项目的业务边界与安全规则，提炼可追踪、可测试的做法。
