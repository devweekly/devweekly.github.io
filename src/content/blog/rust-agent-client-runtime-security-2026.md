
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

如果目标是构建完整 Rust Agent Client，先看 thClaws 的 Agent Harness 和策略实现；如果目标是给现有 TS/JS Agent 加固，先研究 nono 和 Strands Box；如果需要一个内置治理能力的 Rust Runtime，再看 Symbiont。

## 11. 建议的落地路径

不要一开始就把全部 Client Agent 改写为 Rust。先把真正影响安全的执行路径收敛出来。

**第一阶段：建立 Broker。** 把文件、Shell、进程和网络操作纳入统一 Action Model。先做到 Agent 不能直接调用未受控的系统能力。

**第二阶段：建立 OS 隔离。** 将 Agent、Tool Worker 和 Broker 分离。根据 macOS、Windows、Linux 分别使用原生隔离机制。验证子进程、MCP Server、Python 和浏览器是否继承了预期权限。

**第三阶段：引入签名策略和 Capability。** 策略文件独立签名，Broker 验证版本、有效期和签发者。高风险操作通过短期 Action Grant 授权，并绑定实际参数和目标。

**第四阶段：建立发布与恢复机制。** 对所有可执行组件签名，验证更新包，防止回滚到已撤销版本。Broker 异常退出时默认拒绝敏感操作，并保留独立审计证据。

每个阶段都应该通过对抗性测试验收：让 Agent 尝试修改策略、覆盖 Broker、终止 Broker、直接访问受保护目录、启动未授权子进程、连接非白名单域名、替换 Skill 和回滚旧策略。测试结果要检查 OS 实际拒绝了什么，而不是只看 Broker 返回了什么。

## 12. 最终判断

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

### 策略与平台安全

- [Cedar Policy](https://github.com/cedar-policy/cedar)
- [nono Rust API Documentation](https://docs.rs/nono/latest/nono/)
- [Apple Hardened Runtime](https://developer.apple.com/documentation/security/hardened-runtime)
- [Apple Creating Distribution-Signed Code](https://developer.apple.com/documentation/xcode/creating-distribution-signed-code-for-the-mac/)
- [Microsoft: Code Signing with App Control for Business](https://learn.microsoft.com/en-us/windows/security/application-security/application-control/app-control-for-business/deployment/use-code-signing-for-better-control-and-protection)
- [Microsoft: Smart App Control](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/overview)

### Rust 供应链

- [RustSec Advisory Database](https://github.com/RustSec/advisory-db)
- [cargo-audit](https://github.com/rustsec/rustsec)
- [cargo-deny](https://github.com/EmbarkStudios/cargo-deny)
- [cargo-vet](https://github.com/mozilla/cargo-vet)
