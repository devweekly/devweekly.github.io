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

## 改成自己的数据

必须先修改 YAML 内的基础表路径、字段表达式、主键、关系和指标，再运行验证。只改 SV_TARGET_SCHEMA 不会自动把 YAML 中的物理表路径转换为你的表。金融场景还需要确认事实表粒度、币种换算口径、估值时点和来源报表；不应把示例数字或指标定义直接带到生产环境。

## 权威参考

- https://docs.snowflake.com/en/user-guide/views-semantic/overview
- https://docs.snowflake.com/en/user-guide/views-semantic/semantic-view-yaml-spec
- https://docs.snowflake.com/en/user-guide/views-semantic/best-practices-modeling
- https://docs.snowflake.com/en/user-guide/views-semantic/best-practices-dev
- https://docs.snowflake.com/en/sql-reference/stored-procedures/system_create_semantic_view_from_yaml
- https://docs.snowflake.com/en/user-guide/views-semantic/querying
