---
author: W
featured: false
draft: false
description: Claude.md 最佳实践指南：如何构建高效的 AI 编码助手上下文
pubDatetime: 2026-02-16T01:23:45Z
title: Claude.md 最佳实践：构建 AI 编码助手的"外脑"
tags:
  - llm
  - claude
  - productivity
---

# 问题

如何写一个好的 `CLAUDE.md`？

在 AI 辅助编程（如 Claude Code, Cursor, Windsurf）日益普及的今天，`CLAUDE.md`（或 `AGENTS.md`, `.cursorrules`）成为了连接人类意图与 AI 执行力的关键桥梁。它不仅仅是一个文档，更是 AI 的**项目特定的系统提示词**。

# 观点

## Claude.md 标准结构

一个高效的 `CLAUDE.md` 应该像一份写给新入职高级工程师的"入职指南"，专注于**What** (项目是什么), **Why** (为什么这么做), 和 **How** (具体怎么做)。

建议结构：

1.  **项目概览 (Project Overview)**
    - **核心目标**：一句话说明项目解决什么问题。
    - **业务背景**：帮助 AI 理解代码背后的业务逻辑（例如："这是一个高频交易系统，延迟比吞吐量更重要"）。

2.  **技术栈 (Tech Stack)**
    - **精确版本**：必须指定版本号（如 `Next.js 14 (App Router)`, `React 19`），避免 AI 使用过时或未发布的 API。
    - **关键选型**：列出 ORM、状态管理、样式库等具体选择。

3.  **常用命令 (Common Commands)**
    - **完整指令**：提供 `Build`, `Test`, `Lint`, `Deploy` 的完整命令字符串。
    - **环境差异**：如果有本地与 CI 环境的区别，需注明。

4.  **架构与目录 (Architecture)**
    - **目录映射**：解释关键目录的职责（如 `src/domain` vs `src/infrastructure`）。
    - **设计模式**：明确项目中使用的特定模式（如 "Hexagonal Architecture", "Repository Pattern"）。

5.  **代码风格与规范 (Code Style)**
    - **命名约定**：PascalCase vs camelCase。
    - **最佳实践**：项目特定的 Do's and Don'ts。

## Claude.md 不应该包含什么，应该包含什么？

### ✅ 应该包含 (High Value Context)

- **"Unknown Unknowns"**：AI 无法从代码本身推断出的信息（如："我们使用自定义的构建脚本 `scripts/build.py` 而不是 `npm build`"）。
- **负面约束 (Negative Constraints)**：明确"禁止做什么"（如："严禁使用 `any` 类型"，"不要引入新的 npm 包，除非必要"）。
- **隐性知识**：团队约定俗成但未写在代码里的规则。
- **验证步骤**：明确告诉 AI 完成任务后如何自测。

### ❌ 不应该包含 (Low Value Noise)

- **通用文档**：不要复制粘贴整个 React 或 TypeScript 的官方文档。AI 已经训练过这些知识了。
- **显而易见的信息**：不要写 "我们使用 Git 进行版本控制"。
- **敏感信息**：**绝对不要**包含 API Key、密码或数据库连接串。
- **过细的实现细节**：不要教 AI 如何写 `for` 循环，除非有特殊的性能要求。

## Claude.md 如何做到自我进化？

`CLAUDE.md` 不应是一成不变的。建立 **"错误 -> 纠正 -> 固化"** 的反馈循环：

1.  **观察 (Observe)**：当 Agent 犯错（例如引用了错误的路径，或者使用了被弃用的库）时。
2.  **纠正 (Correct)**：在对话中指出错误，并提供正确做法。
3.  **固化 (Solidify)**：**立即**将这条规则添加到 `CLAUDE.md` 中。
    - _Tip_: 可以直接对 Claude 说："你刚才犯了个错，请把避免这个错误的规则更新到 CLAUDE.md 中。"
4.  **定期审查**：每隔一段时间（如每周），让 Claude 阅读 `CLAUDE.md` 并询问："有哪些规则是多余的？有哪些可以合并？"

## Claude.md 小tips

1.  **分层配置 (Hierarchy)**：
    - **Global (`~/.claude/CLAUDE.md`)**：存放个人的编码习惯（如 "总是使用中文回答"，"偏好函数式编程"）。
    - **Project (`./CLAUDE.md`)**：存放项目特定的规则。
    - **Directory (Sub-CLAUDE.md)**：在大型 Monorepo 中，可以在子目录下放置特定的规则文件（虽然 Claude Code 原生主要读取根目录，但可以通过引用或提示词让其关注子目录规则）。

2.  **上下文预算 (Context Budget)**：
    - 前沿模型的注意力是有限的。保持 `CLAUDE.md` 精简（Less is More）。
    - 利用**首尾效应**：将最重要的核心原则放在文件最开头或最结尾。

3.  **使用 Hooks 增强**：
    - 对于必须执行的硬性规则（如 Lint 检查），与其在 Markdown 里苦口婆心劝 AI 执行，不如配置 `pre-commit` hooks 或 Claude Code 的工具链强制执行。

4.  **安全栅栏**：
    - 在 `CLAUDE.md` 中明确："在读取 `.env` 或配置文件前，必须请求用户许可"，防止意外泄露 Token。

5.  **金丝雀测试 (The Canary Test)**：
    - 在 `CLAUDE.md` 中埋入一个无害但明显的指令，例如："总是称呼我为 [特定的名字]"（Hacker News 上有人用 "Mr. Tinkleberry"）。
    - **作用**：如果 Claude 停止使用这个称呼，这就通过一个明显的信号告诉你，它可能已经"遗忘"或忽略了 `CLAUDE.md` 中的其他重要规则（即上下文过载或注意力丢失）。这时候你需要提醒它重新阅读规则。

## 一个金融服务的技术公司相关项目的示例

```markdown
# CLAUDE.md - FinTech Core System

## Project Overview

这是一个高频交易系统的核心结算模块。
**关键原则**：

1. **正确性 > 性能**：资金计算绝对不能出错，涉及金额必须使用 `BigDecimal` 或 `Money` 模式，严禁使用浮点数。
2. **可审计性**：所有关键操作必须记录 Audit Log。
3. **安全性**：严禁在日志中打印 PII（个人身份信息）或卡号。

## Tech Stack

- Java 21 (LTS)
- Spring Boot 3.2
- PostgreSQL 16 (TimescaleDB 插件)
- jOOQ (Type-safe SQL)

## Coding Standards

- **金额处理**：必须使用 `com.company.core.money.Money` 类。
  - ❌ `double amount = 100.00;`
  - ✅ `Money amount = Money.of("100.00", Currency.USD);`
- **异常处理**：不要吞掉异常。所有业务异常必须继承自 `BaseBizException` 并包含错误码。
- **并发**：使用 `Virtual Threads` (Project Loom) 处理 I/O 密集型任务。

## Common Commands

- **Build & Test**: `./mvnw clean verify -Pci` (包含集成测试)
- **Local Run**: `./mvnw spring-boot:run -Dspring-boot.run.profiles=local`
- **DB Migration**: `./mvnw flyway:migrate`

## Verification

在提交代码前，你必须：

1. 运行 `./mvnw test` 确保单元测试通过。
2. 检查是否引入了新的依赖（需经过安全扫描）。
```

# 参考

- [Hacker News: Writing a good Claude.md](https://news.ycombinator.com/item?id=46098838)
  - **关注点**：讨论了 "Context Bloat"（上下文臃肿）问题；提出了在不同子目录使用多个 `.md` 文件的分层策略；强调 `CLAUDE.md` 是写给机器看的，不是给人看的。

- [Anthropic: Building Skills for Claude](https://resources.anthropic.com/hubfs/The-Complete-Guide-to-Building-Skill-for-Claude.pdf?hsLang=en)
  - **关注点**：官方指南，强调清晰、正向的指令，以及通过 Few-Shot（少样本）Prompting 来规范输出格式。

- [GitHub: shanraisshan/claude-code-best-practice](https://github.com/shanraisshan/claude-code-best-practice)
  - **关注点**：非常详细的实践总结。提出了 **Global vs Project** 配置的分离；使用 `MEMORY.md` 给子 Agent 提供持久化记忆；以及集成 MCP 工具（如 Chrome DevTools）进行验证。

- [Reddit: CLAUDE.md tips](https://www.reddit.com/r/ClaudeCode/comments/1p0jjlb/claudemd_tips/)
  - **关注点**：社区经验分享。建议定期让 Claude 自我审查并优化 `CLAUDE.md`；提到了安全隐患，建议在文档中明确禁止输出 Secrets。

- [Arize AI: Optimizing Claude Code with Prompt Learning](https://arize.com/blog/claude-md-best-practices-learned-from-optimizing-claude-code-with-prompt-learning/)
  - **关注点**：硬核技术流。介绍如何使用 "Prompt Learning" 算法（Meta-Prompting）结合 SWE-bench 测试集，自动迭代优化 `CLAUDE.md` 中的规则，以达到最高的代码通过率。

- [Dometrain: Creating the Perfect CLAUDE.md](https://dometrain.com/blog/creating-the-perfect-claudemd-for-claude-code/)
  - **关注点**：强调 "Single Source of Truth"（单一事实来源）原则，建议将项目的所有上下文都收敛到这个文件中。

- [HumanLayer: Writing a good CLAUDE.md](https://www.humanlayer.dev/blog/writing-a-good-claude-md)
  - **关注点**：提出了 "Context Budget"（上下文预算）概念，指出前沿模型能有效遵循的指令数量约为 150-200 条，多了会遗忘（Lost in the Middle）。
