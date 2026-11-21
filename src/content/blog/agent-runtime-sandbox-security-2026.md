---
author: SW
pubDatetime: 2026-11-21T00:00:00Z
title: "Agent Runtime 安全架构：桌面、云端、Kubernetes 与 GUI VM 的隔离设计"
featured: false
draft: false
tags:
  - AI
  - Agent
  - Agent Runtime
  - Security
  - Sandbox
  - Architecture
description: "从工具授权、资源权限和执行隔离出发，分析 Agent Runtime 在桌面、云端、Kubernetes 与 GUI VM 中的安全架构、Sandbox 选型和上线控制。"
---

# Agent Runtime 安全架构：桌面、云端、Kubernetes 与 GUI VM 的隔离设计

Agent Runtime 一旦允许模型读文件、改文件、运行命令或调用 MCP，安全问题就不再只是“模型会不会听 Prompt”。真正需要回答的是：即使模型生成了恶意命令，或者某个工具被 Prompt Injection 诱导，它实际能够访问哪些文件、启动哪些进程、连接哪些网络目标？

这不是给 Tool Schema 加一个权限字段就能解决的问题。工具权限、资源授权和执行隔离是三个不同层次。前两者决定 Agent 理论上可以做什么，最后一层要保证即使执行路径发生偏差，也不能越过操作系统设置的边界。

开源生态已经有几种不同取向的实现：Anthropic 把 Claude Code 使用的 OS Sandbox Runtime 开源；OpenAI 公开了 Codex Sandbox 的工程设计；Vercel 的 just-bash 用 TypeScript 实现一个虚拟 Shell；OpenHands 用 Docker Runtime 提供完整执行环境；MCP Filesystem Server 则在文件工具本身实施目录范围控制。它们解决的问题并不相同，不能简单排成一个“沙箱产品排行榜”。

本文从 TypeScript / Node.js Agent Runtime 出发，讨论桌面、云端、Kubernetes 和带 GUI 的 VM 执行环境，重点区分 Tool 授权、资源授权与 OS / VM 隔离。

## 1. 威胁模型：Agent Runtime 的攻击面已经超出模型输入

传统 Web 应用的威胁模型主要关注请求入口、身份认证、授权、数据访问和服务端执行。Agent Runtime 还增加了一个重要特征：系统会把来自不同信任等级的内容放进同一个推理循环，再由模型决定下一步调用哪个工具。

用户指令、系统策略、邮件正文、网页、PDF、终端输出、MCP Tool Result、Agent Memory、子 Agent 消息，不能被视为同一种可信输入。攻击者不一定需要直接访问 Runtime；只要能影响 Agent 会读取的网页、邮件、仓库文件、工单或工具返回值，就可能改变 Agent 的后续动作。

至少需要考虑以下攻击者和风险来源：

| 风险来源 | 可能的攻击能力 | 典型目标 |
| --- | --- | --- |
| 恶意用户或租户 | 构造任务、上传文件、提交代码、诱导资源消耗 | 越权访问、跨租户读取、资源耗尽 |
| 间接提示注入者 | 控制网页、邮件、文档、代码注释、图片或工具返回内容 | 劫持目标、诱导调用工具、数据外传 |
| 恶意或被攻陷的 MCP / Plugin | 返回恶意工具描述、参数、结果，或在本地执行代码 | 读取凭证、扩大工具权限、横向移动 |
| 恶意依赖与构建产物 | 包安装脚本、插件、浏览器扩展、容器镜像或更新包被替换 | RCE、供应链持久化、窃取构建凭证 |
| 被攻陷的 Agent / 子 Agent | 借助委托关系、共享 Memory 或过宽 Token 访问其他系统 | 身份冒用、跨 Agent 权限提升 |
| 恶意或失陷的外部服务 | 返回伪造结果、重定向请求、滥用回调和 Webhook | SSRF、凭证泄露、数据污染 |
| 同机或同集群其他工作负载 | 利用共享内核、共享存储、网络和节点权限 | 容器逃逸、跨租户访问、侧信道 |
| 内部人员或错误配置 | 过度授权、关闭审计、共享管理员凭证、错误恢复快照 | 隐蔽访问、长期权限残留 |

需要保护的资产不只是文件和 Token。还包括用户身份、Agent 身份、OAuth 授权、云 Workload Identity、浏览器 Cookie、SSH Agent、桌面会话、剪贴板、截图、屏幕录制、持久化 Memory、任务快照、工具清单、策略版本、模型上下文、审计记录以及控制面本身。

一个实用的威胁分析方法，是沿着 Agent 生命周期逐段问问题：

1. **输入与上下文构建**：哪些内容由用户提供，哪些来自外部数据源？有没有把网页或文件中的指令误当成授权？
2. **规划与决策**：Agent 能否改变原始任务目标？能否在任务执行中自行扩大权限或引入新工具？
3. **工具选择与参数生成**：参数值来自用户请求、可信工具结果，还是模型猜测？收件人、账户、URL、文件路径和金额是否有可验证来源？
4. **执行与副作用**：工具实际以什么身份运行？子进程、MCP Server、浏览器和 GUI 自动化是否继承了更大的宿主机权限？
5. **结果与数据流**：敏感信息会进入模型上下文、日志、截图、外部 API 或共享存储吗？
6. **状态与委托**：Session、Memory、快照和子 Agent 是否跨用户、跨租户或跨任务复用？权限能否及时撤销？
7. **监控与恢复**：谁能识别异常行为、终止整个进程树、断开网络、撤销 Token 并保留取证证据？

安全目标不是保证模型永远不犯错，而是确保模型犯错、被注入、工具被攻陷或某个执行组件失陷时，影响范围仍然受控。

## 2. 先把三个安全层次分开

### Tool Permission：模型可以调用什么

Tool Registry 和 Permission Policy 决定某个 Agent 是否能调用 read_file、write_file、bash、browser 或某个业务 API。它解决的是工具入口授权。

例如，一个文档分析 Agent 可以读取文件，但不应该获得发送邮件、修改 CRM 或执行任意 Shell 的能力。即使某个 Tool 已注册，也不代表所有 Agent 都可以使用它。

这一层通常由 Runtime 自己实现：工具注册、角色和任务策略、参数 Schema、审批流程、调用审计。它很重要，但不是安全边界。只要另一个工具能访问相同资源，或者某个 MCP Server 拥有更大的宿主机权限，Tool Allowlist 就可能被绕开。

### Resource Permission：工具可以操作哪些资源

资源授权进一步限制路径、对象、记录和操作类型。比如工作区可以读写、参考资料只读、.env 和 SSH Key 拒绝访问；某个业务 API 只允许读取当前项目的记录，不允许跨客户查询。

这里不能只用一个笼统的 Read/Write 标志。创建、覆盖、移动、删除、执行文件应视为不同能力。写入工作区也不等于可以执行工作区中的任意脚本。

这一层可以由 File Access Service、Connector Gateway 或 MCP Server 实现，但必须确保授权检查绑定到实际资源，而不是只对模型传来的字符串做判断。路径穿越、符号链接、硬链接、挂载点和检查后替换文件的 TOCTOU 问题，都可能让表面上的目录 Allowlist 失效。

### Runtime Sandbox：进程实际能触及什么

Sandbox 是最后一道执行边界。它限制进程及其子进程能够访问的文件系统、网络、系统调用、IPC、设备和宿主机资源。

这层不能依赖模型遵守规则，也不能只依赖 Tool Registry。假设 Agent 获准运行 Python，那么 Python 脚本、它启动的子进程以及被加载的原生模块都必须处于同一个受控边界内。否则，允许执行 Python 实际上可能意味着允许任意访问宿主机。

![Agent Runtime 的工具授权、资源授权与执行隔离架构](/diagrams/agent-runtime-security-layers.svg)

[查看架构图（HTML）](/diagrams/agent-runtime-security-layers.html)

三层之间的关系可以概括为：Tool Permission 决定入口，Resource Permission 决定目标，Sandbox 限制执行能力。它们应该纵深叠加，而不是互相替代。

## 3. 一个适合 TypeScript Agent Runtime 的分层设计

对于本地桌面 Agent，我倾向于把策略和执行机制分开：Runtime 自己掌握 Tool Registry、Policy Engine、审批和审计；底层通过成熟的 OS Sandbox 执行真实进程，不自己重写操作系统隔离机制。

![Agent Runtime 端到端安全执行链路](/diagrams/agent-runtime-end-to-end.svg)

[查看端到端执行架构图（HTML）](/diagrams/agent-runtime-end-to-end.html)

建议的执行路径：

1. Agent 提出工具调用，Runtime 校验 Tool 是否对当前 Agent、Task 和用户开放。
2. Policy Engine 检查主体、动作、资源、数据分类、目的地和任务上下文，返回允许、拒绝或要求审批。
3. 对文件操作，优先走 Capability Filesystem Service。它只暴露已授权的目录句柄或资源 ID，不让模型任意拼接宿主机路径。
4. 对 Shell 任务，先判断是否真的需要真实 Shell。有限命令和数据处理优先使用 just-bash；需要调用本机工具链时，才启动 OS Sandbox。
5. Sandbox 根据执行 Profile 限制文件读写、网络、IPC 和子进程。环境变量采用显式 Allowlist，不能把整个宿主机环境复制给 Agent。
6. 执行结果返回 Runtime 后，记录策略版本、执行身份、命令摘要、资源范围、网络目的地、退出码和产物引用。敏感文件内容不应直接写入普通审计日志。

一个概念性的 Execution Profile 可以这样表达：

~~~yaml
profile: document-analysis
filesystem:
  read:
    - ./workspace
    - ./reference
  write:
    - ./workspace/output
  deny:
    - "**/.env"
    - "~/.ssh"
    - "~/.aws"
network:
  mode: deny
process:
  mode: virtual-shell
  commands:
    - cat
    - grep
    - jq
    - python
limits:
  timeoutSeconds: 60
  maxOutputBytes: 1048576
  maxFiles: 500
~~~

这只是 Runtime 自己的策略模型示例，不是 Anthropic SRT 或 just-bash 的原生配置格式。策略编译器需要把它转换成不同执行后端能够理解的约束，并明确哪些约束由应用层实施、哪些由 OS 强制实施。不能支持某项策略的后端，应拒绝启动该 Profile，不能静默忽略。

### 3.1 通用架构：把身份、策略、执行、数据和观测分开

一个可运营的 Agent Runtime 至少需要五个逻辑平面。它们可以部署在同一个应用中，但不应共享不受约束的权限。

| 平面 | 主要组件 | 必须回答的问题 |
| --- | --- | --- |
| Identity Plane | User Identity、Agent Identity、Workload Identity、Credential Broker | 谁在行动？代表谁？凭证能访问什么、何时失效？ |
| Control Plane | Agent Orchestrator、Policy Engine、Approval、Tool Registry、Session Manager | 任务允许做什么？策略由谁批准？权限如何撤销？ |
| Execution Plane | Tool Worker、Browser Worker、Script Sandbox、Container / VM | 进程实际能访问哪些文件、网络、设备和系统接口？ |
| Data Plane | Workspace、Object Storage、Memory、RAG、Artifact Store、Secrets | 数据属于谁？可信等级如何标记？数据能流向哪里？ |
| Observability Plane | Audit、Trace、Runtime Detection、Incident Response | 谁执行了什么？是否越权？能否追溯、终止和恢复？ |

这五个平面之间要有明确的信任边界。Agent Orchestrator 不应该因为能调度任务，就自动拥有执行任务所需的全部凭证；Sandbox 不应该因为需要读取某个文件，就拿到整个用户 Home；Agent 不应该因为要调用一个 API，就直接获得长期用户 Token。

建议建立以下不可破坏的安全不变量：

- **权限由可信控制面授予，不由模型授予自己。** 模型可以提出工具调用和所需能力，但不能修改 Policy、扩大 Resource Scope 或选择更宽松的 Sandbox Backend。
- **外部内容默认不可信。** 网页、邮件、文档、图片 OCR、终端输出和 Tool Result 中出现的命令或授权语句，不能自动变成用户授权。
- **身份与凭证分离。** Agent 有自己的可审计身份；代表用户执行时使用显式、可撤销、范围受限的委托授权，而不是复制用户的长期凭证。
- **策略与执行双重检查。** Tool 层判断动作是否获准，执行后端确保进程不能越过已批准的资源边界。
- **默认拒绝，能力不足时失败关闭。** 某个后端无法执行必要的文件、网络或 UI 限制时，不允许自动退化为宿主机直接执行。
- **所有高风险副作用可归因、可中止、可恢复。** 审批、执行、网络访问、身份和产物之间必须有可关联的记录。

### 3.2 通用安全控制：不能只做 Prompt Filter

#### 任务边界和自主程度

不要给 Agent 一个无限期、无限目标的“自主工作”权限。每个 Task 应有明确的目标、可访问资源、允许动作、时间窗口、预算、最大步骤数、最大工具调用数和终止条件。任务完成、取消、超时或审批撤销后，临时能力应立即失效。

可以将操作分成四个风险等级：

| 等级 | 操作类型 | 典型动作 | 建议策略 |
| --- | --- | --- | --- |
| R0 | 观察和本地计算 | 读取已授权文件、搜索、计算、生成草稿 | 默认允许已授权范围，完整审计 |
| R1 | 可恢复的本地变更 | 写入任务输出目录、创建草稿、修改可回滚文件 | 受限授权，必要时 Diff Preview |
| R2 | 代码执行和外部通信 | Bash、Python、安装依赖、访问外部网站、调用 SaaS API | 独立 Sandbox、目的地策略、按任务审批 |
| R3 | 高影响或不可逆动作 | 删除、付款、发送外部邮件、发布、生产变更、权限变更 | 明确的人类确认，绑定具体参数和结果，必要时双人审批 |

风险等级不是简单按 Tool 名称决定。read_file 读取一个公开 README 和读取客户合同，风险不同；browser 打开公开网站和向外部发送客户数据，风险也不同。Policy Engine 应结合主体、动作、资源分类、数据来源、目标地址、任务目标和执行环境计算风险。

#### 身份、授权和凭证

Agent Identity 应成为一等安全主体，而不是把所有动作都记录为“某用户调用了模型”。至少区分：

- User Principal：真实登录用户及其组织、租户和设备上下文。
- Agent Principal：某个 Agent 实例、角色和版本。
- Task Principal：当前任务的短期执行身份和权限集合。
- Workload Identity：实际运行在进程、Pod、容器或 VM 中的工作负载身份。
- Delegated Identity：代表用户访问外部业务系统时获得的受限委托身份。

每次授权应尽可能包含 subject、action、resource、purpose、audience、expiry 和 constraints。子 Agent 只能获得父任务明确委托的能力，不能继承父 Agent 的全部 Token。MCP Server 也应有独立身份，不能因为它由某个 Agent 启动就自动获得 Agent 的所有权限。

凭证应由 Credential Broker 或受控代理提供。优先使用短期 Token、OAuth On-Behalf-Of、Workload Identity、SPIFFE / SPIRE 或云厂商的短期身份凭证。对脚本和浏览器进程，避免把长期 API Key 放在环境变量、命令行参数、工作目录或可读取文件中。需要出站认证时，可以由 Egress Gateway 在请求路径上注入短期凭证，避免把 Token 直接交给不可信执行环境。

#### Prompt Injection、数据来源和参数溯源

Prompt Injection 不是单纯的输入清洗问题。攻击内容可能藏在 HTML、邮件引用、Markdown、PDF、代码注释、图片 OCR、终端输出、工具描述和 Agent Memory 中。即使输入过滤器漏掉了攻击，执行边界也应该阻止它完成未授权动作。

建议把内容来源和信任等级作为结构化元数据保存，而不是只把所有文本拼进一个 Prompt：

- trusted_instruction：系统策略、经过认证的用户指令和应用控制面下发的约束。
- user_data：用户提供但不构成授权的文件、文本和附件。
- external_untrusted：网页、邮件、第三方 API、MCP 结果、外部仓库内容。
- tool_observation：工具返回的事实数据，保留工具身份、时间和来源。
- model_generated：模型生成的计划、参数和解释。

对于敏感参数，应记录来源 Provenance。例如邮件收件人、支付账户、文件路径、外部 URL、数据库目标和数据导出目的地，必须能够追溯到用户请求或用户明确指定的数据源。模型自行推测出来的值，不应自动成为高风险动作的授权依据。

[ToolFence](https://arxiv.org/abs/2609.37196) 提供了一个有价值的研究方向：在执行前将用户请求编译成 typed authorization blueprint，再用确定性 Monitor 检查工具和参数；当需要扩展能力时，再走受控的 capability grant。它强调不仅要检查“调用了哪个 Tool”，还要检查参数值来自哪里。这对防止攻击者在一个本来获准的 Tool 内替换收件人、目标 URL 或资源标识尤其重要。论文仍是研究工作，不应把其结果直接视为通用安全保证；Provenance 也不能单独判断多个合法候选值中哪一个真正符合用户意图。

#### Tool、MCP、Plugin 和模型供应链

工具 Schema、MCP Server、Agent Skill、Prompt Template、模型、Embedding Model、浏览器扩展、容器镜像和依赖包都属于运行时供应链。不要允许生产 Agent 在任务执行时随意从公共 Registry 下载并加载新工具。

建议维护批准的工具目录，记录发布者、版本、哈希、签名、权限声明、网络目的地、依赖和升级记录。对 MCP Server 使用独立进程、最小权限和独立 Sandbox。工具发现和工具安装必须分开：Agent 可以搜索可用能力，但安装、启用和授予新权限应由可信控制面或管理员完成。

容器镜像和 VM 基础镜像应固定版本或 Digest，扫描漏洞，生成 SBOM，验证签名和来源。模型版本、System Prompt、Tool Schema 和 Policy Bundle 也应进入变更管理；模型升级不能绕过回归安全测试。

#### 数据保护、信息流和网络出口

文件系统隔离只回答“进程能读什么”，不能回答“读到的数据能发到哪里”。因此要把数据分类、用途、接收方和出口策略结合起来。

至少要区分：
- 数据读取授权：Agent 能否看到该数据。
- 数据处理授权：允许用什么模型、区域和服务处理。
- 数据输出授权：允许写到哪个文件、对象存储或业务系统。
- 数据传输授权：允许发送给哪个域名、租户、API 或人员。
- 数据保留授权：日志、Memory、向量库、快照和模型上下文保留多久。

网络策略应默认拒绝，并分别控制 Egress、Ingress 和 Host Loopback。域名 Allowlist 不应只在 Agent 代码里做字符串比较；要防止 DNS Rebinding、CNAME、重定向、私有 IP、云元数据地址、IPv6 表示差异和代理绕过。HTTP 代理只对遵守代理设置的客户端有效，不能假设任意 TCP、UDP、SSH 或自定义协议都会经过它。

对云端 Agent，尤其需要阻断访问云实例元数据服务、Kubernetes API、节点管理端口、内部控制面和其他租户服务。对桌面 Agent，则需要避免把本地浏览器、VPN、企业内网和用户已经登录的业务系统全部暴露给任意脚本。

#### Memory、快照和多 Agent 委托

长期 Memory 是一个持久化攻击面。被污染的文档或工具结果可能进入 Summary、Embedding、用户偏好、Agent Profile 和任务快照，影响后续 Session。Memory 写入需要来源、身份、时间、任务和可信等级；敏感记忆应支持访问控制、版本、撤销和删除传播。

不要跨用户或跨租户复用未经隔离的 Memory、Workspace、Browser Profile、Cookie Jar、文件缓存和 Sandbox Snapshot。快照恢复时要检查镜像来源、策略版本、凭证是否仍有效、网络身份是否重新绑定，以及快照中是否残留上一个任务的数据。

多 Agent 架构要使用显式消息协议和授权委托。消息中应携带发送者身份、任务 ID、能力范围、有效期、数据来源和完整性保护。接收 Agent 不能把另一个 Agent 的自然语言消息视为授权；跨 Agent Tool Call 仍需重新执行 Policy Check。子 Agent 的权限通常应小于或等于父任务当前委托的权限。

#### Human-in-the-loop、审计和应急停止

Human Approval 应由 Orchestrator 强制执行，而不是寄希望于模型在 Prompt 中“记得询问用户”。审批界面必须展示实际目标、资源、接收方、内容摘要、数据分类、权限范围和执行后果。用户批准后，如果参数、脚本摘要、文件内容、收件人、URL 或 Sandbox Profile 发生变化，必须重新审批。

审计至少记录：User / Agent / Task Identity、Session、Tool Name、规范化参数摘要、策略版本、决策结果、审批人、Sandbox Backend、镜像 / 代码版本、资源范围、网络目的地、开始结束时间、退出码、产物引用和异常事件。日志不应直接复制全部 Prompt、文件内容、Token、Cookie 或截图；需要保留证据时应使用独立加密存储、访问控制和保留策略。

必须有独立于 Agent 自身的 Emergency Stop。停止按钮不能只发送一个取消消息给模型；它应该能取消任务、终止完整进程树、停止 Sandbox、撤销短期凭证、断开出站网络、冻结相关队列，并保留审计证据。云端还应支持按 Tenant、Agent、Task、Worker Pool 和工具供应商分别熔断。

### 3.3 不要把“命令白名单”当成完整的执行安全

允许 node、python 或 bash，并不意味着只允许了某种安全操作。它们本身就是通用解释器，可以读取文件、启动子进程、加载模块和访问网络。命令白名单最多是减少入口，不是资源边界。

更有效的控制是：真实进程在 Sandbox 内运行；文件系统和网络权限按 Profile 配置；子进程继承限制；凭证不进入执行环境；执行有时间、内存、CPU、输出和并发上限。对不可信代码，还应限制文件解析器、编译器插件、包安装脚本和本地扩展的执行路径。

### 3.4 MCP Server 也应该被视为执行进程

MCP 只是工具协议，不是安全容器。一个 MCP Server 可以在启动时读取环境变量、访问本地文件、连接网络或启动子进程。Server 的 Tool Schema 只描述模型能看到的调用入口，不代表 Server 运行时的实际权限。

因此，来自第三方或动态安装的 MCP Server，应该以独立进程运行，并使用最小权限身份和独立 Sandbox。对于可信的内置 MCP Server，也应只授予它完成任务所需的目录、网络和凭证范围。不要让所有 MCP Server 共享 Agent Runtime 的主进程权限。

### 3.5 审批应该绑定具体动作，而不是绑定工具名称

“允许调用 write_file”不是一个足够明确的审批对象。审批至少应绑定目标文件、操作类型、内容或 Diff 摘要、任务 ID、执行身份和有效期。对外发送、删除、覆盖、批量移动和业务系统更新等动作，需要单独的风险策略。

如果审批后模型改变了文件路径、内容或目标对象，就应重新进行策略判断。用户确认不能覆盖组织级拒绝规则，也不能把一次批准扩展为长期授权。
## 4. Read、Write、Bash 应该是三个独立的 Tool 边界

前面讨论的是 Tool Permission、Resource Permission 和 Runtime Sandbox 三个安全层次。落到 Agent 的实际工具设计，还需要再做一次拆分：不要把文件读取、文件写入和脚本执行包装成一个通用的 `filesystem` 或 `terminal` 能力。

这三种操作的权限语义不同。Read 是信息披露风险，Write 是数据完整性风险，Bash 则是通用代码执行风险。一个 Agent 获得读取权限，不应该因此获得写入权限；获得写入权限，也不应该自动获得执行刚写入脚本的权限。

### 4.1 Read Tool：把读取做成只读、可审计的资源访问

Read Tool 只负责读取已经授权的资源，不应提供任何执行或修改能力。建议把它拆成几个语义明确的操作：`list_directory`、`stat_file`、`read_file`、`search_files`。如果需要读取大文件，使用 offset、limit 或分页，不要一次把整个目录或文件树塞进上下文。

权限判断至少包含主体、资源、操作和数据分类。比如某个 Agent 可以读取项目文档，却不能读取 `.env`、SSH Key、浏览器 Profile、云凭证或其他客户目录。目录列表本身也可能泄露文件名和项目结构，因此 `list` 不是天然无风险的操作。

不要仅靠字符串前缀判断路径是否在工作区内。路径规范化后仍要处理符号链接、硬链接、挂载点和路径替换竞态。Linux 上可以研究 `openat2` 的 `RESOLVE_BENEATH`、`RESOLVE_NO_MAGICLINKS` 等约束；跨平台实现则应采用经过审查的目录句柄 / capability 文件访问层，或让文件服务本身运行在 OS Sandbox 内。Node.js 的普通 `realpath()` 后再 `readFile()` 并不能单独消除 TOCTOU 风险。

另一个值得研究的方向是 [AgentFense](https://github.com/AjaxZhan/AgentFense)。它使用 FUSE 把真实文件系统投影成 Agent 可访问的视图，并区分 `none`、`view`、`read` 和 `write`：例如可以允许 Agent 看到目录结构，却不能读取文件内容；也可以让它读取代码，但不能修改。这个模型比简单的目录 Allowlist 更细，尤其适合需要把真实代码库暴露给 Agent、同时隐藏密钥和敏感目录的场景。项目目前规模较小，应把它视为值得验证的设计参考，而不是未经测试就直接采用的安全基座。它的文档还记录了 macOS + Docker Desktop 下 `view` 权限可能受 VirtioFS 限制而失效的情况；如果采用这类 FUSE / 虚拟文件系统方案，必须把目标 OS、文件系统驱动和容器组合纳入测试矩阵。

### 4.2 Write / Edit Tool：写入不是执行，修改应该可回滚

Write Tool 不应和 Bash 共用执行权限。它只允许对授权工作区执行明确的文件操作。建议至少区分：

| 操作 | 建议语义 |
| --- | --- |
| `create_file` | 仅创建不存在的文件，默认不覆盖 |
| `replace_file` | 替换已存在文件，要求版本 / ETag 匹配 |
| `apply_patch` | 应用明确的 Diff，返回实际变更 |
| `delete_file` | 单独授权，通常需要确认 |
| `move_file` | 源和目标分别检查权限，不允许借移动绕过目录边界 |

尤其要避免一个常见设计：提供 `write_file(path, content)`，然后把覆盖、创建、删除、目录创建等全部隐含在一个接口里。工具调用越通用，Policy Engine 越难判断实际影响。

对于重要文件，推荐先写入任务级 staging area，再通过 Diff / Preview 展示变更。提交时检查目标路径权限和原文件版本，使用临时文件加原子替换，保留可恢复版本。审批应绑定目标路径、操作类型、内容摘要、任务 ID 和有效期；如果模型在审批后改变了内容或目标，必须重新审批。

还要明确区分“写入脚本文件”和“执行脚本文件”。`write_file("cleanup.sh", ...)` 只产生一个文件，不应触发 Shell。脚本执行必须经过独立的 `execute_script` Tool 和独立的 Sandbox Policy。这样，文档 Agent 即使能够生成自动化脚本，也不会因此获得运行脚本的能力。

### 4.3 Bash / Script Tool：把它当作不可信代码执行服务

Bash 的能力远超普通 Tool。即使只允许一个 `bash` Tool，模型也可能通过 Shell、解释器、管道、重定向、子进程和系统命令访问大量宿主资源。因此，不能把命令黑名单或正则表达式当作主要安全机制。

推荐把执行入口设计成一个独立的 Execution Service：

- 输入是脚本内容、工作目录的资源标识、参数和明确的 Execution Profile，而不是任意宿主机路径。
- 执行时创建独立进程或 Sandbox Session，不能在 Agent Runtime 主进程中执行任意脚本。
- Sandbox 显式配置只读目录、可写目录、临时目录、网络策略、环境变量和进程限制。
- 所有子进程继承相同或更严格的隔离策略。
- 进程超时后终止整个进程组 / Job Object，而不是只结束最外层 Shell。
- 限制 CPU、内存、PID 数、文件大小、输出字节数、并发数和执行时长。
- 默认不注入宿主机环境变量、长期 Token、SSH Agent Socket、浏览器 Profile 和 Docker Socket。
- 执行结果返回 stdout、stderr、exitCode 和产物引用；不要无限制地把所有输出写回模型上下文。

对于桌面 Runtime，macOS 可以评估 Seatbelt，Linux 可以评估 Bubblewrap、Landlock 和 seccomp；需要跨平台统一管理时，可以研究 Anthropic Sandbox Runtime。需要完整 Linux 环境或运行不可信依赖时，再考虑 Docker、gVisor 或 microVM。

如果脚本由模型生成，审批不应只显示“允许执行 Bash”。应展示脚本内容或 Diff、工作目录、读写范围、网络权限和执行限制。审批绑定脚本内容摘要及 Execution Profile；脚本内容、参数或权限发生变化时，之前的批准失效。

### 4.4 有哪些项目值得对照

| 项目 | 对 Read / Write 的设计 | 对 Bash / Script 的设计 | 适合借鉴的部分 |
| --- | --- | --- | --- |
| [AgentFense](https://github.com/AjaxZhan/AgentFense) | FUSE 文件视图，none / view / read / write | 通过受限文件系统配合普通 Shell 工作流 | 文件级能力授权、隐藏敏感资源 |
| [easy-agent](https://github.com/ConardLi/easy-agent) | Read、Write、Edit、MultiEdit 等独立工具 | Bash / PowerShell 配合 allow / ask / deny 和 OS Sandbox | Tool 拆分、审批策略和执行隔离的组合 |
| [Deep Agents](https://github.com/langchain-ai/deepagents) | Virtual Filesystem、声明式 read / write path permissions | 可插拔 Sandbox Backend 的 execute Tool | 文件权限和执行后端的职责分离 |
| [Anthropic Sandbox Runtime](https://github.com/anthropics/sandbox-runtime) | 不负责 Agent 级文件 Tool 语义 | 对任意进程实施 OS 级文件和网络限制 | 作为真实 Shell / MCP 进程的隔离层 |
| [just-bash](https://github.com/vercel-labs/just-bash) | 虚拟文件系统上的受控读写 | TypeScript 实现的 Shell 语义，不启动真实宿主 Shell | 低风险任务的受限命令环境 |

这里有两个容易误读的地方。第一，Deep Agents 的文件权限规则并不自动约束 Sandbox Backend 中的任意代码执行；其文档明确要求 Sandbox Backend 自己承担执行侧策略。另外，它的路径规则按声明顺序 first-match-wins，且没有匹配规则时默认允许，因此生产策略应明确写出最后的 catch-all deny，避免遗漏路径变成默认放行。第二，AgentFense 的 FUSE 文件视图能把文件访问权限落实到文件系统层，但它不能替代网络隔离、进程限制和凭证保护。工具权限和执行权限仍需分别配置。

[easy-agent](https://github.com/ConardLi/easy-agent) 是一个更完整的 Agent Harness 参考：它把 Read / Write / Edit / Bash 做成不同工具，并组合权限规则、OS Sandbox、MCP 和子 Agent。它适合研究工具注册、授权和执行路径如何在一个 TypeScript Agent 中协作，但仍需按目标平台审查其 Sandbox 覆盖范围；项目文档列出的 Windows Shell Sandbox 能力与 macOS / Linux 并不相同。

### 4.5 推荐的 Tool Contract

可以把 Agent 暴露的接口收敛成以下几类。这里是 Runtime 的逻辑接口，不代表某个项目的现成 API：

```typescript
type ResourceRef = {
  workspaceId: string;
  resourceId: string; // Runtime 解析，不接受任意宿主机绝对路径
};

interface ReadTools {
  listDirectory(ref: ResourceRef): Promise<DirectoryEntry[]>;
  readFile(ref: ResourceRef, range?: { offset: number; limit: number }): Promise<FileContent>;
  searchFiles(query: SearchQuery): Promise<SearchResult[]>;
}

interface WriteTools {
  createFile(ref: ResourceRef, content: string): Promise<ChangeSet>;
  applyPatch(ref: ResourceRef, patch: string, expectedVersion: string): Promise<ChangeSet>;
  deleteFile(ref: ResourceRef, expectedVersion: string): Promise<ChangeSet>;
  commitChangeSet(changeSetId: string, approval?: ApprovalRef): Promise<CommitResult>;
}

interface ExecutionTools {
  executeScript(input: {
    script: string;
    workingDirectory: ResourceRef;
    profile: "read-only" | "workspace-write" | "network-enabled";
    timeoutSeconds?: number;
  }): Promise<ExecutionResult>;
}
```

这套接口刻意不提供 `execute(path)`，也不允许模型传入任意宿主机绝对路径。脚本执行可以使用临时脚本文件，也可以通过标准输入传给固定的 Shell 入口；无论哪种方式，执行目录、挂载范围和权限都由 Runtime 决定。

权限策略应该在 Tool 层和执行后端各检查一次：Tool 层判断这个 Agent 是否能对这个资源发起这个动作；执行后端判断实际进程是否能访问该文件、网络或系统资源。不能把前一层的授权结果当成后一层的隔离保证。

![Read、Write、Bash 三类 Tool 的独立安全边界](/diagrams/agent-runtime-tool-boundaries.svg)

[查看 Read / Write / Bash 架构图（HTML）](/diagrams/agent-runtime-tool-boundaries.html)

## 5. 值得研究的开源实现

### 5.1 Anthropic Sandbox Runtime：最接近通用 Agent 执行隔离层

项目：[anthropic-experimental/sandbox-runtime](https://github.com/anthropic-experimental/sandbox-runtime)  
npm：[@anthropic-ai/sandbox-runtime](https://www.npmjs.com/package/@anthropic-ai/sandbox-runtime)

Anthropic 将 Claude Code 使用的 Sandbox Runtime 独立开源。它不是 Agent Framework，也不是一个新的 Shell，而是把任意命令或进程放进操作系统提供的限制环境中。项目 README 明确列出 Agent、Bash 命令和本地 MCP Server 等使用场景。

它的实现思路是复用各操作系统的原生安全机制：

| 平台 | 主要实现 |
| --- | --- |
| macOS | sandbox-exec 与动态生成的 Seatbelt Profile |
| Linux | Bubblewrap、namespace 隔离及受控网络代理 |
| Windows | 独立本地沙箱用户、受限 Token、NTFS ACL 和 Windows Filtering Platform 出站规则 |

文件系统和网络限制需要一起考虑。文件系统采用读写分离策略：写入默认拒绝，只显式开放工作目录和临时目录；读取则可以通过拒绝敏感区域、再开放必要路径的方式配置。网络默认拒绝，通过 HTTP / SOCKS 代理限制允许访问的域名。Unix Socket 等本地 IPC 也有独立限制能力。

一个很实用的设计是：它可以包裹整个 MCP Server，而不是只限制某个 MCP Tool。例如，原本直接启动的 Filesystem MCP Server，可以改成由 srt 启动。这样，Server 内部即使存在未预期的文件访问路径，也仍然受到进程级文件系统和网络策略约束。

示意配置如下，具体字段应以所使用版本的 Schema 为准：

~~~json
{
  "filesystem": {
    "denyRead": ["~/.ssh", "~/.aws", "~/.config"],
    "allowWrite": ["./workspace", "/tmp"],
    "denyWrite": ["./workspace/.env"]
  },
  "network": {
    "allowedDomains": [
      "api.openai.com",
      "api.anthropic.com"
    ],
    "deniedDomains": []
  }
}
~~~

Node.js Runtime 可以把它作为进程启动边界使用，也可以通过 Library API 集成。它的价值在于：Runtime 不必自己实现 Seatbelt、Bubblewrap 或 Windows Filtering Platform 的底层规则，而是把策略交给一个专门的 Sandbox Runtime。

需要注意的是，项目仍标注为 Beta Research Preview，API 和配置格式可能变化。它也不是万能的 VM：不同平台的隔离原语和已知限制不同，网络代理、系统服务代发流量、凭证暴露以及宿主机本身的安全仍需单独审查。引入时应针对目标 OS、Node 版本和实际工具链做逃逸测试，而不是因为命令成功启动就认为隔离已生效。

### 5.2 OpenAI Codex Sandbox：值得借鉴的权限模型和平台实现

项目：[openai/codex](https://github.com/openai/codex)  
工程文章：[Inside the Codex sandbox](https://openai.com/index/inside-the-codex-sandbox/)

Codex Sandbox 的特点是：不把所有命令搬进容器，而是尽可能利用当前操作系统的隔离机制，让 Agent 在用户现有的开发环境中工作。对于依赖本机 SDK、原生工具链或桌面模拟器的开发任务，这种方式比 Docker 更容易保留宿主机开发环境。

Codex 将 Sandbox 权限组织成 Permission Profile。以 Workspace 权限为例，工作区内可以写入，但 .git、.codex 等敏感目录保持只读；网络默认关闭，需要时再单独开放。这里有一个重要的取舍：为了兼容本机编译器和开发工具，文件读取范围可能比工作区更广。因此，限制写入和关闭网络能减少风险，却不能自动解决敏感文件读取问题。

OpenAI 的工程文章还披露了一个很值得重视的细节：子进程继承父进程的 Sandbox 约束，约束覆盖由该命令启动的整个进程树。这是执行边界必须满足的基本要求。只包裹最外层 Shell，而让 Python、Node 或 MCP 子进程逃到沙箱之外，是不合格的实现。

Codex 的价值主要有两方面：Permission Profile 是 Runtime 的权限配置模型，可以把只读、工作区写入和网络访问等能力组合成可理解的执行模式；OS Sandbox 则通过统一接口屏蔽 macOS、Linux 和 Windows 的平台差异，让调用方提交命令、工作目录、环境变量和权限配置，而不直接操作底层系统调用。

需要区分：Codex 的实现是 Codex 项目的一部分，不应把它误认为一个已经独立发布、可直接 npm install 的通用 Sandbox SDK。对自建 Runtime 来说，更适合先研究其 Permission Profile、子进程继承和 fail-closed 思路，再决定复用哪一层代码或原生机制。

### 5.3 just-bash：TypeScript 里的虚拟 Shell，而不是真正的 OS Sandbox

项目：[vercel-labs/just-bash](https://github.com/vercel-labs/just-bash)

如果 Runtime 本身是 Node.js / TypeScript，just-bash 很值得研究。它用 TypeScript 实现 Shell 语法和一组常用 Unix 命令，提供虚拟文件系统。Agent 可以执行 ls、cat、grep、sed、jq、管道和重定向，而不必直接启动宿主机 Bash。

~~~typescript
import { Bash } from "just-bash";

const bash = new Bash({
  files: {
    "/workspace/report.md": "# Draft\n",
    "/workspace/data.json": '{"count": 12}'
  }
});

const result = await bash.exec(
  "cat /workspace/data.json | jq '.count'"
);

console.log(result.stdout);
~~~

它适合文档处理、结构化数据检查、轻量脚本和受控文件操作。默认内存文件系统不直接访问磁盘；网络默认关闭；Python 和 JavaScript 执行能力也默认关闭。需要真实文件时，可以考虑它提供的其他文件系统实现，但安全边界随之改变。

关键区别在于：just-bash 不提供 VM 隔离。它是在宿主 Node.js 进程内运行的虚拟 Shell。项目自己的 Security Model 也明确说明这一点：自定义命令回调是宿主侧扩展点，可信命令运行在嵌入进程中；JavaScript 不能强制终止任意宿主代码；需要对外部副作用提供硬隔离时，应放到可终止的 Worker 或独立进程中；对任意二进制执行，则应使用真正的 VM 或 OS Sandbox。

因此，不应该把 just-bash 当成 Anthropic Sandbox Runtime 的替代品。它解决的是“不要给 Agent 一个真实 Shell”的问题，后者解决的是“真实进程不能越过 OS 限制”的问题。

### 5.4 OpenHands Runtime：完整的 Docker 执行环境

项目：[OpenHands](https://github.com/OpenHands/OpenHands)  
架构说明：[OpenHands Runtime](https://docs.openhands.dev/openhands/usage/architecture/runtime)

OpenHands 的 Runtime 采用 Client-Server 结构。Backend 将 Action 发送给 Runtime 容器中的执行服务，容器内运行 Bash、文件操作、Python、浏览器和插件，再把执行结果作为 Observation 返回给 Backend。

这类方案适合需要完整开发环境的 Agent：有依赖安装、编译、测试、浏览器和多种执行工具，且希望每个任务或项目拥有独立环境。Docker 镜像和 Volume 机制也便于定义基础环境、持久化工作目录和只读挂载。

它的代价是容器生命周期、镜像管理、资源配额、Volume 和网络策略都需要运营。更重要的是，容器并不等于独立内核：默认仍共享宿主机 Kernel。对抗高风险不可信代码时，必须谨慎配置 capabilities、seccomp、用户权限、设备、挂载和网络；更高隔离要求可以进一步使用 VM 或微型 VM。

对于桌面 Agent，如果只是需要受控地读取和修改用户选定的文件夹，直接引入一整套 Docker Runtime 可能过重。若任务需要任意依赖安装、编译、浏览器和长时间运行的进程，容器化执行环境才更有价值。

### 5.5 MCP Filesystem Server：目录授权有用，但不是进程沙箱

项目：[modelcontextprotocol/servers — filesystem](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem)

Filesystem MCP Server 在启动时通过命令行参数指定允许访问的目录，也支持只读模式和单独指定只读目录：

~~~bash
mcp-server-filesystem \
  --read-only-dir ./reference \
  ./workspace
~~~

它适合把文件操作以标准 MCP Tool 的形式交给 Agent。目录范围由 Server 自己检查，--read-only 会直接不注册写工具，而不是仅仅依赖模型不要调用写操作。

但 MCP Server 仍然是一个普通进程。目录 Allowlist 只限制这个 Server 的文件操作，不会自动限制 Agent Runtime 中的 Bash、Python、其他 MCP Server 或插件。一个拥有宿主机高权限的进程，不能因为它只暴露了几个 MCP Tool，就被视为安全沙箱。

Filesystem Server 的安全实现也需要持续审查。路径解析、符号链接、目录移动和协议 Roots 的行为都会影响真实授权范围。建议将命令行目录作为管理员或宿主侧确定的上限；客户端提供的工作区只能缩小范围，不能扩大范围。即使使用只读目录，也应在 OS 文件权限或容器只读挂载层再加一道保护。

## 6. 不同部署环境的安全边界

通用策略可以复用，但执行隔离不能只靠一套抽象接口。桌面端依赖操作系统权限模型，云端需要处理租户和凭证隔离，Kubernetes 还要约束 Pod 与节点，而 GUI VM 必须把显示、输入和 Host Integration 纳入威胁模型。

![Agent Runtime 四类部署环境的安全边界](/diagrams/agent-runtime-deployment-boundaries.svg)

[查看部署环境架构图（HTML）](/diagrams/agent-runtime-deployment-boundaries.html)

### 6.1 桌面端：Windows / macOS 本机 Agent

桌面端的最大特点是 Agent 与真实用户环境距离很近。它可能继承用户的文件权限、浏览器登录态、SSH Agent、VPN、开发工具链、剪贴板和桌面会话。即使 Agent 只在本地运行，风险也不等于低。

**进程与用户权限。** 桌面主应用负责 UI、身份、审批和策略；模型生成的代码、Shell、第三方 MCP Server 和浏览器 Worker 应尽可能在独立进程或 Sandbox 中运行。不要以管理员 / root 启动整个 Agent。需要安装驱动、配置系统服务或申请更高权限时，应把这类操作与普通任务分开，并通过操作系统授权流程完成。

**macOS。** Apple App Sandbox 通过 Entitlements 限制应用访问文件、网络、硬件和用户数据；TCC 则对 Accessibility、Screen Recording、Input Monitoring、Apple Events、Camera、Microphone 等敏感能力进行用户授权。桌面自动化需要的权限可能非常强：Accessibility 可以让应用观察和驱动其他应用，Screen Recording 会暴露屏幕内容，Input Monitoring 和合成事件能力会扩大键鼠控制范围。不要为了让 Agent “方便工作”而一次性申请所有权限；应按功能逐项解释用途，并将 GUI Automation Broker 与 Shell Sandbox 分开。被授权的主应用也不意味着所有子进程都应自动获得相同能力，必须测试签名身份、TCC 授权归属和进程继承行为。

参考：[Apple App Sandbox](https://developer.apple.com/documentation/security/app_sandbox)、[Resetting access to protected resources in macOS](https://developer.apple.com/documentation/xcode/resetting-access-to-protected-resources-in-macos)。

**Windows。** 使用普通用户 Token 运行 Agent。AppContainer、低完整性进程、Windows Sandbox、Restricted Token、ACL 和 Job Object 解决的问题不同，不能混为一个“Windows Sandbox”概念。Job Object 主要负责进程树和资源管理，不单独构成文件与网络安全边界。UI Automation 还涉及 UIPI 和 Integrity Level：UIAccess 是面向辅助技术的特殊能力，需要签名和受保护安装位置，不应作为普通 Agent 获得更高权限窗口控制的通用开关。Agent 不应试图绕过 UAC Secure Desktop，也不应通过模拟点击来批准管理员授权。

参考：[Windows application isolation](https://learn.microsoft.com/en-us/windows/security/book/application-security-application-isolation)、[Security Considerations for Assistive Technologies](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-securityoverview)。

**文件与凭证。** 默认只允许用户显式选择的 Workspace。不要默认开放整个 Home、Documents、Downloads、浏览器 Profile、SSH、云 CLI 配置和密码管理器目录。系统 Keychain / Credential Manager 应由 Host Credential Broker 使用，不能把密钥导出到脚本环境。对于企业桌面，还应考虑设备合规、磁盘加密、端点检测、应用签名、自动更新和撤销机制。

**GUI 自动化。** 屏幕截图、OCR、Accessibility Tree 和浏览器 DOM 都是输入数据，不是可信指令。网页可能通过隐藏文本、覆盖层、弹窗、伪造系统对话框或图片内容诱导 Agent 点击。建议优先使用有明确 API 和权限模型的集成；必须使用屏幕控制时，把截图采集、窗口选择、键鼠注入和敏感动作确认放进独立的 GUI Broker。限制可控制的应用和窗口；对发送邮件、付款、发布、删除、授权、安装软件等动作，显示结构化预览并由用户确认。不要把系统密码、MFA Code、恢复码和密码管理器主密码交给模型处理。

桌面端尤其需要区分两类 Sandbox：Script Sandbox 限制 Shell 和进程；GUI Session Sandbox 限制 Agent 可见和可操作的桌面环境。前者不能自动约束后者。如果 GUI Agent 运行在真实用户桌面，它看到的可能是用户的邮件、内部系统、个人浏览器和管理员窗口。高风险自动化应使用独立低权限 OS 账户或独立 VM，而不是直接操作用户的日常桌面。

### 6.2 云端 Agent Runtime：多租户、凭证和控制面隔离

云端运行环境面临的主要风险不是本地用户目录，而是多租户、云身份、网络横向移动、共享 Worker、持久化存储和控制面暴露。

**控制面与执行面分离。** Orchestrator、Policy Engine、Session API、Credential Broker 和审计服务属于可信控制面；Shell、Browser、MCP、Python 和用户代码属于不可信执行面。执行 Worker 不应直接持有管理集群、调度系统或数据库的高权限凭证。控制面向 Worker 发放短期任务凭证和窄范围资源引用，Worker 不能反向修改租户策略。

**租户隔离。** 至少按 Tenant / User / Task 隔离 Workspace、对象存储 Prefix、缓存、向量库、浏览器 Profile、临时文件和日志访问。对于高风险或高价值租户，使用独立 Worker、节点池、账号或云项目；不能只依赖应用层在 SQL 查询中追加 Tenant ID。对共享 Worker Pool，要明确每次任务前后的清理、进程终止、临时凭证撤销和文件系统重置。

**云身份与凭证。** 每个 Worker / Task 使用独立 Workload Identity，默认不挂载管理级 Service Account。需要访问云资源时，通过 IAM 绑定和短期令牌授予最小权限。外部 SaaS 凭证由 Credential Broker 或 Egress Gateway 注入；不要把云服务账号 JSON、长效 API Key、SSH 私钥和数据库密码写入镜像、环境变量或快照。

**网络出口。** Worker 默认不应直接访问互联网、云元数据、集群 API、控制面、内部管理服务或其他租户网段。通过 Egress Gateway / Proxy 做域名、IP、端口、协议和身份检查；对于上传、下载和 Webhook，记录目标、数据分类和字节数。DNS、重定向、私网地址、IPv6 和代理旁路都要纳入负向测试。

**弹性和资源控制。** 每个 Task 要有 CPU、Memory、磁盘、PID、GPU、带宽、执行时间、并发和成本预算。设置租户级配额、队列长度和速率限制，防止 Agent 无限循环、递归调用、并发爆炸或恶意构造超大输出。执行 Worker 应可回收、可重建，控制面必须能在 Worker 卡死或失联时撤销身份和清理资源。

**日志与数据驻留。** 对模型供应商、推理区域、日志、Trace、截图、附件和 Memory 明确数据处理区域和保留周期。调试日志不应成为第二个数据湖；对敏感内容进行脱敏或引用化存储，限制安全团队以外的访问，并支持按 Tenant / User / Task 进行审计和删除。

### 6.3 Kubernetes：从 Pod Security 到真正的 Sandbox Runtime

Kubernetes 提供调度、资源和网络策略，但普通 Pod 并不等于强安全沙箱。默认容器通常仍共享 Node Kernel；同一集群中的 Namespace 也不自动构成完整的多租户安全边界。

**基础 Pod Hardening。** 生产 Agent Worker 应采用非 root 用户，runAsNonRoot: true，allowPrivilegeEscalation: false，readOnlyRootFilesystem: true，删除不需要的 Linux Capabilities，配置 Seccomp，并按节点能力使用 AppArmor 或 SELinux。避免 privileged: true、hostPID、hostIPC、hostNetwork、不受控 hostPath、Docker Socket 和宿主机设备挂载。Namespace 应强制适当的 Pod Security Standards，不能只靠开发者自觉填写 SecurityContext。

**Service Account 与 RBAC。** 不要使用默认 ServiceAccount；没有访问 Kubernetes API 需求的 Worker 设置 automountServiceAccountToken: false。需要 API 权限时，为具体 Agent Workload 建立独立 ServiceAccount 和最小 RBAC，禁止普通执行 Pod 创建或修改 Role、ClusterRole、Webhook、Node、Namespace 和高权限 Workload。用 Admission Policy / Gatekeeper / Kyverno 等阻止危险 PodSpec。

**网络。** Namespace 或 Pod 默认拒绝 Ingress / Egress，再明确开放 DNS、模型 Endpoint、Artifact Store 和业务 API。NetworkPolicy 通常主要约束 L3/L4；域名级策略需要 CNI 或专门 Egress Gateway 的支持。必须测试 Pod 能否访问 Node IP、云元数据、Kubernetes API、其他 Namespace、内部 Load Balancer 和私有服务。不要假设配置了 NetworkPolicy 就一定有实际 enforcement，先验证集群 CNI 是否支持并启用。

**存储和 Secret。** Workspace 使用任务级 PVC、临时卷或独立对象存储 Prefix。只读基础镜像与只读数据集分开挂载，输出写入专用目录。Secret 优先通过外部 Secret Store / CSI 或短期身份注入，避免把凭证放入 ConfigMap、镜像层或可被其他 Pod 读取的共享卷。etcd Secret 加密、API Audit Log 和 Secret 访问审计都应纳入集群基线。

**Sandbox Runtime。** 对执行不可信代码的 Agent，评估 RuntimeClass：
- [gVisor](https://gvisor.dev/docs/architecture_guide/security/) 使用用户态 Kernel 拦截和实现系统接口，减少应用直接触达宿主机 Kernel 的范围，通常启动更快、资源开销较低，但存在系统调用兼容性和硬件支持取舍。
- [Kata Containers](https://katacontainers.io/) 通过轻量 VM 和独立 Guest Kernel 提供更强的 Kernel 隔离，适合需要更强租户隔离、又希望保留 Kubernetes 工作流的场景。
- [Firecracker](https://github.com/firecracker-microvm/firecracker) 提供 microVM 边界，设计目标是把不可信 Guest 代码限制在多层信任区中。它不是一个完整桌面产品，也不等于开箱即用的 Kubernetes Runtime；还需要管理 VMM、jailer、seccomp、cgroups、网络、磁盘、快照和 Host API Socket。
- 普通 runc / containerd Pod 适合可信服务和较低风险工作负载，不应不加区分地承载来自不同租户的任意恶意代码。

**节点和集群隔离。** 高敏感租户、执行不可信代码的 Worker、控制面服务和基础设施组件应按风险分配独立 Node Pool / Cluster。使用 taints、tolerations、node affinity 和 admission policy 强制隔离，而不是仅靠调度偏好。限制节点上运行的 DaemonSet、容器运行时 Socket、CSI Driver 和宿主机管理接口。

Google 在 2026 年的 [GKE AI Agent Workloads 架构文档](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/machine-learning/agent-workloads) 已经把 Agent Sandbox 作为专门的工作负载类型讨论，并区分两种模式：Agent Substrate 以 actor 为调度单元，多个 Agent Session 可复用 Worker Pool；Agent Sandbox 则为 Agent 分配专属 Pod。文档还比较 Cloud Hypervisor microVM 与 gVisor：microVM 有独立 Guest Kernel、隔离更强但启动和资源开销更高；gVisor 启动更快、兼容性和 GPU / TPU 支持更好，但 syscall 覆盖不同。

这个实践有几个值得注意的细节：Agent Substrate 使用每个 Actor 的 SPIFFE X.509 Certificate 和 JWT，并通过 Egress Gateway 在请求路径注入凭证；Agent Sandbox 使用 Pod ServiceAccount / Workload Identity，Warm Pool 中的 Pod 可能共享身份，因此不同 Agent 或租户需要按身份拆分 Pool 或按需创建 Sandbox。Agent Sandbox 的 Secret 管理则需要 Kubernetes Secret / CSI 或自行部署代理，不能假设两种模式拥有同样的凭证隔离能力。它说明了一个重要原则：**隔离计算环境之外，还必须单独设计身份隔离、凭证交付和网络出口。**

参考：[Kubernetes Application Security Checklist](https://kubernetes.io/docs/concepts/security/application-security-checklist/)、[Kubernetes Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/)、[Kubernetes Linux Kernel Security Constraints](https://kubernetes.io/docs/concepts/security/linux-kernel-security-constraints/)、[GKE Agent Workloads](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/machine-learning/agent-workloads)、[NIST SP 800-190](https://csrc.nist.gov/pubs/sp/800/190/final)。

### 6.4 带桌面显示和操作能力的 VM：不要把显示通道当成安全边界

有些 Agent 需要操作完整桌面应用，而不只是调用 API 或执行 Shell。此时通常会为每个任务或用户提供一台 Windows / Linux VM，通过 RDP、VNC、WebRTC 或自定义 Desktop Streaming 将画面传给 Agent，再把鼠标和键盘事件发送回 Guest。

这类 VM 的优势是有独立 Guest OS、独立用户、浏览器和桌面会话；但如果 Host 与 Guest 之间开放了共享目录、剪贴板、USB、拖放、打印机、音频、浏览器 Cookie 或本机 Agent Socket，VM 隔离就会被这些集成通道削弱。

**Guest 本身。** 使用经过加固和签名的 Golden Image，定期重建而不是长期手工维护。每个租户 / 任务使用独立 VM 或独立 Guest User；Agent 不使用 Guest Administrator / root。关闭不需要的服务、自动登录、远程管理入口和持久化凭证。浏览器使用独立、临时 Profile，不复用宿主机浏览器 Cookie、密码库或用户的企业 SSO 会话。

**Host / Guest 集成。** 默认关闭共享剪贴板、共享文件夹、拖放、USB Passthrough、打印机、智能卡、宿主机凭证代理、共享浏览器 Profile 和不必要的 Guest Agent RPC。若业务必须传入文件，应通过 Host 控制的 Artifact Gateway，先做类型检查、恶意文件扫描和只读挂载；输出文件通过独立出口收集，不开放 Guest 对 Host 任意路径的写入。

**显示和输入通道。** Display Gateway 只传输经过授权的画面，不应把整个 Host Desktop 暴露给 Guest。Input Gateway 只接受受控的键鼠事件，不应把 Host 的全局键盘、剪贴板或管理员桌面输入直接转发。RDP / VNC / WebRTC 通道需要身份认证、加密、会话绑定、短期访问票据和操作审计。会话结束后关闭通道、销毁临时凭证并清理 Guest 状态。

**屏幕内容也是数据出口。** 截图可能包含客户数据、MFA Code、内部 URL、密码提示、聊天内容和后台管理信息。如果截图要发送到云端模型，就意味着这些信息离开 VM，不能因为它来自“屏幕”就绕过 DLP 和数据驻留策略。建议只采集指定窗口或虚拟桌面，按需截取，敏感区域遮蔽，限制截图保留时间，并记录截图被发送给哪个模型 Endpoint。

**GUI Injection 与外部指令。** Agent 看到的弹窗、网页、PDF、聊天窗口和系统通知都可能包含攻击指令。GUI Agent 不应把屏幕上的“点击允许”“输入密码”“将文件上传到此处”等内容视为授权。对于登录、MFA、付款、发送、删除、安装、下载执行文件和权限变更等动作，应由独立的 Approval UI 确认，而不是让 Agent 自己点击确认。

**VM 快照和恢复。** Snapshot 可能保留 Cookie、Token、浏览器历史、剪贴板、内存中的凭证、已打开文件和任务上下文。快照必须有租户和任务标签、加密、访问控制、保留期和销毁策略。恢复前检查快照来源和策略版本；不要把一个用户的 VM Snapshot 作为另一个用户的干净模板。通用 Golden Image 应在不含用户状态和密钥的条件下制作。

还要区分 microVM 和桌面 VM。Firecracker 适合隔离 Linux 进程和服务，但它的设备模型是为轻量虚拟机设计的，不提供完整 Windows Desktop / GPU 桌面体验。需要真实 GUI 的任务，通常要选择支持图形栈和远程桌面的完整 VM / VDI 技术；不要因为“microVM 隔离更强”就把它当成桌面虚拟化方案。

## 7. Copilot SDK 桌面端的安全接入

如果 Agent Runtime 基于 GitHub Copilot SDK，桌面端同时支持 Windows 和 macOS，我不建议把安全层整体改写成 Rust。更合理的边界是：TypeScript 实现 Agent 控制面和工具服务，操作系统负责强制执行隔离策略；只有在某个平台缺少可靠的 Node.js API、需要调用原生安全接口时，才增加一个很小的原生 Helper。

Copilot SDK 提供的 `onPreToolUse` Hook 可以在工具执行前返回 `allow`、`deny` 或 `ask`，也可以修改工具参数。这适合作为统一策略入口，但 Hook 本身不是 Sandbox：它不能阻止已经启动的进程访问未授权文件，也不能约束绕过该 Hook 的其他进程或 MCP Server。官方文档还提供 `skipPermission`，适用于应用自有、参数已经被应用约束的可信工具；它不应被用来跳过应用自己的 Policy Engine。参考：[Copilot SDK Pre-tool use Hook](https://docs.github.com/en/copilot/how-tos/copilot-sdk/hooks/pre-tool-use)。

### 7.1 推荐的职责划分

| 组件 | 推荐实现 | 职责 |
| --- | --- | --- |
| Copilot SDK 集成 | TypeScript | Session、Agent、Hook、工具调用生命周期 |
| Tool Registry | TypeScript | 只注册应用控制的 Read、Write、Bash 等工具 |
| Policy Engine | TypeScript | Agent / Task / Workspace / Resource / Action 授权，默认拒绝 |
| Approval Service | TypeScript + Desktop UI | 展示具体动作和影响范围，记录一次性批准 |
| Read / Write Service | TypeScript | 资源 ID 解析、路径授权、文件操作、ChangeSet 和回滚 |
| Execution Service | TypeScript | 创建 Sandbox Session、传递受限参数、收集输出、取消和清理 |
| OS Sandbox Backend | OS 原生机制或成熟项目 | 强制文件、网络、进程和资源限制 |
| Native Helper（可选） | Rust / C++ / Swift / C# | 仅封装 TS 无法可靠完成的系统 API 或安装配置 |

TypeScript 不只是 UI 层。它完全可以承担策略计算、审批、工具参数校验、资源引用解析、审计和执行生命周期管理。真正不能只靠 TypeScript 完成的是对任意子进程的强制隔离；这必须落到操作系统安全机制或独立虚拟化边界。

### 7.2 Copilot SDK Hook 应该怎样接

建议在 Session 创建时统一注册 `onPreToolUse`，但不要在 Hook 中堆积所有业务逻辑。Hook 只负责把 SDK 的调用转换为内部标准请求，再交给 Policy Engine。工具 Handler 内部还要进行资源级二次校验，执行后端也要再次校验 Profile 和实际资源范围。

```typescript
const session = await client.createSession({
  hooks: {
    onPreToolUse: async (input, invocation) => {
      const decision = await policy.evaluate({
        sessionId: invocation.sessionId,
        toolName: input.toolName,
        arguments: input.toolArgs,
      });

      return {
        permissionDecision: decision.kind, // allow | ask | deny
        permissionDecisionReason: decision.reason,
        ...(decision.modifiedArgs
          ? { modifiedArgs: decision.modifiedArgs }
          : {}),
      };
    },
  },
});
```

不要把 `onPreToolUse` 当成唯一检查点。应用自定义工具的 Handler 必须自己验证 `ResourceRef`、Workspace 归属和操作权限；Bash Handler 则只能调用 Execution Service，不能直接 `child_process.exec()` 在桌面宿主进程里运行模型给出的命令。对于 MCP Server 和其他执行入口，也必须确保它们不能绕过同一套资源与执行边界。

另外，SDK 的 `ask` 只是请求交互式批准的机制。产品仍需明确处理非交互模式、用户拒绝、超时、会话取消和批准后参数变化。审批记录应绑定工具名、规范化参数摘要、资源范围、Profile、Session / Task 和有效期，不能只记一个“用户同意过 Bash”。

### 7.3 macOS 与 Windows 的 Sandbox 后端

跨平台策略模型可以统一，但底层不能假设两个系统提供相同的隔离能力。

| 平台 | 可评估的隔离机制 | 需要特别验证的部分 |
| --- | --- | --- |
| macOS | Seatbelt / Sandbox Profile；可评估 Anthropic Sandbox Runtime | 文件读写规则、网络限制、子进程继承、系统服务和 IPC 边界、不同 macOS 版本行为 |
| Windows | Restricted Token、ACL、Job Object、Windows Filtering Platform；进一步评估 AppContainer | 文件访问是否真正受限、网络出口是否覆盖、进程树是否完整受控、安装时是否需要 UAC |

macOS 上可以优先评估 [Anthropic Sandbox Runtime](https://github.com/anthropics/sandbox-runtime)，避免自己从头维护 Seatbelt Profile。Windows 也可以评估其 Windows 实现，但要把它当前的成熟度、安装方式和权限要求纳入产品决策，不能假设与 macOS 行为完全等价。

Windows 上尤其不要把 Job Object 误认为完整 Sandbox。Job Object 适合限制进程树、生命周期和资源使用；它本身不提供完整的文件系统与网络访问控制。Restricted Token、ACL、AppContainer 和网络过滤各自解决不同问题，需要组合并验证。若产品要求普通用户安装后无需 UAC，就必须单独验证隔离方案是否能在该部署约束下成立；不能为了绕过 UAC 而静默退化成宿主机直接执行。

### 7.4 统一 Sandbox Backend 接口，不统一底层实现

Runtime 可以定义统一接口，让上层不感知平台差异；但每个平台 Backend 必须声明自己实际支持的能力。不能因为接口里有 `network: deny`，就假设某个后端真的能够可靠阻断所有网络路径。

```typescript
type SandboxProfile = {
  filesystem: { read: string[]; write: string[]; deny: string[] };
  network: { mode: "deny" | "allowlist"; allowedDomains?: string[] };
  limits: { timeoutMs: number; memoryMb?: number; maxProcesses?: number };
};

interface SandboxBackend {
  readonly platform: "darwin" | "win32";
  capabilities(): Promise<{
    filesystemIsolation: boolean;
    networkIsolation: boolean;
    processTreeControl: boolean;
  }>;
  execute(input: {
    script: string;
    workingDirectory: ResourceRef;
    profile: SandboxProfile;
  }): Promise<ExecutionResult>;
  terminate(executionId: string): Promise<void>;
}
```

启动执行前，Execution Service 应检查 Backend 能力是否满足 Profile 的要求；不满足就拒绝执行，而不是忽略不支持的限制。执行完成、超时或取消时，要清理整个进程树、临时目录和短期凭证。宿主机环境变量、SSH Agent Socket、浏览器 Profile、Docker Socket 和长期 Token 默认都不应进入 Sandbox。

#### 2026 年值得加入评估的选项：Microsoft Execution Containers（MXC）

项目：[microsoft/mxc](https://github.com/microsoft/mxc)；文档：[MXC architecture](https://learn.microsoft.com/en-us/windows/apps/develop/mxc/architecture)、[Policy](https://learn.microsoft.com/en-us/windows/apps/develop/mxc/policy)、[Platform support](https://learn.microsoft.com/en-us/windows/apps/develop/mxc/platform-support)。

截至 2026-11-21，MXC 已提供 TypeScript、.NET 和 Rust SDK。它把跨平台的资源授权意图与实际执行后端分开：应用描述文件系统、网络、UI 和超时策略，SDK 再选择当前主机可用的 containment backend。对 TypeScript 桌面 Agent 来说，这是值得优先做 PoC 的路线，不必为了接入安全执行层先把应用主体改写成 Rust。

MXC 的策略模型包括只读路径、读写路径、拒绝路径、出站 / 入站网络、Host Loopback，以及 UI 窗口、剪贴板和输入注入控制。例如可以把后台脚本的 UI 能力关闭、剪贴板设为 none、禁止合成键鼠输入。官方建议采用 deny-by-default，策略由可信 Host App 决定；工具或 Agent 可以报告缺少什么权限，但不能自行选择隔离模式或扩大授权。

但必须注意版本和后端差异。MXC 1.0.0 的 V1 SDK 文档列出的后端是：Windows ProcessContainer、IsolationSession、WSLc；Linux Bubblewrap、LXC；macOS Seatbelt。Windows Sandbox、MicroVM 和 Hyperlight 在该版本文档中仍属于实验能力，不能因为 GitHub 主分支出现对应代码或后端名称，就认为稳定 V1 SDK 已经支持。更重要的是，Windows IsolationSession 主要隔离用户会话，不提供 MXC 的文件系统和 UI 策略过滤，并要求网络方向与 Host Loopback 放开；如果任务要求严格文件、网络和 GUI 控制，就不能选择它来满足这些要求。

因此，MXC 不是一个“所有平台都提供相同强度”的通用 VM。应用应调用平台能力发现和 request probe，核实所选 backend 对文件、网络、UI、进程生命周期的真实支持；再用正向和负向测试验证策略确实生效。后端不能实施某项必要约束时，必须拒绝启动，不能静默降级。MXC 的 Learning Mode 也要谨慎：allow-and-record 会放宽默认拒绝策略，只适合受控测试环境中的可信程序，不应暴露成 Agent 可调用的生产工具。

这也补充了前面的技术选型：桌面端可以同时评估 Anthropic Sandbox Runtime 和 MXC，不应先假设某一个项目覆盖所有平台。优先选择标准化、可验证、部署约束符合产品要求的后端；如果 MXC 某个 backend 的限制不满足目标场景，再单独评估其他 OS Sandbox 或原生 Helper。

### 7.5 Rust 什么时候才值得引入

Rust 不是安全边界本身。用 Rust 写一个没有 OS 隔离的 Shell Runner，仍然可能以当前用户身份读取文件、访问网络和启动子进程。反过来，TypeScript 通过受控 IPC 调用 Seatbelt、Restricted Token 或其他 OS Sandbox，也可以建立真实的执行边界。

只有出现明确的原生需求时才引入 Rust，例如：需要一个小型、独立于 Node Runtime 的进程管理器；需要调用现有 Rust 安全库；或需要封装某些平台 API，而现有 Node API 和成熟工具无法可靠覆盖。即使如此，也应把 Rust Helper 的职责限制在 Sandbox 创建、进程启动 / 终止和必要的系统调用封装。Policy Engine、审批、Tool Registry 和 Agent Session 仍留在 TypeScript。

对桌面产品而言，额外引入 Rust 还会增加 Windows / macOS 双平台构建、签名、公证、升级、崩溃诊断和 IPC 协议维护成本。没有明确的原生能力缺口时，这些成本并不会自动换来更强的安全性。

### 7.6 建议的落地顺序

1. 先在 TypeScript 中收敛工具入口：Read、Write、Bash 独立注册；拒绝无法识别的工具；不要让 Agent 直接获得宿主机 Shell。
2. 实现统一 Policy Engine、ResourceRef、审批和审计；工具 Handler 对资源和动作进行二次校验。
3. 把真实命令执行迁移到独立 Execution Service；先接入成熟 Sandbox Runtime，不要自己实现操作系统隔离原语。
4. 分别建立 macOS 和 Windows 测试矩阵，验证路径穿越、符号链接、敏感目录、网络出口、子进程继承、进程树终止、环境变量泄露和 Sandbox 启动失败。
5. 只有当某个平台确实无法通过现有 Sandbox 或 Node.js 接口满足要求时，再增加最小化的原生 Helper；Rust 是可选实现语言，不是架构前提。

对于 Copilot SDK 桌面应用，最终推荐是 **TypeScript 控制面 + OS Sandbox 执行面**。Copilot Hook 负责拦截和决策，应用自己的 Tool Handler 负责资源授权，Sandbox Backend 负责让操作系统强制执行批准范围。不要把 Hook、命令白名单或 Rust 语言本身误认为安全边界。

## 8. 容易被忽略的安全问题

**文件授权和数据授权不是一回事。** Agent 可以读取某个客户文件，不代表可以把它上传到任意外部网站。文件系统 Sandbox 只能限制文件访问，不能判断数据是否允许流向某个 SaaS 或模型服务。需要独立的数据分类、目的地策略和网络出口控制。

**网络 Allowlist 不能只检查域名字符串。** DNS 解析、重定向、CNAME、IPv4/IPv6 表示差异、私有 IP 和代理绕行都会影响最终连接目标。尤其需要阻止 SSRF、云元数据访问和内网探测。

**凭证不要通过环境变量“方便地传进去”。** 执行进程能读取的环境变量，通常也可能被脚本、子进程和日志意外暴露。需要访问下游系统时，应使用短期、窄范围的委托凭证或宿主侧 Credential Broker，不要把用户的长期 Token 和浏览器 Profile 直接挂载给 Agent。

**沙箱必须覆盖完整进程树。** Shell 启动 Python，Python 再启动 Node，Node 又启动子进程，所有后代都必须继承相同或更严格的限制。工具超时也不能只停止父进程，而留下仍在运行的子进程。

**文件写入最好默认可恢复。** 草稿写入、正式覆盖和删除应分开处理。通过临时文件、原子替换、版本快照和 Diff 审查，降低模型误操作的影响。对正式业务系统则优先提供有明确语义的 API，而不是开放数据库连接或通用 HTTP 写入。

## 9. 方案比较与选型

| 方案 | 主要隔离方式 | 适合场景 | 不能替代什么 |
| --- | --- | --- | --- |
| Anthropic Sandbox Runtime | OS 原生 Sandbox + 网络代理 | 包裹 Shell、脚本和 MCP Server | 业务级数据授权、完整 VM |
| OpenAI Codex Sandbox | OS 原生 Sandbox + Permission Profile | 本机开发环境中的受限命令执行 | 独立 npm Sandbox SDK |
| just-bash | TypeScript Shell + 虚拟文件系统 | 受控命令、文档和数据处理 | 任意宿主进程的 OS 隔离 |
| OpenHands Runtime | Docker 容器 | 完整、可复现的 Agent 开发环境 | 独立 Guest Kernel 的 VM 隔离 |
| MCP Filesystem Server | Tool 级目录授权 | 文件读写能力封装 | Shell、Python 和其他进程的限制 |

这里没有一个项目能够单独解决 Agent 的全部安全问题。选择时首先看执行对象：如果只需要读写文件，优先提供受限文件服务；如果需要有限的 Shell 语义，考虑虚拟 Shell；如果要执行真实命令或 MCP Server，就需要 OS Sandbox；如果需要完整、可复现的开发环境，再考虑容器或 VM。

## 10. 架构落地建议：按风险选择隔离强度

不需要把所有 Agent 都放进最重的 VM，也不应该让所有 Agent 共用一个普通 Node.js 进程。隔离强度应由数据敏感性、工具权限、租户信任、执行代码来源和可能的副作用决定。

| 场景 | 建议运行形态 | 最低安全要求 |
| --- | --- | --- |
| 本地文档分析、只读知识问答 | 桌面 Host + Capability File Service | 用户选定目录、只读授权、外发策略、审计 |
| 本地代码修改和测试 | 桌面 Host + 独立 Script Sandbox | Workspace 写入边界、子进程隔离、网络默认拒绝、Diff / 回滚 |
| 本地 GUI 操作 | 独立 GUI Broker + 受限桌面会话 | 最小 TCC / UI 权限、独立 Browser Profile、高风险动作确认 |
| 云端通用 Agent | 独立 Worker / Task Sandbox | 租户隔离、短期 Workload Identity、Egress Gateway、资源配额 |
| K8s 中执行不可信代码 | Restricted Pod + gVisor / Kata / microVM | Pod Security、RBAC、默认拒绝网络、任务级存储和身份 |
| 多租户浏览器 / 桌面自动化 | 独立 VM / VDI + Display Gateway | Guest 身份隔离、禁用 Host Integration、截图 DLP、会话销毁 |
| 高敏感或对抗性代码执行 | 专用节点上的 microVM / VM，必要时独立云账号 | 独立 Kernel / VM、短期身份、严格网络出口、不可变镜像和完整审计 |

一个值得坚持的原则是：**不要把“隔离强度”与“权限大小”混为一谈。** VM 并不会自动阻止数据外传；gVisor 不会自动替你管理 OAuth Token；Restricted Pod 不会自动防止 Prompt Injection；独立桌面也不会自动阻止 Agent 把截图发送给模型供应商。身份、授权、数据流、执行隔离和运维控制必须共同成立。

对基于 Copilot SDK 的桌面应用，可以先采用 TypeScript Policy Engine、独立 Tool Handler、MXC / Anthropic Sandbox Runtime 等成熟执行后端，再逐步增加 GUI Broker 和独立桌面 VM。云端和 Kubernetes 复用同一套 Policy / Resource / Approval 语义，但使用各自的 Workload Identity、Egress Gateway、Pod Security 和 Sandbox Runtime。VM 则把 Host / Guest、Display / Input 和共享设备通道作为独立安全边界。

这才是可扩展的 Agent Runtime 安全架构：策略统一，身份可追溯，执行隔离按平台实现，数据流受控，失败可终止，安全效果通过真实副作用测试验证。

## 11. 安全验证、上线 Checklist 与参考资料

### 11.1 安全验证：用真实副作用和状态变化测试，而不是只看模型回答

安全评估不能只统计模型有没有说出危险的话，也不能只测 Prompt Injection Classifier 的准确率。一个 Agent 可能在文本层面拒绝了攻击，但另一个工具已经完成了数据外传；也可能模型接受了恶意指令，但执行边界成功阻止了真实副作用。

研究和实践都在推动分阶段评估：
- [AgentDojo](https://arxiv.org/abs/2406.13352) 使用多轮、有状态的 Workspace、Slack、Travel 和 Banking 环境，评估正常任务效用与间接提示注入攻击成功率。它的核心启示是安全测试必须包含真实工具调用和状态变化，而不是只测单轮 Prompt。
- [SafeClawBench](https://arxiv.org/abs/2606.18356) 将语义层攻击接受、审计证据和 Sandbox 中可观察到的工具 / 状态危害分开报告。其研究说明，模型文本判断通过并不代表执行环境没有产生危害；反过来，模型语义失败也不一定产生可验证副作用。
- [AutoDojo](https://arxiv.org/abs/2606.15057) 关注自适应生成 Prompt Injection，提醒防御测试不能只重复固定攻击样本。
- [Toward Secure LLM Agents](https://arxiv.org/abs/2606.10749) 汇总了 247 篇 Agent Security 研究，指出当前防御在 Prompt、工具、Memory 和多 Agent 协作之间仍然缺少足够强的组合性；Memory Provenance、权限撤销和跨 Agent 隔离尤其需要加强。

建议把安全验证拆成四类指标：

| 评估维度 | 应测量什么 | 不应只看什么 |
| --- | --- | --- |
| Semantic Safety | 是否识别任务边界、是否拒绝不相关指令、是否遵循授权来源 | 只看最终回答是否包含拒绝语句 |
| Authorization Safety | 未授权 Tool / 参数 / 资源 / 目的地是否被策略拒绝 | 只看 Prompt Filter 命中率 |
| Execution Containment | 越权读写、网络连接、子进程、系统调用、跨租户访问是否真正失败 | 只看 Sandbox 进程是否启动成功 |
| Observable Harm | 文件、数据库、邮件、支付、Memory、外部网络是否发生未授权状态变化 | 只看模型自述“没有执行” |

每次安全回归都应同时执行正常用例和负向攻击用例。正常用例验证工具仍然可用；负向用例验证越权确实失败。只做负向测试会导致系统通过“全部拒绝”获得虚假的安全成绩。

### 11.2 Agent Runtime Security Checklist

下面的清单适合作为架构评审、PoC 验收和生产上线 Gate。它不是合规认证，也不能替代针对具体数据、行业和司法辖区的威胁建模。建议把 P0 视为上线阻断项，P1 视为生产环境必须完成或有明确风险接受记录的项目。

#### A. 威胁模型与任务边界

- [ ] **P0** 已明确保护资产、信任边界、攻击者能力和允许的业务目标。
- [ ] **P0** 每个 Agent / Task 都有明确的目标、资源范围、动作范围、时限和终止条件。
- [ ] **P0** Agent 不能修改自己的 System Policy、Tool Registry、审批规则或 Sandbox Profile。
- [ ] **P0** 外部网页、邮件、文档、图片 OCR、终端输出和 Tool Result 均按不可信数据处理。
- [ ] **P1** 已按 R0–R3 或等效风险等级分类工具和业务动作。
- [ ] **P1** 已定义最大步骤数、工具调用数、递归深度、并发数、Token / API 预算和成本上限。
- [ ] **P1** 已对 Prompt Injection、Tool Poisoning、Memory Poisoning、Rogue Agent 和供应链攻击做过威胁建模。

#### B. 身份、授权和凭证

- [ ] **P0** User、Agent、Task、Workload 和外部服务身份可以区分并可审计。
- [ ] **P0** 每个 Tool Handler 在执行时重新验证主体、动作、资源和任务范围。
- [ ] **P0** Agent 默认没有权限；未匹配规则、策略错误和授权服务不可用时均拒绝执行。
- [ ] **P0** 子 Agent 和 MCP Server 不继承父 Agent 的全部凭证和权限。
- [ ] **P0** 长期 API Key、SSH Private Key、浏览器 Cookie 和云管理员 Token 不进入模型上下文或不可信执行进程。
- [ ] **P1** 使用短期、窄范围、可撤销的委托凭证或 Workload Identity。
- [ ] **P1** 凭证获取、续期、撤销和访问失败均有审计事件。
- [ ] **P1** 高风险动作使用独立身份或二次审批，不依赖 Agent 自己判断是否需要授权。

#### C. Tool、MCP 和供应链

- [ ] **P0** Read、Write、Delete、Bash、Browser、Network 和业务写入能力彼此独立授权。
- [ ] **P0** 未批准的 MCP Server、Plugin、Skill 和动态工具不能直接安装或执行。
- [ ] **P0** 工具参数经过 Schema 校验、语义校验和资源级授权，不接受任意宿主机路径。
- [ ] **P1** 工具、模型、Prompt Template、镜像和依赖都有版本、来源和完整性记录。
- [ ] **P1** 生产环境使用签名 / Digest 固定的镜像和依赖，维护 SBOM 和漏洞扫描结果。
- [ ] **P1** MCP Server 和第三方工具运行在独立进程或 Sandbox 中。
- [ ] **P1** 工具升级、权限变化和 Schema 变化触发安全回归测试。

#### D. 文件、数据和网络

- [ ] **P0** 文件访问按 ResourceRef / Capability 授权，不能由模型任意指定宿主机绝对路径。
- [ ] **P0** 路径检查覆盖符号链接、路径穿越、挂载点、硬链接和 TOCTOU 风险。
- [ ] **P0** 读取、写入、删除、执行和外发是不同权限。
- [ ] **P0** 数据有分类标签和来源信息，外部内容不会自动成为授权。
- [ ] **P0** 出站网络默认拒绝；Ingress、Egress 和 Host Loopback 分别控制。
- [ ] **P0** 阻断云元数据、集群 API、管理网段、其他租户地址和不必要的内网访问。
- [ ] **P1** DNS、CNAME、重定向、IPv4 / IPv6、私有 IP 和代理旁路都经过测试。
- [ ] **P1** 数据上传、外部 API 写入和跨区域传输经过 DLP / Destination Policy。
- [ ] **P1** 日志、截图、Trace、Memory、快照和产物都有保留期、访问控制和删除策略。

#### E. 执行 Sandbox 与资源隔离

- [ ] **P0** 任意脚本和第三方 MCP Server 不在 Agent Host 主进程中执行。
- [ ] **P0** Sandbox 的文件、网络、进程和 UI 能力均有明确 Profile。
- [ ] **P0** 后端不支持必要策略时拒绝启动，不允许静默降级。
- [ ] **P0** 子进程继承相同或更严格的限制，超时会终止整个进程树。
- [ ] **P0** Sandbox 不默认继承 Host 环境变量、SSH Agent、Docker Socket、浏览器 Profile 和长期凭证。
- [ ] **P1** 限制 CPU、Memory、Disk、PID、GPU、带宽、输出大小、并发和执行时间。
- [ ] **P1** 每个任务结束后清理临时目录、进程、网络连接和短期凭证。
- [ ] **P1** Sandbox 版本、策略版本和平台能力检测结果进入审计记录。

#### F. 桌面端专用

- [ ] **P0** Agent Host 不以 Administrator / root 运行普通任务。
- [ ] **P0** 只开放用户明确选择的 Workspace，不默认开放整个 Home / 用户目录。
- [ ] **P0** Shell、MCP、浏览器和 GUI Automation 与主 UI 进程隔离。
- [ ] **P0** Screen Capture、Accessibility、Input Monitoring、剪贴板和键鼠注入按功能单独授权。
- [ ] **P0** GUI Agent 不操作用户日常浏览器 Profile、密码管理器和管理员桌面。
- [ ] **P1** macOS TCC 权限、App Sandbox Entitlements、代码签名和子进程行为经过真实安装包测试。
- [ ] **P1** Windows AppContainer / Restricted Token / ACL / Job Object 的实际能力和 UAC 行为经过验证。
- [ ] **P1** 桌面更新包签名验证、回滚、权限撤销和卸载清理均有测试。

#### G. 云端与多租户专用

- [ ] **P0** Control Plane 与不可信 Execution Worker 分离。
- [ ] **P0** 每个租户的 Workspace、Memory、Cache、Browser Profile、Artifact 和日志访问隔离。
- [ ] **P0** Worker 使用独立 Workload Identity，不持有集群或云账户管理权限。
- [ ] **P0** Worker 默认不能访问云元数据、控制面和内部管理服务。
- [ ] **P1** 高风险租户或任务可以分配独立 Worker、Node Pool、云账号或项目。
- [ ] **P1** Worker Pool 复用前后有强制清理和身份重绑定。
- [ ] **P1** 有租户级速率、并发、资源、成本和异常调用限制。

#### H. Kubernetes 专用

- [ ] **P0** Namespace 强制适当的 Pod Security Standards，优先 Restricted。
- [ ] **P0** runAsNonRoot: true、allowPrivilegeEscalation: false、readOnlyRootFilesystem: true。
- [ ] **P0** 删除不需要的 Linux Capabilities，配置 Seccomp；按环境启用 AppArmor / SELinux。
- [ ] **P0** 禁止不必要的 privileged、hostPID、hostIPC、hostNetwork、hostPath 和容器运行时 Socket。
- [ ] **P0** 默认 ServiceAccount 不挂载 Token；需要 API 权限时使用独立 SA 和最小 RBAC。
- [ ] **P0** Namespace / Pod 默认拒绝网络，明确允许 DNS、模型、Artifact 和业务 Endpoint。
- [ ] **P1** 通过 Admission Policy 阻止危险 PodSpec 和高权限 RBAC。
- [ ] **P1** 按不可信代码风险选择 runc、gVisor、Kata 或 microVM RuntimeClass。
- [ ] **P1** 高敏感 Worker 与控制面、基础设施和不同信任等级租户分离 Node Pool。
- [ ] **P1** 镜像签名、SBOM、漏洞扫描、etcd Secret 加密和 Kubernetes Audit Log 已启用。

#### I. GUI VM / VDI 专用

- [ ] **P0** 每个租户 / 任务使用独立 VM 或独立 Guest 身份。
- [ ] **P0** VM Guest 不使用 Administrator / root 运行 Agent。
- [ ] **P0** 默认关闭共享剪贴板、共享目录、拖放、USB、打印机和 Host Credential Passthrough。
- [ ] **P0** Display / Input Gateway 有认证、加密、会话绑定和操作审计。
- [ ] **P0** 截图作为敏感数据处理，发送模型前应用数据策略和必要脱敏。
- [ ] **P0** GUI Agent 不能自行确认付款、发送、删除、安装、授权和 MFA 等高风险操作。
- [ ] **P1** VM 使用不可变 Golden Image、临时 Browser Profile 和任务结束销毁机制。
- [ ] **P1** Snapshot 加密、按租户隔离、清理凭证并在恢复前验证策略版本。
- [ ] **P1** Host / Guest 网络、管理接口、元数据服务和远程桌面入口单独隔离。

#### J. 监控、应急和安全测试

- [ ] **P0** 每次工具调用都能关联 User、Agent、Task、Session、Policy Version 和审批结果。
- [ ] **P0** 日志不会明文保存 Token、Cookie、私钥、完整敏感 Prompt 或不必要的屏幕内容。
- [ ] **P0** 有独立 Emergency Stop，可终止任务、进程树、Sandbox 和出站网络。
- [ ] **P0** 能撤销短期凭证、停止队列、冻结 Agent / Tenant 并保留取证证据。
- [ ] **P1** 有异常检测：越权尝试、异常网络目的地、工具调用爆发、跨租户访问和资源耗尽。
- [ ] **P1** 安全测试同时验证 Semantic Safety、Authorization Safety、Execution Containment 和 Observable Harm。
- [ ] **P1** 测试集覆盖 Direct / Indirect Prompt Injection、Tool Poisoning、Memory Poisoning、供应链攻击和多 Agent 委托。
- [ ] **P1** 每个平台、每个 Sandbox Backend、每个镜像版本都运行正向与负向测试。
- [ ] **P1** 定期演练 Agent 失陷、凭证泄露、Sandbox 逃逸、租户越权和紧急停止。

### 11.3 业界实践、标准和研究资料

下面的资料按用途整理。标准和官方工程文档用于建立控制基线；研究论文用于理解攻击路径、验证方法和现有防御的局限。论文中的实验结果不等于生产环境安全保证。

**行业安全框架与实践指南**

| 资料 | 主要价值 |
| --- | --- |
| [OWASP Top 10 for Agentic Applications 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/) | Agent Goal Hijack、Tool Misuse、Identity & Privilege Abuse、Supply Chain、Unexpected Code Execution、Memory Poisoning、Inter-Agent Communication、Cascading Failures、Human-Agent Trust、Rogue Agents 的风险分类。 |
| [OWASP Securing Agentic Applications V2](https://genai.owasp.org/resource/securing-agentic-applications-v2/)（2026-11） | 从架构、身份访问控制、运行时保护、供应链和 Assurance Testing 讨论单 Agent 与多 Agent 安全。 |
| [OWASP GenAI Data Security Best Practices V2 Part 1](https://genai.owasp.org/resource/genai-data-security-best-practices-v2-part1/) / [Part 2](https://genai.owasp.org/resource/genai-data-security-best-practices-v2-part2/)（2026-11） | 数据分类、治理、生命周期、Metadata Propagation、Retrieval Boundary、全链路删除、AI-BOM 和策略联邦执行。 |
| [UK NCSC: Managing the cyber risk of agentic AI](https://www.ncsc.gov.uk/blogs/managing-the-cyber-risk-of-agentic-ai)（2026-08） | 自主程度评估、威胁建模、Sandbox 边界、可观测性、行为归因和 Emergency Shutdown。NCSC 明确说明这是一份随研究演进的阶段性建议，不应误称为最终强制标准。 |
| [Microsoft: Secure autonomous agentic AI systems](https://learn.microsoft.com/en-us/security/zero-trust/sfi/secure-agentic-systems) | 从 Model、Safety System、Application 和 Positioning 等层次提出纵深防御、最小权限、显式 Action Schema、HITL 和审计监控。 |
| [NIST SP 800-190: Application Container Security Guide](https://csrc.nist.gov/pubs/sp/800/190/final) | 容器镜像、Registry、Orchestrator、Container 和 Host 等传统容器安全风险，可作为 K8s 执行层基线。 |
| [Kubernetes Application Security Checklist](https://kubernetes.io/docs/concepts/security/application-security-checklist/) | ServiceAccount、Pod SecurityContext、RBAC、镜像、NetworkPolicy、RuntimeClass 和审计。 |
| [MITRE ATLAS](https://atlas.mitre.org/) | 将 AI 系统攻击技术映射到可演练的对手行为，适合构建红队场景和检测用例。 |

**平台与执行隔离文档**

| 资料 | 主要价值 |
| --- | --- |
| [Microsoft Execution Containers (MXC)](https://github.com/microsoft/mxc) | TypeScript / .NET / Rust SDK、跨平台策略、Backend 能力发现、文件 / 网络 / UI 限制和 Learning Mode。 |
| [Anthropic Sandbox Runtime](https://github.com/anthropics/sandbox-runtime) | Seatbelt、Bubblewrap、Windows 限制执行和网络策略。 |
| [Google GKE Agent Workloads](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/machine-learning/agent-workloads) | Agent Substrate、Agent Sandbox、SPIFFE、Egress Gateway、gVisor 和 microVM 的生产架构取舍。 |
| [gVisor Security Model](https://gvisor.dev/docs/architecture_guide/security/) | 用户态 Kernel 的威胁模型、宿主接口和防御纵深。 |
| [Kata Containers](https://katacontainers.io/) | Kubernetes 友好的轻量 VM 执行边界。 |
| [Firecracker Design](https://github.com/firecracker-microvm/firecracker/blob/main/docs/design.md) | microVM 的 Host / Guest 信任区、VMM、设备模型、网络与威胁遏制。 |
| [Apple App Sandbox](https://developer.apple.com/documentation/security/app_sandbox) | macOS 文件、网络和硬件 Entitlements。 |
| [Windows Application Isolation](https://learn.microsoft.com/en-us/windows/security/book/application-security-application-isolation) | AppContainer、Windows Sandbox、应用隔离与系统控制。 |

**研究论文与可复现实验**

| 研究 | 主要发现 / 用途 |
| --- | --- |
| [AgentDojo: A Dynamic Environment to Evaluate Prompt Injection Attacks and Defenses for LLM Agents](https://arxiv.org/abs/2406.13352), NeurIPS 2024 | 有状态多轮任务和工具环境，联合评估正常任务效用与攻击成功率。 |
| [Toward Secure LLM Agents: Threat Surfaces, Attacks, Defenses, and Evaluation](https://arxiv.org/abs/2606.10749), 2026 | 汇总 247 篇研究，按信息流、委托权限和持久状态分析 Agent 生命周期风险，并指出 Memory 与多 Agent 防御仍有缺口。 |
| [ToolFence: Fine-Grained Authorization for Secure Tool-Using LLM Agents](https://arxiv.org/abs/2609.37196), 2026 | 以授权蓝图、参数 Provenance 和确定性 Monitor 限制工具副作用，尤其关注同一 Tool 内参数被注入篡改的风险。 |
| [SafeClawBench: Separating Semantic, Audit-Evidence, and Sandbox Harm in Tool-Using LLM Agents](https://arxiv.org/abs/2606.18356), 2026 | 将语义失败、审计可见危害和真实 Sandbox 状态危害分开测量，适合设计 Runtime 安全验收指标。 |
| [AutoDojo: A Generative Benchmark for Evaluating Prompt Injection Defenses in LLM Agents](https://arxiv.org/abs/2606.15057), 2026 | 研究自适应生成攻击，说明固定攻击集可能高估 Prompt Injection 防御效果。 |
| [Your Agent is More Brittle Than You Think: Uncovering Indirect Injection Vulnerabilities in Agentic LLMs](https://arxiv.org/abs/2604.03870), 2026 | 在动态多步工具环境中研究间接注入与多种防御策略，强调单轮静态测试的局限。 |
| [The Hidden Dangers of Browsing AI Agents](https://arxiv.org/abs/2505.13076), 2025 | 浏览器 Agent 的端到端威胁模型，讨论 Prompt Injection、域名校验绕过、凭证外泄和 Planner / Executor 隔离。 |

## 12. 结论：复用 OS Sandbox，自己实现策略控制面

如果是 TypeScript / Node.js Agent Runtime，我会按以下方式落地：

- Read：使用只读 Capability Filesystem，细分目录列表、元数据、内容读取和搜索权限。
- Write / Edit：使用独立的 ChangeSet、Patch、版本检查和可回滚提交接口，不与执行能力绑定。
- 轻量 Shell：使用 just-bash，优先采用内存文件系统；只在确有需要时开放网络、Python 或 JavaScript。
- Bash / Script：通过独立 Execution Service 调用 Anthropic Sandbox Runtime、Microsoft Execution Containers（MXC）等经验证的 OS Sandbox，脚本写入与脚本执行分别授权。
- 完整开发环境：需要依赖安装、编译、浏览器和长任务时，再采用 OpenHands 这类 Docker Runtime；高风险任务考虑 VM。
- 权限与审计：由自己的 Agent Runtime 统一管理 Tool Registry、Policy Engine、审批、Execution Profile 和 Audit Log。

这套组合的重点不是多增加一层抽象，而是避免让 Agent Runtime 自己承担操作系统安全机制的实现成本。Runtime 应该知道谁在执行什么任务、请求操作哪个资源、为什么被允许；Sandbox 则保证实际进程不能超出已批准的执行范围。

最后要强调：Sandbox 不能消除 Prompt Injection，也不能自动解决数据外传、恶意依赖、宿主机漏洞或用户误授权。它的作用是把模型可能犯错的影响范围限制住。一个可靠的 Agent Runtime，应该允许模型提出动作，但不能允许模型决定自己的权限边界。