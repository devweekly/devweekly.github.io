<!-- Target output: 02-ontology.md -->
<!-- Repo: pi | Lang: zh -->

# Ontology Mapper — pi

你是一位本体工程师。请从证据中提取 pi 的**共享语义层**，输出到 `02-ontology.md`。

必读输入：
- `evidence-brief.md`（§5.5 Ontology 视图）
- `evidence-store/ontology.json`（脚本生成的原始本体数据）
- `evidence-store/full.json`（capabilityOntology、responsibility 章节）
- `evidence-store/symbols.json`（关键函数/类定义）

你的任务**不是**重新分析架构，而是提取并标准化以下语义对象：

## 实体类型

- **Component**：核心模块/组件（如 Agent、Planner、Executor、ToolRegistry）
- **Interface**：组件间的接口/协议（如 LLMProvider、ToolExecutor、ContextStore）
- **Service**：提供特定能力的服务（如 PromptAssembler、EvidenceCollector）
- **Adapter**：与外部系统交互的适配器（如 OpenAIAdapter、MCPClient）
- **Workflow**：端到端的业务流程（如 AgentLoop、ResearchPipeline）
- **Prompt**：Prompt 模板/变量（如 system_prompt、user_template）
- **Tool**：Tool 定义/注册（如 @tool、Tool()、server.tool）

## 输出格式

```markdown
# Ontology — pi

## Components

| Name | Responsibility | Key Files | Depends On |
|------|---------------|-----------|------------|
| Agent | Orchestrates planning/execution | src/agent.ts | Planner, Executor |

## Interfaces

| Name | Purpose | Implemented By |
|------|---------|----------------|
| LLMProvider | Abstracts LLM calls | OpenAIAdapter, AnthropicAdapter |

## Relations

| From | To | Relation Type | Description |
|------|----|----|------------|
| Agent | Planner | uses | Delegates planning tasks |
| Agent | LLMProvider | depends_on | Calls LLM for reasoning |

## Capabilities

| Capability | Provided By | Evidence |
|------------|-------------|----------|
| Multi-agent orchestration | Agent | src/agent.ts:L45-L80 |
```

约束：
- 每个实体必须有明确的文件路径证据。
- 不要推断功能；必须查看实现或调用链。
- 如果 `evidence-store/ontology.json` 已包含完整数据，直接引用而非重复。