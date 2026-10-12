# Proxy Voting 工作流现代化方案

**状态：** 架构方案草稿，待业务、合规、供应商接口与非功能需求共同确认  
**架构基线：** Angular + BFF / Microsoft Entra ID + Java Domain Service on EKS + PostgreSQL + CDC + Snowflake  
**设计目标：** 把分散在电子表格、邮件和外部投票平台中的工作整合为可追踪、可授权、可回放、可对账的工作流；保持投票指令的权威状态与历史分析读模型分离。

通用分层、Snowflake 查询选型与横向安全设计见 [金融服务架构中的 CQRS：PostgreSQL 写入、Snowflake 历史查询与业务逻辑边界](../../src/content/blog/financial-services-cqrs-postgres-snowflake.md)。本文只补充 Proxy Voting 的业务状态、外部提交和控制要求。

本文是具体业务方案，不代表当前系统已经拥有下文列出的接口、数据或控制能力。凡涉及供应商 API、数据字段、监管保留期限、授权规则及服务等级目标的内容，均需在发现阶段向相关团队和供应商核实。

---

## 1. 要解决的问题与设计结论

Proxy Voting 的核心不只是“把电子表格做成网页”。它是一条具有截止时间、投资组合 / 委托关系、投票资格、政策判断、人工审批、外部提交和确认回执的业务流程。仅保留最终的 For / Against 等选项，不足以重现当时为什么这样投、谁批准了指令、实际向外部平台提交了什么，以及对方是否确认接受。

建议将系统拆成三条相互关联但语义不同的路径：

1. **业务工作流与投票指令路径：** Java Domain Service + PostgreSQL 作为权威写入和当前状态来源。创建、修改、审批、取消、提交状态和外部回执必须落在有事务约束的领域流程里。
2. **外部投票执行路径：** 独立的 Vendor Adapter / Submission Worker 负责与外部投票平台交换数据，使用 Outbox、幂等键、提交尝试记录、超时查询与人工例外处理，避免把网络调用放进数据库事务。
3. **历史查询与分析路径：** PostgreSQL 的已提交数据经 CDC 同步至 Snowflake，构建治理过的历史读模型。Snowflake 承担跨会议、跨期间和跨组合的历史筛选与汇总，不负责决定某条当前投票指令是否合法，也不作为外部提交是否成功的权威来源。

**关键决策：** 对会影响投票资格、审批、截止时间或外部提交的动作，最终校验必须由 Java 领域服务基于权威当前状态完成；不能因为 Snowflake 中查到一条历史记录，或用户在页面上看到了某个选项，就允许提交。

## 2. 范围、假设与需要确认的事项

### 2.1 本方案覆盖

- 接入投票会议、议案、选项和截止时间等外部事件数据。
- 将议案与证券主数据、组合持仓和投票资格关联。
- 管理政策、研究材料、建议、投票决定、独立审批、指令版本及提交结果。
- 为分析员、审批人、投票运营、合规与审计人员提供不同权限的工作台。
- 向外部投票平台提交已批准指令，处理拒绝、超时、重复提交、重放与差异对账。
- 构建面向历史查询和管理报告的 Snowflake 数据模型。
- 保留足够的业务和技术证据，支持复盘、调查和审计。

### 2.2 当前假设，而非既成事实

| 主题 | 方案假设 | 必须确认 |
|---|---|---|
| 身份认证 | 企业用户通过 Microsoft Entra ID SSO 登录；BFF 使用服务端会话 | 应用注册、MFA / 条件访问、Token audience / scope、下游调用方式 |
| 投票资格 | 需要把会议 / 议案、证券、组合、持仓和 record date / entitlement 信息关联起来 | 资格字段的权威来源、时间点、证券标识映射、持仓更正机制 |
| 外部平台 | 通过供应商适配器集成，优先使用合同允许的 API；无 API 时使用受控文件交换或显式人工操作 | API / SFTP 可用性、回执语义、重提规则、速率限制、截止时间和状态查询能力 |
| 投票政策 | 政策是版本化业务规则，分析意见与最终决定分别记录 | 政策审批人、生效时间、例外类型、冲突管理与适用组合 |
| 多人审批 | 对政策例外、批量提交、关键议案或高风险动作执行 maker-checker | 哪些场景必须双人审批，是否允许特定职责合并 |
| 数据保留 | 业务决定、审批和外部回执按合规批准的期限留存 | 法域、记录类别、法律保留、删除 / 冻结流程与审计要求 |
| 数据新鲜度 | 操作工作台优先显示 PostgreSQL 当前状态；Snowflake 提供带水位的分析结果 | 当前待办和持仓更新的时效目标、查询回源策略、RPO / RTO |

不能把不确定的供应商能力写入系统核心合同。例如，如果对方没有可查询提交状态的 API，不能用“自动查询回执”作为已完成的能力；必须设计文件回执或受控人工确认路径。

## 3. 目标架构

### 3.1 业务与数据整体图

~~~mermaid
flowchart TB
    User["分析员 / 审批人 / 投票运营 / 合规审计"]
    Entra["Microsoft Entra ID<br/>企业身份、MFA、条件访问"]
    subgraph Access["应用访问层"]
        Browser["Angular Web"]
        BFF["BFF<br/>会话、CSRF、页面 DTO"]
    end
    subgraph App["AWS EKS：业务应用区"]
        API["Java Domain API<br/>Command、当前状态 Query、领域授权"]
        Policy["Policy / Entitlement<br/>角色、组合范围、职责分离"]
        VendorWorker["Vendor Adapter / Submission Worker<br/>独立出站、状态查询与回执"]
        Outbox["Transactional Outbox<br/>与业务事务原子提交"]
    end
    PG[("RDS PostgreSQL<br/>权威工作流、版本、审批、指令、回执")]
    Provider["外部 Proxy Voting 平台<br/>API / 文件交换 / 受控人工路径"]
    Source["证券主数据、持仓、资格、会议与议案来源"]
    SourceIngest["Source Ingestion Adapter<br/>API / 文件、校验、去重、版本化"]
    SnowAdapter["Snowflake Query Adapter<br/>只读、固定查询合同、参数绑定"]
    CDC["CDC / 数据集成"]
    subgraph SF["Snowflake：历史与分析区"]
        Raw[("受限 RAW / 来源快照")]
        Model["标准化、事件历史、资格与指令历史模型"]
        Mart[("治理后的 Serving Models")]
    end
    BI["历史检索 / 管理报告 / 合规分析"]
    Audit["集中审计、告警与运营监控"]

    User --> Browser --> BFF
    Entra <--> BFF
    BFF --> API
    API --> Policy
    API --> PG
    PG --> Outbox --> VendorWorker --> Provider
    Provider -->|"接受 / 拒绝 / 回执 / 状态"| VendorWorker
    VendorWorker --> PG
    Source -->|"受控导入 / API / 文件"| SourceIngest --> PG
    PG --> CDC --> Raw --> Model --> Mart
    API --> SnowAdapter --> Mart
    BI --> Mart
    API --> Audit
    VendorWorker --> Audit
    CDC --> Audit
~~~

**读图说明：** 只有 PostgreSQL 记录能够确定当前工作流状态、已批准的指令版本和提交尝试的本地状态；供应商的确认或拒绝需要另行记录为外部证据。Snowflake 是从权威源派生的分析投影，不参与命令事务。Source 的具体连接器与接入方式应根据实际数据供应方确定。Transactional Outbox 是与业务修改在同一 PostgreSQL 事务中写入的持久化记录，不是另一个消息代理；Submission Worker 从中领取待处理任务后再调用供应商，避免把网络调用放进数据库事务。

### 3.2 部署与信任边界

~~~mermaid
flowchart TB
    Staff["企业用户浏览器<br/>无数据库或供应商凭证"] --> Edge["受控应用入口<br/>TLS / WAF 按企业标准"]
    Entra["Microsoft Entra ID"] <--> BFF
    subgraph VPC["AWS 私有业务网络"]
        subgraph EKS["Amazon EKS"]
            BFF["BFF Pod<br/>独立 workload identity"]
            Domain["Java Domain API<br/>领域授权与状态机"]
            Worker["Submission Worker<br/>独立 workload identity"]
            CDCJob["CDC / 数据集成运行时<br/>独立 workload identity"]
        end
        DB[("RDS PostgreSQL<br/>私有子网")]
        Secrets["Secrets Manager / KMS<br/>按企业密钥策略"]
        Audit["日志、指标、告警与审计汇聚"]
    end
    Vendor["供应商接入端<br/>仅允许约定的出站目标"]
    SF[("Snowflake Account<br/>网络策略 / 私有连接能力需核实")]

    Edge --> BFF
    BFF --> Domain
    Domain --> DB
    Worker --> DB
    Worker --> Vendor
    DB --> CDCJob --> SF
    BFF -. "读取所需的运行配置" .-> Secrets
    Domain -. "按需访问密钥 / 配置" .-> Secrets
    Worker -. "仅访问供应商凭证" .-> Secrets
    EKS -. "运行日志与指标" .-> Audit
    DB -. "审计与数据库监控" .-> Audit
~~~

落地时需要具体化：AWS 账号 / VPC / 子网 / 安全组、RDS 入口、EKS Service Account 与 IAM Role、Pod 网络策略、供应商出站白名单、Snowflake 登录网络策略、密钥轮换、加密与日志保留。是否可用 PrivateLink、供应商是否支持私有连接以及 Snowflake 所在云与区域，均需按现有部署确认，不能从逻辑图推断已经具备。

### 3.3 领域模块图

系统第一阶段可以部署为一个 Java Domain Service 加一个独立 Submission Worker，不必把每个领域模块都拆成微服务。代码责任应明确：

~~~mermaid
flowchart TB
    REST["REST Controllers<br/>认证上下文、DTO、schema 校验"]
    subgraph UseCases["Application Use Cases"]
        Meeting["Meeting / Agenda Use Cases"]
        Eligibility["Eligibility / Entitlement Use Cases"]
        Research["Research / Recommendation Use Cases"]
        Decision["Vote Decision / Approval Use Cases"]
        Submission["Submission / Reconciliation Use Cases"]
        Query["History Query Use Cases"]
    end
    subgraph Domain["Domain Rules"]
        State["Workflow State Machine"]
        Policy["Versioned Voting Policy"]
        MakerChecker["Approval / Separation of Duties"]
        Deadline["Deadline / Time Zone / Cutoff"]
    end
    subgraph Ports["Ports"]
        PgPort["Operational Repository"]
        VendorPort["Vendor Adapter Port"]
        QueryPort["Historical Query Port"]
        AuditPort["Audit Event Port"]
    end
    PgAdapter["PostgreSQL Adapter"]
    VendorAdapter["Supplier API / File / Manual Adapter"]
    SnowAdapter["Snowflake Query Adapter"]
    AuditAdapter["Audit / Event Adapter"]
    PG[("PostgreSQL")]
    Provider["External Voting Platform"]
    SF[("Snowflake Serving Models")]

    REST --> Meeting
    REST --> Eligibility
    REST --> Research
    REST --> Decision
    REST --> Submission
    REST --> Query
    Decision --> State
    Decision --> Policy
    Decision --> MakerChecker
    Submission --> State
    Submission --> Deadline
    Meeting --> PgPort
    Eligibility --> PgPort
    Decision --> PgPort
    Submission --> PgPort
    Submission --> VendorPort
    Query --> QueryPort
    Meeting --> AuditPort
    Decision --> AuditPort
    Submission --> AuditPort
    PgPort --> PgAdapter --> PG
    VendorPort --> VendorAdapter --> Provider
    QueryPort --> SnowAdapter --> SF
    AuditPort --> AuditAdapter
~~~

领域规则通过接口访问存储与供应商，避免把审批逻辑写进供应商 adapter 或某条 SQL。若早期只有少量团队，也可以将 Use Cases 和 Domain 放在同一代码库、同一部署单元内；隔离 Submission Worker 的理由是它需要独立的供应商网络访问、重试策略、并发限制与故障处理。

## 4. 核心业务流程

### 4.1 从会议事件到指令闭环

~~~mermaid
flowchart TD
    A["接收会议 / 议案 / 截止时间"] --> B["去重、版本比较、主数据匹配"]
    B --> C["关联证券、组合、持仓和投票资格快照"]
    C --> D{"资格和数据完整性通过？"}
    D -- "否" --> E["进入例外队列<br/>补数据 / 人工核验"]
    D -- "是" --> F["建立工作项并分配负责人"]
    F --> G["研究与政策分析<br/>记录依据和版本"]
    G --> H["形成建议（可选）"]
    H --> I["录入正式投票决定"]
    I --> J{"是否触发审批规则？"}
    J -- "是" --> K["独立审批 / 政策例外审批"]
    J -- "否且规则允许" --> L["检查是否满足提交条件"]
    K --> L
    L --> M{"当前状态、权限、资格与截止时间仍有效？"}
    M -- "否" --> N["阻止提交并重新打开检查 / 例外处理"]
    M -- "是" --> O["持久化指令版本 + Outbox"]
    O --> P["供应商适配器提交"]
    P --> Q{"获得可信的外部确认？"}
    Q -- "接受" --> R["记录外部引用与确认内容"]
    Q -- "拒绝" --> S["记录拒绝原因并转例外队列"]
    Q -- "超时 / 状态未知" --> T["进入待核实状态<br/>查询状态或人工确认，不盲目重提"]
    R --> U["对账、归档、历史模型更新"]
    S --> U
    T --> U
~~~

工作流状态应该按业务定义管理，而不是让前端随意编辑状态字符串。初始状态集可以是以下集合，真实值与合法转换需要在设计阶段冻结：

- 会议 / 议案：**RECEIVED**、**NORMALIZED**、**DATA_EXCEPTION**、**READY_FOR_REVIEW**、**CLOSED**。
- 研究与决定：**UNASSIGNED**、**IN_REVIEW**、**RECOMMENDATION_RECORDED**、**DECISION_DRAFT**、**PENDING_APPROVAL**、**APPROVED**、**REJECTED**、**SUPERSEDED**。
- 提交指令：**READY_TO_SUBMIT**、**SUBMISSION_PENDING**、**SUBMISSION_UNKNOWN**、**SUBMITTED_PENDING_ACK**、**ACCEPTED**、**REJECTED_BY_PROVIDER**、**RECONCILIATION_REQUIRED**、**CANCELLED**。

这不是最终状态枚举。尤其要区分“已批准”“本地已提交”“供应商已接受”“最终投票结果 / 代理回执已对账”：这些状态不能合并成一个含糊的 **COMPLETED**。

### 4.2 外部提交：先落本地权威状态，再做网络调用

~~~mermaid
sequenceDiagram
    autonumber
    actor Operator as 投票运营
    participant UI as Angular
    participant BFF as BFF
    participant API as Java Domain API
    participant PG as PostgreSQL
    participant Outbox as Outbox / Worker
    participant Vendor as 外部投票平台

    Operator->>UI: 提交已审批的指令
    UI->>BFF: POST /vote-instructions/{id}/submit
    BFF->>API: 用户 Token + 幂等键 + 请求
    API->>API: 验证身份、动作权限、职责分离
    API->>PG: 开事务并锁定 / 校验指令版本
    API->>PG: 重查截止时间、资格、审批状态、版本与供应商映射
    API->>PG: 写 SubmissionAttempt + Outbox
    API->>PG: COMMIT
    PG-->>API: 已接纳为待提交
    API-->>BFF: 202 Accepted + submissionId
    BFF-->>UI: 显示待提交状态

    Outbox->>Vendor: 按稳定的外部引用发送当前已批准版本
    alt 供应商确认接受
        Vendor-->>Outbox: 回执 / 外部引用 / 接受状态
        Outbox->>PG: 保存外部响应与确认时间
    else 供应商明确拒绝
        Vendor-->>Outbox: 错误码 / 拒绝原因
        Outbox->>PG: 保存拒绝和后续处理状态
    else 网络超时且结果未知
        Outbox->>PG: 标记 SUBMISSION_UNKNOWN
        Note over Outbox,Vendor: 先查询或人工核实；不能假定失败并无条件重发
    end
~~~

这里的 HTTP **202 Accepted** 仅表示系统已持久化提交任务，并不表示供应商已接受投票。只有外部回执 / 状态确认被可靠记录后，界面才显示“供应商已接受”；“已接受”也不等于“最终投票结果已确认”，除非供应商合同把这些语义定义为相同事件。

### 4.3 超时、重复和重提的处理原则

- **本地 API 幂等：** 每次提交要求有幂等键；数据库通过唯一约束把同一业务指令版本的重复请求映射到同一提交任务。
- **外部幂等：** 如果供应商支持 idempotency key 或唯一客户端引用，应按合同使用并持久化。若不支持，先查询对方状态或进入人工核实；不能仅依赖 HTTP 客户端重试。
- **指令版本：** 每次修改投票选项、数量 / 覆盖范围、政策例外或目标外部账户，都应生成不可混淆的版本。已经审批的旧版本被修改后，应使其审批失效并触发重新审批。
- **截止时间：** 必须按供应商 / 会议规则定义时区、提交窗口、暂停 / 延长后的新版本和系统时钟来源。临近截止时间时应限制长时间排队的批次并升级告警。
- **批量提交：** 每个子指令都有独立状态、外部引用与错误结果；部分成功不能整批标成成功。支持按失败原因选择性重试和逐项对账。
- **取消 / 更改：** 只有供应商接口支持并确认后才能声称外部指令已取消。过了可撤销窗口时，应进入人工处理，而不是只修改本地状态。

## 5. 领域数据模型与权威性

### 5.1 建议的核心实体

~~~mermaid
erDiagram
    MEETING ||--o{ AGENDA_ITEM : contains
    SECURITY ||--o{ MEETING_SECURITY : referenced_by
    MEETING ||--o{ MEETING_SECURITY : includes
    PORTFOLIO ||--o{ HOLDING_SNAPSHOT : owns
    SECURITY ||--o{ HOLDING_SNAPSHOT : held_as
    MEETING_SECURITY ||--o{ ENTITLEMENT_SNAPSHOT : qualifies
    PORTFOLIO ||--o{ ENTITLEMENT_SNAPSHOT : eligible_for
    AGENDA_ITEM ||--o{ RESEARCH_CASE : researched_as
    RESEARCH_CASE ||--o{ RECOMMENDATION : may_produce
    AGENDA_ITEM ||--o{ VOTE_DECISION : receives
    PORTFOLIO ||--o{ VOTE_DECISION : scopes
    VOTE_DECISION ||--o{ APPROVAL : approved_by
    VOTE_DECISION ||--o{ INSTRUCTION_VERSION : versions
    INSTRUCTION_VERSION ||--o{ SUBMISSION_ATTEMPT : sent_through
    SUBMISSION_ATTEMPT ||--o{ PROVIDER_ACK : receives
    VOTE_DECISION ||--o{ AUDIT_EVENT : records
~~~

实体的具体拆分要以业务对象和数据来源为准。建议至少明确：

| 实体 | 主要内容 | 权威数据 / 约束 |
|---|---|---|
| Meeting / Agenda Item | 外部会议 ID、议案 ID、证券、议案选项、版本、截止时间、时区、来源时间戳 | 外部来源提供事实；本系统存来源快照与标准化版本。修订应保留旧版本和差异 |
| Security / Portfolio | 内部稳定 ID、供应商 ID 映射、组合与委托范围 | 内部参考数据系统负责主数据；不要用未经治理的名称字符串作为连接键 |
| Holding / Entitlement Snapshot | 持仓、记录日期、可投数量、资格来源、计算时间、版本 | 需要指明哪个系统对资格与数量负责；更正不能静默覆盖旧快照 |
| Voting Policy | 政策规则、适用范围、生效区间、批准版本、例外条件 | 规则所有人、审批者、生效时间与版本必须可追溯 |
| Research Case / Recommendation | 研究材料引用、分析结论、建议选项、理由、来源与版本 | 建议不是最终指令；AI 生成内容如被使用，应记录模型 / 提示版本、输入依据和人工复核结果 |
| Vote Decision | 最终选项、作用范围、记录人、决定时间、政策版本、理由、状态版本 | 业务工作流权威记录；合法选项受该议案提供的 ballot options 约束 |
| Approval | 审批人、审批时间、审批对象版本、批准 / 拒绝、评论 | 不允许对已经变化的指令版本沿用旧审批；职责冲突由服务端阻止 |
| Instruction Version | 发往供应商的目标、标准化 payload、payload hash、版本、状态、生成时间 | 已批准后应固定提交内容；更改需生成新版本并执行重审规则 |
| Submission Attempt / Provider Ack | 发送尝试、时间、结果、供应商请求 ID、回执原文 / 摘要、错误分类 | 每次尝试分别记录；外部状态未知时不能以推断替代回执 |
| Audit Event | 谁、何时、对何对象、做了什么、结果与关联 ID | 单独定义不可随业务编辑的权限边界及保留规则；是否使用 WORM / 不可变归档需由审计政策决定 |

不要把“投票建议”“已批准的投票决定”“发出的指令”和“外部接受的指令”放在一条可覆盖的记录里。需要重建过程时，系统应该能还原当时的政策版本、资格信息、指令 payload 和供应商响应。

### 5.2 PostgreSQL 与 Snowflake 的读写分工

| 场景 | 首选数据源 | 理由 / 限制 |
|---|---|---|
| 当前工作队列、任务分配、审批状态 | PostgreSQL | 状态变化后马上可见，适合命令关联与事务约束 |
| 当前资格校验、截止时间校验、指令版本校验 | Java + PostgreSQL 权威记录，必要时调用资格权威服务 | 不允许用延迟读模型作最终提交许可 |
| 新增 / 修改 Vote Decision、Approval 或提交状态 | Java Domain API + PostgreSQL 事务 | 权威写入与 Outbox 可原子提交 |
| 多年投票历史、按证券 / 组合 / 政策版本横向筛选 | Snowflake Serving Models | 适合大范围历史扫描、窗口与聚合；需返回模型水位 |
| 历史投票趋势、政策例外比例、来源质量和运营指标 | Snowflake | 面向分析的模型，不应成为当前状态机 |
| 搜索某一条提交的最终外部状态 | PostgreSQL 中的受确认回执记录，必要时查供应商 | Snowflake 可能尚未同步，也不能代替当前提交状态查询 |
| 批量重算历史指标或跨期回溯 | Snowflake SQL / Dynamic Tables / Tasks / dbt 等经选择的工具 | 版本化逻辑、明确口径、数据水位与对账必不可少 |

如果 UI 同时展示 PostgreSQL 当前状态和 Snowflake 历史摘要，需要明确两个区域的更新时间，不能把它们合并成一个没有水位的“实时”对象。对用户刚提交的投票决定，命令响应可返回已提交的版本和状态，工作台随后的详情读取应继续从 PostgreSQL 读取。

## 6. Snowflake 查询与数据模型设计

### 6.1 分层

- **RAW / Landing：** 按批准的源表和事件范围保存 CDC、来源快照与同步元数据。限制对业务应用的直接访问；敏感字段尽量不复制。
- **Standardized / History：** 统一会议、证券、组合、持仓、资格、议案、政策版本、投票决定、指令版本和外部回执的键与时间语义。保留业务时间与系统记录时间。
- **Serving Models：** 为具体用途建立例如 **VOTE_INSTRUCTION_HISTORY**、**MEETING_OUTCOME_HISTORY**、**POLICY_EXCEPTION_ANALYTICS** 与 **SOURCE_RECONCILIATION** 等读模型。命名应体现用途和数据口径，不必把所有主题合并成一张无限宽表。

这里的表名只是模型候选。当前待办和需要即时授权的查询应继续从 PostgreSQL 获得权威状态；Snowflake 的 Serving Models 主要面向历史追溯、跨期间搜索和报告。

### 6.2 时间与回溯

Proxy Voting 特别容易出现“当时知道什么”和“后来修正为多少”的差异：

- 会议或议案的业务生效时间、供应商发布 / 修订时间、系统接收时间应明确区分。
- 持仓与 entitlement 应有适用日期、来源、快照生成时间及版本，不能仅用当前持仓重算过去所有投票资格。
- 政策需要生效区间与版本，历史分析不能用今日规则覆盖过去决策所依赖的规则。
- 供应商回执有事件时间和系统接收时间；迟到、重复与更正回执要保留来源和去重键。
- 若需要重现“当时操作员看到的状态”，模型必须保存历史可见版本；若只需要最终修正后的历史统计，则可以用不同口径，但查询合同必须把两种口径区分开。

### 6.3 刷新与对账

Snowflake 使用哪种刷新技术，应从模型需求决定而不是一律选 Dynamic Tables。简单共享定义可从普通 View 起步；跨表历史投影与重复昂贵计算可评估 Dynamic Tables 或物化的 Serving Model；定时回补和端到端质量检查可使用现有 SQL / Tasks / dbt / 编排平台。必须实际监控水位与数据差异，不能把目标刷新延迟当作严格保证。

至少建立以下对账：

1. 外部会议 / 议案与本地标准化记录的数量、版本和截止时间差异。
2. 可投组合、资格快照、持仓数量与供应商返回资格的核验结果。
3. 已批准指令、实际提交尝试、外部接受回执及最终确认记录之间的差异。
4. CDC 源端与 RAW / 模型的事件数、水位、删除 / 更正处理和重放进度。
5. Snowflake 汇总值与 PostgreSQL 权威业务事实的抽样或定期全量核对。

对账差异应生成可分派的异常记录、有负责人、有时间和处理结论；不能只发一条日志就视为已解决。

## 7. 权限、安全与职责分离

### 7.1 角色是起点，不是完整授权条件

建议的业务角色是初始模板。最终授权必须同时判断用户身份、动作、业务对象、组合 / 委托范围、当前状态、职责冲突与适用政策。

| 角色 | 默认允许 | 默认禁止 / 限制 |
|---|---|---|
| Research Analyst | 查看已授权议案与研究材料、记录研究意见和引用依据 | 不能独自批准政策例外或直接提交投票指令 |
| Voting Operator | 管理分配的工作项、创建和修订草稿、处理提交异常 | 不能批准自己创建的高风险或政策例外指令；范围受组合权限约束 |
| Approver / Committee Member | 审阅规定范围的决定、批准 / 拒绝并留下理由 | 只允许审批当时展示且仍有效的指令版本；不得审批已被修订或过期的版本 |
| Submission Worker | 读取已批准的提交任务、向规定供应商端点发送、保存回执 | 不能选择投票立场、修改已批准 payload 或自行扩大账户范围 |
| Reconciliation Operator | 查看对账差异、登记调查结果、执行经授权的修复操作 | 不能静默覆盖外部回执或修改历史审计记录 |
| Compliance / Auditor | 按获批范围只读查看决定、审批、提交记录、数据版本与审计链 | 不默认拥有变更投票指令的能力 |
| Platform Administrator | 管理运行时、部署、密钥和平台权限 | 平台管理员权限不自动授予业务审批或投票决定权限 |

是否每条指令都必须双人审批应由合规与运营政策决定。建议至少对政策例外、冲突议案、高风险议案、大批量提交、截止时间附近的修订和被拒后重新提交启用独立审批。所有授权在服务端执行，按钮隐藏只是 UI 表现。

### 7.2 安全控制清单

- **用户身份：** Entra OIDC、Token 验证、MFA / 条件访问、会话失效、CSRF 防护、Secure / HttpOnly Cookie。
- **业务授权：** API 每次调用验证权限，不只在登录时授权；资源范围按 portfolio / mandate / entity / meeting / instruction 检查。
- **职责分离：** 服务端阻止自我审批、审批过期版本、越权代办，以及由管理员身份直接绕过业务控制的路径。
- **供应商集成：** 独立工作负载身份、限定出站目标、TLS、凭证存入秘密管理系统、访问凭证轮换；文件交换需要文件签名 / 完整性校验、加密和安全投递。
- **数据层：** PostgreSQL 业务角色最小权限；Snowflake 应用查询 Role 只读受治理 Serving Schema，CDC / Transformation / App Query 角色分离。需要按行 / 列限制时，评估 Snowflake Row Access Policy、动态 Masking、Secure View、network policy 和私有连接选项。Row Access Policy 与 Dynamic Data Masking 需要 Enterprise Edition 或更高版本，必须在方案成本与授权评审中确认账户版本。若当前版本不支持，应收紧数据集与角色、限制直接查询并在 Java 服务执行对象级授权；不能把普通 View 视作等价的行列安全控制。
- **数据最小化：** 不复制无查询必要的个人数据、完整客户资料或供应商敏感字段；按用途设分类、访问策略、保留和删除要求。
- **审计链：** 业务审计记录 actor、action、target、reason、decision / instruction version、policy version、approval 和 provider reference；技术记录 trace ID、请求 ID、submission ID、Snowflake query ID、模型水位与失败重试。日志内容需防止 Token、凭证或敏感 payload 泄露。
- **异常处置：** 提供禁用外部发送、暂停批次、撤销服务身份、隔离出站、阻止新增审批与查询的应急控制。停止路径也需要权限控制与审计。
- **数据导出：** 单独授权，限制批量范围、字段、目标位置、有效期和下载记录；导出任务应支持取消、保留策略和结果清理。
- **AI 辅助（如使用）：** AI 可以摘要材料、对照已批准政策或提供研究建议，但不能自行放宽 Entitlement、变更正式票选、通过审批或触发外部提交。输出应被标记为建议，并保存引用、版本和人工复核结果。

### 7.3 审计不是普通应用日志

一次完整的投票记录应能够回答：

- 谁在什么时间、以哪个有效身份，对哪个会议、议案、组合和指令版本做了什么？
- 当时使用的投票资格快照、政策版本、研究依据与审批结论是什么？
- 最终批准的 payload 是什么，其 hash / 版本是什么？
- 系统何时尝试提交，使用了哪个外部引用或 idempotency key？
- 供应商返回了什么回执、拒绝或未知状态；谁处理了差异？
- 若显示为最终完成，完成的状态依据是什么，而不是哪条程序代码认为它成功？

业务审计事件建议作为单独的、应用普通写角色不可任意修改的记录；按企业审计策略定期归档到受控存储。是否需要不可变存储 / WORM、数字签名或更长保留期限由合规与法律团队明确。Snowflake Access History、查询日志和云平台审计可以补充技术证据，但不能代替业务决定和供应商回执本身。

## 8. API 合同建议

API 名称只是一个可讨论的起点；最终合同应经领域建模、消费者需求与安全审查确认。

| 类型 | 候选端点 | 关键控制 |
|---|---|---|
| 查询工作队列 | **GET /work-items** | 按当前用户与分配范围过滤；分页；数据来自权威当前状态 |
| 查询议案详情 | **GET /meetings/{id}/agenda-items/{itemId}** | 返回版本、来源时间、截止时间和适用选项；只显示授权字段 |
| 录入研究结论 | **POST /research-cases/{id}/notes** | 记录作者、时间、依据引用及版本；不改变正式投票指令 |
| 建立 / 修改决定草稿 | **POST /vote-decisions**、**PATCH /vote-decisions/{id}** | 校验当前选项、资格、范围、版本；用版本字段或等效机制防止覆盖 |
| 发起审批 | **POST /vote-decisions/{id}/submit-for-approval** | 固定待审版本；请求人与审批人的职责关系检查 |
| 审批 | **POST /vote-decisions/{id}/approvals** | 审批人与当前用户分离；只能针对固定版本，记录理由 |
| 提交指令 | **POST /vote-instructions/{id}/submit** | 幂等键；重查资格、政策、截止时间、审批版本；返回提交任务 ID 而非伪造即时成功 |
| 查询提交结果 | **GET /submissions/{submissionId}** | 显示本地任务状态、供应商确认状态、最新更新时间和未决异常 |
| 查询历史 | **POST /history/search** | 使用受限查询 schema；服务端决定 PostgreSQL 或 Snowflake；返回数据水位和口径版本 |
| 导出 | **POST /exports**、**GET /exports/{id}** | 独立导出授权、异步状态、过期时间、下载审计 |

所有 mutation 应定义并发冲突语义、重复请求语义和错误分类。建议区分 **403 Forbidden**（权限不足）、**409 Conflict**（版本 / 状态冲突）、**422 Unprocessable Entity**（业务校验不通过）、**202 Accepted**（任务已持久化但外部处理尚未确认）及外部状态未知等业务错误；具体错误合同须统一。

## 9. 运行、恢复与监控

### 9.1 必需的运营指标

| 区域 | 核心指标 / 告警 |
|---|---|
| 会议与议案摄取 | 新事件延迟、未知证券映射、截止时间缺失 / 已修改、重复与无效事件 |
| 资格与持仓 | 快照新鲜度、未匹配组合 / 证券、数量差异、资格缺失、record date 冲突 |
| 工作流 | 未分配工作项、临近截止未完成数、审批积压、政策例外数量、状态转换被拒数 |
| Submission Worker | 待提交队列年龄、成功 / 拒绝比例、超时未知数、重试次数、供应商限流、凭证到期 |
| 外部回执 | 已提交未确认时长、回执重复 / 缺失、外部引用冲突、待人工核实队列 |
| CDC / Snowflake | 源端到 RAW 水位、模型刷新失败、实际数据延迟、源与目标数量 / 汇总差异 |
| 安全 / 审计 | 授权拒绝、异常导出、角色与策略修改、管理操作、外部发送开关变化、审计写入失败 |

截止时间类告警应按会议时区和实际提交窗口计算，而不只按 UTC 日期字符串。应提前定义哪些告警需要运营立即处置，哪些进入次日对账。

### 9.2 失败处理

| 失败 | 预期行为 |
|---|---|
| PostgreSQL 事务失败 | 命令失败，不产生可被 Worker 处理的已提交 Outbox 项 |
| Worker 中断 | 从持久化队列恢复；重复消费安全；不丢弃已记录的提交状态 |
| 外部系统不可用 | 保留任务状态与尝试记录，执行有界重试和告警；接近截止时间升级人工处置 |
| 网络超时，供应商可能已收到 | 标记状态未知；先查询 / 对账 / 人工核实，再决定是否再次提交 |
| 回执重复或乱序 | 通过外部事件 ID、供应商引用、payload version 和状态转换规则去重，不覆盖更高版本的最终状态 |
| CDC 停滞 / Snowflake 刷新失败 | 继续以 PostgreSQL 作为工作流权威；降低或暂停历史分析承诺并显示水位；恢复后重放和对账 |
| 错误的投票选项映射 | 停止相关批次，保留原始来源与处理版本；经授权修正映射和重新审批后重提 |
| 外部账户 / 投票资格无法确认 | 阻断提交，产生可分派例外；不把未知资格默认视为合格 |

对于停机恢复，需要定义数据库备份与时间点恢复、跨区域恢复方式、Outbox 积压恢复、外部提交状态核实和最终对账顺序。对外部供应商的真实投票结果不能通过数据库回滚撤销，因此恢复计划必须包含业务级核实流程。

## 10. 测试与验收

### 10.1 领域与权限测试

- 同一用户无权访问别的组合、委托或受限会议；通过改 URL、改 ID 或直接调用 API 也必须被拒绝。
- 分析员不能提交指令；提交 worker 不能改变票选；普通管理员不能代替业务审批。
- 自我审批、旧版本审批、政策已更新、资格已失效、截止时间已过的提交均被拒绝或进入明确的例外流。
- 议案选项必须来自当前议案版本，禁止构造供应商不接受的选项 / 字段。
- 对单条和批量操作分别测试重复请求、部分成功、超时、失败重试、取消和补偿过程。

### 10.2 一致性与对账测试

- 同一 meeting / agenda event 重复发送与更正，源版本和当前可见版本符合预期。
- 持仓 / entitlement 更正可追溯，不会无声覆盖当时用于投票决定的资格快照。
- 指令在批准后发生修改，旧审批作废，提交的 payload 与批准版本 hash 一致。
- 供应商在超时后实际已接收、但响应丢失的情况下，系统不会盲目生成第二条外部有效指令。
- 回执重复、乱序、迟到、拒绝和人工录入都能关联到原始提交任务和指令版本。
- CDC / Snowflake 回补后，关键对象数量、版本、状态以及管理报告数值与权威源对账。

### 10.3 非功能验证

- 在预期峰值下测试工作队列、会议批量导入、批量指令和历史筛选；定义 p95 / p99、最大并发、导出容量和 Snowflake 预算。
- 验证临近截止时的优先级策略、队列积压、供应商限流、应用降级和人工应急路线。
- 在故障注入中分别中断 PostgreSQL、Worker、供应商连接、CDC 与模型刷新，验证每条路径的重试、告警、恢复和对账证据。
- 验证日志不暴露 Token、口令、敏感个人数据或完整供应商 payload；验证审计记录在普通应用角色下不能被修改或删除。

没有实际容量测试数据之前，不给出未经验证的 TPS、延迟或服务等级承诺。

## 11. 分阶段实施

1. **发现与控制梳理：** 绘制当前 Excel / 邮件 / 外部平台操作过程，明确角色、组合 / 委托范围、议案类型、资格来源、截止时间和审批规则；确认供应商的 API / 文件 / 回执能力。
2. **最小可运行工作流：** 建立会议、议案、分派、研究记录、决定草稿、版本、审批与审计模型；先不自动提交外部指令。
3. **资格和政策校验：** 接入证券主数据、持仓和资格快照；对账现有人工流程，处理数据缺失和例外。
4. **受控供应商提交：** 实现 Outbox、Adapter、幂等与提交尝试；先以沙箱 / 非生产环境测试回执与重试，再启用限定范围的生产提交和双人控制。
5. **Snowflake 历史模型：** 通过 CDC 建立受治理的历史数据集和 Serving Models；验证时间语义、访问权限、刷新水位和对账后，再迁移跨期间分析。
6. **扩展与退役旧流程：** 以工作流完成率、外部对账差异、人工返工量、权限错误和数据新鲜度为标准，逐步迁移电子表格与邮件流程；保持有审批的回退安排直到新流程达到验收条件。

## 12. 关键架构决策记录

| 决策 | 建议 | 选择理由 | 重新评估的触发条件 |
|---|---|---|---|
| 写入权威源 | PostgreSQL | 领域状态转换、审批、指令版本与 Outbox 需要事务约束 | 明确事务规模、可用性或一致性需求无法满足当前部署时再评估 |
| 历史查询 | Snowflake Serving Models | 适合跨期间、多议案、多组合的大范围分析 | 如果小规模操作查询只需主库，直接使用 PostgreSQL；不要机械把所有读取搬去 Snowflake |
| 外部提交 | 独立 Adapter / Worker + 持久化任务 | 把供应商延迟、限流、失败和回执与用户 HTTP 请求分离 | 供应商协议、限流和批处理能力确认后再决定同步 / 异步边界 |
| 消息平台 | 首期 Outbox Worker；是否用 MSK 等平台由实际吞吐 / 重放 / 多消费者需求决定 | 避免因架构图出现消息组件就先引入额外运营负担 | 需要持久化事件分发给多个独立消费者，或已有企业平台可复用时评估 |
| 历史模型刷新 | 根据目标新鲜度和计算形状选 SQL / Dynamic Tables / Tasks / dbt | 查询模型与工作流 API 不同职责 | 数据量、变更率、刷新成本及团队既有编排能力测量后决定 |
| AI 辅助 | 仅用于研究辅助与材料处理，默认不自动做出或提交投票 | 投票指令需明确的责任人与审计链 | 只有当治理、模型风险、人工控制和可验证的业务标准获批后，才讨论更高自动化程度 |
| 服务拆分 | 初期 Domain API 与 Submission Worker 两个明确运行单元 | 只有供应商出站和重试的运营边界需要独立隔离 | 团队所有权、扩缩容、故障隔离或发布节奏实际证明需要更多服务时再拆 |

## 13. 方案评审前必须回答的问题

- 哪个系统是会议与议案数据的权威来源？它是推送 API、SFTP 文件还是只能从门户获取？
- 组合、证券、投票资格和可投数量的权威来源分别是什么？历史更正需要重算到什么程度？
- 外部平台是否提供正式 API、幂等能力、状态查询、拒绝码、批量提交和回执导出？如果某项没有，人工控制点是什么？
- 哪些类型或金额 / 数量范围的投票需要审批？政策例外和利益冲突的处理规则是谁批准的？
- 哪些操作允许委托代办？是否存在隔离墙、信息屏障或敏感研究资料权限？
- 如何定义“供应商接受”“已投出”“最终确认”和“投票结果”？外部平台实际支持哪些状态？
- 各类业务记录、研究材料、用户操作、外部回执和导出需要保留多久？是否需要不可变归档或法律保留？
- 对工作台、提交、回执、Snowflake 历史模型分别要求怎样的可用性、响应时延、新鲜度、RPO / RTO 与运营支持？
- 是否允许 AI 对材料做摘要或对照政策？输出需要怎样的来源引用、人工复核、模型版本记录和禁止动作限制？

在这些问题明确前，架构的责任边界可以先确定，但不能宣称供应商自动化、业务政策或合规控制已经完成。

## 参考资料

- [Microsoft — Backends for Frontends pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/backends-for-frontends)
- [Microsoft identity platform — Application types](https://learn.microsoft.com/en-us/entra/identity-platform/v2-app-types)
- [AWS — Transactional outbox pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html)
- [AWS — Amazon EKS service accounts and workload permissions](https://docs.aws.amazon.com/eks/latest/userguide/service-accounts.html)
- [Snowflake — SQL API](https://docs.snowflake.com/en/developer-guide/sql-api)
- [Snowflake — Access control overview](https://docs.snowflake.com/en/user-guide/security-access-control-overview)
- [Snowflake — Row Access Policies](https://docs.snowflake.com/en/user-guide/security-row-intro)
- [Snowflake — Dynamic Data Masking](https://docs.snowflake.com/en/user-guide/security-column-ddm-intro)
- [Snowflake — Access History](https://docs.snowflake.com/en/user-guide/access-history)
- [AWS — Kotak Mahindra Bank RTS / ROS case study](https://aws.amazon.com/blogs/industries/kotak-bank-modernizes-microledgers-using-amazon-dynamodb-for-predictable-low-latency-at-scale/)
