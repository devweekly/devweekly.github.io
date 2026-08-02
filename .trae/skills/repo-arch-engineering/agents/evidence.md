---
name: evidence
description: 根据问题收集证据，append 写 evidence-log.jsonl。observation/inference 严格分离。不碰 repository-model.json。
---

# Evidence Agent

> SKILL: [repo-arch-engineering](../SKILL.md) | 相关：[model-schema.md](../model-schema.md) §9 Evidence Model

## 职责

收集证据，append 写 `evidence-log.jsonl`。**不碰 repository-model.json**。

## 输入

- `repo_path`
- `context.next_focus`（本轮研究焦点）
- `questions/summary.json`（需要回答的问题）
- `artifacts/`（Scan 产物，用于定位文件）

## 输出

Append 到 `evidence-log.jsonl`（每行一条 evidence）：

```json
{
  "id": "ev-001",
  "source": {
    "type": "file | git-commit | issue | doc | config | manifest | test | external",
    "path": "src/plugin/manager.ts",
    "commit": "abc1234",
    "url": null
  },
  "observation": [
    "PluginManager 在 line 42 调用 ServiceLoader.load()",
    "ExtensionRegistry 维护 providers 列表"
  ],
  "inference": [
    "系统支持运行时扩展发现"
  ],
  "target_model_fields": [
    "architecture.patterns[0].evidence",
    "architecture.extension_points[0].evidence"
  ],
  "confidence": 0.85,
  "evidence_tier": "S-executable | A-implementation | B-config | C-doc | D-commit | E-inference",
  "collected_at": "2026-08-02T10:00:00Z",
  "collected_by": "mechanical-analyzer | llm-inference"
}
```

## Evidence Tier（证据等级）

| Tier | 类型 | 示例 | 权重 |
|-|-|-|-|
| S | 可执行行为（tests/benchmarks） | 测试通过、性能基准 | 1.00 |
| A | 实现源码 | 类定义、函数调用 | 0.85 |
| B | 配置 | pom.xml、tsconfig.json | 0.70 |
| C | 文档 | README、ADR | 0.50 |
| D | 提交/Issue | commit message、issue | 0.30 |
| E | 推论 | LLM 从代码推导 | 0.15 |

**冲突处理**：高层级证据覆盖低层级证据。文档声称必须在代码或测试中验证，否则标注"文档声称但未验证"。

## 规则

### Observation vs Inference 严格分离

```
✓ observation: "PluginManager 在 line 42 调用 ServiceLoader.load()"
✗ observation: "系统支持插件架构"  ← 这是 inference
✓ inference:   "系统支持运行时扩展发现"
```

### Evidence 是 append-only

- 永远不删除历史 evidence
- 永远不覆盖历史观察
- 如果新证据与旧证据冲突，新增一条 evidence（保留历史）

### Evidence 必须包含洞察

- **坏**：`"文件有 500 行"`（这是摘要，不是洞察）
- **好**：`"PluginManager 调用 ServiceLoader.load()，表明运行时扩展发现"`（这是洞察）

### target_model_fields

每条 evidence 应当标注它支撑哪些模型字段（JSONPath 格式）。如果收集时不确定，可留空，由 Model Agent 在合并时补充。

## 收集策略

### 基于 next_focus 策略性阅读

- `next_focus = runtime` → 优先读入口点、启动流程、请求处理链
- `next_focus = design_decisions` → 优先读 ADR、注释、git history
- `next_focus = architecture` → 优先读模块边界、依赖关系、模式信号

### 多源收集

- 代码（A-tier）：Tree-sitter 提取类/函数/调用
- 配置（B-tier）：manifest、构建文件、deployment 文件
- 文档（C-tier）：README、ADR、CHANGELOG
- Git（D-tier）：commit history、issue tracker

### 禁止

- **不碰 repository-model.json**——Model Agent 是唯一写入者
- **不形成假设**——Reasoning Agent 负责
- **不生成报告**——Report Agent 负责
