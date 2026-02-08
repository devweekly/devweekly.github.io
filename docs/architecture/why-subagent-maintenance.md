# 架构报告：AGENTS.md 自我维护机制采用 Subagent 模式的必然性分析

## 1. 执行摘要 (Executive Summary)

本报告分析了在 `OpenCode` 环境下，通过独立的 `agents-maintainer` 子代理来管理项目规则（AGENTS.md）的架构决策。虽然 `CLAUDE.md` 开启了“项目规则文件”的先河，但将其维护逻辑外包给专门的子代理，是解决 **Token 膨胀**、**注意力竞争** 和 **权限隔离** 问题的关键进化。

---

## 2. 核心架构对比 (Architectural Paradigms)

### 2.1 Monolithic Rules (单体规则模式 - CLAUDE.md)
在这种模式下，所有的维护指令（例如：“如果修改了 package.json，请更新 Tech Stack 章节”）都直接写在规则文件中。
- **缺点**：维护逻辑（关于文档的指令）与业务逻辑（关于代码的指令）混杂在一起。
- **后果**：主代理（Agent）的上下文窗口被大量与当前编码任务无关的“元指令”占据。

### 2.2 Agentic Orchestration (代理编排模式 - Subagent)
我们将维护逻辑封装在 `.opencode/agents/agents-maintainer.md` 中，主 `AGENTS.md` 只保留一个高层级的“操作协议”。
- **优点**：主代理只需记住“变更时调用维护者”这一条核心原则。
- **后果**：实现了真正的关注点分离（Separation of Concerns）。

---

## 3. 为什么要用 Subagent？(The "Why")

### 3.1 上下文窗口的最优化 (Token Efficiency)
*   **CLAUDE.md 的“Token 税”**：如果你有 100 行复杂的文档维护规则，每一轮对话、每一个思考步骤，AI 都会被迫重新加载这 100 行。在长对话中，这会极快地消耗 Token 并导致 AI 遗忘早期的业务需求。
*   **Subagent 的“延迟加载”**：详细的维护步骤、映射表和格式规范只有在 `agents-maintainer` 被唤起时才会进入内存。主 Agent 在写代码时完全不需要知道“维护日志的 ISO 8601 格式要求”。

### 3.2 专家模型的专业化 (Expert Specialization)
*   **参数定制**：维护 Agent 可以配置为低 `temperature`（0.1），确保文档生成的严谨性和格式一致性。而主 Agent 可以使用稍高的 `temperature` 来处理创造性的编码任务。
*   **工具聚焦**：`agents-maintainer` 拥有专门用于文档处理的工具集指令。它不需要感知 `pnpm dev` 这种开发指令，从而降低了误操作的概率。

### 3.3 权限隔离与安全 (Permission Sandboxing)
*   **最小权限原则**：我们可以为子代理设置极其严格的权限。例如，禁止它运行任何 `bash` 命令，只允许 `edit` 和 `write` 指定的文件。
*   **防范风险**：这防止了 AI 在尝试“自动更新文档”时，错误地触发了清理脚本或部署脚本。

---

## 4. 协作逻辑：从“文档”到“操作系统”

通过 Subagent 模式，`AGENTS.md` 的角色发生了根本性转变：

1.  **它不再只是说明书**：它变成了项目的 **内核配置 (Kernel Config)**。
2.  **强制性协议**：主 Agent 将 `AGENTS.md` 视为必须遵守的“法律”。
3.  **任务委托 (Delegation)**：当“法律”要求更新自身时，主 Agent 像调用系统 API 一样调用维护 Agent。这种分层结构让 AI 能够处理比单文件模式复杂得多的项目规模。

---

## 5. 结论 (Conclusion)

单文件模式（CLAUDE.md）适用于小型或简单的规则集。但当项目进入生产级规模，需要严格的格式控制、多章节同步和变更日志维护时，**Subagent 模式是实现“自治代理”的唯一途径**。它保证了主代理在执行编码任务时的纯净性，同时又确保了项目资产（文档）能够同步进化。
