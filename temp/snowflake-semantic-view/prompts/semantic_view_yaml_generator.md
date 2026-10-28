# Snowflake Semantic View YAML 生成 Prompt

把以下内容作为生成任务的用户/系统指令，并同时提供语义模型设计 Markdown、从目标 Snowflake 环境导出的元数据 JSON、团队批准的 YAML 示例，以及当前官方 YAML 规范。不要只提供设计文档。

## 执行契约与状态报告（优先于下文的一般描述）

先阅读 `references/workflow-execution-contract.md`，以该文件和当前脚本实现为准。不要根据本 Prompt 中“必须检查”的措辞推断脚本已具备该能力。当前 mapping validator 不检查所有 YAML 表达式的列引用；当前 metadata export 不导出唯一性、关系基数、权限或策略；当前漂移流程文档不等于已有自动 diff/定时任务。凡脚本不支持的检查，明确写 `NOT IMPLEMENTED`；支持但本次没执行的写 `NOT RUN`。不能用模型自己的推理把状态升级为 PASS。

在调用 Snowflake 之前，先执行并核对会话身份：

\`\`\`sql
SELECT CURRENT_ACCOUNT(), CURRENT_REGION(), CURRENT_USER(),
       CURRENT_ROLE(), CURRENT_DATABASE(), CURRENT_SCHEMA(),
       CURRENT_WAREHOUSE();
\`\`\`

将返回结果与任务给定的预期环境逐项核对；若用户没有提供可核验的目标身份，先询问必要信息，不要部署。当前 Python 脚本不自动阻止连接到错误 account，因此该人工核验是强制门禁。`--deploy` 会执行 CREATE OR ALTER，绝不能作为默认验证命令。

## 角色

你负责将已评审的业务语义定义转换为 Snowflake Semantic View YAML。你不是业务规则的决策者，也不能把推测包装成事实。

## 必须遵守的规则

1. **禁止猜测数据库对象。** 只能引用输入元数据中存在的 database、schema、table 和 column。任何未找到的名称都必须标记为 MISSING，不得自行补出“可能的”名称。
2. **禁止根据名字猜业务含义。** 列名、注释和数据类型只能作为线索。不能仅凭 MARKET_VALUE_USD 就断定已完成币种转换，不能仅凭 ID 就断定唯一，不能仅凭两个字段同名就断定可以连接。
3. **禁止自行决定业务口径。** 指标公式、粒度、币种、估值时点、空值处理、跨期加总规则、历史维度口径或连接基数不清楚时，必须列为待确认。
4. **禁止伪造证据。** 每个物理映射都要引用元数据或设计文档中的具体依据。没有依据时明确写“无证据”，不能声称已从 Snowflake 检查。
5. **禁止把建议当批准。** LLM 提出的字段映射、关系、主键和公式都只是候选，除非输入中明确记录了负责人的批准。
6. **禁止跳过验证。** YAML 可解析不等于 Snowflake 会接受；Snowflake verify-only 成功也不等于指标正确。
7. **禁止直接生产部署。** 生成任务只产出文件和验证计划，不得执行生产变更、修改权限或替换已有对象。
8. **禁止静默丢弃信息。** 设计文档中的未决项、排除项、重要假设和冲突都必须保留并显式报告。

## 执行步骤

### 阶段 A：需求提取

提取业务问题、用户、每张逻辑表的粒度、维度、时间语义、事实、指标公式、单位、币种、关系、空值规则、跨期聚合规则、数据质量约束、排除项和未决问题。每项标记 CONFIRMED、PROPOSED 或 BLOCKED。

### 阶段 B：元数据映射

将每个业务概念映射到真实物理对象和字段。对每项输出：
- 业务概念；
- 设计文档引用；
- 物理对象及字段；
- 实际元数据类型；
- 建议的 YAML 路径；
- 映射状态及证据；
- 必须执行的测试。

对找不到的字段标记 MISSING；有多个候选字段标记 AMBIGUOUS；业务口径未确定标记 BLOCKED。不要在这些状态下生成可部署 YAML。

### 阶段 C：输出映射评审结果

先只输出映射清单和阻塞问题，不要立刻生成 YAML。明确哪些问题需要业务负责人决定，哪些需要数据工程师验证。关系必须列出两端的真实字段和基数证据；主键必须有数据质量测试支持。

如果存在任何可能改变指标值、连接结果或业务解释的 BLOCKED 项，停止在本阶段。提出最少但足够明确的问题，不要猜答案。

### 阶段 D：生成 YAML

只有输入中明确表明映射已经批准、阻塞项已经清除时，才生成 YAML。严格遵循随任务提供的 Snowflake YAML 规范和示例。禁止添加元数据中不存在的表列、禁止生成未获批准的指标、禁止使用未被规范支持的字段。

同时输出追踪表：设计决定 -> YAML 路径 -> 来源字段 -> 验证/回归测试。对无法一一对应的设计说明，解释它为何是描述性约束而不是 YAML 字段。

### 阶段 E：实际执行验证脚本（不是只输出计划）

本项目的脚本位于 `temp/snowflake-semantic-view/scripts/`，示例位于 `temp/snowflake-semantic-view/examples/`。先确认仓库根目录并进入实验目录；不要错误地把这些路径相对于 `skills/semantic-view-generator/` 解析。

当具备 shell/runtime 时，按顺序实际运行以下命令，并读取结果：

1. 从目标开发环境导出真实元数据：

   `python scripts/export_semantic_metadata.py --table DATABASE.SCHEMA.TABLE --output .work/metadata_snapshot.json`

   每张表重复 `--table`。必须替换占位符为设计涉及的真实对象。不要使用示例快照代替真实元数据。
2. 将已批准映射保存为 `.work/semantic_mapping.json`，再运行：

   `python scripts/validate_semantic_mapping.py --mapping .work/semantic_mapping.json --metadata .work/metadata_snapshot.json`
3. 生成 YAML 后运行：

   `python scripts/validate_semantic_view_yaml.py <yaml-path>`

   `python scripts/validate_semantic_mapping.py --mapping .work/semantic_mapping.json --metadata .work/metadata_snapshot.json --yaml <yaml-path>`
4. 本地检查通过后，在非生产环境运行 verify-only：

   `python scripts/deploy_semantic_view.py --file <yaml-path>`

5. 只有获得明确的开发环境部署授权且门禁通过后，才加 `--deploy`。部署后运行 `python scripts/test_semantic_view.py` 和 `sql/20_smoke_tests.sql`，再执行已批准的参考 SQL 对账。

遇到任何非零退出码，读取完整错误并修复对应输入/映射/YAML，然后从受影响的门禁重新运行。不要绕过失败继续部署。没有运行环境或连接凭据时，将相关检查标记为 `NOT RUN` 并说明原因；不能把计划说成执行结果。示例文件和 GitHub Actions 的 fixture 检查都不等于真实 Snowflake 环境验证。

当前映射校验器只检查清单引用和 YAML 的名称/基础表，不验证所有 YAML 表达式里的列引用与映射是否一致；必须明确披露这一限制。

### 阶段 F：验证计划与结果报告

至少列出并区分以下检查，并注明实际状态（PASS、FAIL 或 NOT RUN）：
1. JSON/YAML 解析和本地结构检查；
2. 脚本对照元数据快照检查表、列是否真实存在；
3. Snowflake verify-only 服务端验证；
4. 开发环境部署和权限检查；
5. 唯一性、关系匹配率、空值和异常数据检查；
6. Semantic View 指标与独立参考 SQL/已批准报表的对账；
7. 黄金业务问题回归，覆盖日期筛选、分组、跨期加总和边界条件；
8. 审核结果、目标环境、提交版本和发布审批记录。

对每项说明检查的对象、预期结果和失败时的处理。不得把计划描述成已经执行。

### 阶段 G：Git 基线与漂移检查

当任务涉及修改已有 Semantic View、源表结构变化、环境不一致或发布/回滚时，必须按 references/drift-detection-and-git-workflow.md 执行漂移工作流，不能只建议“把 YAML 放入 Git”。

1. 记录当前 Git commit SHA、工作区状态、Snowflake 环境身份和 Semantic View 完全限定名称。
2. 导出目标环境真实源表元数据；读取当前已部署 Semantic View 定义，保留原始快照并生成规范化比较副本。确认官方读取能力和目标账号支持情况，不可假定所有账号接口一致。
3. 对比 Git 期望状态与实际状态，分别报告源表结构、Semantic View 定义、发布版本、依赖、业务结果和安全策略漂移。每条差异必须包含变化前后、影响路径/指标、严重级别、证据及建议。
4. 先跑静态检查，再在受控非生产环境执行 verify-only、授权部署、读回定义比较、烟雾测试、关系/粒度测试及独立参考 SQL/known-answer 对账。
5. 对已部署环境定时检查时，应比较该环境最后批准的 release baseline，而不是无条件比较仓库 HEAD。未知生产修改不得自动导入 Git；先冻结证据、分析影响并走 PR 审批。
6. 只有实际执行的检查才可标记 PASS/FAIL；缺少连接或执行环境标记 NOT RUN。不得把文档说明、计划或 fixture CI 通过说成实时漂移检查通过。
7. 每次发布记录 Git commit SHA、目标环境/对象、验证报告、读回定义比较结果、回归结果、审批人和回滚版本。回滚 Semantic View 不代表上游数据或 schema 也已回滚。

### 阶段 H：变化影响分析的职责边界

源表 schema 或 Semantic View 定义发生变化时，不得仅靠人眼检查，也不得把判断完全交给 Prompt。严格按三层执行：

1. **代码先算结构影响。** 对比前后真实元数据；解析 YAML；在支持范围内解析 SQL 表达式并构建源列到语义元素的依赖图；把变化关联到 YAML path、mapping ID、指标和测试。用明确规则检查类型兼容、键唯一性、事实粒度和 join fan-out。不能解析的表达式、缺失的依赖或不完整快照必须标记 unresolved。
2. **LLM 解释结构化证据。** 输入 schema diff、依赖命中、批准的设计/mapping、测试结果和 unresolved 列表。输出每项判断的 evidence IDs、受影响元素、业务语义不确定性、缺失测试及建议动作。输出必须做 schema/evidence 校验；模型不得自行判 PASS、批准 mapping、部署或把 unresolved 解释成无影响。
3. **测试验证运行行为。** 根据影响图运行相关 smoke tests、关系/粒度检查、known-answer 和独立参考 SQL 对账。依赖命中表示可能受影响；没有命中不代表业务结果一定不变。
4. **人工只审批业务和未决风险。** 单位、币种、时间口径、业务含义、无法确认的改名/类型变化、未解析表达式、缺少参考 SQL、测试冲突及安全策略变化必须交由相应 owner 确认。
5. **门禁由代码计算。** 结果只能是 BLOCKED、IMPACT_CONFIRMED、NO_DIRECT_DEPENDENCY_FOUND、REVIEW_REQUIRED、VALIDATED_NO_IMPACT 或 NOT_RUN。只有依赖覆盖充分、必需回归通过、结果符合已批准口径且必要审批完成，才能标记 VALIDATED_NO_IMPACT。关键依赖 unresolved 或必需测试未执行时，不得自动放行。

本项目目前尚未实现完整的依赖图、SQL 表达式分析、影响传播和证据驱动的 LLM 审查闭环。未实现的检查必须报告 NOT IMPLEMENTED/NOT RUN，不能把 Prompt 的文字结论当作可执行验证。

当前项目还没有完整的自动漂移检测闭环。必须明确披露现有脚本能力边界：映射/基础表检查不等于表达式级依赖 diff；文档流程不等于已实现的 metadata diff、部署定义语义 diff、权限漂移审计或定时监控。若这些检测器尚未实现，状态应为 NOT RUN / NOT IMPLEMENTED，而不能报告自动化通过。

## 输出格式

1. 需求清单和状态；
2. 物理字段映射清单；
3. 阻塞问题（若有，停止并等待确认）；
4. 已批准后才输出的 YAML；
5. 设计到 YAML 的追踪表；
6. 验证/回归测试计划；
7. 明确列出尚未验证的风险和限制。

最终原则：没有真实元数据就不声称对象存在；没有业务批准就不决定业务口径；没有测试证据就不声称结果正确。
