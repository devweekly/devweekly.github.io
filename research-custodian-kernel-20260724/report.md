# Custodian-Kernel — 工程研究报告

> **仓库**: [custodian-kernel](https://github.com/KeyArgo/custodian-kernel) (v0.4.0, MIT)
> **分析日期**: 2026-07-24
> **方法论**: Research Trace（Question → Evidence → Analysis → Counter Evidence → Conclusion → Confidence）+ Ontology-driven Research
> **证据基线**: evidence-brief.md（§0-§9）、evidence-store/full.json、ref-only/custodian-kernel/ 源码

---

## 1. 执行摘要

Custodian-Kernel 是一个面向 AI Agent 的**kernel-enforced 权限与支出平台**。它不解决"Agent 如何思考"，而解决一个更尖锐的问题：当一个 Agent 能花钱、改基础设施、写生产环境时，**谁决定这个动作是否被允许**——而且这个决定不能住在 Agent 自己的进程里。仓库以三个顶层 Python 包发布（`custodian` 内核 + `paladin`/`caduceus` 凭证保险库），包含 304 个源文件、48 个测试文件（README 称 1,346 个测试用例）、100+ 个受治理的 bundled skills，以及 11 个 builtin guard adapter。

**最有趣的发现**：Custodian 的信任模型是**"无单一承重层"（no single layer is load-bearing）**——Agent 提议、Verifier 验证、Adapter 处置、Kernel 决断，四层独立，Agent 可以"说谎或犯错"而钱仍然不会错动。这与大多数 Agent 框架把 guardrail 当作可选插件的做法形成对照。配合 `@govern` 装饰器（kernel-as-call-path，用户代码零 kernel import）和可选的独立 executor 进程，它在结构上使 Agent 自批准（self-approval）成为不可能，而非仅仅被劝阻。

**项目阶段**：早期（10 commits、2 contributors、3.5 周开发跨度，无 CI）。研究价值高于生产成熟度——适合研究"硬约束 Agent 治理"的工程范式。

---

## 2. Research Traces

### 2.1 核心架构：四层无承重信任链

**问题**: 信任如何在 Agent 与"动钱"之间分配？哪一层是承重墙？

**证据**:
- `custodian/packs/base.py:14-31` 的注释明文写出四层流：`messy input → [AI judgment] Envelope → [verifier] ClaimStatus → [adapter] Disposition → [kernel] Decision`
- 同文件 `Claim` 类（L60）注释："The agent extracts it … the deterministic verifier resolves … The agent does not get to mark its own homework."
- `custodian/policy/evaluator.py:23` `decide()` 是纯函数，输入 `SpendRequest + AuthorityState + Policy`，输出 `Decision`——无 LLM 调用、无网络
- 简报 §2：`custodian.types` 入度 69、PageRank 0.0661（全库最高），是四层共享的数据契约

**分析**: 四层在对象图上由不同的 Object 类型承担：Agent 对象（`packs/agent.py`）produces `Envelope`；`verify_claims()` 消费 `Claim` produces `ClaimStatus`；`decide()` 消费 `Envelope+ClaimStatus` produces `Decision`。每一层的输出是下一层的输入，且每层都可独立测试。Agent 的 `recommended_disposition` 字段被注释明确定为"advisory only"——这是事实，非解读。

**反证**: Kernel 仍需信任 `decide()` 的输入（band/cap/policy.yaml）来自 operator 配置。若 operator 配错 band，kernel 会忠实地执行错误策略。但这是配置面问题，非架构承重问题。

**结论**: Custodian 采用**四层无承重信任链**——Agent、Verifier、Adapter、Kernel 各自确定性，任一层被攻破或出错都不会单独导致钱错动。

**置信度**: 高 — 四层注释、`decide()` 纯函数签名、`Claim` 注释三处源码交叉验证。

---

### 2.2 `@govern` 装饰器：Kernel-as-Call-Path

**问题**: 如何让用户代码获得 kernel 治理而不显式 import kernel？

**证据**:
- `custodian/govern.py:203` `govern(band, cap, ...)` 装饰器，`README:31` "Zero kernel imports in user code"
- `govern.py:239` `wrapper(*args, **kwargs)` 内部依次执行：tamper check → `_evaluate()` → 分支（DENIED/ESCALATION/AUTONOMOUS）→ `_bus.emit()` → 返回 `GovernedResult`
- `govern.py:179` `wrapper.receipt()` 生成 `GovernedReceipt`（SHA-256 指纹）
- 简报 §3：`wrapper` 是 decorator-tool（`custodian/govern.py`）

**分析**: "The kernel is the call path"——调用 `charge_customer(85.00)` 本身就是 kernel 决策。这把治理从"显式 API 调用"转为"控制流隐含属性"，消除了"忘记调用 kernel"这类错误。`GovernedResult` 同时携带 `value`（真实返回值）和 `verdict/audit_id/claim_proof`，使治理元数据随调用链传播。

**反证**: `govern.py:49` `_default_tamper_dir()` 注释承认 `~/.custodian` 只是"tamper-evident, not tamper-proof"——同进程的代码仍可直接删除 snapshot。这是已知边界，非承重缺陷。

**结论**: `@govern` 是**控制流即治理**模式——零侵入、强制经过 kernel 决策、自带审计与回执。

**置信度**: 高 — 装饰器源码、README、tamper check 注释三方一致。

---

### 2.3 结构性自批准不可能 + Kill Switch

**问题**: Agent 如何被阻止批准自己的退款？Kill switch 为何不可被 Agent 绕过？

**证据**:
- `custodian/types.py:187` `KillSwitchState` 注释："operator-only control -- engaging/disengaging it is not exposed to the agent itself"
- `evaluator.py:35` `if killed:` 是 `decide()` 的**第一个**短路检查，先于一切 band/cap 逻辑
- `evaluator.py:57` NaN/Infinity 金额被显式 fail-closed（IEEE-754 比较陷阱）
- `registry.py:314` `CustodianTool.invoke()` 对 L2/L3/L4 工具强制 `kernel_gate`，非 autonomous 直接返回 `{"ok": false, "kernel_escalation": true}`
- README:210 `test_self_approval_regression.py` — 故意重现 bug 验证测试失败后恢复修复

**分析**: 自批准在结构上不可能，因为 Agent 进程不持有 kill switch 的写入路径，且 L3（退款类）band 在 policy 层"always escalates"。`decide()` 的 kill 检查先于金额检查，意味着即使金额为 0 也无法绕过。回归测试存在使 bug 无法静默回归。

**反证**: 未发现反证。但 README:230 坦承"Only one approval backend shipped: twilio_verify"、"Only one storage backend: SQLite"——单 backend 是工程边界。

**结论**: Kill switch 是**先于一切规则的 operator-only 短路**；自批准被 band 策略 + kill switch + 回归测试三重结构性禁止。

**置信度**: 高 — `decide()` 控制流顺序、`KillSwitchState` 注释、回归测试文件名三方验证。

---

### 2.4 Guard Adapter Pipeline：11 个 Builtin 防护

**问题**: 允许的动作如何被进一步审查"是否 sane"？Adapter 覆盖哪些风险面？

**证据**:
- `custodian/adapters/base.py:1-21` 定义 `Adapter` 协议：`pre_action`/`post_action` 返回 `ALLOW/WARN/TRANSFORM/DENY`，`fail_closed=True` 时崩溃即 DENY
- LS 确认 `custodian/adapters/builtin/` 下 11 个 adapter：`prompt_injection_guard`、`pii_redactor`、`secret_leak_guard`、`repetition_breaker`、`tool_confabulation_guard`、`spend_sentinel`、`path_fence`、`scope_fence`、`egress_domain_guard`、`kernel_self_protection`、`context_anchor`
- `prompt_injection_guard.py:23` 9 条正则规则 + base64 blob 解码再扫描；`fail_closed=True`、`category="security"`
- `base.py:150` `handle_action()` 允许 adapter 直接"回答"动作（claim it）而非仅否决——提供能力而非仅 veto

**分析**: Adapter 对象通过 `uses` 关系连接到 Tool 对象，在 `pre_action` 拦截。`TRANSFORM` 谓词允许就地改写 args（如 PII 脱敏）——比单纯 DENY 更丰富。`handled_skills` 字段让 adapter 伪装成真实工具被 bridge 接受，避免被 confabulation guard 误拒——这是个巧妙的自指设计。

**反证**: `prompt_injection_guard.py:13` 自承"heuristic, not a classifier"——只捕获"广泛、粗暴"的注入家族，对精心构造的攻击可能漏报。但作者选择 WARN 优先、`strict=True` 升级为 DENY，是显式权衡。

**结论**: 11 个 builtin adapter 构成**可组合、分类目（money/security/privacy/guardrail）的防护管道**，`TRANSFORM` 与 `handle_action` 使其超越 veto 框架。

**置信度**: 高 — LS、base.py 协议、具体 adapter 源码三方验证。

---

### 2.5 ToolRegistry：SKILL.md 自发现 + 最小权限子进程

**问题**: 100+ 工具如何零注册代码接入治理？凭证如何不泄露给 Agent 进程？

**证据**:
- `registry.py:478` `ToolRegistry.load()` rglob `SKILL.md`，解析 YAML frontmatter 中 `metadata.custodian.band`
- `registry.py:35` `_ENV_REQUIREMENTS` 显式映射每个工具名到所需 env var 列表
- `registry.py:117` `_SAFE_RUNTIME_ENV` frozenset——子进程只继承 PATH/HOME/TEMP 等运行时必需 + 该工具声明的凭证
- `registry.py:143` `_redact_credential_values()` 在 stdout/stderr 返回前用 `[REDACTED:credential]` 替换已知凭证值
- `registry.py:419` 子进程经 `require_sandboxed_argv()` + 可选 `EgressProxy`（per-tool `allowed_hosts` 白名单）
- `pyproject.toml:57` `package-data` 把 `bundled_skills/**` 打包进 wheel

**分析**: 凭证通过 Paladin `exec --with` egress 注入到**子进程 env**，而 Agent 主进程的 `os.environ` 中没有密钥——这是"values in, never out"的物理隔离。stub 工具（缺凭证）返回 `{"ok": false, "stub": true}` 但仍出现在 registry，使能力面（capability surface）在 review 时可见。

**反证**: `registry.py:412` `CUSTODIAN_ALLOW_UNSANDBOXED_TOOLS=1` 可绕过 sandbox——逃生阀存在，但默认关闭。

**结论**: ToolRegistry 用 **frontmatter 声明 + 子进程最小权限 env + sandbox + egress proxy** 四层把 100+ 工具纳入治理，凭证永不进入 Agent 进程。

**置信度**: 高 — registry.py 全文、pyproject.toml、Paladin CLI 文档三方验证。

---

### 2.6 双层执行：In-Process vs 独立 Executor 进程

**问题**: 若 Agent 进程被完全攻陷，kernel 决策如何仍然生效？

**证据**:
- `registry.py:270` `CustodianTool.invoke()` 首查 `CUSTODIAN_EXECUTOR_SOCKET`，若设置则委托给 `ExecutorClient.propose()`
- `registry.py:262` 注释："this process never runs the skill script itself, so a fully compromised agent process cannot bypass the kernel's decision by simply not calling it"
- LS 确认 `custodian/executor/` 包含 `client.py`、`service.py`、`capability.py`
- `registry.py:366` `_run_script()` 注释强调 in-process 与 delegated executor 共享同一低层执行机制，"避免一处修 sandbox 另一处漏"——对抗式 review 痕迹

**分析**: 这是**最强保证**：kernel 决策发生在另一个进程，被攻陷的 Agent 进程无法"不调用 kernel"。默认仍是 in-process（需 operator `custodian executor start`），形成两档安全姿态。这是少见的"默认便利、可选最强"安全设计。

**反证**: 独立 executor 是 opt-in，多数部署可能用 in-process 路径。但 in-process 路径仍有 band/cap/sandbox/adapter 全套治理，只是不抗进程攻陷。

**结论**: Custodian 提供**两档执行姿态**——in-process（默认、便利）与独立 executor 进程（opt-in、抗进程攻陷）。

**置信度**: 高 — registry.py 控制流、executor 包结构、注释三方验证。

---

### 2.7 Claim/Envelope 验证器：Agent 不能给自己批作业

**问题**: Agent 提取的事实声明如何被确定性验证？

**证据**:
- `packs/base.py:42` `ClaimStatus` 枚举：`VERIFIED / CONTRADICTED / UNVERIFIABLE / PENDING`
- `packs/base.py:60` `Claim` 包含 `ledger_path`（dotted path）+ `relation`（eq/neq/gt/lt/gte/lte/exists/absent）
- `packs/base.py:119` `_resolve()` 对嵌套 dict 解析 dotted path
- `govern.py:411` `_verify_output()` 用 `verify_claims()` 对函数输出做声明式校验，返回 `verified/contradicted/unverifiable`
- 简报 §4：tests 模式包含 `corpus`、`poison`、`verify-kit`；`packs/*/corpus/*.json` 每包 5-6 个语料

**分析**: Agent 输出 `Envelope`（结构化建议 + `claims` + `policy_clauses_cited` + `EvidenceSpan`），Verifier 用 dotted path 对 `*_ledger.json` ground truth 解析并比较。`CONTRADICTED` 是"谎言捕获"——Agent 声称"订单 $100"而 ledger 显示 $0，直接打脸。`EvidenceSpan` 强制"判断基于哪句原文"，dashboard 逐字展示，消除"trust me"。

**反证**: `UNVERIFIABLE` 是诚实的不确定性边界——无 ground truth 字段时不假装验证。这反而增强信任。

**结论**: Claim/Envelope 是**声明式可验证 Agent 输出**模式——Agent 提议带证据，Verifier 确定性比对，`CONTRADICTED` 是结构性谎言检测。

**置信度**: 高 — base.py 数据结构、`_resolve/_compare` 实现、govern 集成、corpus 语料四方验证。

---

## 3. Negative Findings

> 简报 §6 仅列出"未检测到 CI/CD 配置"。以下补充源码层验证。

- **无 CI/CD**（简报 §6，已验证）：Glob `.github/**/*` 返回空。**重要性**：README 称 1,346 测试 0 失败，但无 CI 意味着回归靠人工纪律。对一个宣称"安全 kernel"的项目，这是显著风险面。
- **LICENSE 文件存在（MIT, Copyright 2026 InovinLabs）**：已通过 `ref-only/custodian-kernel/LICENSE` 读取验证。**校正说明**：简报 §6 Negative Findings **未**将 LICENSE 列入缺失项，该项为正面验证（针对此前其他仓库报告中"误报 LICENSE 缺失"的模式，本仓库简报未发生此类误报）。
- **无 multi-tenant 支持**（README:230 显式声明）：**重要性**：单 operator 场景可行，多租户 SaaS 部署需自行隔离。
- **无插件市场 / 无通用 policy DSL 表达式**（README:231）：policy 匹配词汇固定为 skill name + context flags + spend-amount。**重要性**：复杂条件策略需改代码而非改配置。
- **无第三方安全审计**（README:233）：**重要性**：所有安全声明均为自证。
- **仅一个 approval backend（twilio_verify）+ 一个 storage backend（SQLite）**（README:227-229）：**重要性**：扩展点存在但未行使。
- **简报 §3 检测到 4 个 system prompt**，但未检测到 few-shot / repair / compression prompt：**重要性**：Prompt 工程非本项目重点，Agent 智能主要外包给底层 LLM。

---

## 4. Architecture Smells（Potential，非断言）

- **Potential Tight Coupling**：简报 §2 报告 2 个 import cycle——`custodian.cli.main ↔ custodian.cli.menu`、`paladin.cli ↔ paladin.menu`。证据：cycle detection 数据。**风险**：CLI 与 menu 互相 import，重构时易产生隐藏回归。置信度中。
- **Potential Code Duplication**：`caduceus/cli.py` 与 `paladin/cli.py` 的模块 docstring 几乎逐字相同（"Values in, never out"），均实现 `Vault/Broker/SecretRef`。证据：两文件 docstring 对比、git history 显示 paladin 在 v0.4.0 才被 bundle。**风险**：孪生包维护成本翻倍，安全修复需双写。置信度高。
- **Potential Abandoned Code**：git `topActiveModules` 显示 `warden` 有 10 commits，但当前目录树无 `warden/`。证据：full.json git 段。**风险**：warden 可能被重命名为 paladin，但历史决策无 changelog 解释。置信度中。
- **Potential Observability Gap**：v0.4.0 commit "full sync from custodian-dev" 表明真实开发发生在 `custodian-dev` 仓库，本仓库是镜像/发布仓库。证据：full.json `largestRefactors`。**风险**：研究者只能看到 sync 后的快照，无法观察真实迭代过程。置信度高。
- **Potential Hidden Complexity**：`custodian/custodian/policy/enforcer.py` 存在嵌套重复路径（`custodian/custodian/`）。证据：LS。**风险**：可能是打包脚本误生成或遗留，易导致 import 歧义。置信度中。

---

## 5. Interesting Decisions

- **"Values in, never out" 凭证哲学**：凭证只能通过 `paladin/caduceus exec --with` egress 注入子进程，任何子命令（含 `show`/`list`/错误路径）永不打印值。**有趣处**：把"不泄露"从策略提升为 CLI 协议不变量。**替代方案**：env 文件 + .gitignore（常见但易泄露）。**权衡**：UX 复杂度上升，安全性结构性提升。
- **Tamper-evident 而非 tamper-proof**：`govern.py:46` 显式承认 `~/.custodian` snapshot 是"tamper-evident, not tamper-proof"。**有趣处**：作者拒绝过度声明，明确边界。**替代方案**：用内核 keyring / TPM。**权衡**：可移植性 vs 强度。
- **Stub 工具保留可见**：缺凭证工具返回 `{"ok": false, "stub": true}` 但仍在 `tools list` 显示。**有趣处**：能力面在 review 时可见，operator 知道"若配齐凭证会多出哪些能力"。**替代方案**：隐藏未配置工具。**权衡**：信息泄露（暴露能力意图）vs 审计透明。
- **Fail-closed money gates**：`evaluator.py:115` envelope check 异常时 escalate 而非 continue。**有趣处**：金钱门异常 = 人介入，而非"跳过检查放行"。**替代方案**：log + 继续。**权衡**：可用性下降，安全姿态提升。
- **`handled_skills` 自指**：adapter 可声明 `handled_skills` 伪装成真实工具，避免被 confabulation guard 误拒。**有趣处**：guard 之间通过"已知技能白名单"协作，形成自洽闭环。**权衡**：新增 adapter 需更新白名单逻辑。

---

## 6. Repository Positioning

| 维度 | 成熟度 | 说明 |
|------|--------|------|
| Planning | N/A | 非 Agent loop 项目，无 planner 对象 |
| Execution | Advanced | 独立 executor 进程 + sandbox + egress proxy + 最小权限 env |
| Memory | Emerging | kv-get/set/delete/list + sqlite-query 5 个 L0 工具 |
| Evaluation | Advanced | Claim verifier + poison tests + verify_kit + 1,346 测试 + corpus 语料 |
| Guardrails | Unique | 11 个 builtin adapter + TRANSFORM 谓词 + 结构性自批准不可能 |
| Prompt | Emerging | 4 个 system prompt（extractor/report），无 few-shot/repair/compression |
| Tooling | Advanced | 100+ governed skills，band-tagged，SKILL.md 自发现 |
| Observability | Advanced | UniversalLedger + SHA-256 receipt + audit trail + EventBus |
| Context Eng | Emerging | 无 compaction/sliding window，Agent 上下文外包给底层 LLM |

**生态定位**：Custodian 不与 LangGraph/CrewAI/OpenAI Agents 竞争——它不是 Agent 框架，而是**Agent 之外的治理内核**。最接近的类比是"Agent 世界的 sudo + SELinux + 审计日志"。它可被视为任意 Agent 框架的**横向治理层**。

---

## 7. Reusable Pattern Catalog

| 模式 | 描述 | 位置 | 可复用性 |
|------|------|------|----------|
| Kernel-as-Call-Path | `@govern` 装饰器把治理嵌入控制流 | `custodian/govern.py:203` | ✅ 通用 |
| 四层无承重信任链 | Agent→Verifier→Adapter→Kernel 各自确定性 | `custodian/packs/base.py:14` | ✅ 通用 |
| Guard Adapter Pipeline | pre/post hook + ALLOW/WARN/TRANSFORM/DENY | `custodian/adapters/base.py` | ✅ 通用 |
| 最小权限子进程 env | `_SAFE_RUNTIME_ENV` + per-tool `_ENV_REQUIREMENTS` | `custodian/tools/registry.py:117` | ✅ 通用 |
| 凭证 egress 注入 | "Values in, never out"，子进程 env 注入 | `paladin/cli.py` | ⚠ 需适配 |
| Tamper-evident source snapshot | SHA-256 快照 + drift 检测 + 原子写 | `custodian/govern.py:95` | ✅ 通用 |
| Claim/Envelope 验证器 | dotted path + relation 比对 ground truth | `custodian/packs/base.py:119` | ✅ 通用 |
| Stub-tool 能力面 | 缺凭证工具返回 stub 但保留可见 | `custodian/tools/registry.py:294` | ✅ 通用 |
| Fail-closed money gate | 异常即 escalate 而非 continue | `custodian/policy/evaluator.py:115` | ✅ 通用 |
| 独立 executor 进程 | opt-in 最强保证，抗进程攻陷 | `custodian/executor/` | ⚠ 需适配 |
| 密钥 sentinel 脱敏 | `_SECRET_SENTINELS` + `_FILE/_DIR/_PATH` 豁免 | `custodian/types.py:83` | ✅ 通用 |

---

## 8. Architecture Evolution

基于 full.json `git` 段（10 commits，2026-06-28 至 2026-07-21，~3.5 周）：

| 版本 | 日期 | 事件 | 证据 |
|------|------|------|------|
| v0.1.1 | 06-28 | 初始 kernel（107 files） | `largestRefactors[2]` |
| v0.1.2 | 06-28 | bundle 100 tools + demo-verify（262 files） | `largestRefactors[0]` |
| v0.2.0 | 06-30 | "kernel as fabric"（84 files） | `largestRefactors[4]` |
| v0.2.1 | 07-06 | cyberware-adoption 安全特性（10 files） | `largestRefactors[7]` |
| v0.3.0/0.3.1 | 07-14 | release（81 + 24 files） | `largestRefactors[5,6]` |
| v0.4.0 | 07-21 | control plane + ledger + full sync from custodian-dev（110 files） | `largestRefactors[1]` |
| — | 07-21 | bundle paladin（99 files） | `largestRefactors[3]` |

**关键演进信号**：
- **warden → paladin 重命名/替换**：`topActiveModules` 中 warden（10 commits）消失，paladin（19 commits）接管，但无 changelog 记录此迁移。
- **"full sync from custodian-dev"**：本仓库是发布镜像，真实迭代在 `custodian-dev`。这意味着 10 commits 不反映真实开发强度，仅反映 sync 节奏。
- **cyberware-adoption**：v0.2.1 commit message 显示项目从名为 "cyberware" 的前序项目借鉴安全模式（`govern.py:101` 注释亦提及 "Pattern from cyberware's executor.py .bk"）。
- **从 kernel-as-decorator 到 kernel-as-fabric**：v0.2.0 的 "kernel as fabric" 标志着从单一 `@govern` 装饰器扩展为完整 adapter/control/executor 体系。

---

## 9. Reading Guide

### 30 分钟速览（按洞察密度排序）
1. `README.md` — 项目哲学"model proposes, kernel decides, verifier proves, kill switch stops"（简报 §7 #2）
2. `custodian/packs/base.py:1-31` — 四层信任链注释，全项目最浓缩的设计声明
3. `custodian/govern.py:203-322` — `@govern` 装饰器主体，理解"kernel-as-call-path"
4. `custodian/policy/evaluator.py:23-120` — `decide()` 控制流，理解 kill switch 优先级与 fail-closed
5. `custodian/adapters/base.py` — Adapter 协议（ALLOW/WARN/TRANSFORM/DENY + handle_action）

### 2 小时深入（+ 以下文件）
6. `custodian/tools/registry.py` — ToolRegistry 自发现 + 最小权限 env + sandbox + executor 委托
7. `custodian/adapters/builtin/prompt_injection_guard.py` — 代表性 guardrail，理解正则 + base64 解码再扫
8. `custodian/types.py` — 全库数据契约（入度 69，PageRank 最高），含密钥 sentinel 脱敏
9. `paladin/cli.py` — "Values in, never out" 凭证 egress 哲学
10. `tests/test_self_approval_regression.py` — 安全 bug 回归测试范式
11. `custodian/executor/client.py` + `service.py` — 独立进程最强保证
12. `custodian/universal_ledger.py` — 审计链与 hash chain
13. `caduceus/cli.py` — 与 paladin 对比，理解孪生包 duplication smell
14. `custodian/packs/refunds/corpus/06-planted-lie.json` — poison test 语料实例
15. `pyproject.toml` — 三个独立 CLI 入口 + optional deps 拆分

---

## 10. Open Questions

- **caduceus vs paladin 谁在退役？** 两者 docstring 几乎逐字相同，功能高度重叠。git 显示 paladin 在 v0.4.0 才 bundle，caduceus 更早。**重要性**：决定凭证层未来方向。**调查方法**：读 `custodian-dev` 仓库（若可访问）的近期 commit；查 `paladin/vault.py` vs `caduceus/vault.py` 实现差异。
- **`custodian/custodian/policy/enforcer.py` 嵌套路径是打包 bug 还是遗留？** **重要性**：影响 import 正确性。**调查方法**：查 setuptools find 配置 + 实际 import 该路径的代码。
- **`custodian-dev` 真实开发仓库在哪？** "full sync from custodian-dev" 表明本仓库非一手源。**重要性**：研究者观察到的迭代非真实节奏。**调查方法**：查 GitHub org `KeyArgo` / `InovinLabs` 下是否公开 `custodian-dev`。
- **无 CI 如何保证 1,346 测试持续通过？** **重要性**：安全 kernel 项目无 CI 是显著风险。**调查方法**：查是否有 pre-commit hook、本地 Makefile、或外部 CI（如 getcustodian.xyz 部署流水线）。
- **`custodian/control/` 控制面与 kernel 的边界？** v0.4.0 引入 control plane（contracts/filesystem_policy/ledger_access_policy/service）。**重要性**：理解治理权从 kernel 扩展到控制面的意图。**调查方法**：读 `custodian/control/service.py` 与 `policy/enforcer.py` 的交互。
- **`nemoclaw` adapter 是什么？** `custodian/adapters/nemoclaw.py` 存在但简报未覆盖其语义。**重要性**：可能是第三方 Agent 框架适配。**调查方法**：读 `nemoclaw.py` 与 `tests/test_nemoclaw_adapter.py`。

---

*报告完。所有结论均引用证据（文件路径、简报章节、git 段、LS 验证）。置信度标注遵循"高=多源交叉验证、中=单源或部分验证、低=仅推断"原则。*
