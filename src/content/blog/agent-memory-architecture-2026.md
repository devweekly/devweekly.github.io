---
author: SW
pubDatetime: 2026-11-12T00:00:00Z
title: "Agent Memory 不只是 RAG：基于 Anthropic Dreaming 的开源实现与三种 Runtime 落地方案"
featured: false
draft: false
tags:
  - AI
  - Agent
  - Memory
  - Copilot SDK
  - LangChain
  - pi-mono
description: "从 Anthropic 的记忆层次与 Dreaming 出发，比较 Copilot SDK、DeepAgents、pi-mono 的现有实现，并给出统一 Memory Core、Runtime Adapter 和后台整理的可落地架构。"
---

# Agent Memory 不只是 RAG：基于 Anthropic Dreaming 的开源实现与三种 Runtime 落地方案

Anthropic 在 [Components of Agent Memory](https://www.anthropic.com/research/components-of-agent-memory) 中描述了一种长期记忆设计：Agent 在工作时留下原始记录，从经历中提炼值得保留的知识；记忆积累到一定规模后，后台过程重新检查旧记录，纠正错误、合并重复项、建立更高层的知识表示，并为下一次 Session 准备少量相关上下文。

这篇文章容易让人联想到 Claude Code 的 Auto Memory，但真正值得研究的是记忆如何形成和维护，而不是某个产品使用了什么私有文件路径或 Prompt。**要实现这种架构，不需要反向工程 Claude Code。** 公开的 Session 生命周期 API、可持久化的事件记录、一个独立 Memory Store 和后台 LLM Worker 已经能覆盖主要机制。只有在目标是复制 Claude Code 未公开的内部选择策略时，才有必要做黑盒行为对比；这并不是构建可移植 Memory Engine 的前提。

本文重点讨论三个 Runtime：GitHub Copilot SDK、LangChain DeepAgents，以及 pi.dev / pi-mono。三者的会话管理方式不同，但可以通过统一的 Memory Contract 接入同一套记忆服务。先给出结论：

- **Copilot SDK** 有 Session Hooks、完整消息与工具执行事件，以及会话持久化能力，适合作为企业应用的 Runtime Adapter；SDK 本身没有跨 Session 的 Dreaming Engine。
- **DeepAgents** 已把文件型长期记忆、跨 Thread Store 和 Skills 纳入框架，官方还给出了独立 Consolidation Agent + Cron 的方案；LangMem 可以补充后台提取和反思。
- **Pi** 的 Extension API 暴露了细粒度的消息、工具、Agent 和 Session 生命周期，社区已有多个本地记忆实现，最适合先完成端到端试点。

推荐的方向不是为三个 Runtime 分别实现三套 Memory Engine，而是先实现一个共享的 Memory Core，再分别编写 Runtime Adapter。这样可以复用记忆模型、检索、整理、评估、删除和审计逻辑，避免某个框架的内部数据格式成为长期架构依赖。

## 1. Anthropic 的设计到底解决什么问题

传统 RAG 会把文档切块、建立索引，再在请求时检索相关内容。它能让模型找到已有信息，却不会自动判断一次长任务中哪些经历值得保留，也不会主动验证旧结论是否已经失效。对话摘要同样不够：它主要压缩当前上下文，目标是让当前 Session 继续运行，不是建立一个能够跨 Session 演化的知识体系。

Anthropic 将 Agent Memory 分成四层：

| 组件 | 保存什么 | 主要用途 |
| --- | --- | --- |
| Transcripts | 用户消息、Agent 回复、工具调用及结果等原始事件 | 保留经历与证据，支持回溯 |
| Memory Notes | 从经历中提取的偏好、事实、决策、规则和教训 | 保存以后可能再次用到的信息 |
| Memory Representations | Wiki 页面、主题索引、实体关系和链接 | 组织持续增长的知识，支持关联检索 |
| Injected Context | 每次 Session 开始时预加载的少量内容 | 让 Agent 一开始就掌握相关背景 |

四层职责不同。原始 Transcript 应尽量保留来源，不应直接全部塞进 System Prompt；Memory Notes 是经过提炼的候选知识，但仍可能出错；Wiki 或知识图谱帮助 Agent 找到关联信息，却不应成为脱离来源的第二套事实源；Injected Context 则是按当前任务和 Token 预算挑选出来的视图，不是完整知识库。

### 1.1 Dreaming 是记忆维护过程，不是定时摘要

文章最有价值的部分是 Dreaming。Agent 在工作时可以记录显著事件，但它未必能立即判断一条信息未来是否重要，也可能把当时的猜测误当成事实。Dreaming 让后台任务重新检查历史记录，以来源证据校正旧笔记，合并重复项，识别冲突和过时内容，再生成适合未来检索的知识表示。

Anthropic 的示例包括：Agent 根据任务反馈修正此前回答错误的规则；在 Pokémon 长任务中，根据历史 Transcript 纠正错误的地点记忆；以及把大量内部文档组织成相互链接的 Wiki 页面。它们对应不同的记忆维护动作：纠错、经验归纳、知识组织和上下文准备。

这并不意味着每次 Session 结束都必须运行一次昂贵的总结。整理任务可以由事件数量、时间窗口、重复召回、错误反馈或队列积压触发；一次任务也可以只处理某个 User、Project 或 Agent 的部分记忆。关键是把它设计成可重试、可追踪、可评估的后台工作，而不是放在交互式请求的关键路径里。

### 1.2 不要把 Compaction 当成 Long-term Memory

Compaction 解决的是当前上下文窗口接近上限时，如何压缩旧消息并继续当前任务。Long-term Memory 解决的是多个 Session 之间，哪些知识应该留下、如何纠错和如何再次使用。

两者会共享原始对话材料，但生命周期不同。Pi 官方文档也把 Compaction 和 Branch Summarization 作为会话上下文管理机制：它们会保存摘要和保留边界，但这不等于一套完整的跨 Session 知识维护系统。参见 [Pi Compaction Reference](https://pi.dev/docs/latest/compaction)。

## 2. 可以直接使用的开源实现

目前没有一个开源项目能在所有 Runtime 上原样提供 Anthropic 的全部四层能力。更实际的做法是选用已有项目中成熟的部分，再补齐缺失的 Runtime Adapter 或后台 Worker。

### 2.1 OpenClaw：最接近完整 Dreaming 流程的参考实现

[OpenClaw Memory](https://docs.openclaw.ai/concepts/memory) 和 [Dreaming](https://docs.openclaw.ai/concepts/dreaming) 值得作为架构参考。它没有把所有长期记忆塞进一份不断增长的摘要，而是按生命周期使用不同文件：

- `USER.md` 保存稳定的用户偏好、沟通方式和当前项目背景。
- `MEMORY.md` 保存已经整理的长期事实、决策和规则。
- `memory/YYYY-MM-DD.md` 保存每日观察与工作记录，供后续搜索和提炼。
- `DREAMS.md` 保存后台整理的摘要和可检查的结果。

OpenClaw 的 Dreaming 分为 Light、REM 和 Deep 三个阶段。Light 整理近期信号并去重，REM 归纳主题和重复模式，这两个阶段不直接改写长期的 `MEMORY.md`。Deep 阶段才对候选项评分和校验，并在通过门槛后执行新增、合并或替代。它会重新读取来源文件，避免把已经删除或变更的旧片段写回。

这套实现还有几项值得借鉴的保护措施：记忆条目保留来源引用；不可信来源会在进入整理模型前被过滤；候选项需要通过分数、重复召回次数和不同查询数等门槛；更新前保存旧文件，整理结果可以检查；历史记忆回放也会避免把已经注入过的记忆再次当成新的经历。

OpenClaw 还提供从 Claude Code 自动记忆目录导入 Markdown 文件的功能，但不会把 Claude Code 的完整 Session Transcript 一并导入。这说明可以复用公开的文件约定和迁移入口，不需要反向工程 Claude Code 的运行时。

### 2.2 Pi 生态：从轻量 Markdown 到完整睡眠周期

Pi 的社区实现最丰富，且与 TypeScript Runtime 的结合比较直接。

**pi-hermes-memory：适合先验证日常自动学习**

仓库：[chandra447/pi-hermes-memory](https://github.com/chandra447/pi-hermes-memory)

截至 2026-11-12，Pi Package Catalog 显示的版本为 0.11.0。扩展提供长期事实、User Profile、项目记忆、历史 Session 搜索和可复用 Skill。它会在一定数量的 Turn 或 Tool Call 后进行后台 Review，也会识别用户纠正并保存相关信息。历史对话索引用 SQLite FTS5，记忆本身仍可落在 Markdown 文件中。

它将全局信息与 Project 信息分开，程序性经验保存为 Pi 原生 `SKILL.md`。默认的 Policy-only 模式不会把整份记忆文件都注入 Prompt，而是给 Agent 一套检索规则，需要时再调用 `memory_search`。这比每轮加载越来越大的 MEMORY.md 更可控。

边界也需要看清：后台 Review 仍然需要 LLM 调用；历史 Session 必须先建立索引；SQLite FTS5 主要解决关键词检索，不能等同于时间知识图谱或完整语义检索。对中文检索，项目文档指出 Trigram 对一两个字符的查询不友好。它是一个可直接使用的本地记忆扩展，但不是 Anthropic Dreaming 的完整复刻。

安装：

```bash
pi install npm:pi-hermes-memory
```

**pi-sleep-agent：最值得研究的 Dreaming 实现**

仓库：[aydinnyunus/sleep](https://github.com/aydinnyunus/sleep)

Sleep 把记忆生命周期拆成三层：T0 是会话中捕获的临时观察，T1 是经过整理但仍待确认的候选记忆，T2 是已经晋升的长期记忆。它提供自动捕获、预算控制、候选整理、夜间 Dream Cycle、记忆卫生检查和 Replay。

Nightly Cycle 会执行四项工作：Mine 从多次 Session 中找重复偏好；Consolidate 把近期 T0 观察提炼为 T1 候选；Hygiene 检查陈旧、未使用或积压的候选；Replay 对相同任务分别使用和不使用候选记忆，比较结果是否改善。

这个设计有两个值得参考的地方。第一，候选记忆和永久记忆分开管理，避免一次 LLM 误判直接污染长期知识。第二，项目会度量记忆是否有帮助，而不是只统计写入了多少条。

它的默认治理更严格：新的永久记忆需要通过 `promote` 显式批准。这个门槛适合高风险或证据不足的场景，但不宜无条件推广到所有个人偏好和普通项目经验。项目还需要模型调用和平台调度器来运行夜间流程。公开支持列表包括 Pi、Claude Code、Gemini、Cursor、OpenCode、Windsurf、Codex 和 Cline 等；当前列表没有 GitHub Copilot SDK，因此不能直接视为 Copilot 插件。

Pi 安装入口：

```bash
pi install npm:pi-sleep-agent
```

**pi-memory：轻量的 Markdown 方案**

仓库：[jayzeng/pi-memory](https://github.com/jayzeng/pi-memory)

它将长期记忆、每日日志和待办 scratchpad 保存为普通 Markdown 文件，核心能力不依赖额外数据库。可选的 QMD 提供 BM25、语义和混合搜索。对于希望直接查看、编辑并通过 Git 管理记忆的个人开发者，这是一个轻量起点。

但它的定位仍以文件记忆和检索为主。其仓库中的 `pi-dream` Consolidation PR 在本次核对时仍是开放状态，不能把未合并的提案当成已经发布的稳定能力。

**pi-cognee：知识图谱方向**

仓库：[kerryhatcher/pi-cognee](https://github.com/kerryhatcher/pi-cognee)

这是一个社区维护的 Pi 扩展，通过 Cognee 提供持久化知识图谱记忆。它可以选择在进程内使用 TypeScript SDK，也可以连接远端 Cognee MCP Server，提供 Remember、Recall、Forget 和 Dataset 管理等操作。

要注意两点：它不是 Cognee 官方团队维护的 Pi 插件；在 SDK 模式下，实体抽取、Embedding 和搜索补全使用扩展单独配置的模型与服务，并不会自动复用 Pi 当前的模型调用。另外，官方集成文档说明 Recall 并非每轮自动执行，Agent 需要主动调用 `cognee_recall`。因此它更适合承担 Memory Representations 和关系检索，不是完整的自动记忆生命周期。

### 2.3 其他可以作为 Memory Engine 的项目

如果目标是给多个 Runtime 提供共享记忆服务，可以研究以下项目：

| 项目 | 主要方向 | 更适合的场景 |
| --- | --- | --- |
| [Mem0](https://github.com/mem0ai/mem0) | 记忆提取、实体关联、检索和多种 SDK 集成 | 需要应用侧 Memory API，且能接受其 OSS 与托管能力之间的差异 |
| [Hindsight](https://github.com/vectorize-io/hindsight) | Retain、Recall、Reflect，多策略检索和记忆页面 | 希望把记忆作为独立服务，通过 SDK、MCP 或 HTTP 接入多个 Agent |
| [Cognee](https://github.com/topoteretes/cognee) | 从文本、文档和对话生成知识图谱与向量表示 | 企业知识关系、文档和多源资料的图结构检索 |
| [Graphiti](https://github.com/getzep/graphiti) | 带时间信息的知识图谱 | 事实会随时间变化，需要追踪实体关系及其有效时间 |
| [Letta](https://github.com/letta-ai/letta-code) | 可自我编辑记忆的 Stateful Agent Runtime | 希望把记忆管理直接放进 Agent Runtime，而不是只引入独立记忆库 |

这里要区分 Memory Engine 与 Agent Runtime。Mem0、Hindsight、Cognee 和 Graphiti 更适合提供记忆存储、整理或检索能力；Letta 则把 Agent 本身也纳入框架。它们都不能仅凭某一项功能就被视为完整复制 Anthropic 的架构。

## 3. 三种 Runtime 的接入方式

三个框架的关键差异在于：事件从哪里来、上下文在哪个时点注入、后台整理由谁触发。它们不需要拥有相同的 Session 数据格式，但应映射到同一个内部事件和记忆模型。

### 3.1 GitHub Copilot SDK：用 Hooks 和事件流接入独立 Memory Core

Copilot SDK 的定位是把 Copilot CLI 的 Agent Runtime 嵌入应用，而不是提供一套长期记忆数据库。SDK 已有正式的 Session Hooks 和 Streaming Events API，足以建立 Memory Adapter。

可用接口包括：

| SDK 接口 | 在记忆系统中的职责 |
| --- | --- |
| `onSessionStart` | 在新建或恢复 Session 时检索记忆，通过 `additionalContext` 注入 |
| `onUserPromptSubmitted` / `onUserPromptTransformed` | 观察用户输入及其最终变换形式 |
| `onPostToolUse` / `onPostToolUseFailure` | 补充工具执行成功或失败的信息 |
| `onAgentStop` | 观察顶层 Agent 自然停止，可用于完成检查 |
| `onSessionEnd` | 释放资源、完成最终 Flush 或提交后台整理任务 |
| Streaming Events | 捕获完整用户消息、Assistant 消息、工具调用和工具结果 |

SDK 的事件流区分已持久化事件与 ephemeral 事件。完整消息、工具执行结果等可以写入 Session Event Log；增量 Delta 和部分进度事件不会作为持久记录在恢复时重放。Memory Adapter 应以完整事件为主要输入，避免把每个 Token Delta 都送入长期记忆提取。

一个接入轮廓如下。代码展示的是边界位置，事件归一化、Scope 解析和持久化由应用自己的 Memory SDK 负责：

```typescript
import { CopilotClient } from "@github/copilot-sdk";

const client = new CopilotClient();

const session = await client.createSession({
  streaming: true,
  hooks: {
    onSessionStart: async () => {
      const context = await memory.prepareContext({
        userId,
        projectId,
        agentId,
        runtime: "copilot-sdk",
      });

      return { additionalContext: context.text };
    },
  },
});

session.on((event) => {
  // Delta / progress 不进入长期记忆；完整事件交给持久化队列。
  if (event.ephemeral) return;

  if (isMemoryEvent(event.type)) {
    void memoryEventWriter.enqueue({
      runtime: "copilot-sdk",
      sessionId: session.sessionId,
      event,
    });
  }
});
```

这里有三个实现要求。

**第一，区分会话恢复与长期记忆恢复。** Copilot SDK 会保留 Session 的对话、工具状态和规划上下文，能够通过 Session ID 恢复原会话。这是 Session Persistence，不是跨 Session 的 User Memory 或 Project Memory。应用应继续维护自己的事件索引和记忆 Scope，不能只依赖 CLI 的 Session 文件来实现跨用户检索。

**第二，事件写入不要阻塞 Agent 主循环。** Streaming Handler 应尽快把标准化事件放入可靠队列或本地 Outbox，再由后台 Worker 写入数据库和执行提取。若记忆服务不可用，主 Agent 应继续正常工作；事件可以按重试策略补写，但不能因为 Memory Store 故障而阻塞用户任务。

**第三，选择正确的整理边界。** `session.idle` 是一个 ephemeral 事件，适合通知应用“当前暂时没有继续执行”；`onSessionEnd` 适合清理 Session 资源或触发最终 Flush。不要把 `onAgentStop` 当成唯一的最终整理信号，因为顶层 Agent 停止和 Session 生命周期结束不是同一个概念。

因此，Copilot SDK 不需要反向工程 CLI。应用只需利用公开事件建立自己的事件日志，用 `onSessionStart` 做 Context Injection，再由后台 Worker 完成跨 Session 的记忆整理。若要让多个 Copilot Session 共享同一用户或项目记忆，Scope 和权限必须由应用层明确控制。

参考：[Copilot SDK Hooks](https://github.com/github/copilot-sdk/blob/main/docs/hooks/hooks-overview.md)、[Session Lifecycle](https://github.com/github/copilot-sdk/blob/main/docs/hooks/session-lifecycle.md)、[Streaming Events](https://github.com/github/copilot-sdk/blob/main/docs/features/streaming-events.md)、[Session Persistence](https://github.com/github/copilot-sdk/blob/main/docs/features/session-persistence.md)。

### 3.2 LangChain DeepAgents：把 Store 和 Consolidation Agent 分开

DeepAgents 已将长期记忆做成框架的一等能力。默认的 Thread State 和 Checkpointer 保存当前 Thread 的执行状态；跨 Thread 的长期记忆使用 LangGraph Store。Memory 以文件形式暴露给 Agent，Agent 可以读取或修改这些文件，Backend 决定实际存储在哪里。

这和 Anthropic 的 Memory Notes、Injected Context 有直接对应关系：

- 使用少量 `memory` 文件保存每次运行都需要的稳定约束；
- 使用 `skills` 表达 Procedural Memory，也就是如何执行某类任务；
- 使用 StoreBackend 把 User、Agent 或 Project 的记忆隔离到不同 Namespace；
- 更大的历史知识按需通过文件工具读取，而不是全部放入每次 System Prompt。

官方示例将 `/memories/` 映射到 StoreBackend，并将临时工作文件保留在 StateBackend。生产环境应使用持久化 Store，而不是 InMemoryStore。Namespace 必须使用经过认证的稳定身份，不能把模型生成的名称或显示标签当作用户 ID。

```python
from deepagents import create_deep_agent
from deepagents.backends import CompositeBackend, StateBackend, StoreBackend

# durable_store 由应用提供，例如持久化的 LangGraph Store。
agent = create_deep_agent(
    model="anthropic:claude-sonnet-5",
    memory=["/memories/USER.md", "/memories/PROJECT.md"],
    skills=["/skills/"],
    backend=CompositeBackend(
        default=StateBackend(),
        routes={
            "/memories/": StoreBackend(
                namespace=lambda rt: (
                    rt.server_info.user.identity,
                    "memory",
                )
            ),
            "/skills/": StoreBackend(
                namespace=lambda rt: (
                    rt.server_info.assistant_id,
                    "skills",
                )
            ),
        },
    ),
    store=durable_store,
)
```

**DeepAgents 的 Background Consolidation 不是安装后自动运行的后台服务。** 官方文档给出的做法是部署一个独立 Consolidation Agent。它通过自定义工具查询最近的对话，将关键事实和已有 Memory 合并，再写回长期 Store。随后通过 LangGraph SDK 创建 Cron Job 定期运行。

官方示例使用每六小时一次的 Cron，并让 Consolidation Agent 查询最近六小时的对话。两个时间窗口必须一致，否则会重复处理或漏掉中间的会话。自托管部署也可以使用外部调度器触发这个 Agent，但要保留同样的 Lookback 和幂等规则。

LangMem 可以提供记忆处理组件。它的 `create_memory_store_manager` 用于从消息中提取和更新记忆，`ReflectionExecutor` 可以延迟和合并后台处理任务。它适合放在提取与反思阶段，不需要再复制一份长期存储。如果已经使用官方 Consolidation Agent，就应明确谁是唯一写入者，避免 LangMem 和另一整理 Agent 并发改写同一份 Memory。

可参考：[DeepAgents Memory](https://docs.langchain.com/oss/python/deepagents/memory)、[DeepAgents Context Engineering](https://docs.langchain.com/oss/python/deepagents/context-engineering)、[DeepAgents GitHub](https://github.com/langchain-ai/deepagents)、[LangMem GitHub](https://github.com/langchain-ai/langmem)。

如果新 Agent 已经基于 LangGraph / DeepAgents 开发，优先使用它原生的 StoreBackend、Memory Files 和独立 Consolidation Agent。不要为了得到一个记忆库而再包一层 Mem0；只有需要跨多个不同 Runtime 共享同一记忆服务时，才把 Memory Core 外置。

### 3.3 pi.dev / pi-mono：利用 Extension 生命周期做自动捕获和注入

Pi 是三个 Runtime 中最容易做本地快速试验的一个。Extension 可以在消息、工具、Agent 和 Session 生命周期的不同阶段运行逻辑，并能通过 `before_agent_start` 修改当前 System Prompt 或插入一条发给模型的自定义消息。

几个事件尤其重要：

| Pi Extension Event | 适用用途 |
| --- | --- |
| `session_start` | 初始化数据库、索引或 Session 级资源 |
| `before_agent_start` | 在每次 Agent Run 开始前准备相关记忆 |
| `message_end` | 捕获最终的用户、Assistant、工具结果和自定义消息 |
| `tool_execution_end` | 记录工具执行的最终结果，包括失败的调用 |
| `agent_settled` | 判断本轮运行以及可能的自动恢复、排队工作都已结束 |
| `session_before_compact` | 在 Compaction 前保留会话交接信息 |
| `session_shutdown` | 关闭 Session 级资源 |

一个重要细节是：`agent_end` 只代表一轮低层 Agent Run 结束，Pi 之后仍可能自动重试、执行 Compaction 或处理排队消息。要触发“当前 Agent 已经不会自动继续”的后台任务，应使用 `agent_settled`。另一个细节是 `message_end` 是最终消息事件，适合捕获完整记录；逐 Token 的 `message_update` 不应直接进入长期记忆。

最小的 Context Injection 可以这样做：

```typescript
pi.on("before_agent_start", async (event, ctx) => {
  const result = await memory.recall({
    query: event.prompt ?? "",
    cwd: event.systemPromptOptions.cwd,
    userId,
    projectId,
    maxTokens: 1200,
  });

  if (!result.text) return;

  return {
    message: {
      customType: "agent-memory",
      content: result.text,
      display: false,
    },
  };
});
```

捕获则由 `message_end` 和 `tool_execution_end` 完成；后台整理可以先入队，在 `agent_settled` 后触发轻量任务，再由独立调度器运行 Nightly Dream。对于资源较重的 Worker，应在 `session_start` 后初始化，并在 `session_shutdown` 时关闭。

Pi 的 Extension API 足以实现这些能力，不需要改动 pi-mono 内核。它的 SessionManager 管理当前会话和分支，扩展可以读取 Session Messages，或将独立的记忆事件写入自己的 Store。

实际选型上，我会先把 `pi-hermes-memory` 作为本地自动学习的参考实现，再研究 `pi-sleep-agent` 的候选记忆和 Dream Cycle。不要把两个扩展未经隔离就同时安装到同一套工作流里：它们都可能捕获事件、提取经验并维护记忆，重复写入会使冲突处理和质量评估更难判断。更好的方式是先分别运行和评估，再决定将哪些模块纳入自己的 Memory Engine。

参考：[Pi Extensions](https://pi.dev/docs/latest/extensions)、[Pi SDK](https://pi.dev/docs/latest/sdk)、[Pi Compaction](https://pi.dev/docs/latest/compaction)。

## 4. 推荐架构：一个 Memory Core，三个 Runtime Adapter

Memory 能力拆成两部分：Runtime Adapter 负责接入各自框架；Memory Core 负责事件归一化、记忆提取、整理、检索和生命周期管理。后台 Dream Worker 与 Agent 的交互循环独立运行。

![统一 Agent Memory 架构：三个 Runtime Adapter 接入共享 Memory Core](/diagrams/agent-memory-reference-architecture.svg)

*图源：[HTML 版本](/diagrams/agent-memory-reference-architecture.html)。*

这张图表达的是逻辑职责，不要求第一版就部署成多个服务。个人开发环境可以是一个 Node.js 进程加 SQLite；团队环境可以将 API、Worker 和数据库分开运行。拆分应由并发、故障隔离和部署边界驱动，而不是先假设需要微服务。

### 4.1 Core 的职责和最小接口

Memory Core 先只需要五类能力：

| 接口 | 作用 | 典型调用方 |
| --- | --- | --- |
| `appendEvent` | 追加原始事件，保证可追溯和幂等 | Runtime Adapter |
| `extractCandidates` | 从一段经历中抽取有来源的候选记忆 | Capture Worker |
| `consolidate` | 去重、纠错、冲突处理和表示构建 | Dream Worker |
| `recall` | 根据任务、Scope 和预算检索记忆 | Runtime Adapter |
| `forget` | 退休或删除记忆，并同步清除派生索引 | 管理工具 / 用户 |

可以把它暴露为 TypeScript SDK、HTTP API 和 MCP Server。Pi 与 Copilot SDK 直接使用 TypeScript Client；DeepAgents 可以使用 Python Client 或 MCP。对外协议应当保持简单，不要让每个 Runtime 都了解 SQLite 表结构或 Dream Worker 的内部实现。

### 4.2 数据模型：保留来源、时间和作用范围

记忆系统至少需要区分 Event、Candidate 和 Memory Record 三种对象。

**MemoryEvent 是追加式原始事件。** 它记录事件 ID、Runtime、User、Project、Agent、Session、事件类型、发生时间、来源位置和必要的 Payload 引用。不要把工具调用失败、用户纠正和 Agent 最终回答简单合并成一段文本；这些事件的证据强度和用途不同。

**MemoryCandidate 是尚未晋升的知识主张。** 它保存提炼后的内容、类别、Scope、置信度、来源 Event ID、提取时间、所描述事实的有效时间、冲突关系和处理状态。Candidate 可以被拒绝、合并或等待进一步证据。

**MemoryRecord 是当前可检索的长期知识。** 它应保留来源引用、更新时间、有效时间和生命周期状态。旧事实不一定要物理覆盖；例如某个服务原来运行在 us-east-1，后来迁移到 eu-central-1，应把旧记录标记为已被替代，并保留它曾经有效的时间范围。

记忆类别可以从五种开始：Profile / Preference、Episodic、Semantic、Procedural 和 Decision。它们分别用于用户偏好、任务经历、稳定事实、操作经验和已经做出的设计或业务决策。当前执行计划和临时任务状态应留在 Session 或 Workflow State 中，不能都当成长久知识保存。

### 4.3 存储先简单，按检索需求逐步增加组件

第一版建议以 SQLite 或 PostgreSQL 为核心：

- 原始事件保存在追加式表或独立 JSONL 文件中，按 User、Project 和 Session 分区。
- 候选记忆和正式记忆保存结构化字段及来源引用。
- 使用 FTS5 或 PostgreSQL Full-Text Search 解决关键词、名称和精确事实查询。
- 只有当语义检索带来的收益经过评估后，再增加 Embedding 和向量索引。
- 只有需要实体关系、多跳路径或时间图查询时，再增加 Graphiti 或 Cognee 这样的图层。

不要在第一版同时引入 SQLite、PostgreSQL、Qdrant、Neo4j 和独立搜索服务。它们会让事件一致性、删除语义、迁移和备份复杂化。一个数据库先承担事件、结构化记忆和关键词检索，已经足够验证架构。

## 5. Dream Worker：如何把经历变成可信的长期记忆

Dream Worker 不应只是一个“把最近 N 条消息总结成 Markdown”的 Prompt。它需要一个有状态的处理流程。

![Dreaming 流程：从原始事件、候选事实到校验、合并、晋升和效果评估](/diagrams/agent-memory-dreaming-flow.svg)

*图源：[HTML 版本](/diagrams/agent-memory-dreaming-flow.html)。*

### 5.1 捕获与提取分开

Capture 只负责忠实地保留事件，不急于判断其长期价值。提取器可以在 Session Idle 后或达到事件阈值时工作，将可能值得保留的内容转成 Candidate。例如，用户明确说“这个仓库统一使用 pnpm”，它可能成为 Project Convention；工具连续失败后 Agent 找到可复现的修复方法，可能成为 Procedural Memory；用户纠正了某项偏好，则可能替换旧的 Profile 值。

不能把每次工具输出都变成记忆。大多数中间结果只是当前任务状态，未来可以重新从源码、数据库或工具中获得。优先保留那些无法轻易重建、而且对以后决策确实有价值的信息。

### 5.2 校验来源和时间冲突

候选事实应当能回到原始事件或外部来源。对于 Project Convention，检查它是否与仓库配置或实际命令冲突；对于技术结论，检查是否有成功执行记录；对于用户偏好，用户直接表达的证据应高于模型根据行为推断的偏好。

时间也不能只保存一个 `created_at`。至少要区分：

- `recorded_at`：系统什么时候发现或保存这条信息。
- `valid_from / valid_to`：这条事实描述的状态在什么时候有效。
- `last_confirmed_at`：最近一次得到验证的时间。

例如，今天记录的一条历史信息可能描述的是两年前的架构状态。若只根据记录时间排序，Agent 就会把旧事实误认为当前事实。

对于冲突候选，优先生成 Supersedes 或时间版本关系，而不是直接覆写。找不到足够证据时，保留冲突状态或拒绝晋升。记忆越重要，来源和时间约束越不能省略。

### 5.3 自动晋升，不要让人工审核成为默认阻塞点

`pi-sleep-agent` 的 T0/T1/T2 和人工 Promote 很适合做高风险记忆的治理参考，但个人助理或普通工程 Agent 不应让每条候选都等待人工确认。可以使用按风险分类的策略：

| 候选类型 | 默认策略 |
| --- | --- |
| 用户明确表达的稳定偏好 | 满足 Scope 和隐私规则后自动更新，保留用户原话来源 |
| 可复现的项目命令和工具用法 | 有成功执行证据后自动晋升 |
| 单次任务得到的技术推断 | 暂存为 Candidate，等待重复证据或后续验证 |
| 与已有记忆冲突的事实 | 标记 Supersedes / Conflict，必要时进一步验证 |
| 涉及权限、金融操作、隐私或安全策略的指令 | 不作为自动授权依据；遵守系统策略和审批边界 |

人工确认应该用于真正影响权限、风险或业务责任的事项，而不是用来弥补记忆系统无法处理不确定性的设计缺陷。需要审批的是操作授权，不是每一条知识记录。

### 5.4 记忆表示与检索索引分开维护

Memory Notes 积累到一定规模后，可以按主题生成 Wiki 页面、实体关系和反向链接。它们是从来源记录生成的派生表示，必须能够重新构建。不要让 Wiki 成为唯一事实来源，否则一次生成错误就可能扩散到所有检索入口。

检索可以逐步引入多种信号：精确关键词、语义相似度、实体关联、时间有效性和 Scope。只有在候选集足够小后才调用 Reranker。对个人偏好和项目约束，可以用很小的固定预算预加载；详细技术资料和历史经历则按任务按需加载。

### 5.5 评估记忆有没有实际帮助

Replay 不应该只是测试检索接口是否返回了结果。对一组真实任务或经过脱敏的历史任务，分别运行有记忆和无记忆的版本，比较最终任务结果、纠错次数、执行成本和错误类型。

建议至少测量四个指标：

- **Recall Quality**：正确记忆是否被找回，错误记忆是否被注入。
- **Freshness / Conflict**：陈旧事实和未处理冲突的比例。
- **Utility**：记忆对任务是 Helpful、Neutral 还是 Harmful。
- **Cost**：每一百轮交互的提取、Embedding、检索和 Dreaming 成本。

可以把每次 Replay 的结果写入评估日志，用于调整候选晋升门槛和检索策略。不能只追求记忆召回率；一个总能召回但经常过时或越权的记忆系统，并不是更好的记忆系统。

## 6. 安全、隔离与删除是 Memory Core 的一部分

记忆会长期影响 Agent 的行为，因此 Memory Store 本身也是一个新的输入信任边界。它不应因为内容被保存过，就自动拥有更高的指令优先级。

**Scope 隔离要在存储和查询两端执行。** User Memory、Project Memory、Agent Memory 和 Organization Memory 应有明确 Namespace 和 ACL。检索接口必须从可信身份上下文推导 Scope，不允许模型通过工具参数自行扩大检索范围。

**Provenance 必须参与可信度判断。** 用户直接表达、Agent 已验证的工具结果、外部网页和模型推测不能同等对待。来自不可信文档或外部页面的指令，应作为数据处理，不能因为被提炼进记忆就升级为系统指令。

**忘记需要定义真实删除语义。** 对过时内容，可以 Retire 或 Supersede；对用户明确要求删除的个人数据，则需要从主记录、向量索引、图索引、缓存和派生 Wiki 中同步删除，并按照 Transcript 保留策略处理来源记录。仅仅从 MEMORY.md 中删掉一行，而底层 SQLite、向量库和图数据库仍能搜到，不算完成删除。

**记忆故障不应阻止 Agent 工作。** 检索超时、Worker 崩溃或索引损坏时，Agent 应能够继续使用当前 Session 和正常工具完成任务；后台任务通过 Outbox、幂等事件 ID 和重试处理恢复。对于检索失败，要能区分“没有记忆”和“记忆服务不可用”，不能让两者表现为同一个空结果。

## 7. 实施路线：先跑通一个 Runtime，再扩展到另外两个

不建议同时把三个 Runtime、三种存储和完整知识图谱全部上线。最短的验证路径如下。

### Phase 1：用 Pi 完成端到端试点

先在 Pi 上运行 `pi-hermes-memory`，观察自动学习、纠错、Session 搜索和 Project Scope 的实际效果。再独立运行 `pi-sleep-agent`，重点评估它的 T0/T1/T2、夜间整理和 Replay。两个扩展先分别试验，不要同时写入同一个目录。

试点期间定义一小组固定任务：用户偏好跨 Session 复用、项目命令复用、一次错误修复被再次使用、旧配置变更后不再推荐旧命令、用户要求忘记某条个人信息。先验证正确性和隔离，再测量 Token 和 LLM 成本。

### Phase 2：提取共享的 Memory Contract

根据 Pi 试点的真实事件定义统一 TypeScript 数据契约，包括 Event、Candidate、MemoryRecord、Scope、Source Reference 和 Context Plan。第一版用 SQLite + FTS5，提供本地 SDK 和简单 HTTP / MCP API。Dream Worker 使用独立模型调用，不要求与交互式 Agent 使用同一模型。

这一阶段先不引入完整知识图谱。只要能稳定完成事件追加、候选提取、证据校验、记忆更新、检索和删除，就已经形成了可供其他 Runtime 复用的 Core。

### Phase 3：接入 Copilot SDK

编写 Copilot Adapter：SessionStart 做 Context Injection；Streaming Events 负责完整事件捕获；Session Idle 和 Session End 负责排队、Flush 和后台触发。要特别测试 Session Resume、工具失败、子 Agent 和事件重复投递。

Copilot Adapter 不应直接访问数据库表，而是通过 Memory SDK 调用统一接口。这样以后升级 Copilot CLI 或 SDK 时，变化只会落在 Adapter 层。

### Phase 4：接入 DeepAgents

使用 LangGraph Store 保存长期 Memory Files，并定义 User / Project / Agent Namespace。交互过程继续由 Thread Checkpointer 管理。独立 Consolidation Agent 负责跨 Thread 的历史归纳，由 LangGraph Cron 或自托管调度器定期触发。

如果使用 LangMem，就让它承担候选提取和反思的职责；如果使用自定义 Consolidation Agent，就不要再让另一套 Reflection Worker 同时改写同一份 Memory。无论选哪种方式，最终更新都应通过 Memory Core 的写入接口完成。

### Phase 5：再考虑图谱和共享服务

当实际查询开始需要跨多个实体、多段关系和时间状态时，再引入 Graphiti 或 Cognee。若团队要求多个 Runtime 共享记忆、统一审计、集中删除和多租户隔离，则把 Memory Core 从本地 SQLite 升级为 Postgres / 独立服务，并提供 HTTP 和 MCP 双入口。

此时再决定是否部署向量数据库、图数据库和独立检索服务。不要在评估前先为它们付出部署、备份、权限和一致性成本。

## 8. 三种 Runtime 的最终选型建议

| 维度 | Copilot SDK | DeepAgents | pi.dev / pi-mono |
| --- | --- | --- | --- |
| 原生长期记忆 | 无完整 Memory Engine | Filesystem + StoreBackend | 通过 Extension / 社区 Package |
| 自动捕获 | Events + Hooks | Agent State / Tools / Middleware | Extension Events |
| 上下文注入 | `onSessionStart` | `memory` 文件、Backend、Middleware | `before_agent_start` |
| 后台整理 | 应用自建 Worker | Consolidation Agent + Cron | 扩展或外部 Dream Worker |
| 可直接参考的项目 | Memory Core Adapter | LangMem、官方 Consolidation 示例 | pi-hermes-memory、pi-sleep-agent |
| 推荐定位 | 企业应用中的 Runtime Adapter | 复杂 Agent 的执行和后台管理框架 | 本地试点和快速验证 |

**如果当前主要目标是验证 Memory 机制，先选 Pi。** `pi-hermes-memory` 能快速验证自动捕获与跨 Session 检索，`pi-sleep-agent` 能验证候选记忆、后台整理和 Replay。它们提供了真实可运行的实现，不需要先写一套空框架。

**如果要把 Memory 做成企业内部公共能力，Copilot SDK 是合适的接入对象。** 通过其公开事件和 Hooks 接入统一 Memory API，避免依赖 Copilot CLI 私有文件结构。对于应用已经使用 Copilot SDK 的场景，这条路径改动范围小，也便于和现有审计、身份和业务系统集成。

**如果 Agent 本身是基于 LangGraph 构建，优先使用 DeepAgents 的 Store 和 Memory Files。** 它的长期记忆与 Thread 状态边界清楚，官方也给出了后台 Consolidation Agent 的落地方式。LangMem 可以按需引入，不必为一个提取函数再建立第二套 Memory Store。

## 9. 结论：Claude Code 不是必需的研究对象

Anthropic 的文章给出了有价值的记忆组织思路，但它并没有要求开发者复制 Claude Code。当前已经有足够多的公开接口和开源实现，可以分别覆盖事件捕获、长期存储、知识组织、后台 Dreaming 和上下文注入。

从工程上看，最重要的决策不是选哪一种向量库，而是明确谁负责记录原始经历、谁负责把候选知识变成长期记忆、谁能修改记忆、记忆如何回溯来源，以及错误记忆如何被纠正和删除。把这些边界定义清楚后，Copilot SDK、DeepAgents 和 Pi 就只是不同的 Runtime Adapter。

建议先以 Pi 作为验证环境，抽取一套 TypeScript Memory Contract，再把同一个 Core 接入 Copilot SDK；DeepAgents 通过 LangGraph Store 和 Consolidation Agent 接入。第一版只使用 SQLite / FTS5 和一个后台 LLM Worker，等 Replay 证明语义检索或知识图谱确实改善任务结果后，再增加相应组件。这样既能尽快得到可运行系统，也不会把某个 Agent Framework 的内部实现变成长期架构依赖。

## 参考资料

### Anthropic
- [Components of Agent Memory](https://www.anthropic.com/research/components-of-agent-memory)
- [Managed Agents Memory](https://platform.claude.com/docs/en/managed-agents/memory)
- [Sleep-time Compute](https://arxiv.org/abs/2504.13171)

### GitHub Copilot SDK
- [GitHub Copilot SDK](https://github.com/github/copilot-sdk)
- [Session Hooks](https://github.com/github/copilot-sdk/blob/main/docs/hooks/hooks-overview.md)
- [Session Lifecycle Hooks](https://github.com/github/copilot-sdk/blob/main/docs/hooks/session-lifecycle.md)
- [Streaming Session Events](https://github.com/github/copilot-sdk/blob/main/docs/features/streaming-events.md)
- [Session Persistence](https://github.com/github/copilot-sdk/blob/main/docs/features/session-persistence.md)

### LangChain
- [DeepAgents](https://github.com/langchain-ai/deepagents)
- [DeepAgents Memory](https://docs.langchain.com/oss/python/deepagents/memory)
- [DeepAgents Context Engineering](https://docs.langchain.com/oss/python/deepagents/context-engineering)
- [LangMem](https://github.com/langchain-ai/langmem)

### Pi / pi-mono
- [Pi Coding Agent](https://github.com/earendil-works/pi)
- [Pi Extension API](https://pi.dev/docs/latest/extensions)
- [Pi SDK](https://pi.dev/docs/latest/sdk)
- [Pi Compaction](https://pi.dev/docs/latest/compaction)
- [pi-hermes-memory](https://github.com/chandra447/pi-hermes-memory)
- [pi-sleep-agent](https://github.com/aydinnyunus/sleep)
- [pi-memory](https://github.com/jayzeng/pi-memory)
- [pi-cognee](https://github.com/kerryhatcher/pi-cognee)

### Memory Engine 与知识图谱
- [Mem0](https://github.com/mem0ai/mem0)
- [Hindsight](https://github.com/vectorize-io/hindsight)
- [Cognee](https://github.com/topoteretes/cognee)
- [Graphiti](https://github.com/getzep/graphiti)
- [Letta](https://github.com/letta-ai/letta-code)
- [OpenClaw Memory](https://docs.openclaw.ai/concepts/memory)
- [OpenClaw Dreaming](https://docs.openclaw.ai/concepts/dreaming)
