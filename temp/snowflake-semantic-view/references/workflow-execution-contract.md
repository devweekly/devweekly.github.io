# Semantic View 工作流执行契约与能力边界

本文是本目录 README、Skill、Prompt、验证脚本和漂移指南之间的操作契约。发生描述冲突时，按以下顺序处理：当前 Snowflake 官方文档决定产品语法和能力；可执行脚本决定本仓库实际自动检查了什么；本文件说明人工步骤、门禁与尚未实现的能力。Prompt/Skill 不能覆盖脚本的真实行为，也不能把未执行的步骤变成 PASS。

## 1. 谁负责什么

| 工作 | 负责者 | 必须留下的证据 | 不能替代它的东西 |
|---|---|---|---|
| 业务含义、指标公式、单位/币种、时间规则、空值和跨期聚合 | 业务 owner | 设计文档中的明确决策、审批人/日期、对应测试 | 列名、LLM 建议、YAML 描述 |
| 物理表/列、数据类型、粒度、键、连接基数和数据质量 | 数据工程师 | 元数据快照、profiling/约束证据、mapping 审批和测试 | 同名字段、仅声明 primary_key |
| 候选映射与 YAML 初稿 | LLM/Skill | 每项到设计证据和 source_refs 的追踪 | 自动批准、猜测字段 |
| 格式、字段清单和可确定规则 | 本地脚本 | 命令、退出码、报告 | Prompt 自我声明“已验证” |
| 服务端定义可接受性 | Snowflake verify-only | 目标环境、执行时间、原始返回结果 | YAML parser / 本地 CI |
| 查询行为和业务口径 | 独立 SQL、known-answer、回归测试 + owner | expected/actual、容差、测试版本、结果 | verify-only 成功 |
| 部署与生产放行 | 发布流水线及授权审批人 | commit、环境/对象、审批、部署后读回、回归和回滚版本 | 任何单个脚本或 Skill |

## 2. 状态含义必须统一

- `PASS`：该项检查确实执行，且结果符合预期；报告必须指出具体命令或测试 ID。
- `FAIL`：该项检查执行后发现错误或不符合预期。
- `NOT RUN`：该项检查应当执行，但本次没有执行，例如没有 Snowflake 连接。
- `NOT IMPLEMENTED`：当前仓库没有相应自动检查能力。不能把它伪装成 PASS，也不应只写 NOT RUN 让人误以为脚本已存在。
- `BLOCKED`：由于未解决的业务决定、缺失元数据或高风险问题，不允许继续生成/发布。
- `REVIEW REQUIRED`：静态证据不足以自动决定，需要指定 owner 审查。

总体结果不能简单取“最后一条命令的退出码”。任何必需门禁 FAIL、BLOCKED、NOT RUN 或 NOT IMPLEMENTED，都必须按发布策略阻止相应阶段；例外必须有具名审批和书面理由。

## 3. 当前脚本实际覆盖范围

| 脚本 | 当前实际做的事 | 当前不做的事 |
|---|---|---|
| `scripts/export_semantic_metadata.py` | 对明确传入的每张未加引号的 `DATABASE.SCHEMA.TABLE` 执行 `DESCRIBE TABLE`，导出列名/类型和生成时间 | 不读取行数据；不导出约束、唯一性、列注释、视图定义、权限、策略或历史快照；不自动发现依赖 |
| `scripts/validate_semantic_mapping.py` | 检查 mapping 必填项、审批状态、未决问题、source_refs 表列存在、required_tests 非空；可选检查 YAML 名称和物理 base_table 是否在快照中 | 不验证快照新鲜度/来源身份；不检查每个 YAML expr 的列引用；不检查 mapping 与 YAML 的逐项覆盖/公式一致性；不证明键唯一或 join 基数 |
| `scripts/validate_semantic_view_yaml.py` | YAML 可解析、部分必填结构、逻辑表名、实验约定的 primary_key、关系列名引用、指标声明 | 不是完整的官方 YAML schema validator；不解析 SQL 表达式；不确认表达式列在源表存在；不证明 Snowflake 接受或业务结果正确 |
| `scripts/deploy_semantic_view.py` | 基础结构检查；默认连接 Snowflake 并调用 verify-only；只有传入 `--deploy` 才调用部署，并在部署后执行 DESCRIBE | 不会自动校验当前 account 是否等于预期环境；不做业务回归；DESCRIBE 成功不等于已读回并比较完整 YAML 语义；不会自动回滚 |
| `scripts/test_semantic_view.py` | 对教学 fixture 的固定日期 `2026-10-27`、固定 Semantic View 名称和固定预期值做查询、源 SQL 对账和 known-answer 检查 | 不是通用测试框架；换了模型名、表名、日期或数据后，必须同步修改/扩展脚本和预期值；测试通过只覆盖列出的场景 |
| `sql/20_smoke_tests.sql` | 人工执行对象发现、DESCRIBE、固定日期查询和源表 SQL 对账 | 不是自动断言；SQL 返回结果需要由执行者比较；其中对象名和日期为教学环境常量 |

因此，当前完整链路是“有限本地检查 + Snowflake verify-only + 教学 fixture 回归”，不是完整的依赖分析或漂移自动化平台。缺少的能力包括表达式级依赖解析、metadata diff、已部署 YAML 的规范化语义 diff、权限/策略漂移检测、通用测试发现、自动定时监控和自动回滚。

## 4. 每次运行的准确操作顺序

在仓库根目录执行时，先进入实验目录：

```bash
cd temp/snowflake-semantic-view
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

在 Windows PowerShell 中激活命令为 `.venv\\Scripts\\Activate.ps1`。不要在没有确认当前目录时照抄相对路径。

### 4.1 导出快照

```bash
mkdir -p .work
python scripts/export_semantic_metadata.py \
  --table SV_FINANCE_LAB.MART.FACT_POSITION_DAILY \
  --table SV_FINANCE_LAB.MART.DIM_PORTFOLIO \
  --table SV_FINANCE_LAB.MART.DIM_SECURITY \
  --output .work/metadata_snapshot.json
```

每个源对象重复一次 `--table`。当前解析器只接受未加引号的常规标识符；带空格、特殊字符或需要双引号的标识符不受支持。任何表导出失败都会导致本次命令失败，不能将部分成功结果当成完整快照。

快照只包含列名和类型。每次使用前都要确认它来自目标账号/环境、覆盖全部依赖表且导出时间足够新。当前快照没有 account/role 身份字段，不能仅靠 JSON 文件本身证明它属于哪个环境；运行者必须在报告中记录环境身份。当前脚本也没有强制过期时间策略。

### 4.2 先验证 mapping，再生成 YAML

```bash
python scripts/validate_semantic_mapping.py \
  --mapping .work/semantic_mapping.json \
  --metadata .work/metadata_snapshot.json
```

只有业务和数据工程师的决定已明确写入 mapping，且 `approval_status=approved`、每项 `decision_status=approved`、`open_questions=[]`，才可能通过此门禁。把状态字段改成 approved 不是审批流程本身；应在设计/mapping 的审查记录中保留实际审批人和依据。

### 4.3 生成后运行两个不同的本地检查

```bash
python scripts/validate_semantic_view_yaml.py position_analytics.yaml
python scripts/validate_semantic_mapping.py \
  --mapping .work/semantic_mapping.json \
  --metadata .work/metadata_snapshot.json \
  --yaml position_analytics.yaml
```

第一个检查本地 YAML 结构与本实验约定；第二个检查 mapping 与元数据，并只核对 YAML 的模型名称和物理基础表。两者不能互相替代。第二个检查不验证所有表达式列引用。

### 4.4 服务端验证和部署必须分开

先查看当前会话身份和目标：

```sql
SELECT CURRENT_ACCOUNT(), CURRENT_REGION(), CURRENT_USER(),
       CURRENT_ROLE(), CURRENT_DATABASE(), CURRENT_SCHEMA(),
       CURRENT_WAREHOUSE();
```

将返回值与发布记录中的预期值逐项比较；任一不符立即停止。当前 Python 脚本不会自动对比“实际 account”与“期望 account”，所以这一步目前是人工门禁。

默认只验证，不创建或修改对象：

```bash
python scripts/deploy_semantic_view.py --file position_analytics.yaml
```

只有目标身份核对完成、verify-only 通过、测试和审批要求满足、且明确授权在隔离开发 schema 部署时，才执行：

```bash
python scripts/deploy_semantic_view.py --file position_analytics.yaml --deploy
python scripts/test_semantic_view.py
```

`--deploy` 是有副作用的 CREATE OR ALTER 操作。当前脚本没有生产环境防护开关，也没有自动回滚；不能将它作为通用 CI 默认命令。部署后再人工执行 `sql/20_smoke_tests.sql`，并保存结果。若 YAML 使用了不同的对象名或非教学数据，固定的教学回归脚本不适用，必须编写相应的独立 SQL 和预期结果。

## 5. 证据链与文件命名

建议每次验证报告至少记录：

- Git commit SHA、工作区是否干净、YAML/mapping 文件路径及内容 hash；
- Snowflake account/region、role、warehouse、目标 database/schema、Semantic View 完全限定名称（不得记录秘密）；
- 元数据快照路径、hash、生成时间、覆盖的源表和失败对象；
- 每条门禁的命令、实际退出码、PASS/FAIL/NOT RUN/NOT IMPLEMENTED、输出摘要；
- 业务/数据审批人、测试 ID、expected/actual、容差、执行时间；
- 发布时的部署对象、读回比较结果、回滚版本和发布批准人。

`.work/` 是临时工作目录，不应默认提交。元数据快照可否入 Git 取决于组织策略；无论如何都不得提交凭据或客户行数据。验证报告不能只写“测试通过”，必须指出实际执行了哪些检查。

## 6. 漂移检测当前是流程规范，不是已实现功能

要称为“自动漂移检测”，至少需要可执行的 metadata snapshot diff、表达式依赖索引、已部署定义读回与规范化比较、权限/策略检查、可重复 fixture tests、定时调度/告警和处理闭环。当前仓库未具备完整实现。

当前可做的是：人工重新导出元数据、运行现有静态检查、通过 Snowflake verify-only、在教学数据上运行有限回归，并把结果作为证据保存。不能声称这些步骤已经自动发现列变更影响、证明无影响或自动修复生产漂移。

源表变化的决策流程应为：代码计算可确定的 diff 与依赖命中；无法解析的表达式/不完整基线标记 unresolved；LLM 只能根据结构化证据解释可能影响并列出缺口；独立回归验证实际结果；业务 owner 审批语义变化；门禁程序按规则计算最终状态。没有命中依赖不等于没有影响。

## 7. 修改数据模型时的额外规则

- 不要把 YAML 的 `primary_key` 声明当作底层数据唯一性约束。应使用数据质量 SQL 验证键重复、空值和预期粒度。
- 连接关系必须有两端字段、预期基数和证据。连接后事实行数/指标变化需要测试；多事实表通过共享维度连接时要检查 fan trap。
- 持仓、余额等时点指标通常不能跨日期简单求和。必须写清单日、期末、日均或区间变化的业务定义，并为时间边界建立测试。
- Prompt、同义词和语义描述都不是访问控制。授权、行级/列级过滤和脱敏必须由 Snowflake 权限与策略实现并单独审计。
- 对已有 Semantic View 的修改，先读回当前定义并做差异审查。未纳入 mapping 的现有语义元素不能因为重新生成 YAML 就被静默删除。

## 8. 发布前最小检查清单

- [ ] 设计中的粒度、指标、单位/币种、时间与空值规则均有明确状态。
- [ ] mapping 中的每个关键项有真实 source_refs、证据、审批和 required_tests。
- [ ] 使用的是目标环境新鲜且完整的元数据快照。
- [ ] 两个本地检查均实际运行，结果和退出码已保存。
- [ ] Snowflake 会话身份与目标环境已人工核对，verify-only 已实际执行。
- [ ] 关系键、基数、fan-out 和时点聚合风险有独立测试证据。
- [ ] 已运行的测试与未运行/未实现的检查明确区分。
- [ ] 部署仅在明确授权后执行；部署后核对对象、结果并记录回滚版本。
- [ ] 业务 owner 和数据工程师已审查与其职责相符的事项。
