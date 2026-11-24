---
author: SW
pubDatetime: 2026-11-21T00:00:00Z
title: "Agent Runtime 安全与执行隔离：从权限边界到 Sandbox 选型"
featured: false
draft: false
tags:
  - AI
  - Agent
  - Agent Runtime
  - Security
  - Sandbox
  - Architecture
description: "梳理 Agent Runtime 的工具授权、资源访问和进程隔离边界，比较本机、容器、VM 与远端执行方案，并给出 TypeScript Runtime 的实施建议。"
---

# Agent Runtime 安全与执行隔离：从权限边界到 Sandbox 选型

Agent 能读写文件、运行命令、控制浏览器或调用 MCP 后，模型输出就可能改变真实系统。安全设计需要回答三个问题：Agent 能调用什么、这些工具能访问哪些资源、执行进程实际受到什么限制。

这三层分别是 **Tool Permission、Resource Permission 和 Runtime Sandbox**。它们解决不同问题，不能互相替代。工具白名单不能约束拥有宿主机权限的 MCP Server；目录 Allowlist 不能限制 Bash 的其他文件访问；VM 也不会自动限制已经交给 Agent 的 Token 和网络出口。

本文从这三个边界出发，讨论常见 Sandbox 实现、部署方式，以及 TypeScript / Copilot SDK 桌面 Runtime 的落地方式。

## 1. 威胁模型与安全边界

Agent 的输入并不都来自用户。网页、邮件、文档、代码仓库、终端输出、MCP Tool Result 和长期 Memory 都可能带有攻击者控制的内容。攻击者可以通过这些内容影响 Agent 的决策，不需要直接访问 Agent Runtime。

| 风险来源 | 可能的攻击路径 | 需要保护的对象 |
| --- | --- | --- |
| 恶意网页、邮件和文档 | 间接 Prompt Injection，诱导调用工具或改变任务目标 | 文件、业务数据、外部系统 |
| MCP Server、Plugin 和 Agent Skill | 恶意工具结果、过宽权限或本地代码执行 | 凭证、工作区、Runtime |
| 依赖、镜像和更新包 | 安装脚本、依赖投毒、运行时替换 | Worker、构建环境、供应链 |
| 被攻陷的 Agent 或子 Agent | 滥用委托权限、共享 Memory 或长期 Token | 其他任务、租户和业务系统 |
| 同机或同集群工作负载 | 利用共享内核、挂载、网络或节点权限 | Host、其他租户和控制面 |
| 错误配置或内部人员 | 过度授权、关闭审计、错误恢复快照 | 身份、数据和持久化状态 |

外部内容应作为数据处理，而不是授权指令。网页里要求读取 SSH Key 并上传的文字，不会因为出现在 Agent 上下文中就获得执行权限。模型生成的参数同样不代表用户授权：收件人、账户、URL、文件路径、数据库目标和数据导出目的地，需要能追溯到用户请求或可信业务数据。

要保护的也不只是文件。浏览器 Cookie、SSH Agent、OAuth Token、云 Workload Identity、剪贴板、截图、Memory、任务快照、Workspace、Artifact 和模型上下文，都属于安全边界的一部分。

### 三层授权

**Tool Permission** 控制 Agent 能调用哪些工具。例如文档 Agent 可以读取文件和搜索，但不应自动获得 Shell、邮件发送或 CRM 写入能力。工具注册不等于授权，权限还要绑定 Agent、Task 和用户。

**Resource Permission** 控制工具可以操作哪些资源。工作区可以读写、参考资料只读、密钥目录拒绝访问；业务 API 只能查询当前项目的数据。创建、覆盖、移动、删除和执行应分开授权。文件授权不能只做字符串前缀比较，还要处理路径规范化、符号链接、挂载点和 TOCTOU。

**Runtime Sandbox** 限制进程及其子进程实际能访问的文件、网络、系统调用、IPC、设备和宿主机资源。允许执行 Python，就必须把 Python、它启动的子进程和加载的原生模块放在同一执行边界内。

![Agent Runtime 的工具授权、资源授权与执行隔离架构](/diagrams/agent-runtime-security-layers.svg)

[查看架构图（HTML）](/diagrams/agent-runtime-security-layers.html)

## 2. Runtime 的安全控制面

策略应由可信 Runtime 管理，不能散落在 Prompt、Tool Handler 和平台 Sandbox 配置中。逻辑上可以分成五个平面：

| 平面 | 主要职责 |
| --- | --- |
| Identity | User、Agent、Task 和 Workload 身份；短期凭证与委托关系 |
| Control | Orchestrator、Tool Registry、Policy Engine、Approval、Session |
| Execution | Tool Worker、Browser Worker、Script Sandbox、Container / VM |
| Data | Workspace、Memory、Artifact、Object Storage、Secrets |
| Observability | Audit、Trace、Runtime Detection、Incident Response |

这些平面可以部署在同一个应用中，但不能共享不受约束的权限。Orchestrator 能创建任务，不代表它应该拿到执行任务所需的全部凭证；Sandbox 需要读取一个目录，也不代表它应该获得整个用户 Home。

![Agent Runtime 端到端安全执行链路](/diagrams/agent-runtime-end-to-end.svg)

### PDP 与 PEP

Policy Decision Point（PDP）根据身份、动作、资源、数据分类、任务状态和策略版本给出决策。Policy Enforcement Point（PEP）位于实际副作用发生的路径上，负责强制执行。

| PEP | 应放置的位置 | 不能只依赖 |
| --- | --- | --- |
| Tool | Runtime Dispatcher、MCP Gateway | SDK Hook 或 Prompt |
| Resource | File Service、Workspace Service、业务 API | 模型传入的路径字符串 |
| Execution | Sandbox Launcher、Container / VM Manager | 启动前的一次检查 |
| Network | 强制 Egress Proxy、Firewall、DNS / IP Policy | 进程自觉使用 HTTP Proxy |
| Identity | Credential Broker、Token Exchange、下游 API | 复制用户 Cookie 或长期 Token |
| Commit | 邮件发送、支付、发布和生产变更接口 | UI 上的确认按钮 |

SDK 的 BeforeToolCall Hook 适合作为策略入口，但不能成为唯一 PEP。工具 Handler、资源服务和执行后端都要检查各自负责的边界。否则，只要存在一个绕过 SDK Hook 的入口，授权就可能失效。

### 任务、身份和凭证

每个 Task 应限定目标、资源范围、允许动作、有效期、资源预算和终止条件。可以按风险区分：

| 风险 | 典型操作 | 处理方式 |
| --- | --- | --- |
| 低 | 读取已授权文件、搜索、计算、生成草稿 | 在授权范围内执行并审计 |
| 中 | 修改工作区、创建文件、生成可回滚变更 | 限定目录，展示 Diff，保留版本 |
| 高 | Bash、安装依赖、外部网络、调用 SaaS 写 API | 独立 Sandbox、网络策略、必要时审批 |
| 关键 | 付款、发送外部邮件、生产变更、权限修改 | Commit PEP 强制确认，审批绑定具体参数 |

风险不能只按 Tool 名称判断。读取公开 README 和读取客户合同不同；浏览网页和向外部上传数据也不同。

至少要区分 User Principal、Agent Principal、Task Principal 和 Workload Identity。子 Agent 只获得父任务明确委托的能力，不能继承父 Agent 的全部 Token。凭证优先使用短期、窄范围、可撤销的授权，通过 Credential Broker、OAuth Token Exchange、Workload Identity 或 SPIFFE 等机制交付。不要把长期 Key 放进环境变量、命令行、工作目录或 Sandbox Snapshot。

### 数据、网络和 Memory

文件权限只回答“进程能读什么”，不能回答“读到的数据能发到哪里”。策略还应分别控制数据读取、模型处理、文件输出、网络传输和数据保留。网络默认拒绝；需要出站时，按域名、IP、端口和身份放行，并测试 DNS Rebinding、CNAME、重定向、IPv6、私网地址、云元数据和代理旁路。

浏览器是高价值权限集合。已登录 Profile 可能包含企业 SSO、Cookie、下载目录和内部系统访问权。优先使用独立 Browser Profile；需要共享当前 Tab 时，只共享用户明确选择的会话范围。截图、DOM、下载文件和剪贴板同样属于数据出口。

Memory 和快照需要记录来源、身份、任务和可信等级。不要跨用户或租户复用未隔离的 Memory、Workspace、Browser Profile、Cache 和 Snapshot。恢复快照前检查策略版本、租户归属和残留凭证。

审批必须绑定不可变的 Action Proposal：主体、动作、目标、参数摘要、内容 / Diff 摘要、数据分类、执行身份、策略版本和有效期。只要目标、参数、内容或权限发生变化，就重新审批。提交操作应由独立 Commit PEP 执行，避免 Agent 修改提案后直接绕过审批。

## 3. Read、Write、Execute 应是独立工具

Read 是信息披露风险，Write 是数据完整性风险，Execute 则是通用代码执行风险。不要把它们包装成一个拥有任意路径和命令的万能 Tool。

### Read

Read Tool 只提供 list、stat、read 和 search 等只读操作。目录列表也可能泄露项目结构，因此同样需要授权。大文件使用分页或范围读取，不要把整个文件树一次放进上下文。

路径检查需要落到实际打开文件的操作上。Linux 可研究 openat2 的 RESOLVE_BENEATH、RESOLVE_NO_MAGICLINKS；跨平台则使用经过审查的目录句柄或 Capability Filesystem。单纯 realpath() 后再 readFile() 不能完全避免竞态。

[AgentFense](https://github.com/AjaxZhan/AgentFense) 的 FUSE 文件视图提供 none、view、read、write 等细粒度权限，适合作为文件访问控制的设计参考，但不替代进程和网络隔离。

### Write

Write Tool 应把创建、替换、Patch、移动和删除分开。覆盖文件时使用版本号或 ETag 检查并发变更；重要修改先生成 ChangeSet / Diff，再由独立接口提交。

写入脚本不等于执行脚本。write_file("task.sh", ...) 不应触发 Shell；执行必须走独立的 Execute Tool 和 Sandbox Policy。

### Execute

Bash / Script 应视为不可信代码执行服务。输入包括脚本、Workspace ResourceRef、参数和 Execution Profile，不接受任意宿主机路径。执行环境应明确配置只读目录、可写目录、临时目录、网络、环境变量和资源限制。所有子进程继承相同或更严格的约束；超时和取消必须终止整个进程树。

不要注入宿主机环境变量、SSH Agent Socket、浏览器 Profile、Docker Socket 或长期 Token。结果应限制 stdout、stderr 和 Artifact 大小，避免将大量内容直接写回模型上下文。

![Read、Write、Bash 三类 Tool 的独立安全边界](/diagrams/agent-runtime-tool-boundaries.svg)

## 4. Sandbox 技术与开源实现

Sandbox 不是单一技术。选型时先确认边界由谁强制执行，再看兼容性、性能和运维成本。

| 类型 | 代表实现 | 隔离边界与限制 |
| --- | --- | --- |
| OS 进程沙箱 | macOS Seatbelt、Linux seccomp / Landlock / namespaces、Windows AppContainer | 由宿主 OS 强制限制文件、网络、进程和设备；仍依赖 Host Kernel |
| 容器 | runc、crun、Docker、containerd | namespaces、cgroups、capabilities、seccomp、LSM；默认共享 Host Kernel |
| 用户态 Kernel | gVisor / runsc | 由 Sentry 处理系统调用，减少工作负载直接触达 Host Kernel 的范围；不是 VM |
| VM / microVM | Kata、Cloud Hypervisor、Firecracker、QEMU/KVM | 独立 Guest Kernel；VMM、虚拟设备和 Host 管理面仍在 TCB 中 |
| WASM / Language Runtime | Wasmtime、Wasmer、WASI、V8 Isolates、Deno | 通过受限运行时 API 访问资源；不等价于完整 Linux 环境 |
| 虚拟 Shell | just-bash | 在宿主运行时内模拟命令和文件系统，不启动任意宿主 Shell |

普通容器有实际的隔离能力，但共享内核是它与 VM 的根本区别。Rootless 容器降低容器进程获得 Host root 的风险，却没有消除共享内核。Docker Desktop 还要考虑容器运行的 Linux VM、文件共享、Socket 和端口转发等 Host / Guest 通道。

![Agent Sandbox Implementation Options](/diagrams/agent-sandbox-implementation-tree.svg)

### 值得对照的实现

| 项目 | 解决的问题 | 需要注意 |
| --- | --- | --- |
| [Anthropic Sandbox Runtime](https://github.com/anthropics/sandbox-runtime) | 用 Seatbelt、Bubblewrap 等 OS 机制限制命令、子进程和 MCP Server | 按平台核对文件、网络和 IPC 能力；不是 VM |
| [OpenAI Codex Sandbox](https://openai.com/index/inside-the-codex-sandbox/) | 本机开发环境中的权限 Profile、文件写入限制和网络控制 | 子进程继承边界很重要；不是通用独立 SDK |
| [Microsoft Execution Containers (MXC)](https://github.com/microsoft/mxc) | 用跨平台策略描述文件、网络、UI 和进程约束，再选择可用 Backend | 同一策略在不同 OS / Backend 上不代表相同隔离强度；必须检查能力探测结果 |
| [just-bash](https://github.com/vercel-labs/just-bash) | 以虚拟文件系统和受控命令替代部分真实 Shell 工作 | 运行在宿主 Node.js 内，不是任意代码的安全边界 |
| [OpenHands Runtime](https://github.com/All-Hands-AI/openhands) | 提供带 Shell、文件、Python 和浏览器的完整执行容器 | 普通容器仍共享 Host Kernel，需额外配置和隔离 |
| [MCP Filesystem Server](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem) | 将文件操作暴露为 MCP Tool，并限制允许目录 | 只约束该 Server 的文件操作，不约束其他进程或工具 |

Anthropic Sandbox Runtime 适合评估为本机真实进程的执行边界；just-bash 适合有限命令和数据处理，避免不必要地开放 Host Shell。二者不是替代关系。MXC 提供策略和 Backend 抽象，但不能仅凭统一 API 假设各平台功能等价。OpenHands Runtime 则面向需要完整开发环境的任务，运营成本也更高。

托管服务（如 E2B、Vercel Sandbox、Daytona、Modal、Cloudflare Sandbox、Runloop 和模型厂商的 Code Interpreter）属于产品层。它们可能采用 VM、microVM、容器或未公开的专有实现。除非供应商明确说明并能在文档中验证，不应从产品名称推断底层隔离机制。还要单独核对租户边界、数据留存、网络出口、凭证、快照和模型处理路径。

## 5. 不同部署环境的重点

通用策略可以复用，执行边界要按平台设计。

![Agent Runtime 四类部署环境的安全边界](/diagrams/agent-runtime-deployment-boundaries.svg)

### 桌面端

桌面 Agent 与用户环境距离最近，默认能接触用户权限范围内的文件、浏览器、VPN、SSH Agent 和桌面会话。不要以管理员 / root 运行整个 Agent；Shell、脚本、MCP Server 和 Browser Worker 应放进独立进程或 Sandbox。

macOS 需要区分 App Sandbox / Seatbelt 与 TCC：前者限制应用资源访问，后者管理 Accessibility、Screen Recording、Input Monitoring 等用户数据和交互权限。Windows 的 AppContainer、Restricted Token、ACL、Job Object 和 Windows Filtering Platform 也各自解决不同问题；Job Object 主要管理进程树和资源，不是完整 Sandbox。

默认只开放用户选定的 Workspace。浏览器 Profile、SSH、云 CLI 配置、密码库和系统凭证不应自动进入执行环境。GUI 自动化应由独立 Broker 管理窗口、截图和输入；发送、付款、删除、安装和权限变更等操作需要结构化确认。

参考：[Apple App Sandbox](https://developer.apple.com/documentation/security/app_sandbox)、[Windows Application Isolation](https://learn.microsoft.com/en-us/windows/security/book/application-security-application-isolation)。

### 云端与 Kubernetes

把 Orchestrator、Policy Engine、Credential Broker 和 Audit 作为可信控制面；Shell、Browser、MCP 和用户代码作为执行面。Worker 只获得当前 Task 的短期身份和资源引用，不能持有集群管理权限或其他租户的凭证。

Kubernetes Pod 的基础加固至少包括非 root、allowPrivilegeEscalation: false、只读根文件系统、删除不需要的 capabilities、Seccomp，以及 Restricted Pod Security。默认关闭不需要的 ServiceAccount Token，使用最小 RBAC 和默认拒绝的 NetworkPolicy。还要验证 CNI 是否真的实施策略，不能只检查 YAML。

对执行不可信代码的任务，根据威胁等级选择 RuntimeClass：普通 runc 共享 Host Kernel；gVisor 增加用户态 Kernel 边界；Kata / microVM 提供 Guest Kernel。高风险任务还可使用独立 Node Pool 或独立集群。Workspace、Memory、Cache、Artifact、Browser Profile 和日志都要有租户隔离。

Google 的 [GKE Agent Workloads](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/machine-learning/agent-workloads) 将 Agent Substrate 与 Agent Sandbox 分开讨论，并涉及 Worker 复用、独立 Sandbox、身份和 Egress Gateway。计算隔离、身份隔离和凭证交付是三个独立问题：Warm Pool 中的 Worker 如果共享身份，就不能仅靠 Pod 生命周期实现租户隔离。

### GUI VM / VDI

需要操作完整桌面应用时，可为任务提供独立 VM，通过 RDP、VNC 或 WebRTC 传递画面和输入。Guest 应使用低权限账户、临时 Browser Profile 和可重建镜像。

默认关闭共享目录、剪贴板、拖放、USB、宿主机凭证代理和不必要的 Guest Agent RPC。文件通过 Artifact Gateway 传入和取回。截图可能包含客户数据、MFA Code 和内部系统信息，必须纳入数据分类和模型数据路由。

microVM 不等于桌面 VM。Firecracker 面向轻量 Linux 工作负载，不提供完整 Windows Desktop / GPU 桌面体验。GUI 自动化需要支持图形栈和远程显示的 VM / VDI 方案。

## 6. Remote-first：本地 Agent 与远端 Agent 的职责边界

本地应用可以只保留 UI、模型交互和必须访问本机的能力；文件、Shell、代码执行、MCP 和业务系统工具放在远端。需要先分清三种远程能力：

| 类型 | 调用对象 | 调用方得到什么 | 常见方式 |
| --- | --- | --- | --- |
| Remote Tool | 一个工具或业务动作 | Tool Result | MCP、HTTP API、RPC |
| Remote Execution | Workspace、Shell、Browser 或代码执行环境 | 文件、进程输出、状态、Artifact | Workspace API、Sandbox API |
| Remote Agent | 有独立 Agent Loop 的服务 | Task ID、状态、消息和 Artifact | A2A、框架自有 Task API |

远端 MCP Tool 不代表远端 Agent；远端 Sandbox 也不会自动提供任务委托、断线恢复和异步状态管理。

![Remote-first Agent Runtime：本地与远端双 Agent 架构](/diagrams/agent-runtime-remote-first.svg)

### 两种规划方式

**本地 Agent 规划，远端执行工具。** 本地模型看到远端工具 Schema，逐步决定调用什么；远端服务负责授权和执行。这适合轻量、低延迟的操作。文件内容和 Tool Result 会返回本地，并可能进入本地模型 Provider 的上下文。

**本地 Agent 委托，远端 Agent 自己规划。** 本地模型只提交目标、Workspace 引用和任务约束；远端 Agent 使用自己的模型和工具完成任务，返回摘要、状态和 Artifact。适合长任务、大文件和希望内容留在远端处理的场景。但远端模型 Provider 仍然能处理任务内容，不能把“文件没回本地”理解为“数据没有出域”。

建议远端工作区默认采用第二种模式；确实需要本地模型逐步控制时，再开放少量 Remote Tool。

### Workspace、身份与数据流

远端目录应是逻辑 Workspace，不是本地目录的网络映射。服务端通过 tenant + user + workspace 确定资源边界，执行时叠加 session + task。Sandbox 只挂载当前任务获批的目录；持久 Workspace 与短期执行容器分开管理。

可按以下命名空间管理数据：

| 路径 | 生命周期 |
| --- | --- |
| /workspace | 用户或项目持久文件 |
| /session | 当前会话状态 |
| /memories | 独立授权的长期记忆 |
| /tmp | 当前任务临时文件 |
| /artifacts | 有版本、下载权限和保留期的交付物 |

通信协议也按职责选择：

| 协议 | 用途 | 不负责 |
| --- | --- | --- |
| HTTPS / OIDC | 客户端登录、提交任务、审批和取消 | Agent 间任务语义 |
| A2A | Agent 发现、任务委托、状态和 Artifact 交换 | Workspace 授权和 Sandbox |
| MCP | Agent 调用工具和访问资源 | 长任务生命周期 |
| ACP（Agent Client Protocol） | Desktop / IDE 接入 Coding Agent Session | 通用 Agent-to-Agent 委托 |
| SSE / WebSocket | 向 UI 推送进度、审批和结果事件 | 任务状态持久化 |

A2A 与 MCP 不冲突：Agent 用 MCP 调工具，用 A2A 委托另一个 Agent。A2A 的 Task 状态也不必取代内部 Task Domain Model；内部仍需处理租户、审批、执行 Profile、幂等、Checkpoint、取消传播和清理。ACP 在这里指 Agent Client Protocol，不是历史上也使用 ACP 缩写的 Agent Communication Protocol。

远端服务至少要区分用户身份、Agent Session 身份和 Task / Execution 身份。客户端 Token 只用于识别调用者和授权 Agent Service；访问下游资源时，应取得面向该资源的短期凭证，禁止 Token Passthrough。模型 Provider Key、用户 OAuth Token 和 Workload Identity 也必须分开。

### 框架支持到哪一层

| 框架 / 平台 | 远程能力 | 需要自己补齐的部分 |
| --- | --- | --- |
| Deep Agents | AsyncSubAgent、Agent Protocol、Backend 和 Sandbox Backend | 租户授权、凭证和 Workspace 安全边界 |
| OpenAI Agents SDK | MCP Client / Hosted MCP、可插拔 Sandbox、Agent-as-tool / Handoff | 远端长任务的持久化、恢复及授权语义 |
| Claude Managed Agents | 托管 Agent Loop；可连接托管或自托管执行环境 | 自托管 Worker 的身份、网络和数据策略 |
| Google ADK | RemoteA2aAgent、A2A Server | Workspace、Sandbox 和资源授权 |
| Copilot SDK | Headless Runtime、MCP、SessionFS | SDK 与 Headless CLI 的外部认证、Shell 隔离和远端委托 |
| Pi | MCP、自定义 Tool / Extension、独立 Session | 远端任务协议、Workspace 和执行环境 |

几个容易误判的边界：

- Copilot SDK 的 SessionFS 负责会话文件 I/O 路由，不代表 Shell 访问也自动受它约束；Headless CLI 对外仍需 Gateway 负责认证和授权。
- OpenAI Hosted MCP 的调用发生在 OpenAI 服务侧，与应用进程自己连接 MCP Server 的数据路径不同。
- Claude 自托管 Sandbox 模式下，执行 Worker 可以在用户基础设施中运行，但 Agent Loop 和模型请求仍由 Anthropic 管理。
- A2A 是任务通信协议，不是文件系统或 Sandbox 标准；Agent Card 声明能力，不代表调用者已经获得资源授权。

## 7. TypeScript / Copilot SDK 桌面 Runtime 的实现建议

不需要为了安全把整个 Runtime 改写成 Rust。TypeScript 可以承担 Session、Tool Registry、Policy Engine、审批、资源引用、审计和执行生命周期管理；真实进程隔离交给操作系统或独立 VM。

Copilot SDK 的 onPreToolUse 可以作为统一策略入口，但不能成为唯一检查点。自定义 Tool Handler 需要再次验证 ResourceRef 和资源权限；Bash Handler 只调用 Execution Service，不能直接在宿主主进程里执行模型生成的命令。

~~~typescript
type SandboxProfile = {
  filesystem: {
    read: string[];
    write: string[];
    deny: string[];
  };
  network: {
    mode: "deny" | "allowlist";
    allowedDomains?: string[];
  };
  limits: {
    timeoutMs: number;
    memoryMb?: number;
    maxProcesses?: number;
  };
};

interface SandboxBackend {
  capabilities(): Promise<{
    filesystemIsolation: boolean;
    networkIsolation: boolean;
    processTreeControl: boolean;
  }>;

  execute(input: {
    script: string;
    workspaceId: string;
    profile: SandboxProfile;
  }): Promise<ExecutionResult>;

  terminate(executionId: string): Promise<void>;
}
~~~

Backend 必须报告实际能力。启动前检查 Profile 是否能被完整实施；不支持必要限制就拒绝执行，不能静默降级。取消和超时要终止完整进程树，并清理临时文件、网络连接和短期凭证。

本机可以优先评估 [Anthropic Sandbox Runtime](https://github.com/anthropics/sandbox-runtime) 与 [MXC](https://github.com/microsoft/mxc)。前者直接使用各平台的 OS 安全机制；后者提供策略与 Backend 抽象，适合评估跨平台文件、网络和 UI 控制。两者的具体能力都要按 SDK 版本、操作系统和实际 Backend 核对，不能把统一 API 当作相同的隔离保证。

Rust 只在需要封装原生 API、独立进程管理或现有 Node.js 接口无法可靠覆盖某项系统能力时引入。Helper 的职责应限于 Sandbox 创建、进程启动 / 终止和少量系统调用；Policy Engine 和 Agent Session 仍留在 TypeScript。语言本身不构成安全边界。

## 8. 选型与验证

### 按风险选执行形态

| 场景 | 建议形态 | 关键控制 |
| --- | --- | --- |
| 本地只读文档分析 | Desktop Host + Capability Filesystem | 用户选定目录、只读授权、数据外发策略 |
| 本地代码修改与测试 | 独立 Script Sandbox | 子进程隔离、Workspace 写入、网络限制、Diff / 回滚 |
| 本地 GUI 自动化 | GUI Broker + 独立 Profile；高风险时使用 VM | 最小 UI 权限、截图 DLP、敏感动作审批 |
| 云端一般 Agent | 每 Task 独立 Worker / Sandbox | Workload Identity、租户隔离、Egress Gateway、配额 |
| K8s 不可信代码 | Restricted Pod + gVisor / Kata / microVM | Pod Security、RBAC、默认拒绝网络、任务级存储 |
| 高敏感代码执行 | 专用节点上的 VM / microVM；必要时 Confidential VM | 独立信任域、短期身份、远程证明和密钥释放 |

普通容器适合可信或中等风险工作负载；需要更强租户隔离时评估 gVisor、Kata 或 microVM。Confidential VM 主要解决特权 Host 对运行中 Guest 数据的可见性问题，不是所有 Agent 都需要的默认选项。

无论选择哪种 Sandbox，都无法替代业务权限和数据治理。Agent 仍可能滥用已获准的 API、把允许读取的数据发送到允许访问的地址，或在授权 Workspace 内执行错误操作。对这些风险，需要最小权限、出口控制、审批、审计、回滚和补偿机制。

### 上线前的验证项

测试必须验证真实副作用，而不只是模型有没有拒绝恶意指令。至少覆盖：

- 未授权路径、符号链接、路径穿越和跨租户文件访问被拒绝。
- 子进程继承相同限制；超时、取消和 Worker 崩溃能终止完整进程树。
- 云元数据、集群 API、管理网段、IPv6 和代理旁路无法绕过网络策略。
- Sandbox 不会获得长期 Token、SSH Agent、浏览器 Profile、Docker Socket 或宿主机目录。
- 审批后改变参数、内容、目标或权限时，旧审批失效。
- 任务取消后能确认外部副作用是否发生，并执行必要的回滚或补偿。
- 不同租户的 Workspace、Memory、Cache、Artifact、Browser Profile 和日志不可互访。
- 正常任务仍能完成，避免用“全部拒绝”制造虚假的安全结果。

建议把 Emergency Stop 放在 Runtime 外部的可信管理通道中。它应能暂停新任务、拒绝后续工具调用、终止执行进程、关闭网络出口、撤销短期凭证并保留审计证据。取消模型请求本身不代表工具进程已经停止。

审计至少关联 User、Agent、Task、Policy Version、Tool Version、Execution Backend、Approval 和最终 Artifact。日志不要保存明文 Token、Cookie、私钥和不必要的文件内容。

## 参考资料

**安全与治理**

- [OWASP Top 10 for Agentic Applications 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/)
- [OWASP Securing Agentic Applications V2](https://genai.owasp.org/resource/securing-agentic-applications-v2/)
- [UK NCSC: Managing the cyber risk of agentic AI](https://www.ncsc.gov.uk/blogs/managing-the-cyber-risk-of-agentic-ai)
- [MITRE ATLAS](https://atlas.mitre.org/)
- [NIST SP 800-190: Application Container Security Guide](https://csrc.nist.gov/pubs/sp/800/190/final)

**Sandbox 与平台**

- [Anthropic Sandbox Runtime](https://github.com/anthropics/sandbox-runtime)
- [Microsoft Execution Containers](https://github.com/microsoft/mxc)
- [gVisor Security Model](https://gvisor.dev/docs/architecture_guide/security/)
- [Kata Containers](https://katacontainers.io/)
- [Firecracker Design](https://github.com/firecracker-microvm/firecracker/blob/main/docs/design.md)
- [Kubernetes Application Security Checklist](https://kubernetes.io/docs/concepts/security/application-security-checklist/)
- [Apple App Sandbox](https://developer.apple.com/documentation/security/app_sandbox)
- [Windows Application Isolation](https://learn.microsoft.com/en-us/windows/security/book/application-security-application-isolation)

**远端 Agent 与工具协议**

- [A2A Protocol](https://a2a-protocol.org/)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Deep Agents Async Subagents](https://docs.langchain.com/oss/javascript/deepagents/async-subagents)
- [OpenAI Agents SDK](https://openai.github.io/openai-agents-python/)
- [Claude Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview)
- [Google ADK A2A](https://google.github.io/adk-docs/a2a/intro/)
