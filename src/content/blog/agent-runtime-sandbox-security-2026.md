---
author: SW
pubDatetime: 2026-11-21T00:00:00Z
title: "Agent Runtime 的安全执行边界：开源 Sandbox、受控 Shell 与 Tool Permission 怎么选"
featured: false
draft: false
tags:
  - AI
  - Agent
  - Agent Runtime
  - Security
  - Sandbox
  - Architecture
description: "面向 TypeScript/Node.js Agent Runtime，比较 Anthropic Sandbox Runtime、OpenAI Codex Sandbox、just-bash、OpenHands Runtime 和 MCP Filesystem Server，厘清工具权限、资源授权与操作系统隔离的边界，并给出可落地的分层架构。"
---

# Agent Runtime 的安全执行边界：开源 Sandbox、受控 Shell 与 Tool Permission 怎么选

Agent Runtime 一旦允许模型读文件、改文件、运行命令或调用 MCP，安全问题就不再只是“模型会不会听 Prompt”。真正需要回答的是：即使模型生成了恶意命令，或者某个工具被 Prompt Injection 诱导，它实际能够访问哪些文件、启动哪些进程、连接哪些网络目标？

这不是给 Tool Schema 加一个权限字段就能解决的问题。工具权限、资源授权和执行隔离是三个不同层次。前两者决定 Agent 理论上可以做什么，最后一层要保证即使执行路径发生偏差，也不能越过操作系统设置的边界。

开源生态已经有几种不同取向的实现：Anthropic 把 Claude Code 使用的 OS Sandbox Runtime 开源；OpenAI 公开了 Codex Sandbox 的工程设计；Vercel 的 just-bash 用 TypeScript 实现一个虚拟 Shell；OpenHands 用 Docker Runtime 提供完整执行环境；MCP Filesystem Server 则在文件工具本身实施目录范围控制。它们解决的问题并不相同，不能简单排成一个“沙箱产品排行榜”。

本文重点讨论桌面型和本地型 Agent Runtime，尤其是 Node.js / TypeScript 技术栈。

## 1. 先把三个安全层次分开

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

## 2. 值得研究的开源实现

### 2.1 Anthropic Sandbox Runtime：最接近通用 Agent 执行隔离层

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

### 2.2 OpenAI Codex Sandbox：值得借鉴的权限模型和平台实现

项目：[openai/codex](https://github.com/openai/codex)  
工程文章：[Inside the Codex sandbox](https://openai.com/index/inside-the-codex-sandbox/)

Codex Sandbox 的特点是：不把所有命令搬进容器，而是尽可能利用当前操作系统的隔离机制，让 Agent 在用户现有的开发环境中工作。对于依赖本机 SDK、原生工具链或桌面模拟器的开发任务，这种方式比 Docker 更容易保留宿主机开发环境。

Codex 将 Sandbox 权限组织成 Permission Profile。以 Workspace 权限为例，工作区内可以写入，但 .git、.codex 等敏感目录保持只读；网络默认关闭，需要时再单独开放。这里有一个重要的取舍：为了兼容本机编译器和开发工具，文件读取范围可能比工作区更广。因此，限制写入和关闭网络能减少风险，却不能自动解决敏感文件读取问题。

OpenAI 的工程文章还披露了一个很值得重视的细节：子进程继承父进程的 Sandbox 约束，约束覆盖由该命令启动的整个进程树。这是执行边界必须满足的基本要求。只包裹最外层 Shell，而让 Python、Node 或 MCP 子进程逃到沙箱之外，是不合格的实现。

Codex 的价值主要有两方面：Permission Profile 是 Runtime 的权限配置模型，可以把只读、工作区写入和网络访问等能力组合成可理解的执行模式；OS Sandbox 则通过统一接口屏蔽 macOS、Linux 和 Windows 的平台差异，让调用方提交命令、工作目录、环境变量和权限配置，而不直接操作底层系统调用。

需要区分：Codex 的实现是 Codex 项目的一部分，不应把它误认为一个已经独立发布、可直接 npm install 的通用 Sandbox SDK。对自建 Runtime 来说，更适合先研究其 Permission Profile、子进程继承和 fail-closed 思路，再决定复用哪一层代码或原生机制。

### 2.3 just-bash：TypeScript 里的虚拟 Shell，而不是真正的 OS Sandbox

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

### 2.4 OpenHands Runtime：完整的 Docker 执行环境

项目：[OpenHands](https://github.com/OpenHands/OpenHands)  
架构说明：[OpenHands Runtime](https://docs.openhands.dev/openhands/usage/architecture/runtime)

OpenHands 的 Runtime 采用 Client-Server 结构。Backend 将 Action 发送给 Runtime 容器中的执行服务，容器内运行 Bash、文件操作、Python、浏览器和插件，再把执行结果作为 Observation 返回给 Backend。

这类方案适合需要完整开发环境的 Agent：有依赖安装、编译、测试、浏览器和多种执行工具，且希望每个任务或项目拥有独立环境。Docker 镜像和 Volume 机制也便于定义基础环境、持久化工作目录和只读挂载。

它的代价是容器生命周期、镜像管理、资源配额、Volume 和网络策略都需要运营。更重要的是，容器并不等于独立内核：默认仍共享宿主机 Kernel。对抗高风险不可信代码时，必须谨慎配置 capabilities、seccomp、用户权限、设备、挂载和网络；更高隔离要求可以进一步使用 VM 或微型 VM。

对于桌面 Agent，如果只是需要受控地读取和修改用户选定的文件夹，直接引入一整套 Docker Runtime 可能过重。若任务需要任意依赖安装、编译、浏览器和长时间运行的进程，容器化执行环境才更有价值。

### 2.5 MCP Filesystem Server：目录授权有用，但不是进程沙箱

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

## 3. Read、Write、Bash 应该是三个独立的 Tool 边界

前面讨论的是 Tool Permission、Resource Permission 和 Runtime Sandbox 三个安全层次。落到 Agent 的实际工具设计，还需要再做一次拆分：不要把文件读取、文件写入和脚本执行包装成一个通用的 `filesystem` 或 `terminal` 能力。

这三种操作的权限语义不同。Read 是信息披露风险，Write 是数据完整性风险，Bash 则是通用代码执行风险。一个 Agent 获得读取权限，不应该因此获得写入权限；获得写入权限，也不应该自动获得执行刚写入脚本的权限。

### 3.1 Read Tool：把读取做成只读、可审计的资源访问

Read Tool 只负责读取已经授权的资源，不应提供任何执行或修改能力。建议把它拆成几个语义明确的操作：`list_directory`、`stat_file`、`read_file`、`search_files`。如果需要读取大文件，使用 offset、limit 或分页，不要一次把整个目录或文件树塞进上下文。

权限判断至少包含主体、资源、操作和数据分类。比如某个 Agent 可以读取项目文档，却不能读取 `.env`、SSH Key、浏览器 Profile、云凭证或其他客户目录。目录列表本身也可能泄露文件名和项目结构，因此 `list` 不是天然无风险的操作。

不要仅靠字符串前缀判断路径是否在工作区内。路径规范化后仍要处理符号链接、硬链接、挂载点和路径替换竞态。Linux 上可以研究 `openat2` 的 `RESOLVE_BENEATH`、`RESOLVE_NO_MAGICLINKS` 等约束；跨平台实现则应采用经过审查的目录句柄 / capability 文件访问层，或让文件服务本身运行在 OS Sandbox 内。Node.js 的普通 `realpath()` 后再 `readFile()` 并不能单独消除 TOCTOU 风险。

另一个值得研究的方向是 [AgentFense](https://github.com/AjaxZhan/AgentFense)。它使用 FUSE 把真实文件系统投影成 Agent 可访问的视图，并区分 `none`、`view`、`read` 和 `write`：例如可以允许 Agent 看到目录结构，却不能读取文件内容；也可以让它读取代码，但不能修改。这个模型比简单的目录 Allowlist 更细，尤其适合需要把真实代码库暴露给 Agent、同时隐藏密钥和敏感目录的场景。项目目前规模较小，应把它视为值得验证的设计参考，而不是未经测试就直接采用的安全基座。

### 3.2 Write / Edit Tool：写入不是执行，修改应该可回滚

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

### 3.3 Bash / Script Tool：把它当作不可信代码执行服务

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

### 3.4 有哪些项目值得对照

| 项目 | 对 Read / Write 的设计 | 对 Bash / Script 的设计 | 适合借鉴的部分 |
| --- | --- | --- | --- |
| [AgentFense](https://github.com/AjaxZhan/AgentFense) | FUSE 文件视图，none / view / read / write | 通过受限文件系统配合普通 Shell 工作流 | 文件级能力授权、隐藏敏感资源 |
| [easy-agent](https://github.com/ConardLi/easy-agent) | Read、Write、Edit、MultiEdit 等独立工具 | Bash / PowerShell 配合 allow / ask / deny 和 OS Sandbox | Tool 拆分、审批策略和执行隔离的组合 |
| [Deep Agents](https://github.com/langchain-ai/deepagents) | Virtual Filesystem、声明式 read / write path permissions | 可插拔 Sandbox Backend 的 execute Tool | 文件权限和执行后端的职责分离 |
| [Anthropic Sandbox Runtime](https://github.com/anthropics/sandbox-runtime) | 不负责 Agent 级文件 Tool 语义 | 对任意进程实施 OS 级文件和网络限制 | 作为真实 Shell / MCP 进程的隔离层 |
| [just-bash](https://github.com/vercel-labs/just-bash) | 虚拟文件系统上的受控读写 | TypeScript 实现的 Shell 语义，不启动真实宿主 Shell | 低风险任务的受限命令环境 |

这里有两个容易误读的地方。第一，Deep Agents 的文件权限规则并不自动约束 Sandbox Backend 中的任意代码执行；其文档明确要求 Sandbox Backend 自己承担执行侧策略。第二，AgentFense 的 FUSE 文件视图能把文件访问权限落实到文件系统层，但它不能替代网络隔离、进程限制和凭证保护。工具权限和执行权限仍需分别配置。

[easy-agent](https://github.com/ConardLi/easy-agent) 是一个更完整的 Agent Harness 参考：它把 Read / Write / Edit / Bash 做成不同工具，并组合权限规则、OS Sandbox、MCP 和子 Agent。它适合研究工具注册、授权和执行路径如何在一个 TypeScript Agent 中协作，但仍需按目标平台审查其 Sandbox 覆盖范围；项目文档列出的 Windows Shell Sandbox 能力与 macOS / Linux 并不相同。

### 3.5 推荐的 Tool Contract

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

## 4. 这些方案到底如何选择

| 方案 | 主要隔离方式 | 适合场景 | 不能替代什么 |
| --- | --- | --- | --- |
| Anthropic Sandbox Runtime | OS 原生 Sandbox + 网络代理 | 包裹 Shell、脚本和 MCP Server | 业务级数据授权、完整 VM |
| OpenAI Codex Sandbox | OS 原生 Sandbox + Permission Profile | 本机开发环境中的受限命令执行 | 独立 npm Sandbox SDK |
| just-bash | TypeScript Shell + 虚拟文件系统 | 受控命令、文档和数据处理 | 任意宿主进程的 OS 隔离 |
| OpenHands Runtime | Docker 容器 | 完整、可复现的 Agent 开发环境 | 独立 Guest Kernel 的 VM 隔离 |
| MCP Filesystem Server | Tool 级目录授权 | 文件读写能力封装 | Shell、Python 和其他进程的限制 |

这里没有一个项目能够单独解决 Agent 的全部安全问题。选择时首先看执行对象：如果只需要读写文件，优先提供受限文件服务；如果需要有限的 Shell 语义，考虑虚拟 Shell；如果要执行真实命令或 MCP Server，就需要 OS Sandbox；如果需要完整、可复现的开发环境，再考虑容器或 VM。

## 5. 一个适合 TypeScript Agent Runtime 的分层设计

对于本地桌面 Agent，我倾向于把策略和执行机制分开：Runtime 自己掌握 Tool Registry、Policy Engine、审批和审计；底层通过成熟的 OS Sandbox 执行真实进程，不自己重写操作系统隔离机制。

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

### 4.1 不要把“命令白名单”当成完整的执行安全

允许 node、python 或 bash，并不意味着只允许了某种安全操作。它们本身就是通用解释器，可以读取文件、启动子进程、加载模块和访问网络。命令白名单最多是减少入口，不是资源边界。

更有效的控制是：真实进程在 Sandbox 内运行；文件系统和网络权限按 Profile 配置；子进程继承限制；凭证不进入执行环境；执行有时间、内存、CPU、输出和并发上限。对不可信代码，还应限制文件解析器、编译器插件、包安装脚本和本地扩展的执行路径。

### 4.2 MCP Server 也应该被视为执行进程

MCP 只是工具协议，不是安全容器。一个 MCP Server 可以在启动时读取环境变量、访问本地文件、连接网络或启动子进程。Server 的 Tool Schema 只描述模型能看到的调用入口，不代表 Server 运行时的实际权限。

因此，来自第三方或动态安装的 MCP Server，应该以独立进程运行，并使用最小权限身份和独立 Sandbox。对于可信的内置 MCP Server，也应只授予它完成任务所需的目录、网络和凭证范围。不要让所有 MCP Server 共享 Agent Runtime 的主进程权限。

### 4.3 审批应该绑定具体动作，而不是绑定工具名称

“允许调用 write_file”不是一个足够明确的审批对象。审批至少应绑定目标文件、操作类型、内容或 Diff 摘要、任务 ID、执行身份和有效期。对外发送、删除、覆盖、批量移动和业务系统更新等动作，需要单独的风险策略。

如果审批后模型改变了文件路径、内容或目标对象，就应重新进行策略判断。用户确认不能覆盖组织级拒绝规则，也不能把一次批准扩展为长期授权。

## 6. 容易被忽略的安全问题

**文件授权和数据授权不是一回事。** Agent 可以读取某个客户文件，不代表可以把它上传到任意外部网站。文件系统 Sandbox 只能限制文件访问，不能判断数据是否允许流向某个 SaaS 或模型服务。需要独立的数据分类、目的地策略和网络出口控制。

**网络 Allowlist 不能只检查域名字符串。** DNS 解析、重定向、CNAME、IPv4/IPv6 表示差异、私有 IP 和代理绕行都会影响最终连接目标。尤其需要阻止 SSRF、云元数据访问和内网探测。

**凭证不要通过环境变量“方便地传进去”。** 执行进程能读取的环境变量，通常也可能被脚本、子进程和日志意外暴露。需要访问下游系统时，应使用短期、窄范围的委托凭证或宿主侧 Credential Broker，不要把用户的长期 Token 和浏览器 Profile 直接挂载给 Agent。

**沙箱必须覆盖完整进程树。** Shell 启动 Python，Python 再启动 Node，Node 又启动子进程，所有后代都必须继承相同或更严格的限制。工具超时也不能只停止父进程，而留下仍在运行的子进程。

**文件写入最好默认可恢复。** 草稿写入、正式覆盖和删除应分开处理。通过临时文件、原子替换、版本快照和 Diff 审查，降低模型误操作的影响。对正式业务系统则优先提供有明确语义的 API，而不是开放数据库连接或通用 HTTP 写入。

## 7. 结论：复用 OS Sandbox，自己实现策略控制面

如果是 TypeScript / Node.js Agent Runtime，我会按以下方式落地：

- Read：使用只读 Capability Filesystem，细分目录列表、元数据、内容读取和搜索权限。\n- Write / Edit：使用独立的 ChangeSet、Patch、版本检查和可回滚提交接口，不与执行能力绑定。
- 轻量 Shell：使用 just-bash，优先采用内存文件系统；只在确有需要时开放网络、Python 或 JavaScript。
- Bash / Script：通过独立 Execution Service 调用 Anthropic Sandbox Runtime 等 OS Sandbox，脚本写入与脚本执行分别授权。
- 完整开发环境：需要依赖安装、编译、浏览器和长任务时，再采用 OpenHands 这类 Docker Runtime；高风险任务考虑 VM。
- 权限与审计：由自己的 Agent Runtime 统一管理 Tool Registry、Policy Engine、审批、Execution Profile 和 Audit Log。

这套组合的重点不是多增加一层抽象，而是避免让 Agent Runtime 自己承担操作系统安全机制的实现成本。Runtime 应该知道谁在执行什么任务、请求操作哪个资源、为什么被允许；Sandbox 则保证实际进程不能超出已批准的执行范围。

最后要强调：Sandbox 不能消除 Prompt Injection，也不能自动解决数据外传、恶意依赖、宿主机漏洞或用户误授权。它的作用是把模型可能犯错的影响范围限制住。一个可靠的 Agent Runtime，应该允许模型提出动作，但不能允许模型决定自己的权限边界。
