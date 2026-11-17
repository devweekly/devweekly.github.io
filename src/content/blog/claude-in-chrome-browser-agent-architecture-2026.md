---
author: SW
pubDatetime: 2026-11-17T13:00:00Z
title: "Claude in Chrome：浏览器 Agent 与 Coding Agent 的边界"
featured: false
draft: false
tags:
  - AI
  - Agent
  - Browser Automation
  - Claude
  - Copilot
  - Architecture
description: "从 Claude in Chrome 出发，分析浏览器 Agent 与 VS Code Copilot、Claude Code 的能力边界，拆解浏览器控制架构、安全模型，并比较 Browser Use、Stagehand、Skyvern、Playwright MCP、BrowserOS 等开源方案。"
---

# Claude in Chrome：浏览器 Agent 与 Coding Agent 的边界

浏览器是大多数企业软件真正的操作界面。CRM、工单系统、采购门户、内部报表、旧版管理后台和 SaaS 控制台，很多并没有可供 Agent 使用的 API。即使存在 API，也可能没有覆盖用户当前登录态、页面上下文或某些交互流程。过去，AI Agent 主要通过搜索接口、Connector 和 MCP 调用业务能力；浏览器 Agent 则尝试直接使用人已经在使用的 Web 界面。

Claude in Chrome 把这件事做成了 Claude 产品的一部分。它可以读取当前页面，在多个 Tab 之间切换，点击、输入、填写表单，并使用用户已有的登录状态。它还可以从 Claude Cowork 和 Claude Code 发起浏览器任务。2026 年 8 月 26 日，Anthropic 宣布该功能向所有付费计划开放，并加入自动动作安全检查。

这项能力值得关注，但不应该把它理解为一个独有的浏览器自动化技术。VS Code 已经有内置 Agent Browser，Copilot 可以导航页面、读取 Accessibility 信息、操作控件、截图和运行 Playwright；Claude Code 也已经能连接 Claude in Chrome，完成代码修改后的真实浏览器验证。差异主要在浏览器会话、产品入口、任务范围和安全边界，而不只是能不能点击网页。

本文以 2026 年 11 月公开的产品能力和代码仓库为准，区分厂商明确披露的事实、开源实现和基于公开信息的架构推断。Anthropic 没有公开 Claude in Chrome 的完整内部实现，涉及扩展内部消息协议、DOM 采集策略和模型工具定义的部分，不会把推测写成产品事实。

## 1. Claude in Chrome 到底解决什么问题？

### 1.1 API 和 Connector 覆盖不到的 Web 系统

企业应用的现实情况是：新系统通常有 API，旧系统可能只有 Web 页面；内部系统可能通过 SSO、浏览器证书或设备策略登录；第三方 SaaS 的 API 权限也未必与用户当前页面权限一致。用户能够在浏览器里完成操作，并不意味着 Agent 已经有一个可调用的 API。

Claude in Chrome 的直接价值，是让 Agent 使用用户正在使用的浏览器，而不是先要求用户导出数据、复制页面内容，或者另外配置一套 API 凭证。它可以读取已经登录的页面，跨 Tab 收集信息，再执行页面上的操作。Anthropic 展示的场景包括读取分析看板、整理 Google Drive 文件、结合日历和邮件准备会议、比较供应商信息，以及把销售活动记录到 CRM。

这类任务通常横跨多个系统。以整理 CRM 为例，Agent 可能需要先从日历确认会议参与者，再从邮件读取上下文，到 CRM 查找联系人，最后填写活动记录。每个系统都可能有独立登录、不同页面结构和不一致的交互方式。浏览器提供了统一入口，但不代表这些系统的业务规则因此统一。

### 1.2 它不只是页面摘要

浏览器侧边栏的常见用法是总结当前页面、解释选中内容或回答页面相关问题。这仍然是把浏览器当作上下文来源。

Browser Agent 的任务则包含状态变化：

- 读取多个页面并整理结构化信息；
- 在不同网站之间传递业务上下文；
- 填写表单、选择下拉项、上传文件；
- 对操作结果进行验证；
- 根据页面反馈继续下一步，必要时暂停让用户处理登录、验证码或高风险动作。

区别在于，Agent 不再只返回一段文本，而是会改变外部系统的状态。它需要对操作对象、执行结果和失败路径负责。一个点击动作成功返回，并不意味着业务操作成功；真正的完成条件应该是页面状态或业务记录已经达到预期。

### 1.3 Cowork、Claude Code 和 Chrome 是三个不同层次

Claude in Chrome 的产品入口已经不止一个。Chrome 侧边栏在支持的计划和组织配置下运行 Cowork Session；Cowork 可以把浏览器作为较大工作流中的一个执行环节；Claude Code 则把 Chrome 接入开发工作流。

| 产品入口 | 工作环境 | 浏览器承担的角色 |
| --- | --- | --- |
| Claude in Chrome 侧边栏 | 用户正在浏览的 Chrome | 当前页面和多个 Tab 的交互入口 |
| Claude Cowork | 跨文件、跨应用的知识工作 | 收集信息、执行 Web 操作、形成交付物 |
| Claude Code | 终端、代码仓库、开发工具 | 开发后的浏览器测试、调试和验证 |

需要注意，Cowork 现在也有自己的内置浏览器。没有既有 Claude in Chrome 使用习惯时，Cowork 默认可以使用内置浏览器；用户也可以选择继续使用 Chrome 扩展。两者的关键差别是浏览器环境：内置浏览器拥有自己的浏览器状态，而扩展连接用户正在使用的浏览器。

官方资料：
- [Claude in Chrome 产品说明](https://claude.com/claude-in-chrome)
- [Get started with Claude in Chrome](https://support.claude.com/en/articles/12012173-get-started-with-claude-in-chrome)
- [Claude Cowork comes to the Chrome side panel](https://claude.com/resources/articles/cowork-chrome-side-panel)

## 2. 与 VS Code Copilot、Claude Code 的真实差异

最容易出现的误判，是把 Claude in Chrome 与 Copilot 或 Claude Code 当成三个同类产品。它们处于不同的产品层次：Claude in Chrome 提供浏览器连接和交互入口；Copilot 和 Claude Code 提供 Agent Harness，负责理解任务、规划步骤、调用工具和维护执行上下文。浏览器工具可以成为这些 Harness 的一部分。

### 2.1 VS Code Copilot 已经具备 Agent Browser

VS Code 的内置浏览器工具已经支持页面导航、读取页面内容、检查可访问元素、截图、点击、输入、悬停、拖拽、处理对话框，以及运行 Playwright 代码。它不需要用户另行部署 MCP Server。

其典型流程是：Copilot 修改代码，启动应用，在集成浏览器中打开页面，执行用户流程，检查页面内容、截图和 Console 错误，再根据结果修改代码。对于 Web 开发，这已经是完整的 build-test-verify 循环。

VS Code 的浏览器会话有两个重要模式：

- Agent 自己打开的页面使用隔离的临时会话，不共享用户普通浏览器的 Cookie 和 Storage。
- 用户可以主动点击 Share with Agent，把已有页面及其登录状态授权给 Agent；之后也可以撤销。

这意味着 Copilot 并不是不能操作登录后的 Web 应用，而是默认不把用户已经打开的页面交给 Agent。用户必须显式共享页面。隔离默认值有利于隐私和并行任务，也意味着真实工作系统的自动化多一步授权。

官方文档：[Use browser tools with agents](https://code.visualstudio.com/docs/agents/run/browser-tools)。

### 2.2 Claude Code 的 Chrome 集成更接近真实浏览器协作

Claude Code 可以通过 `claude --chrome` 启动 Chrome 集成，也可以通过 `/chrome` 检查连接和管理浏览器权限。它连接 Claude in Chrome 扩展，在可见的浏览器窗口中执行动作，并使用现有浏览器登录状态。

官方文档列出的能力包括：

- 读取页面 DOM 状态和 Console 错误；
- 读取网络请求，辅助定位前端问题；
- 使用 Figma 设计稿验证实际页面；
- 测试表单验证、用户流程和视觉回归；
- 操作 Google Docs、Gmail、Notion 等已登录应用；
- 从本地文件上传到网页；
- 从页面提取结构化信息并保存到本地；
- 记录浏览器操作 GIF。

这里有一个实际的产品限制：Claude Code 的 Chrome 集成要求直接 Anthropic 账号登录。通过 API Key 或 `claude setup-token` 登录时，该集成不会启用；仅通过 Bedrock、Google Cloud 或 Microsoft Foundry 使用 Claude 的用户，也不能直接使用这项 Chrome 集成。

所以，Claude Code 与 Chrome 的关系并不是“Claude Code 自己实现了一套浏览器驱动”。它通过扩展获得浏览器能力，再由 Claude Code 的 Agent Loop 把浏览器操作与代码修改、终端命令和其他工具组合起来。

官方文档：[Use Claude Code with Chrome](https://code.claude.com/docs/en/chrome)。

### 2.3 功能对比

| 比较维度 | Claude in Chrome / Claude Code | VS Code Copilot Agent Browser |
| --- | --- | --- |
| 当前页面读取 | 支持 | 支持共享页面 |
| 普通页面导航与交互 | 支持 | 支持 |
| 多 Tab 操作 | 支持 | 支持 |
| 用户现有登录态 | 扩展可直接使用 | 需要 Share with Agent |
| 默认隔离浏览器 | Cowork 内置浏览器可提供 | Agent 创建页面默认隔离 |
| DOM / Accessibility | 页面状态可读，具体内部实现未完整公开 | 明确提供页面可访问信息 |
| 截图与视觉验证 | 支持 | 支持 |
| Console / Network 调试 | Claude Code 集成支持 Console 和 Network 检查 | VS Code 文档明确支持读取 Console 错误和页面状态 |
| 直接执行 Playwright | 通过浏览器工具和开发流程实现 | 提供 runPlaywrightCode |
| 本地代码和终端 | Claude Code 原生能力 | Copilot Agent 原生能力 |
| 跨应用工作 | Cowork、Connectors、Skills | 取决于 Agent 工具、MCP 和扩展 |
| 浏览器权限控制 | 站点权限、风险动作确认、安全分类器 | 页面共享、网络域名策略、组织策略 |
| 主要定位 | 通用浏览器操作与 Claude 工作流整合 | 开发环境中的浏览器反馈与验证 |

不能据此断言某一方的浏览器自动化成功率更高。公开资料没有提供同一任务集、相同模型、相同浏览器状态和相同安全策略下的独立对照测试。表格比较的是公开能力与默认产品设计，不是性能排名。

对开发者来说，VS Code 已经覆盖了大部分日常 UI 测试和页面调试需求。Claude in Chrome 的差异更明显地出现在“使用我已经登录的真实浏览器完成跨站工作”这一类任务。Claude Code 则把这种能力带入代码仓库和终端工作流。

## 3. 它是怎么实现的？

### 3.1 先区分公开事实与架构推断

Anthropic 公开了扩展的用户能力、权限管理、Claude Code 集成方式和安全措施，但没有公开完整的扩展源码，也没有给出完整的内部组件图。因此，不能仅凭产品行为断言它一定采用某一种 DOM 抽取算法、消息总线或浏览器控制协议。

从公开接口可以确认的边界包括：

1. Chrome 扩展负责把 Claude 的能力放到浏览器侧边栏，并允许读取和操作页面。
2. Claude Cowork 或 Claude Code 提供上层任务执行环境。
3. Claude Code 通过扩展连接浏览器，使用现有登录状态，并在可见窗口中执行操作。
4. 页面截图会进入对话上下文；Claude Code 还可以读取 DOM 状态、Console 错误和网络请求。
5. 输入内容和待执行动作会经过安全检查；用户可以设置站点权限和动作确认策略。

下面的图是基于公开能力整理的逻辑架构，不代表 Anthropic 内部模块名称或未公开的实现细节。

![Claude in Chrome 的逻辑架构](/diagrams/claude-in-chrome-logical-architecture.svg)

[交互查看 HTML](/diagrams/claude-in-chrome-logical-architecture.html)

### 3.2 浏览器控制有三条主要技术路线

浏览器 Agent 的底层实现大致有三种方式，成熟产品经常采用混合方案。

**DOM / Accessibility Tree。** 浏览器将页面转换成带有角色、名称、状态和层级关系的结构化信息，Agent 根据元素引用执行点击、输入和选择。它不需要理解整张截图，Token 成本也更容易控制。缺点是 Canvas、复杂图表、视觉布局和部分自定义控件可能无法完整表达。

**Chrome DevTools Protocol（CDP）。** CDP 提供浏览器调试和控制接口，可以导航、操作页面、获取 DOM、读取网络和 Console 信息、截取屏幕。它适合构建通用浏览器控制服务，也适合调试和测试。缺点是需要管理浏览器实例、连接、权限和会话隔离。

**Computer Use / 视觉控制。** 模型观察截图，再通过坐标、鼠标和键盘执行动作。它不依赖页面 DOM 结构，能够处理视觉组件和部分特殊页面；但坐标受窗口尺寸、缩放、布局变化影响，动作也更难精确验证。

这三条路线不是互斥选择。合理的实现通常是先用 DOM 或 Accessibility 信息定位元素，遇到结构信息不足时再用截图补充，执行后重新读取页面状态验证结果。

### 3.3 Browser Agent 的闭环

一次浏览器操作不应该是“模型发出 click，浏览器返回成功”这么简单。可用的 Agent Loop 至少要包含观察、定位、动作、验证和恢复。

![浏览器 Agent 的动作与安全检查流程](/diagrams/browser-agent-action-safety-flow.svg)

[交互查看 HTML](/diagrams/browser-agent-action-safety-flow.html)

一个可靠的执行步骤应当是：

1. 获取当前页面 URL、Tab 状态、页面内容和可见元素。
2. 把页面内容作为不可信输入，提取与用户任务相关的上下文。
3. 选择具体动作，并判断动作的目标、影响和可逆性。
4. 检查站点权限、用户授权和高风险动作策略。
5. 执行点击、输入、导航或上传。
6. 重新读取页面，验证预期状态是否真的发生。
7. 如果失败，判断是定位错误、页面尚未加载、业务校验失败、登录失效，还是动作本身不允许；再决定重试、重新观察或请求用户介入。

页面上的“保存成功”提示只是一个观察结果。对有业务后果的操作，还应检查记录是否存在、状态是否更新、重复提交是否可能造成副作用。

### 3.4 浏览器会话是最容易被低估的架构问题

浏览器自动化能否使用登录态，决定了它能不能进入真实企业工作流。这里至少有三种不同的 Session：

| Session 类型 | Cookie / Storage | 典型用途 | 主要风险 |
| --- | --- | --- | --- |
| 临时隔离 Session | 独立、任务结束后可销毁 | 测试、公开页面、临时任务 | 需要重新登录 |
| 持久化 Agent Profile | Agent 自己维护并跨任务保留 | 长期自动化、固定工作流 | 凭证和会话需要长期保护 |
| 用户现有 Browser Session | 复用用户已登录的浏览器 | 内部门户、真实 SaaS、跨站工作 | Agent 能触达用户已有权限的数据 |

Claude in Chrome 主要解决第三种模式。VS Code Copilot 默认偏向第一种，用户主动共享页面后才进入第三种。Playwright MCP 默认可以使用持久化 Profile，也支持隔离上下文和扩展连接现有浏览器。BrowserOS neo 则把登录状态导入作为产品设计的一部分。

这些模式没有绝对优劣。隔离 Session 更适合自动化测试和无人值守执行；现有 Session 更适合用户委托的日常工作。企业系统不应把“复用用户登录态”直接等同于“获得无限制的自动操作授权”。

## 4. 开源项目：哪些真正值得研究？

开源项目并不都在解决同一个问题。有些提供 Agent，有些提供浏览器驱动，有些提供高层自动化原语，还有些提供浏览器基础设施。选型前需要先区分这些层次。

### 4.1 Browser Use：从逐步工具调用走向持久 REPL

项目：[browser-use/browser-use](https://github.com/browser-use/browser-use)，MIT License。

Browser Use 是最值得研究的通用 Browser Agent 项目之一。它的 1.0 架构与早期版本有明显变化：模型不再只是在每轮从 DOM 快照中挑一个动作，而是可以在持久 Python REPL 中编写代码，调用浏览器辅助函数和原始 CDP。Agent Runtime 基于 Pydantic AI。

这个设计有几个实际好处：

- 模型可以在一个执行单元里完成多个浏览器动作，减少逐个动作往返。
- 可以用普通 Python 处理数据、循环、条件和结果验证。
- 浏览器控制与模型推理之间仍然保持明确的执行边界。
- 同一套 Agent 可以接本地浏览器或云浏览器，也可以使用不同模型提供方。

代价是模型生成的代码拥有更大的执行能力。与单个 click/type 工具相比，持久 REPL 的权限范围更广，必须考虑代码执行隔离、文件系统访问、网络访问、密钥暴露和执行审计。它更像一个 Browser Agent Runtime，而不是单纯的浏览器 MCP Server。

值得注意的是，Browser Use 1.0 是一次引擎变化。旧版本的逐步动作 API 与 1.0 的持久 REPL 不能简单视为同一种实现。依赖它构建产品时，应锁定具体版本并针对升级做回归测试。

### 4.2 Stagehand：把浏览器 Agent 拆成可组合原语

项目：[browserbase/stagehand](https://github.com/browserbase/stagehand)。

Stagehand 的设计思路更适合已有 Agent Runtime 的团队。它提供三类核心能力：

- `observe()`：根据自然语言意图，观察页面并返回候选动作。
- `act()`：执行自然语言描述的原子动作，也可以执行 observe 返回的结构化 Action。
- `extract()`：按照给定 Schema 提取结构化数据。

Stagehand 4 的一个重要变化是：它不再提供早期版本那种完整 Agent API，而是让调用方组合 observe、act 和 extract。Agent 的规划、任务分解、重试和状态管理由上层系统负责。

这对企业架构有价值。浏览器控制可以成为一个独立的工具包，Copilot SDK、Claude Agent SDK 或自建 Runtime 都可以调用它。业务 Agent 不需要把整个执行生命周期交给某个浏览器框架。

它仍然保留 Playwright 风格的定位器和页面 API。确定性高的操作可以使用 Selector，页面结构变化较大的地方再使用自然语言定位。这样比把所有步骤都交给模型猜测更可控。

官方资料：[Stagehand](https://stagehand.dev/) 和 [GitHub Repository](https://github.com/browserbase/stagehand)。

### 4.3 Skyvern：更偏向长流程业务自动化

项目：[Skyvern-AI/skyvern](https://github.com/Skyvern-AI/skyvern)，AGPL-3.0。

Skyvern 把 AI 能力叠加在 Playwright 之上，提供 `act()`、`extract()`、`validate()` 和多步骤 Agent Task。它既有 SDK，也有服务端和可视化工作流产品。

它更适合研究如何把浏览器动作变成长期运行的业务自动化：任务执行、数据提取、验证、状态保存和多步骤流程。与 Stagehand 相比，Skyvern 更偏向完整自动化平台，而 Stagehand 更像可嵌入现有系统的浏览器 SDK。

如果企业要运行发票下载、采购信息录入、供应商门户查询等重复任务，Skyvern 的工作流和运行服务值得参考。若只是想给现有 Agent 增加浏览器工具，直接引入完整平台可能偏重。

官方资料：[Skyvern Developers](https://www.skyvern.com/developers)。

### 4.4 Playwright MCP：标准化的浏览器工具接口

项目：[microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp)。

Playwright MCP 把 Playwright 能力包装成 MCP 工具。它主要使用 Accessibility Snapshot，让模型看到类似以下结构：

```text
heading "todos" [level=1]
textbox "What needs to be done?" [ref=e5]
checkbox "Toggle Todo" [ref=e10]
```

模型根据 `ref` 定位元素，再调用 click、type、fill 等工具。它支持 Chromium、Firefox、WebKit 和 Edge，也提供截图、导航、表单、Storage、Tracing 等功能。

它的优点是协议标准、工具粒度清楚、与各种 MCP Client 兼容。缺点是 Agent 需要频繁往返调用工具，复杂流程的规划和恢复逻辑仍然要由上层 Runtime 负责。对于需要严格控制动作边界的系统，这种显式工具调用反而是优点。

官方资料：[Playwright MCP Introduction](https://playwright.dev/docs/getting-started-mcp)。

### 4.5 Chrome DevTools MCP：偏向开发调试，而非通用业务 Agent

项目：[ChromeDevTools/chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp)，Apache-2.0。

Chrome DevTools MCP 由 Chrome 团队维护，面向 Coding Agent 提供浏览器调试和自动化能力。它通过 Puppeteer 控制 Chrome，并使用 DevTools 能力读取网络请求、Console、截图和性能 Trace。

它与 Playwright MCP 的定位不同：

- Playwright MCP 更强调跨浏览器的页面交互和 Accessibility Tree。
- Chrome DevTools MCP 更强调 Chrome 的调试、网络和性能分析能力。
- 两者都可以作为 Claude Code、Copilot 或其他 MCP Agent 的浏览器工具。

如果目标是让 Coding Agent 判断页面为什么报错、接口为什么失败、页面性能为什么退化，Chrome DevTools MCP 的价值更高。如果目标是稳定地执行跨浏览器用户流程，Playwright 更合适。

官方资料：[Chrome DevTools for agents](https://developer.chrome.com/docs/devtools/agents)。

### 4.6 BrowserOS：把浏览器本身变成 Agent Runtime 的一部分

项目：[browseros-ai/BrowserOS](https://github.com/browseros-ai/BrowserOS)，AGPL-3.0。

BrowserOS 值得单独讨论，因为它不只是一个自动化 SDK。其新产品 BrowserOS neo 是一个面向 Agent 的独立浏览器，支持从 Chrome 导入登录信息，并让 Claude Code、Codex、Cursor、VS Code 和其他 MCP Agent 连接。Agent 可以在独立 Tab 中并行工作，用户可以实时观察或回放执行记录。

从公开仓库结构看，它包含两个主要部分：

- Chromium Fork：浏览器本身和相关构建系统。
- Agent Platform：TypeScript / Rust 服务、MCP Endpoint、JSON API 和浏览器 Dashboard。

BrowserOS neo 的目标不是替代用户日常浏览器，而是提供一个 Agent 专用的浏览器环境。与 Claude in Chrome 相比，它更强调 Agent 选择自由、并行执行和本地控制；Claude in Chrome 则与 Anthropic 的 Cowork、Claude Code 和账户会话深度整合。

需要注意，BrowserOS 的本地执行和隐私优势主要来自它公开描述的产品架构。它仍然需要处理浏览器导入凭证、站点权限、Agent 操作风险和本地服务暴露面。AGPL-3.0 也意味着企业集成前需要评估许可证义务。

## 5. 类似商业产品：Claude 并不是唯一选择

浏览器 Agent 正在分化为三种产品形态：在用户浏览器旁边工作的扩展、内置 Agent 的 AI Browser，以及面向 Coding Agent 的浏览器工具。

| 产品 | 产品形态 | 登录态与浏览器 | 主要差异 |
| --- | --- | --- | --- |
| Claude in Chrome | Chrome 扩展 | 使用现有 Chrome 会话 | 与 Claude Cowork、Claude Code、Skills 和 Connectors 整合 |
| ChatGPT Chrome Extension / Codex | 浏览器扩展与桌面 Agent | 可以使用已登录站点 | 可跨 Tab 执行任务，支持网站权限控制 |
| Perplexity Comet | AI Browser | 浏览器自身管理 | 搜索和研究体验与页面操作结合 |
| Gemini in Chrome | Chrome 内置 AI | Chrome 浏览上下文 | 与 Google 搜索、Workspace 和 Chrome 能力结合 |
| BrowserOS neo | Agent 专用浏览器 | 可导入 Chrome 登录信息 | 本地运行、MCP Agent 兼容、并行 Tab 和执行回放 |
| VS Code Integrated Browser | IDE 内置浏览器 | 默认隔离，支持显式共享 | 以开发验证为中心，和代码修改形成闭环 |

### 5.1 ChatGPT / Codex Chrome

OpenAI 的 Chrome 扩展可以让桌面端 Agent 使用用户已经登录的 Chrome 页面。2026 年 5 月的更新支持跨多个 Tab 并行工作，并允许用户控制 Agent 可以访问的网站。典型任务包括比较多个产品页面、收集信息、数据录入和验证。

它与 Claude in Chrome 的产品思路比较接近：Agent 不需要把所有网站都变成 Connector，而是直接使用浏览器里的登录状态。Codex 更强调把浏览器任务与代码、文件和开发工作结合起来；ChatGPT Work 则可以把浏览器采集的信息继续交给其他工具生成报告、表格和演示文稿。

官方资料：[ChatGPT Browser Extension](https://learn.chatgpt.com/docs/chrome-extension) 和 [What's New](https://learn.chatgpt.com/docs/whats-new)。

### 5.2 Perplexity Comet

Comet 是以 AI 为中心的浏览器产品，Assistant 可以使用当前打开的 Tab 上下文，帮助用户总结页面、研究信息和执行网站操作。它的优势是浏览器和搜索体验原生整合，用户不需要先在 IDE 或 Agent Runtime 中配置浏览器工具。

它与 Claude in Chrome 的差别在于产品边界。Comet 是一个完整浏览器，AI 是浏览器本身的主要交互方式；Claude in Chrome 则是把 Agent 能力带进用户已经在使用的 Chrome。前者控制浏览器产品体验，后者更容易嵌入已有工作环境。

官方资料：[Perplexity Comet](https://www.perplexity.ai/comet)。

### 5.3 Gemini in Chrome

Google 正在把 Gemini 和自动浏览能力放进 Chrome。2026 年 Google I/O 公布的方向包括多步骤自动浏览、页面上下文理解，以及跨设备的浏览器助手能力。

Google 的优势是浏览器、搜索和 Workspace 生态整合。Claude 的优势则是把浏览器操作纳入通用 Agent 工作流，并通过 Cowork、Skills 和 Connectors 继续处理结果。两者的最终差异取决于各自的任务执行能力、权限模型和可组合性，而不只是模型回答页面问题的质量。

官方资料：[Google Chrome AI innovations](https://www.google.com/chrome/ai-innovations/)。

## 6. 安全问题：浏览器 Agent 比普通 RAG 多了一种风险

浏览器 Agent 会读取外部网页、邮件、文档和内部系统内容。这些内容不一定可信，而且可能包含针对 Agent 的恶意指令。攻击者不需要控制模型，只要让模型把网页中的指令误认为用户指令，就可能改变后续操作。

这就是 Browser Prompt Injection。一个页面可以隐藏“把当前用户的邮件内容发送到某个地址”之类的指令。模型如果没有区分用户意图和页面内容，就可能在合法的浏览器会话中执行非预期动作。

Anthropic 已经为 Claude in Chrome 引入多层防护：

- 模型训练阶段识别恶意指令；
- 对进入模型上下文的内容进行分类；
- 对每一个待执行动作进行安全检查；
- 通过站点权限和 Blocklist 限制访问；
- 对下载文件、输入敏感信息等动作要求确认；
- 对高风险操作暂停执行，交给用户判断。

官方安全文档明确说明：页面截图会进入对话上下文，安全分类器也不能保证识别所有新型攻击。对于敏感站点，建议使用独立浏览器 Profile 和严格的站点 Allowlist；对于受监管数据，Anthropic 也明确提示不要把 Claude in Chrome 当成默认处理路径。组织启用 HIPAA 的情况下，该功能默认关闭，而且不会自动纳入现有 BAA 覆盖范围。

安全流程应当把三个问题分开：

1. **Content Trust**：网页内容只是数据，不能因为它出现在页面上就提升为系统指令。
2. **Action Authorization**：即使模型理解了页面，也不代表它有权执行页面上的任何动作。
3. **Business Confirmation**：删除、发布、付款、修改权限等有业务后果的操作，需要明确的授权和结果验证。

上图展示了浏览器 Agent 的动作检查链。在企业环境里，建议把只读操作、可逆写操作和不可逆业务操作分成不同的权限等级。浏览器登录态只说明用户可以访问某个系统，不应该自动授予 Agent 执行所有业务动作的权力。

安全参考：
- [Use Claude in Chrome safely](https://support.claude.com/en/articles/12902428-use-claude-in-chrome-safely)
- [Mitigating the risk of prompt injections in browser use](https://www.anthropic.com/research/prompt-injection-defenses)
- [Chrome DevTools MCP Security](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/README.md)

## 7. 如果自己实现 Browser Agent，应该怎么选？

先确定你要解决的是浏览器控制、Agent 编排，还是一套完整的浏览器工作平台。它们的实现成本和维护边界差异很大。

| 需求 | 推荐起点 | 原因 |
| --- | --- | --- |
| Web UI 自动化测试 | Playwright | 确定性高、生态成熟、测试能力完整 |
| 给现有 Agent 增加自然语言浏览器工具 | Stagehand | 原语清晰，容易接入不同 Agent Runtime |
| 需要独立 Browser Agent | Browser Use | Agent Loop 和浏览器执行结合，适合探索自主任务 |
| 长流程业务自动化 | Skyvern | 提供任务、验证和服务化能力 |
| Chrome 调试、网络和性能分析 | Chrome DevTools MCP | DevTools 能力覆盖更完整 |
| 真实登录态、多个 Agent 并行、本地浏览器 | BrowserOS neo | 产品本身围绕 Agent 浏览器设计 |

### 7.1 推荐的企业架构

如果已有 Copilot SDK、Claude Agent SDK 或其他 Agent Runtime，不建议把浏览器自动化平台和 Agent Orchestration Runtime 重新做成一个大系统。浏览器应该作为独立的执行工具层，由上层 Agent 负责任务理解、规划和业务状态管理。

可以把实现拆成五个边界：

- **Agent Harness**：维护任务目标、上下文、工具调用和终止条件。
- **Browser Adapter**：封装 Playwright、CDP 或 Browser Use，提供统一的导航、观察、动作和提取接口。
- **Session Manager**：管理浏览器 Profile、Tab、Cookie、并发和会话生命周期。
- **Policy & Authorization**：控制站点访问、动作风险、用户授权和数据边界。
- **Execution Evidence**：保存页面快照、动作、结果、错误和验证证据。

其中 Browser Adapter 不应把具体浏览器框架的对象直接暴露给业务 Agent。应当用有限的工具契约表达能力，例如 `observe_page`、`navigate`、`act`、`extract` 和 `verify_state`。具体底层可以是 Playwright、CDP 或 Stagehand。

更重要的是，Browser Agent 需要一个独立的执行记录。每个动作至少保留目标页面、动作类型、执行前状态、授权决策、执行结果和验证结果。只记录模型对话不足以满足故障排查和审计要求。

### 7.2 先做一个最小可用版本

第一版只需要支持单个浏览器 Profile、有限站点范围、页面观察、点击和输入、执行后验证，以及用户确认。不要一开始就实现多浏览器、多租户、跨设备会话迁移和复杂工作流编排。

当真实任务证明需要并行执行后，再增加多 Tab 和多 Agent 隔离；当业务需要无人值守运行后，再引入持久化任务、恢复机制和执行队列。安全策略应从第一版就存在，而不是等自动化能力变强后再补。

### 7.3 应该如何评估？

不能用“能不能打开网页”作为 Browser Agent 的验收标准。建议建立一组可重复的任务集，覆盖页面读取、跨 Tab 信息汇总、登录态使用、表单填写、页面结构变化、网络失败、登录过期、恶意页面指令和重复提交。

至少记录以下指标：

| 指标 | 说明 |
| --- | --- |
| Task Success Rate | 任务最终业务结果是否满足预期 |
| Action Success Rate | 单个动作是否按预期执行 |
| Recovery Rate | 页面变化、超时或失败后能否恢复 |
| Verification Coverage | 写操作是否有后置状态验证 |
| Prompt Injection ASR | 恶意页面指令导致非授权行为的成功率 |
| Cost per Completed Task | 完成任务的模型、浏览器和基础设施成本 |
| Human Intervention Rate | 需要用户处理或确认的任务比例 |
| Audit Completeness | 是否能还原每一步的输入、动作和结果 |

比较不同方案时必须使用同一批页面、相同浏览器状态、相同任务目标和相同权限策略。否则，模型能力、登录状态、页面结构和授权差异都会污染结果。

## 8. 结论：浏览器正在成为 Agent 的一等执行环境

Claude in Chrome 的价值不是发明了浏览器自动化。Playwright、CDP、Browser Use 和 Stagehand 已经提供了不同层次的浏览器控制能力；VS Code Copilot 也已经把 Agent Browser 集成进开发环境。

它的产品价值在于把真实浏览器会话接入 Claude 的通用工作流。用户可以从当前页面发起任务，再让 Cowork 或 Claude Code 继续处理；Agent 可以访问没有 API 的内部系统，复用用户登录态，并把浏览器操作与本地文件、代码和其他工具组合起来。

如果只关心 Web 开发验证，VS Code 集成浏览器和 Playwright 已经足够强，Claude in Chrome 并不构成不可替代的优势。如果目标是跨 SaaS、内部门户和传统 Web 系统执行真实业务任务，浏览器会话、站点授权、动作验证和安全隔离才是选型重点。

从工程角度看，值得长期投入的不是再造一个能点击网页的 Agent，而是建立一个可替换浏览器驱动、可审计、可恢复、能管理真实登录态和动作权限的 Browser Runtime。模型负责决定下一步做什么，浏览器层负责安全地执行并提供证据；两者之间应保持清晰边界。
