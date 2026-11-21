---
author: SW
pubDatetime: 2026-11-21T00:00:00Z
title: "Rust 在 Agent Client 与 Runtime 安全中的应用：从本机 Broker 到可验证执行边界"
featured: false
draft: false
tags:
  - AI
  - Agent
  - Rust
  - Agent Runtime
  - Security
  - Sandbox
  - Architecture
description: "分析 Rust 在本机 Agent Client、Security Broker、策略执行、OS Sandbox、代码签名和供应链防护中的作用，比较 nono、Strands Box、Symbiont、thClaws 等开源实现。"
---

# Rust 在 Agent Client 与 Runtime 安全中的应用：从本机 Broker 到可验证执行边界

当 Agent 获得文件、Shell、浏览器和 MCP 工具后，风险不再只是模型会不会生成错误命令。模型可能被网页、文档、Skill 或工具结果中的间接提示注入诱导，进而修改 Client Agent 自身的配置、脚本、工具注册表，甚至尝试替换负责权限检查的组件。

如果 Client Agent 完全由 TypeScript / JavaScript 实现，安全逻辑和业务逻辑往往运行在同一个 Node.js 进程中。模型一旦能调用 Shell 或文件工具，就可能修改磁盘上的脚本、配置和依赖；如果运行时支持动态加载、插件或 eval，攻击面还会扩大。

把本机关键安全组件改用 Rust，确实能改善这个问题。但要先说清楚：Rust 不是防破解语言，编译成 Native Binary 也不代表程序不可修改。真正的价值在于把安全关键路径做成独立、较小、可审计的组件，再借助操作系统的身份、权限和代码完整性机制保护它。

本文关注的是本机 Agent Client 和 Runtime 的设计，不是泛泛比较 Rust 与 TypeScript 的性能。

## 1. 先确定威胁模型：Agent 可能攻击自己的 Client

传统桌面应用通常假设应用逻辑由开发者编写，用户通过 UI 操作它。Agent Client 的假设不同：模型会根据上下文生成代码、调用工具、启动子进程，并可能读取或修改自己的工作目录。它处理的网页、仓库、邮件、PDF、MCP 返回值和 Skill 内容也可能包含恶意指令。

需要考虑的攻击至少包括：

- 修改本机策略文件，把 deny 改成 allow，或者把审批开关关闭。
- 修改 Agent 的 JS/TS 文件、启动脚本、插件配置或依赖，下一次启动时加载恶意代码。
- 通过 Shell 直接访问文件系统或网络，绕过 Client 中的 Tool Permission。
- 终止本机安全进程，再启动一个行为相同但不执行策略检查的伪造进程。
- 修改本地缓存的签名策略、回滚到旧策略，或替换策略验证公钥。
- 利用 MCP Server、Skill、Python 包或 Native Plugin 在 Agent 进程内执行任意代码。
- 修改本地审计记录，隐藏实际执行过的操作。

这里要区分攻击者权限。模型通常最初只拥有 Agent 进程的权限；但如果 Agent 进程与用户桌面共享同一个 OS 用户身份，它可能继承该用户可访问的大量文件、凭证和本地服务。若攻击者已经控制了本机管理员或内核权限，客户端自身就不能再充当可信根。

因此，合理的安全目标不是“Rust 程序永远不会被破解”，而是：Agent 进程即使完全失陷，也不能直接修改安全策略、替换安全组件或绕过对敏感资源的操作系统限制。

## 2. Rust 能改善什么，不能改善什么

Rust 的第一个价值是内存安全。所有权和借用检查能在编译阶段消除大量悬空指针、重复释放和数据竞争问题。对于处理不可信 Tool 参数、文件路径、网络协议和 IPC 消息的安全组件，这能减少 C/C++ 常见的一类漏洞。

第二个价值是部署形态。Rust 可以构建为独立 Native Binary，不依赖 Node.js、Python 或 JVM 才能启动。策略执行、Capability 管理、进程启动、IPC 和审计可以收敛在少量可执行组件中，减少动态脚本运行时和包加载路径。

第三个价值是类型和状态约束。可以把未验证请求、已规范化 Action、已授权 Action 和可执行 Action 建模为不同类型，避免业务代码随意把一个普通 JSON 对象当成已授权请求。状态机、枚举和类型封装可以让一部分安全约束在编译时暴露。

但 Rust 不会自动解决以下问题：

| 问题 | Rust 能否解决 | 仍需要的控制 |
| --- | --- | --- |
| 缓冲区溢出、悬空指针等内存错误 | 大幅降低安全 Rust 代码中的风险 | 审查 unsafe、FFI、Native 依赖 |
| Agent 修改自己的策略脚本 | 不能自动解决 | 策略独立存储、签名验证、文件权限 |
| Agent 绕过 Tool API 直接访问文件 | 不能 | OS Sandbox、独立执行身份、资源 ACL |
| Agent 终止或替换 Broker | 不能 | 进程身份隔离、服务权限、OS 控制 |
| 二进制被 Patch 或内存被调试 | 不能保证阻止 | OS Code Integrity、签名、Hardened Runtime |
| 恶意 Skill、MCP Server 或依赖 | 不能 | 来源验证、权限隔离、供应链治理 |
| 管理员或内核级攻击者 | 不能 | 设备管理、平台安全能力或远端信任边界 |

尤其需要避免一个错误结论：Rust Binary 比 JS 文件难修改，不等于安全。只要 Agent 和 Broker 运行在同一个用户权限下，攻击者仍可能删除或替换可执行文件、修改配置、终止进程，或者直接绕开 Broker 使用操作系统 API。

## 3. 三种实现路线：全 Rust Client、混合 Client、独立 Security Broker

Rust 并不意味着整个桌面应用都必须重写。

### 3.1 全 Rust Agent Client

UI、Agent Loop、Tool Registry、策略判断和本机执行都由 Rust 实现。桌面 UI 可以采用 egui / eframe，也可以使用 Tauri 的 Rust Host 配合 Web UI。

优点是运行时依赖少，核心逻辑集中，进程和状态管理可以使用统一的类型系统。缺点是 UI、模型供应商集成、文档渲染和复杂交互都需要迁移到 Rust 生态，开发成本不低。更重要的是，如果 UI、Agent 和执行器仍然在同一个进程、同一个 OS 身份下运行，语言统一并没有建立安全隔离。

### 3.2 TypeScript UI + Rust Runtime

保留 React、Vue 或其他 Web UI，Rust 实现 Agent Runtime、工具执行和本机服务。UI 通过 Tauri Command、Unix Domain Socket、Named Pipe 或本机受认证的 IPC 与 Rust 通信。

这条路线适合已有 Electron / Web 技术栈的产品。它减少 UI 重写成本，但必须把 IPC 当成安全 API：每个请求都要重新验证身份、参数、资源范围和权限，不能因为请求来自本机 WebView 就默认可信。

如果 Agent Loop 仍然在 Node.js 中，Node 进程应当被视为不可信客户端。Rust Runtime 不应相信它传来的 risk_level、approved、principal 或 policy_decision 字段。

### 3.3 TypeScript Agent + 独立 Rust Security Broker

这是本机安全防护中更值得优先考虑的方案。Agent Client 继续负责模型调用、对话、规划和工作流；Rust Broker 负责 Action 规范化、策略判定、Capability 校验、进程启动和资源访问控制。

但 Broker 不能只是一个供 JS 调用的 allow/deny HTTP API。若 Node.js 仍然可以直接使用 fs、child_process、任意网络连接或本地凭证，那么它可以完全绕过 Broker。

要形成有效边界，Agent 进程必须在 OS 层失去直接访问受保护资源的能力，敏感操作只能通过受控代理完成。Broker 自身也应运行在受保护的服务身份或独立沙箱中。

| 路线 | 适用情况 | 主要代价 |
| --- | --- | --- |
| 全 Rust Client | 新产品、希望减少运行时依赖、团队熟悉 Rust | UI 和生态迁移成本高 |
| TS UI + Rust Runtime | 已有 Web UI，希望统一 Agent Runtime | IPC、进程边界和前后端状态设计 |
| TS Agent + Rust Broker | 现有 Agent 代码较多，优先强化本机安全 | 必须处理 OS 权限隔离和绕过路径 |

从已有产品渐进改造的角度，第三种路线通常更现实；如果从零构建一个面向普通用户的 Agent Desktop，第二种路线的综合成本可能更合适。

## 4. 推荐的本机信任边界

不要把 Rust 进程本身等同于可信边界。可信边界应当由 OS 身份隔离、资源权限和实际执行路径共同构成。

建议把系统拆成几个不同信任域：

| 组件 | 主要职责 | 信任定位 |
| --- | --- | --- |
| UI | 展示、交互、用户确认 | 不可信输入面 |
| Agent Orchestrator | 模型调用、规划、任务编排 | 不可信 |
| Skills / MCP / Scripts | 扩展能力和第三方工具 | 不可信 |
| Rust Security Broker | Action 规范化、策略决策、Capability 验证 | 受保护组件 |
| Tool Worker | 文件、Shell、浏览器、网络等实际操作 | 每类能力单独限制 |
| OS Sandbox | 限制进程可访问的资源 | 最终执行边界 |
| Remote Authorization | 高风险授权、组织策略和撤销 | 远端信任服务 |

Agent 与 Broker 之间使用版本化 IPC 协议。Broker 从 OS 获取对端进程身份，并验证调用主体是否拥有对应任务的 Capability。不能只依赖随机端口、共享 Secret 或“请求来自 localhost”来识别可信调用方。

Broker 也不应该把所有 Tool 都放在自身进程里执行。更稳妥的方式是由 Broker 创建受限 Worker：每个 Worker 只获得完成当前任务所需的文件路径、网络目标、环境变量和凭证。Worker 退出后撤销临时资源和凭证。

### 一次工具调用的控制路径

1. Agent 提交原始 Tool Request。
2. Broker 解析并规范化 Action，重新确定操作类型、目标资源和数据分类。
3. Local PDP 根据签名策略和当前 Capability 做本机判定。
4. 需要远端授权的操作提交 Action Proposal，返回结果必须绑定具体 Action 摘要。
5. Broker 验证授权结果、有效期、策略版本和撤销状态。
6. Broker 启动受限 Worker，或把请求交给对应的受控 Tool Gateway。
7. OS Sandbox 限制 Worker 的文件、进程、网络和 IPC 能力。
8. Broker 记录实际执行结果，而不只是 Agent 声称的执行结果。

策略判断和实际副作用必须在同一条受控执行路径上。否则，风险分类做得再精细，也只是在给 Agent 提供一份建议。

## 5. Rust 生态中可以直接利用的安全组件

不需要从零实现所有安全功能。Rust 生态已经有一些值得组合使用的项目和库。

### 5.1 nono：本机 Agent 的 OS 级隔离

[nono](https://github.com/nolabs-ai/nono) 是目前值得重点研究的 Rust Agent Runtime 安全项目。它不是 Agent Framework，而是面向已有 Agent 的安全执行层。

项目 README 描述的能力包括：

- Linux 使用 Landlock，macOS 使用 Seatbelt，Windows 环境支持 WSL2。
- 文件、命令、网络和凭证权限控制。
- 工具级隔离，避免 Agent 和工具共享全部权限。
- 通过代理注入凭证，让 Agent 不直接持有底层 API Key。
- 对 Skill、Hook 和指令文件进行来源与完整性验证。
- 具有防篡改审计记录和文件恢复能力。

它的价值在于不要求把 Agent 改写成 Rust。已有的 Claude Code、Codex、Copilot、OpenCode 或自建 Agent，都可以在外部执行边界中运行。

需要区分：nono 的 Rust 实现不意味着所有被启动的 Agent 都是 Rust。它提供的是安全执行和治理层。项目支持矩阵、具体隔离能力和平台限制应以当前版本文档为准。

### 5.2 Strands Box：策略与执行隔离组合

[Strands Box](https://github.com/strands-agents/box) 是 Rust 实现的 Agent Sandbox Engine。它将 OS 级隔离与 Dogwood 策略引擎结合。

它的架构有一个值得借鉴的点：Agent 在受限 Sandbox 中运行，而 Shell、Python Interpreter、Egress Gateway 和 MCP Broker 位于 Sandbox 外部的受信任执行侧。它们在执行操作前调用统一策略引擎，并把事件写入共享历史。

这让策略可以考虑操作序列，而不只是单次 Tool Request。例如，Agent 先读取某个敏感文件，之后再尝试向外部网络发送数据，后续网络操作可以根据此前事件被拒绝。

项目当前文档标注为 Preview。其平台支持和可用性仍在演进，不应把 Preview 能力直接当成成熟的跨平台生产承诺。

### 5.3 Symbiont：Rust Agent Runtime 与治理模型

[Symbiont](https://github.com/thirdkeyai/symbiont) 是更完整的 Rust Agent Runtime，而不只是 Sandbox。

项目公开的安全设计包括：

- 每次 Tool 调用和资源访问前进行 Cedar 授权。
- 使用 SchemaPin 验证 Tool Schema。
- 支持 Docker、gVisor 和 Firecracker 等隔离级别。
- 敏感操作可以进入人工审批。
- 支持 Vault / OpenBao 等凭证管理后端。
- 通过可验证的审计记录保留决策轨迹。

它还强调 Agent 输入默认不可信，模型输出不能直接成为执行授权。对希望把 Agent Identity、Tool Governance、审批和审计统一在 Runtime 中的团队，Symbiont 值得研究。

不过，项目 README 中也明确提醒：不应把较弱的本地执行模型当成运行不可信代码的唯一边界。采用它仍需按实际部署方式验证隔离强度。

### 5.4 thClaws：更接近完整 Rust Agent Client

[thClaws](https://github.com/thClaws/thClaws) 是较完整的 Rust Agent Harness，提供 GUI、CLI、Headless 和 Web App 等入口，包含 Agent Loop、MCP、Skills、Plugins 和多 Agent 能力。

它的安全实现尤其值得关注：

- Shell 命令使用 macOS Seatbelt、Linux Landlock 或 bubblewrap 进行 OS 级限制。
- 文件系统 Sandbox 默认限定工作目录。
- 变更类 Tool 可以要求用户审批。
- Enterprise Policy 使用 Ed25519 签名，客户端内置公钥验证。
- 策略文件被修改后，程序会停止，而不是静默降级。
- Tool Call Audit 记录调用主体、动作和审批方式。

这说明完整 Rust Client 可以把策略验证、权限模式和审计直接集成进 Agent Harness，而不是把它们当作外围插件。

但要注意：签名策略文件只能证明策略来自受信任签发者且内容未被修改，不能证明客户端进程本身无法被调试、终止或替换。项目的 OS Sandbox、服务身份和安装保护仍需独立评估。

### 5.5 OpenAI Fence：范围很窄，但安全工程方法值得参考

[OpenAI Fence](https://github.com/openai/fence) 是一个面向特定 GitHub-hosted Linux Runner 的 Rust 安全 Agent。它的目标不是通用桌面 Agent，而是在明确限定的执行环境中建立出站网络和普通权限绕过边界。

它值得研究的不是功能广度，而是安全声明的写法：明确支持的平台、攻击者能力、已覆盖的绕过方式、残余风险和验收证据。项目文档把规范、威胁模型和实现历史分开，避免把“实现了某个功能”误写成“解决了某类安全问题”。

这种收敛范围的安全工程方法，比声称一个通用 Sandbox 可以防住所有攻击更可信。

 
### 5.6 Goose：成熟度较高的 Rust Agent Client 与可复用 Runtime

[Goose](https://github.com/aaif-goose/goose) 是 Rust 实现，而且不只是一个 Rust CLI。它同时提供桌面应用、CLI、ACP Server，以及可嵌入其他应用的 Open Intelligence Kit（oi-kit）。oi-kit 将 Agent State Machine、Operations、Tools、Model Providers 和 Context Management 拆成可组合组件；应用可以自己决定 UI、策略和存储。Goose Desktop 本身也通过 ACP 与后端交互。当前 oi-kit 文档仍标注 Alpha，使用时应锁定与依赖版本匹配的文档和 API。

Goose 的安全功能包括 Prompt Injection Detection、Tool Permission Controls、Sandbox Mode 和 Adversary Mode。Adversary Mode 在每次工具执行前，让独立 Reviewer 根据原始任务、近期对话和 Tool Call 判断 ALLOW / BLOCK。它的设计意图是防止主 Agent 被 Prompt Injection 操纵后执行偏离用户意图的操作。

但需要注意一个关键实现细节：官方 Adversary Mode 文档说明，Reviewer 失败时采用 **fail-open**，工具调用仍会继续。因此它属于基于模型判断的第二道审查，不是不可绕过的安全执行边界。它也使用当前配置的模型 Provider，并非独立可信的本机策略引擎。若攻击者已经能修改 Goose 配置或禁用该模式，这一层也可能失效。

Goose 自身的 Security Policy 对风险边界写得比较明确：Agent 可以在本机执行代码并代表用户操作系统，因此建议在权限受限的 VM 或容器中运行，审查 MCP Extensions，对重大操作要求人工确认，并把复杂任务拆成较小的隔离操作。这些建议说明 Goose 的 Rust 实现并没有试图用语言本身替代 OS 隔离。

对架构设计而言，Goose 有两项特别值得借鉴的内容：

- **oi-kit 的 Runtime 组件化**：将 Agent State Machine、工具调用、审批、上下文压缩和持久化状态从桌面 UI 中分离，适合构建自己的 Rust Agent Client。
- **ACP 作为进程边界**：外部应用可以把 Goose 当作 Agent Backend，通过协议交换消息、工具活动和权限请求，而不是把 Agent Loop 嵌进自己的 UI 进程。

如果目标是借鉴完整 Rust Client，Goose 应当进入第一梯队；如果目标是研究不可绕过的本机防护，则需要把它与 nono、Strands Box 或 OS Sandbox 组合起来评估。

### 5.7 IronClaw：WASM Tool Sandbox 与凭证边界

[IronClaw](https://github.com/nearai/ironclaw) 是 NEAR AI 的 Rust Agent OS，定位是安全优先的个人 Agent。它受到 OpenClaw 启发，但不是简单的 Rust 语法翻译：其公开架构包含 Agent Loop、Router、Scheduler、Worker、Orchestrator、Web Gateway、Routines Engine 和 Safety Layer。

它最值得关注的是 Tool 执行边界：

- 不可信 Tool 以 WebAssembly 模块运行，通过 Capability 明确授予 HTTP、Secret 和 Tool Invocation 等能力。
- 默认不向 WASM Tool 暴露宿主机文件系统和任意网络访问。
- HTTP 请求先经过 Endpoint Allowlist，再做 Secret Leak Scan；只有通过检查的请求才由 Host 注入凭证并执行。
- 响应返回 WASM 前再次进行泄漏检查。
- 对 Tool 设置内存、执行时间、请求频率等资源限制。
- 同时提供 Docker Sandbox 和 Orchestrator / Worker 模式，用于更重的隔离任务。

这套设计把“工具能做什么”和“工具能否看到凭证”分开了。模型生成的 WASM Tool 不直接持有 API Key，而是向宿主提出受限请求，由 Host 根据 Endpoint Policy 注入凭证。对于需要运行第三方 Tool、动态生成 Tool 或不完全信任 MCP Server 的场景，这比把所有 Tool 都作为本机子进程运行更容易建立权限边界。

但 WASM 不是绝对安全边界。它依赖 WASM Runtime 的正确性，Host Function 暴露面、Capability 配置和模块验证仍然是可信计算基的一部分。IronClaw 也同时保留了 Docker 执行路径，说明不同工作负载需要不同隔离强度。

### 5.8 ZeroClaw：把风险等级、Autonomy 和 Sandbox 分层

[ZeroClaw](https://github.com/zeroclaw-labs/zeroclaw) 是 Rust 编写的本机 Agent Runtime，提供单一 Binary、CLI、常驻 Service、多种消息 Channel、模型 Provider 和工具集成。它不是单纯的 Sandbox，但它的 Security Model 对本机 Agent 的权限治理很有参考价值。

ZeroClaw 把安全拆成多个层次：

1. Channel Pairing 和 Allowlist：先决定谁可以向 Agent 发消息。
2. Autonomy Level：ReadOnly、Supervised、Full 三档，决定默认自主程度。
3. Workspace Boundary 和 Path Rules：限制文件和 Shell 可访问范围。
4. Shell Command Policy：命令 Allowlist、Denylist 和参数模式检查。
5. OS Sandbox：按平台选择 Landlock、Firejail、Seatbelt、Bubblewrap 或 Docker 等后端。
6. Tool Receipts：对成功 Tool Call 和结果生成 HMAC-SHA256 证据。

其 Supervised 模式把工具分为 Low、Medium、High：低风险操作自动执行，中风险要求操作员批准，高风险直接阻断。ReadOnly 模式只暴露无副作用工具。Full 模式提高自主程度，但并不自动取消 forbidden paths、always-ask 和 OS Sandbox 等其他约束。

另外还有 OTP Gate、Emergency Stop、Prompt Injection Guard 和 Outbound Leak Detector。Tool Receipt 是一个有意思的设计：它证明成功的 Tool Result 确实经过 Runtime 生成，降低模型虚构工具调用或结果的可能性。不过，当前 Receipt 使用短生命周期内存 HMAC Key，不是长期可验证的审计日志，也不能替代授权和执行隔离。

ZeroClaw 的文档也明确列出了平台差异：当前 OS Sandbox 自动选择在 Linux 和 macOS 有不同后端，Windows 没有同等的 OS Sandbox Backend；如果没有可用后端，Native Runtime 可能退回应用层策略。这一点对选型很重要：不能只看到“支持 Windows”就推断各平台拥有相同的隔离强度。

### 5.9 Moltis：完整 Rust Agent Server 与桌面端

[Moltis](https://github.com/moltis-org/moltis) 是 Rust 实现的持久化个人 Agent Server，提供 Web UI、CLI、MCP、消息 Channel、长期记忆、语音、浏览器和远程执行等能力。它还提供 Native Rust / GPUI Desktop Client，客户端可以连接本地 Daemon，也可以通过 HTTPS 或 SSH Tunnel 连接远端服务。

它的安全设计覆盖面比较完整：

- Tool 执行使用 Docker、Podman、Apple Container 或 WASM 等隔离方式。
- 每 Session 隔离执行环境，避免不同任务共享全部运行权限。
- 使用 Vault / Secret Store、XChaCha20-Poly1305、Argon2id 等机制保护凭证和静态数据。
- 支持 Password、Passkey、API Key 认证和速率限制。
- 对 HTTP 目标进行 DNS 解析和私网地址检查，防止 SSRF。
- WebSocket Origin Validation 防止跨站连接滥用。
- BeforeToolCall Hook 可以检查或阻止 Tool Invocation。
- 发布产物支持 Sigstore Artifact Attestation、GPG 签名和 Checksum 验证。

Moltis 的价值在于展示了一个 Rust Agent 产品如何把 Agent Loop、Gateway、Tool Runtime、Vault、Network Filter、Desktop Client 和发布安全组合起来，而不只是一个命令执行 Sandbox。

需要进一步审查的地方是部署形态：例如 Docker 部署如果把宿主机 Docker Socket 挂入容器，控制该 Socket 的进程通常拥有很高的宿主机控制能力。不能因为 Tool Worker 被放进容器，就忽略 Orchestrator 对容器运行时本身的权限。对于多租户部署，应评估 Docker Socket、容器身份、镜像来源和每任务隔离方式。

### 5.10 Strands Shell：值得单独研究的 Rust Shell Kernel

[Strands Shell](https://github.com/strands-agents/shell) 是 Rust 编写的 Bourne-compatible Shell，通过 Python（PyO3）和 Node.js（napi-rs）提供绑定，也能作为 MCP Server 使用。它提供虚拟文件系统、URL Allowlist、SSRF 防护、按 URL 注入凭证、命令执行限制和资源上限。

它的架构有一个重要区别：Shell Kernel 在宿主应用进程内运行，命令通过用户态实现执行，不依赖传统 Shell 的 fork / exec 路径。这样可以避免把真实宿主 Shell 的全部能力交给 Agent，也能把文件、网络和凭证访问集中在 Kernel 中检查。

不过项目的 Security Model 明确说明：**Strands Shell 是 mediation layer，不是 OS Sandbox。** Kernel 与调用它的 Agent 代码处于同一进程；如果攻击者控制宿主进程，就可能绕过这层中介。它适合控制“Agent 不应该访问未授权资源”的常规场景；对于恶意代码、多租户或强对抗负载，仍应把它放进 Container 或 MicroVM。

这也解释了 Strands Shell 和 Strands Box 的关系：Shell 提供受控的命令执行和资源中介；Box 再把 Agent 放进 OS Sandbox，并在 Sandbox 外运行 Shell、Python Interpreter、Egress Gateway、MCP Broker 和 Dogwood Policy Engine。两者不是同一层的替代品。


## 6. Rust 实现时的技术选型

如果自己构建 Rust Security Broker，可以按职责选组件，不必引入一个庞大的 Agent Framework。

| 领域 | 可考虑的组件 | 用途与边界 |
| --- | --- | --- |
| Async Runtime | Tokio | IPC、网络代理、任务并发；不是安全隔离机制 |
| 序列化 | Serde | 解析 IPC 和策略数据；必须限制输入大小和递归深度 |
| 授权策略 | [Cedar](https://github.com/cedar-policy/cedar) / cedar-policy | RBAC、ABAC 和细粒度授权；不负责 OS 资源隔离 |
| OS Sandbox | [nono](https://github.com/nolabs-ai/nono) | 使用平台原生机制限制文件和网络能力 |
| 签名 | Ed25519 实现及标准签名格式 | 验证策略、Manifest 和授权 Grant |
| IPC | Unix Domain Socket / Windows Named Pipe | 进程间通信；还需要 OS ACL 和对端身份验证 |
| Secret Storage | macOS Keychain / Windows Credential Manager / Linux Secret Service | 保存长期凭证；不要把 Secret 放入 Agent 上下文 |
| TLS | rustls | 远端授权服务通信 |
| Agent Framework | [Rig](https://github.com/0xPlaygrounds/rig) 等 | 模型与 Agent 开发；不应直接承担安全边界 |

Cedar 是一个值得考虑的策略引擎。它的 Rust 实现将策略语言和应用代码分开，策略可以独立编写、验证、更新和审计。它解决的是“某个主体能否对某个资源执行某个动作”，不是“进程在操作系统层面是否真的无法访问其他资源”。

Rust 类型系统也可以帮助减少授权状态混用。例如，不要让所有 API 都接受一个通用 Action 结构；可以分别定义 UntrustedAction、NormalizedAction、AuthorizedAction，只有通过验证的对象才能传入执行器。这个设计不能替代运行时校验，但能减少内部调用错误。

## 7. 策略签名和代码签名不是一回事

本机 Agent 安全至少涉及三类签名对象。

**代码签名（Code Signing）** 用来验证发布的可执行文件、动态库、Helper 和安装包是否来自预期发布者，以及文件在签名后是否被修改。它不能阻止拥有足够权限的攻击者替换整个应用目录，也不能保证运行时内存没有被修改。

**策略签名（Policy Signing）** 用来保护 Policy Bundle、Capability Manifest 和组织配置。客户端内置公钥，发布端使用私钥签名。建议签名内容包含策略版本、适用 Runtime 版本、有效期、策略正文摘要和密钥标识。验证时还要处理旧版本回滚、密钥轮换、吊销和过期。

**执行授权签名（Action Grant）** 用于高风险操作的短期授权。它应绑定主体、任务、操作类型、目标资源、参数摘要、策略版本、有效期和唯一请求 ID。Broker 执行前重新计算 Action 摘要，防止批准的是一个动作、实际执行时却换成另一个动作。

签名不能解决授权语义错误。如果签发服务给了过宽权限，或者 Broker 没有把实际参数纳入摘要，签名只会让错误授权变得更可信。

### 平台代码完整性机制

| 平台 | 可用机制 | 实际作用 |
| --- | --- | --- |
| macOS | Developer ID、Notarization、Hardened Runtime、App Sandbox | 验证发布者和分发产物，限制代码注入、动态库加载及部分运行时篡改 |
| Windows | Authenticode、App Control for Business、Smart App Control、Restricted Token | 验证代码签名，并按组织策略限制可执行内容和进程权限 |
| Linux | IMA、AppArmor、SELinux、Landlock、seccomp | 通过内核机制约束文件、进程和系统调用；代码签名与完整性策略需结合发行版和系统配置 |

macOS 的 Hardened Runtime 与 SIP 能阻止一部分代码注入、动态库劫持和进程内存篡改，但它不是防止所有本机管理员攻击的万能开关。启用 JIT、加载插件或允许任意动态库时，必须审查是否引入了例外 Entitlement。

Windows 的 App Control for Business 不应只签主 EXE。微软建议把安装器、Helper、DLL、脚本、插件、更新程序等可执行内容都纳入签名和发布流程，并在 CI/CD 中验证签名覆盖率。

## 8. 本机 Broker 如何避免被 Agent 绕过

这是整个方案的关键。只要 Agent 仍然拥有和普通桌面应用相同的资源访问权限，Broker 就可能只是一个可选 API。

### 8.1 Broker 与 Agent 不应共享同一安全身份

至少应考虑：

- Broker 安装在 Agent 进程无权修改的目录。
- Broker 由 OS Service / LaunchDaemon 等机制管理，而不是由 Agent 自己随意启动和替换。
- Agent 无权修改 Broker 的二进制、配置、公钥和策略存储。
- IPC 校验客户端进程身份、OS 用户、会话和授权上下文。
- Broker 退出或验证失败时，高风险操作失败关闭。
- 更新由独立更新器完成，更新包验证签名后原子替换。

如果 Broker 与 Agent 都运行在同一普通用户权限下，上述隔离通常并不完整。需要根据平台采用独立服务账户、受限令牌、目录 ACL、沙箱和受保护的服务管理配置。不能仅凭“两个进程”就认为建立了安全边界。

### 8.2 Agent 不能保留绕过 Broker 的原始能力

如果 Agent 进程能直接读写用户目录、访问 SSH Agent、连接任意网络，Broker 就无法控制这些操作。

可行的做法是把 Agent 放入受限环境：只给它必要的 Workspace 和只读资源；Shell、Python、MCP、Browser 和网络访问通过独立 Worker 或 Gateway；凭证由代理按需注入，不进入 Agent 环境变量或模型上下文。

需要留意继承关系：子进程通常继承父进程的环境变量、文件描述符和部分权限。启动 Worker 时必须显式构造干净环境，而不是把 Agent 的全部环境直接传下去。

### 8.3 对路径和进程参数做真实解析

不能只对字符串做前缀判断。例如 /workspace/project-evil 可能通过简单的 /workspace/project 前缀检查。符号链接、硬链接、挂载点、大小写和路径规范化也会影响实际访问目标。

文件授权应尽可能在打开文件的执行边界完成，并考虑检查后替换（TOCTOU）问题。Shell 也不能只依靠危险命令黑名单：命令别名、解释器、脚本、重定向和子进程都可能改变真实行为。高风险场景应限制可执行程序和参数，或使用受控解释器，而不是把任意 Shell 当作可安全解析的普通字符串。

## 9. Rust 自身的供应链和发布安全

Rust 编译成单一二进制，并不代表依赖供应链消失。Cargo 依赖、build.rs、proc-macro、Native Library、Git Dependency 和构建工具都可能在构建阶段执行代码或引入漏洞。

至少应建立以下控制：

- 提交并审查 Cargo.lock，固定应用依赖解析结果。
- 使用 cargo audit 检查 RustSec 公告。
- 使用 cargo deny 检查许可证、重复依赖和来源策略。
- 评估 cargo vet，对依赖来源和审计状态建立组织级记录。
- 对 Git Dependency 固定到具体 Commit，不跟随浮动分支。
- 生成 SBOM，记录源码 Commit、构建器、依赖版本和最终产物摘要。
- 在受保护的 CI 环境签名，不把发布私钥放进开发机或 Agent 可访问目录。
- 对安装器、Updater、Helper、动态库和插件分别建立签名覆盖检查。
- 发布后验证下载产物的签名、Checksum 和 Attestation。

这里尤其要防止 Agent 修改构建脚本或发布流水线，再利用 CI 中的签名凭证签出恶意版本。签名只能证明产物经过某个签名密钥签署；它不能证明源代码审查、构建环境和发布审批没有被攻陷。

## 10. 现有 Rust 项目应该如何选

这些项目不是同一类产品。把 Agent Client、Runtime 和 Sandbox Engine 混在一个榜单里，会误导选型。

| 项目 | 类型 | 最值得研究的部分 | 需要注意 |
| --- | --- | --- | --- |
| [nono](https://github.com/nolabs-ai/nono) | Agent Runtime Security Tool | 工具隔离、凭证注入、网络控制、Skill Attestation、审计 | 不要求 Agent 本身使用 Rust；按当前平台矩阵验证 |
| [Strands Box](https://github.com/strands-agents/box) | Rust Sandbox Engine | OS 隔离、Dogwood 策略、Shell/Python/MCP/Egress Gateway | 当前项目文档标记 Preview |
| [Symbiont](https://github.com/thirdkeyai/symbiont) | Rust Agent Runtime | Cedar、Tool Schema 验证、身份、审批、审计 | 生产部署仍需验证实际隔离配置 |
| [thClaws](https://github.com/thClaws/thClaws) | Rust Agent Harness / Client | 完整 Agent Loop、签名组织策略、Seatbelt/Landlock、审计 | UI 使用 React Bridge；不是所有代码都在 Rust 进程内 |
| [OpenAI Fence](https://github.com/openai/fence) | 专用安全 Agent | 窄范围威胁模型、可审计发布和验收证据 | 目标是特定 Linux Runner，不是通用 Desktop Client |
| [harness](https://github.com/AleCyriaco/harness) | Rust 桌面 Agent | egui、GUI 与后台 Daemon 分离、单二进制分发 | 更适合研究客户端结构，不应视为完整安全方案 |
| [Goose / oi-kit](https://github.com/aaif-goose/goose) | Rust Agent Client + Runtime SDK | 桌面/CLI、ACP、可组合 Agent State Machine、审批操作 | Adversary Mode 是模型审查且 fail-open；不是 OS 安全边界 |
| [IronClaw](https://github.com/nearai/ironclaw) | Rust Agent OS | WASM Tool Capability、Host-side Secret Injection、Leak Scan | 需要审查 WASM Runtime 和 Host Function 暴露面 |
| [ZeroClaw](https://github.com/zeroclaw-labs/zeroclaw) | Rust Agent Runtime | 风险档位、Autonomy、OS Sandbox、OTP Gate、HMAC Tool Receipt | OS Sandbox 后端存在平台差异，Windows 当前无同等后端 |
| [Moltis](https://github.com/moltis-org/moltis) | Rust Agent Server + Desktop Client | Session Sandbox、Vault、SSRF 防护、Passkey、发布 Attestation | 重点审查 Container Runtime / Docker Socket 权限 |
| [Strands Shell](https://github.com/strands-agents/shell) | Rust Shell Kernel / Tool Mediation | 用户态 Shell、VFS、URL Allowlist、凭证代理、Python/Node Bindings | 同进程中介层，不是对抗宿主进程失陷的 Sandbox |
| [rust-agent-sandbox](https://github.com/maverickkhan/rust-agent-sandbox) | WASM Tool Sandbox 参考实现 | Wasmtime/WASI、JSON Schema、资源限制、MCP 子集 | 小型参考项目，适合学习和测试，不等同成熟产品 |

如果目标是构建完整 Rust Agent Client，先看 thClaws 的 Agent Harness 和策略实现；如果目标是给现有 TS/JS Agent 加固，先研究 nono 和 Strands Box；如果需要一个内置治理能力的 Rust Runtime，再看 Symbiont。

## 11. Rust Agent 的业界经验：语言选择之外，真正困难的是 Runtime

Rust Agent 项目逐渐成熟后，工程重点并没有停留在“用 Rust 重写 Agent Loop”。从 Goose、IronClaw、Moltis、ZeroClaw、Strands Shell，以及 ADK-Rust 的公开实现和文档，可以归纳出几条更有价值的经验。需要说明，开源项目的架构和 issue 能证明某个问题确实出现过或某种设计正在被采用，但不能自动证明它已经在大规模生产环境中得到验证。

### 11.1 Rust 更适合承载执行核心，不代表所有层都应该 Rust 化

Goose 把桌面应用、CLI、ACP Server 和可复用的 oi-kit Runtime 组合起来；Moltis 将 Agent Server、Gateway、Tool Runtime 和 Desktop Client 分开；ADK-Rust 则把 Runner、Session、Invocation、Event Stream、State、Checkpoint 和协议适配作为明确的 Runtime 抽象。Goose 当前 oi-kit 文档进一步说明了组件边界：Agent State Machine 由 Operations 和 Inference Steps 组成，事件在运行时流出，取消会结束中断步骤并处理未响应的 Tool Request；Session 类型、SessionLoader 和 EffectHandler 由宿主应用提供，持久化也由应用自己的 Runtime 负责，而不是内置数据库。当前 Python/Kotlin Bindings 只暴露 Provider、Streaming 和 Context Compaction 等能力，并没有完整暴露 Rust Agent State Machine。oi-kit 仍处于 Alpha，不能把 Rust 核心的成熟度等同于跨语言 API 已稳定。

这些项目体现出一个共同方向：把高频执行、并发控制、进程管理、工具生命周期和状态转换放在可控的 Runtime 核心中，UI、外部协议和应用集成则通过明确接口连接。它不意味着 UI 必须重写成 Rust，也不意味着所有业务流程都必须编译进一个大型二进制。

对已有 TS/JS 产品，更合理的迁移边界通常是先把敏感执行和系统资源访问从 Agent Orchestrator 中剥离，而不是一次性重写模型调用、UI、对话管理和全部业务逻辑。

### 11.2 MCP 是远程边界，不是安全边界

Goose 采用 MCP 扩展模式，ADK-Rust 的 MCP 文档也强调：当工具属于另一个进程、团队、语言、安全边界或部署单元时，MCP 是合适的契约边界。但协议只定义发现和调用方式，不自动提供可信身份、最小权限或安全执行。

生产使用 MCP 至少要解决这些问题：

- 工具发现与执行权限分开。不要把 Server 暴露的全部工具无差别交给模型；按任务过滤工具，并区分只读、可写和高影响操作。
- Server 生命周期需要管理。连接关闭、初始化失败、工具注册变化和 Server 重启都必须成为可观测事件。
- 为连接、工具调用和整个 Agent Task 分别设置超时。单个 HTTP 请求超时不能代表整个任务已经安全取消。
- 工具描述、Schema、返回值和错误信息都属于不可信输入。Schema 校验只能保证结构，不保证语义安全。
- 对工具调用、审批、拒绝、错误和 Server 生命周期保留结构化记录。

Goose 的公开 issue 中出现过 MCP 工具进入异常 Timeout 状态、后续连即时工具也失败的报告。这是单个 issue，不能据此推断 Goose 普遍存在该缺陷；但它提醒 Runtime 不能把一次调用超时简单等同于底层连接健康状态。连接级状态、请求级状态和 Agent Task 状态应分开管理，超时后需要明确判断是取消、重试、重连还是进入可恢复状态。

参考：[Goose oi-kit Reference](https://goose-docs.ai/docs/oi-kit/reference/)、[Goose oi-kit Changelog](https://github.com/aaif-goose/goose/blob/main/crates/goose-agent/CHANGELOG.md)、[ADK-Rust MCP Tools 文档](https://adk-rust.com/en/docs/tools/mcp-tools)、[Goose MCP timeout issue](https://github.com/aaif-goose/goose/issues/1164)。

### 11.3 Async Rust 的关键不是吞吐量，而是取消和资源生命周期

Agent 任务会同时等待模型 API、MCP、浏览器、子进程和用户审批。Tokio 可以高效管理并发，但异步并发本身不会自动解决任务生命周期问题。

实现时需要区分至少四种状态：调用方停止等待、Future 被取消、外部操作真正停止、外部副作用已经发生。它们并不等价。例如，取消一个等待 HTTP 响应的 Future，不一定能撤销远端服务已经提交的写操作；停止等待子进程，也不代表整个子进程树已经退出。

建议在 Runtime 中明确实现：

- **分层 Deadline**：模型请求、单次 Tool、子任务和整个 Session 使用不同 Deadline，并向下传递剩余预算。
- **Cancellation Token**：取消信号沿 Agent → Tool → Worker 传播；Worker 必须定义收到取消后的清理行为。
- **并发上限**：分别限制模型请求、MCP Server、子进程、文件操作和每个 Session 的并发量，避免一个任务耗尽整个 Runtime。
- **幂等和补偿**：对可能产生外部副作用的操作使用幂等键、执行状态查询或补偿流程，不能把网络超时后的盲目重试当成通用恢复策略。
- **资源回收**：确保临时文件、文件描述符、子进程、IPC Channel、Sandbox 和短期 Capability 都有明确的 owner 和释放路径。

对安全 Broker 而言，取消也不能绕过审计。授权已发出但 Worker 尚未执行、Worker 已执行但响应丢失、执行结果未知，这些状态必须分别记录，不能简单记为“调用失败”。

### 11.4 长任务需要持久化状态机，不能依赖内存中的 Agent Loop

Agent 任务可能在等待审批时停留数小时，也可能在模型供应商、MCP Server 或本机进程重启后继续执行。只把消息历史写入数据库，不等于具备 Durable Execution。

Runtime 应持久化任务状态、当前步骤、工具调用 ID、审批状态、重试次数、外部副作用标识和恢复点。恢复时不能简单重放最后一段对话并期待模型重新做出相同决定，因为模型输出并不保证确定性，重放工具也可能重复执行外部副作用。

更稳妥的模式是把模型输出视为候选 Action，把 Action 的授权与执行状态单独持久化。恢复流程先查询外部副作用是否已经完成，再决定继续、补偿或要求人工介入。Goose oi-kit 的 State Machine / Operations 分层，以及 ADK-Rust 的 Session、Invocation 和 Graph Checkpoint 设计，都值得从这个角度研究；它们提供的是可借鉴的抽象，不代表应用无需自行定义持久化和恢复语义。

### 11.5 可观测性必须覆盖 Agent 的真实执行结果

普通应用的日志通常可以围绕请求和异常组织。Agent Runtime 还需要记录模型决策、工具调用、授权、审批、外部副作用和最终任务状态之间的关联。

建议为每个 Task、Invocation、Tool Call、Worker 和 Approval 分配稳定 ID，并通过 Trace Context 贯穿模型请求、MCP、子进程和远端服务。事件至少要能回答：谁提出动作、依据什么任务、哪个策略版本做出判定、授权了哪些参数、哪个 Worker 实际执行、OS 是否拒绝、外部结果是否确认。

特别要避免只记录 Agent 自己声称的“执行成功”。应当从 Tool Worker 或远端服务取得执行结果，并把不确定状态显式呈现给用户。对于 Agent 系统，错误被模型总结成一段看似合理的成功叙述，比普通服务返回 500 更难发现。

### 11.6 WASM Tool 与 OS Sandbox 是不同层次

IronClaw 和 Strands Shell/Box 展示了不同的工具执行思路。WASM Component Model 通过 Host 明确授予文件、网络、环境变量等能力；没有获得相应 Import 或 Capability 的组件，原则上无法直接调用对应宿主能力。Akamai 的 Spin 示例也展示了通过声明 allowed outbound hosts 来限制组件网络访问。

这适合运行第三方 Tool、用户生成 Tool 或需要跨平台分发的轻量执行逻辑。但 WASM 的安全边界仍依赖 Runtime、Host Function 和 Capability 配置。一个过度宽泛的 Host Function，可能重新把宿主权限交还给 Guest。

OS Sandbox 则进一步限制 Worker 进程及其子进程能够访问的文件、网络、系统调用和 IPC。对于原生程序、浏览器、Python 或复杂 Shell，WASM 并不总是可行替代。实践中可以采用分层方案：受信任的内置 Tool 走受限 Native Worker；不可信插件走 WASM；需要运行任意原生代码的任务进入 Container 或 MicroVM。

参考：[WASI Security Model](https://wasi.dev/security)、[Akamai: Sandboxed Agentic Tools with Rust and Spin](https://developers.akamai.com/blog/sandboxed-agentic-tools/)。

### 11.7 审计日志不能只做到 append-only

审计系统本身也可能成为可靠性短板。多进程并发写入、崩溃时的半行记录、日志轮转、索引和长期查询都需要实测。简单地给 JSONL 文件追加内容，并不自动意味着记录完整、不可篡改或适合长期审计。

建议采用单写者或明确的事务提交机制，记录序号、主体、策略版本、Action Digest、授权结果、Worker 结果和时间信息；使用哈希链或签名检测篡改；对日志缺口、解析失败和写入失败设置独立告警。高价值审计记录应放在 Agent 无权修改的边界之外，并定期导出到独立存储。

后文引用的 2026 年执行治理研究报告了并发写入丢记录、日志增长导致查询变慢，以及格式错误记录被静默跳过等问题。它的实验环境和实现规模有限，但说明审计完整性必须通过并发和长期运行测试验证，而不能仅凭数据结构设计推断。

### 11.8 多平台支持要按隔离能力声明，不能按可运行性声明

一个 Rust Binary 能在 macOS、Windows 和 Linux 编译运行，不代表三个平台拥有相同的安全保证。Landlock、Seatbelt、seccomp、AppContainer、Job Objects 和容器运行时的能力、覆盖范围与配置复杂度不同。

项目的支持矩阵应至少分别描述：文件隔离、网络隔离、子进程继承、环境变量清理、凭证访问、进程身份、资源限制和审计保护。缺少 OS Sandbox 后端时，应明确显示降级状态，并对高风险操作失败关闭，而不是静默退回字符串 Allowlist。

这也是 ZeroClaw 的平台差异、Strands Box 的 Preview 状态，以及 OpenAI Fence 收敛到特定 Linux Runner 的设计所体现的工程现实：安全产品应该对支持范围做窄而准确的声明。

## 12. 相关论文：从研究结论转成工程约束

以下研究主要发表于 2026 年，许多是 arXiv 预印本。论文中的数据应按其威胁模型、模型版本、实验环境和评估集理解；预印本结果不等于独立复现或生产验证。

### 12.1 Agent Runtime 应该像操作系统一样设计

**Toward Securing AI Agents Like Operating Systems**（2026）从操作系统安全角度分析 Agent，把资源隔离、权限分离和通信中介作为核心问题，并对四个 OpenClaw-like Agent 做了案例评估。研究发现，即使攻击者能力有限，一些现有保护机制在实际配置下也会失效；但传统 OS 安全技术仍能缓解不少问题。

这项研究支持本文的基本判断：Agent Runtime 不只是一个 Prompt Loop，而是一个需要资源管理、主体隔离、权限检查和通信控制的系统软件。工程上应优先验证 OS 实际拒绝了什么，而不是只检查应用层是否返回了 DENY。

论文：[arXiv:2605.14932](https://arxiv.org/abs/2605.14932)。

### 12.2 权限检查必须绑定真实执行内容

**Separation of Duties for Privileged LLM Agents: A Governed Execution Architecture with Measured Security-Utility Trade-offs**（2026）把 Planner、Policy Gate、Executor 和 Auditor 分开，并使用结构化 Intent、一次性授权凭证和执行前内容摘要校验。论文在其 313 个案例的实验中报告，攻击成功率从直接执行基线的 98.3% 降至部署方案的 7.7%；同时报告了误拒绝、审计延迟和实现缺陷。

更值得工程团队注意的是作者报告的缺陷：只验证 Intent 而不验证待执行文件，可能出现审批后替换内容；可重复使用的 Approval 也可能被重放。论文还报告审计日志并发写入丢失记录，以及日志规模增长后的查询性能问题。

这些结果来自论文指定的单机、单操作系统实验，不应直接外推为所有 Agent 的安全提升比例。可复用的工程结论是：审批必须绑定实际执行字节或规范化参数；授权应一次性消费；Executor 在执行前再次验证；审计路径需要做并发、损坏恢复和规模测试。

论文：[arXiv:2609.38224](https://arxiv.org/abs/2609.38224)。

### 12.3 凭证应该被代理使用，而不是交给 Agent 持有

**CapSeal: Capability-Sealed Secret Mediation for Secure Agent Execution**（2026）提出由本机可信 Broker 代替 Agent 持有 API Key、SSH 凭证。Agent 获得的是受限 Capability，通过 Schema 约束的 HTTP 请求或受控 SSH 命令使用凭证；设计还包括 Session Binding、Anti-Replay 和审计。

这与 Rust Broker 的设计高度相关：不要把 Secret 放进模型上下文、环境变量或可读取的配置文件；把“使用凭证的权力”和“读取凭证内容的权力”分开。需要注意，论文描述的是 Rust 原型和条件性安全目标，并提出了评估方案，不能把它写成已经完成大规模实证验证的产品。

论文：[arXiv:2604.16762](https://arxiv.org/abs/2604.16762)。

### 12.4 Prompt Injection 防御需要模型外的强制执行

**Adaptive Evaluation of Out-of-Band Defenses Against Prompt Injection in LLM Agents**（2026）比较模型外策略、Capability 和信息流控制，并强调静态攻击集不足以证明防御有效。论文对 Progent 的一次独立复现，在特定 Qwen2.5-7B、单台 H200 和有限攻击模板条件下报告攻击成功率下降；作者也明确指出更强的白盒自适应攻击仍未覆盖。

它给工程评估带来的启示是：不能只用固定 Prompt Injection 样本做回归测试。应让攻击者了解策略边界，尝试变换工具名称、参数、调用顺序和多步组合，并验证实际副作用是否被阻止。模型审查可以作为辅助信号，但不能替代确定性的执行路径授权。

论文：[arXiv:2606.26479](https://arxiv.org/abs/2606.26479)。

### 12.5 Skill 的供应链风险发生在执行之前

**Agent Skill Security: Threat Models, Attacks, Defenses, and Evaluation**（2026）把 Skill 生命周期拆成仓库准入、语义检索、Planner 选择、执行和后续演化。其 327 个公开 Skill 的受控评估显示，攻击不仅发生在运行时；关键词堆叠、语义伪装、推荐信息伪造和权限描述欺骗都可能影响 Agent 选用哪个 Skill。论文的运行时实验也显示，即使加入动态监控，仍有部分攻击到达最终执行点。

对 Rust Client 的实际意义是：签名和扫描不能只在安装时做一次。Skill Manifest 应声明权限，仓库来源和版本要可追溯，检索结果要验证元数据，执行时还要核对实际请求是否超出声明权限。Skill 更新、依赖变化和撤销也应进入生命周期治理。

论文：[arXiv:2607.13987](https://arxiv.org/abs/2607.13987)。

### 12.6 长期运行系统最危险的故障可能是“看起来成功”

**When Errors Become Narratives: A Longitudinal Taxonomy of Silent Failures in a Production LLM Agent Runtime**（2026）报告了一个个人助理 Agent Runtime 连续八周的运行观察：约 40 个定时任务、8 个模型供应商，记录 22 起事件。作者将错误吞没、假设不匹配、环境差异、模型补写错误叙述和取证盲点归纳为几类问题，并指出有些失败会被模型转换成流畅但不真实的用户反馈。

这是单一系统的纵向案例，不是跨产品统计；但它提供了一个重要的可靠性视角：Agent 的失败不一定表现为异常退出，也可能表现为错误结果被包装成成功。Runtime 应把工具真实结果、任务状态和模型生成的总结分开存储，并让用户界面展示未确认、部分完成和执行结果未知等状态。

论文：[arXiv:2606.14589](https://arxiv.org/abs/2606.14589)。

### 12.7 安全评估不能只测单次 Tool Call

**Toward Secure LLM Agents: Threat Surfaces, Attacks, Defenses, and Evaluation**（2026）综述了 247 篇研究，按信息流、委托权限和持久状态组织 Agent 安全问题。作者指出，现有基准对长周期、有状态和部署环境相关的风险覆盖不足，持久状态污染和多 Agent 攻击传播值得进一步研究。

这意味着 Rust Runtime 的安全测试应覆盖完整生命周期：从 Skill 安装、检索、权限授予，到多步工具调用、Session 恢复、状态持久化和策略更新。单个函数的单元测试通过，并不能证明跨进程、跨 Session 或跨重启的权限边界仍然有效。

论文：[arXiv:2606.10749](https://arxiv.org/abs/2606.10749)。

### 12.8 研究结论如何落到工程验收

| 研究问题 | 工程控制 | 应验证的行为 |
| --- | --- | --- |
| Agent 是否拥有过多能力 | Task-scoped Capability、工具过滤 | 摘要任务无法获得 Shell、凭证和写权限 |
| Agent 能否滥用凭证 | Secret Broker、非导出 Capability | Agent 无法读取 Secret，只能调用受限动作 |
| 审批后动作是否可被替换 | Action Digest、一次性 Grant | 修改参数或文件字节后，执行必须被拒绝 |
| Skill 是否可能被投毒 | 来源验证、签名 Manifest、运行时权限核对 | Skill 更新或元数据伪装不能扩大权限 |
| 长任务失败是否会被掩盖 | Durable State、外部结果核验 | 超时、取消、未知结果不能被总结成成功 |
| 审计是否完整 | 单写者/事务、哈希链、独立存储 | 并发、崩溃、日志轮转和损坏测试不丢失事件 |
| 防御是否能抵抗自适应攻击 | Red-team Trace Replay | 攻击者了解策略后仍无法触发未授权副作用 |

这些研究共同指向一个工程方向：安全能力要从模型输出之前的提示约束，延伸到 Tool 发现、权限授予、执行、状态保存和结果验证的整个生命周期。

## 13. 建议的落地路径


不要一开始就把全部 Client Agent 改写为 Rust。先把真正影响安全的执行路径收敛出来。

**第一阶段：建立 Broker。** 把文件、Shell、进程和网络操作纳入统一 Action Model。先做到 Agent 不能直接调用未受控的系统能力。

**第二阶段：建立 OS 隔离。** 将 Agent、Tool Worker 和 Broker 分离。根据 macOS、Windows、Linux 分别使用原生隔离机制。验证子进程、MCP Server、Python 和浏览器是否继承了预期权限。

**第三阶段：引入签名策略和 Capability。** 策略文件独立签名，Broker 验证版本、有效期和签发者。高风险操作通过短期 Action Grant 授权，并绑定实际参数和目标。

**第四阶段：建立发布与恢复机制。** 对所有可执行组件签名，验证更新包，防止回滚到已撤销版本。Broker 异常退出时默认拒绝敏感操作，并保留独立审计证据。

每个阶段都应该通过对抗性测试验收：让 Agent 尝试修改策略、覆盖 Broker、终止 Broker、直接访问受保护目录、启动未授权子进程、连接非白名单域名、替换 Skill 和回滚旧策略。测试结果要检查 OS 实际拒绝了什么，而不是只看 Broker 返回了什么。

## 14. 最终判断

Rust 对 Agent Client 安全有价值，但它的价值不在于让程序变得无法破解，而在于能以较小的 Native 组件承载安全关键逻辑，减少动态运行时和内存错误，并与操作系统的权限和隔离机制直接集成。

对于已有 TypeScript / JavaScript Agent，最现实的做法通常不是整体重写，而是保留 UI 和编排层，把 Security Broker、策略验证、Capability 管理和敏感操作执行迁移到 Rust，并通过 OS Sandbox 让 Agent 无法绕过它。

对于新建的桌面 Agent，Rust 可以覆盖更多 Runtime 组件，但 UI、Agent、第三方 Tool 和安全执行器仍然需要不同的信任边界。一个进程里有多少 Rust 代码，并不能说明它有多安全。

最后要记住：**代码签名解决发布者和产物完整性，策略签名解决策略来源和内容完整性，OS Sandbox 解决进程实际能做什么。三者各自解决不同问题，缺少任何一层，都不能用 Rust 语言本身来补足。**

## 参考资料

### Rust Agent Runtime 与 Sandbox

- [nono — Capability-based Agent Runtime Security](https://github.com/nolabs-ai/nono)
- [Strands Box — Agent Sandbox Engine](https://github.com/strands-agents/box)
- [Symbiont — Rust-native Governed Agent Runtime](https://github.com/thirdkeyai/symbiont)
- [thClaws — Native Rust Agent Harness](https://github.com/thClaws/thClaws)
- [OpenAI Fence — Rust Security Agent](https://github.com/openai/fence)
- [harness — Rust + egui Desktop Agent](https://github.com/AleCyriaco/harness)
- [Goose / oi-kit — Rust Agent Runtime and SDK](https://github.com/aaif-goose/goose)
- [IronClaw — Secure Personal Agent OS](https://github.com/nearai/ironclaw)
- [ZeroClaw — Rust Personal Agent Runtime](https://github.com/zeroclaw-labs/zeroclaw)
- [Moltis — Rust Personal Agent Server](https://github.com/moltis-org/moltis)
- [Strands Shell — Rust Shell Kernel](https://github.com/strands-agents/shell)
- [rust-agent-sandbox — Wasmtime/WASI Tool Sandbox Reference](https://github.com/maverickkhan/rust-agent-sandbox)

### 策略与平台安全

- [Cedar Policy](https://github.com/cedar-policy/cedar)
- [nono Rust API Documentation](https://docs.rs/nono/latest/nono/)
- [Apple Hardened Runtime](https://developer.apple.com/documentation/security/hardened-runtime)
- [Apple Creating Distribution-Signed Code](https://developer.apple.com/documentation/xcode/creating-distribution-signed-code-for-the-mac/)
- [Microsoft: Code Signing with App Control for Business](https://learn.microsoft.com/en-us/windows/security/application-security/application-control/app-control-for-business/deployment/use-code-signing-for-better-control-and-protection)
- [Microsoft: Smart App Control](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/overview)

### Agent Runtime 工程实践与研究论文

- [Block: Block Open Source Introduces codename goose](https://block.xyz/inside/block-open-source-introduces-codename-goose)
- [Goose Documentation](https://goose-docs.ai/)
- [Goose MCP timeout issue #1164](https://github.com/aaif-goose/goose/issues/1164)
- [ADK-Rust: MCP Tools](https://adk-rust.com/en/docs/tools/mcp-tools)
- [WASI Security Model](https://wasi.dev/security)
- [Akamai: Sandboxed Agentic Tools with Rust and Spin](https://developers.akamai.com/blog/sandboxed-agentic-tools/)
- [Toward Securing AI Agents Like Operating Systems](https://arxiv.org/abs/2605.14932)
- [Separation of Duties for Privileged LLM Agents](https://arxiv.org/abs/2609.38224)
- [CapSeal: Capability-Sealed Secret Mediation for Secure Agent Execution](https://arxiv.org/abs/2604.16762)
- [Adaptive Evaluation of Out-of-Band Defenses Against Prompt Injection in LLM Agents](https://arxiv.org/abs/2606.26479)
- [Agent Skill Security: Threat Models, Attacks, Defenses, and Evaluation](https://arxiv.org/abs/2607.13987)
- [When Errors Become Narratives: A Longitudinal Taxonomy of Silent Failures](https://arxiv.org/abs/2606.14589)
- [Toward Secure LLM Agents: Threat Surfaces, Attacks, Defenses, and Evaluation](https://arxiv.org/abs/2606.10749)

### Rust 供应链

- [RustSec Advisory Database](https://github.com/RustSec/advisory-db)
- [cargo-audit](https://github.com/rustsec/rustsec)
- [cargo-deny](https://github.com/EmbarkStudios/cargo-deny)
- [cargo-vet](https://github.com/mozilla/cargo-vet)
