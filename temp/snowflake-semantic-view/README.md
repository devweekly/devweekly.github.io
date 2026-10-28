# Snowflake Semantic View 实验室：投资组合分析

本目录与博客文章《如何在 Snowflake 添加 Semantic View：手把手教程》配套。

## 文件结构

- position_analytics.yaml：Semantic View 的主定义。它引用 SV_FINANCE_LAB.MART 中的三个演示表。
- sql/00_setup_demo.sql：创建隔离练习数据库、三张表和确定性的回归样例数据。
- sql/10_deploy_semantic_view.sql：存储过程的手工调用模板。
- sql/20_smoke_tests.sql：基于 Semantic View 和物理表的核对 SQL。
- scripts/deploy_semantic_view.py：通过 Python Connector 验证 YAML，并在显式指定时部署。
- scripts/test_semantic_view.py：比较 Semantic View 与物理表聚合值，并验证固定的预期金额。
- 01_semantic_view_workshop.ipynb：可交互的演练 notebook。
- requirements.txt：Python 依赖。

## 安全边界

这些表和数字是确定性的教学 fixture，不是实际客户持仓或实时市场价格。所有建表脚本都应在专门的 sandbox 账号/数据库中执行。不要在生产数据对象上照抄演示脚本。不要把密码、私钥、访问令牌或客户数据提交到 Git。

## 快速开始

1. 在 Snowflake Worksheet 执行 sql/00_setup_demo.sql。
2. 在真实的开发角色下确认角色、database/schema USAGE、源表 SELECT 和 CREATE SEMANTIC VIEW 权限。
3. 在本目录安装依赖：

       python -m venv .venv
       source .venv/bin/activate
       pip install -r requirements.txt

4. 通过环境变量配置连接。交互式本地练习可使用 externalbrowser；无人值守自动化应使用组织批准的工作负载身份或密钥对认证。

       export SNOWFLAKE_ACCOUNT="your-account-identifier"
       export SNOWFLAKE_USER="your-user"
       export SNOWFLAKE_AUTHENTICATOR="externalbrowser"
       export SNOWFLAKE_WAREHOUSE="your-warehouse"
       export SNOWFLAKE_ROLE="your-development-role"
       export SV_TARGET_SCHEMA="SV_FINANCE_LAB.MART"

5. 在当前目录运行只验证模式：

       python scripts/deploy_semantic_view.py

6. 只有验证成功、确认目标环境和权限后，才运行部署：

       python scripts/deploy_semantic_view.py --deploy

7. 执行回归：

       python scripts/test_semantic_view.py

8. 最终再用低权限角色测试 grants 和边界。成功部署本身不等于业务口径已验证。

## 自动检查与线上验证

仓库中的 .github/workflows/semantic-view-lab-validation.yml 会在相关文件变更时检查 Python 语法并验证 YAML 的基本结构。它不连接 Snowflake，也不代表 Snowflake 一定接受这份语义定义。线上验证由 deploy_semantic_view.py 默认执行的 verify_only 完成；回归脚本则需要一个已部署的 Semantic View 和已创建的教学表。

## 从设计文档生成 YAML：推荐的 Skill + 脚本流程

不要只靠 Prompt，也不要让人逐字段手抄 YAML。推荐把 LLM 用在理解业务描述、提出映射候选和生成 YAML 初稿上；把可确定的检查交给脚本；把 Snowflake 语法/对象检查交给 Snowflake；把业务口径交给业务负责人和回归测试。

新增文件：

- `skills/semantic-view-generator/SKILL.md`：生成工作流的 Skill 规范，规定输入、阶段、禁止事项、停止条件和输出物。
- `prompts/semantic_view_yaml_generator.md`：可单独复用的 Prompt 模板，明确禁止猜测表列名、伪造证据和跳过检查。
- `examples/semantic_mapping.example.json`：业务概念到物理字段、YAML 路径和测试的映射清单示例。
- `examples/metadata_snapshot.example.json`：元数据格式示例，仅供理解格式，不能当作目标环境的真实元数据。
- `scripts/export_semantic_metadata.py`：通过当前 Snowflake 连接，对指定表执行 DESCRIBE TABLE，导出真实表列和类型；只导出元数据，不读取业务行。
- `scripts/validate_semantic_mapping.py`：把映射清单与元数据快照比对，检查表/列是否存在、映射是否审批、是否有未决问题、是否有测试，以及 YAML 声明的基础表是否存在。

### 推荐执行顺序

以下命令也是 Skill 的强制执行流程，不只是供参考的手工步骤。Skill 应在可用的 shell 中执行它们、读取退出码和错误并修复后重跑；如果缺少 shell 或 Snowflake 连接，则必须报告 NOT RUN，而不能声称验证成功。

1. 在设计文档里先明确粒度、业务指标公式、币种、时间语义、连接关系和未决问题。
2. 从目标开发环境导出真实元数据。每张源表重复传入一个 `--table` 参数：

       python scripts/export_semantic_metadata.py \
         --table SV_FINANCE_LAB.MART.FACT_POSITION_DAILY \
         --table SV_FINANCE_LAB.MART.DIM_PORTFOLIO \
         --table SV_FINANCE_LAB.MART.DIM_SECURITY \
         --output .work/metadata_snapshot.json

3. 让 Skill 读取设计文档、这份元数据、当前官方 YAML 规范和团队示例。第一轮只产出映射清单和歧义问题，不急着生成 YAML。
4. 数据工程师确认物理字段、类型、粒度和关系；业务负责人确认指标公式、单位、时间口径和聚合规则。未决问题必须先解决。
5. 将已审批的映射清单保存为 JSON，参照 `examples/semantic_mapping.example.json` 的格式。注意把示例中的对象和字段换成刚刚从目标环境导出的真实对象。
6. 运行确定性检查：

       python scripts/validate_semantic_mapping.py \
         --mapping .work/semantic_mapping.json \
         --metadata .work/metadata_snapshot.json \
         --yaml position_analytics.yaml

7. 检查通过后，才由 Skill 依据映射清单生成 YAML。生成后重新运行检查，再执行：

       python scripts/deploy_semantic_view.py

   该命令默认走 Snowflake verify-only。随后部署到隔离开发环境并运行 `python scripts/test_semantic_view.py` 和已批准的独立 SQL 对账；不要把 verify-only 当成业务正确性的证明。
8. PR 中同时评审设计文档、映射清单、YAML 和测试结果。生产发布必须经过明确的审批和发布流程。

元数据快照应与目标账号、schema 和生成时间绑定。表结构变化后要重新导出；不要长期复用过期快照。不要把真实业务数据、凭据或私钥写入快照或提交到 Git。

### 为什么不能只靠 Prompt？

Prompt/Skill 是对模型的行为约定，不是强制执行的安全边界。它可以要求模型禁止猜测，但模型仍可能违反要求。脚本可以确定性地检查映射中引用的表列是否存在、审批状态是否正确、是否存在未决问题，以及 YAML 中的基础表是否在快照中；Snowflake 的 verify-only 可以检查服务端接受情况；数据测试和业务验收则负责检查指标结果。

当前验证脚本**不会**证明表达式业务含义正确，也不会自动证明每个 YAML 表达式都已完整映射到清单。它是发布门禁的一层，而不是全自动语义正确性证明。后续若要强化，可再将 YAML 解析为语法树，校验表达式列引用、关系键与映射清单的一致性，并把独立 SQL 对账纳入 CI。

## 改成自己的数据

必须先修改 YAML 内的基础表路径、字段表达式、主键、关系和指标，再运行验证。只改 SV_TARGET_SCHEMA 不会自动把 YAML 中的物理表路径转换为你的表。金融场景还需要确认事实表粒度、币种换算口径、估值时点和来源报表；不应把示例数字或指标定义直接带到生产环境。

## 上游 Skill 与建模模式参考

已对照 Snowflake Labs 和社区的 Semantic View Skill，并整理出适用模式、局限及后续改进清单：[`references/upstream-guidance.md`](references/upstream-guidance.md)。重点参考 Snowflake Labs 的 [`semantic-view-patterns`](https://github.com/Snowflake-Labs/coco-skills/tree/main/skills/semantic-view-patterns)，补充关系基数、fan trap、半可加指标、时间有效关系、Verified Query 回归和安全策略审查。社区 Skill 只作为工程实践参考，不视为官方产品规范；旧的 [`semantic-model-generator`](https://github.com/Snowflake-Labs/semantic-model-generator) 已被官方标注为由 Snowsight 原生 Semantic View Generator 替代。

## 权威参考

- https://docs.snowflake.com/en/user-guide/views-semantic/overview
- https://docs.snowflake.com/en/user-guide/views-semantic/semantic-view-yaml-spec
- https://docs.snowflake.com/en/user-guide/views-semantic/best-practices-modeling
- https://docs.snowflake.com/en/user-guide/views-semantic/best-practices-dev
- https://docs.snowflake.com/en/sql-reference/stored-procedures/system_create_semantic_view_from_yaml
- https://docs.snowflake.com/en/user-guide/views-semantic/querying
