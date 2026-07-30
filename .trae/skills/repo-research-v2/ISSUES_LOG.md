# repo-research-v2 Issue Log

> 从实际运行与代码审查中发现的 bug、修复说明与参考位置。

---

## P0 Issues

### RR2-P0-001: 未定义变量导致运行时崩溃

- **严重级别**: `P0`
- **文件**: `research.mjs`
- **现象**: 写 evidence 日志路径时使用了 `workingDir`，而非 `workDir`，在报告阶段触发运行时错误。
- **状态**: 已修复
- **修复说明**: 统一替换为 `workDir`；在写入前确保 `artifacts` 目录存在；evidence 条目写入非空 `key_findings` 并标注强度。
- **参考**:
  - `.trae/skills/repo-research-v2/research.mjs:743`

### RR2-P0-002: 质量通过前提前推进 checkpoint commit

- **严重级别**: `P0`
- **文件**: `research.mjs`
- **现象**: `last_analyzed_commit` 在 delta 分析阶段被提前更新，违反延迟提交 checkpoint 语义。
- **状态**: 已修复
- **修复说明**: `last_analyzed_commit` 仅在质量通过并发布报告后更新；delta 阶段只写入 `analysis_target_commit` 作为 pending target。
- **参考**:
  - `.trae/skills/repo-research-v2/research.mjs:250`
  - `.trae/skills/repo-research-v2/research.mjs:590`

### RR2-P0-003: Orchestrator 控制流偏离多阶段契约

- **严重级别**: `P0`
- **文件**: `SKILL.md`, `research.mjs`
- **现象**: 原实现为线性流程，未完整体现收敛判断与失败回退循环。
- **状态**: 部分修复
- **修复说明**: 新增 planner/research 迭代（MAX_ROUNDS）与 quality 失败后的定向重试路径；gate 失败时直接退出并保留 `report-draft.md`。
- **剩余差距**: 脚本仍直接持久化较多状态字段，尚未完全收敛到 Workspace Agent 边界。
- **参考**:
  - `.trae/skills/repo-research-v2/SKILL.md:16`
  - `.trae/skills/repo-research-v2/research.mjs:784`

---

## P1 Issues

### RR2-P1-001: 绕过 report-draft/report 发布所有权链

- **严重级别**: `P1`
- **文件**: `research.mjs`
- **现象**: 报告曾直接写入 `report.md`，绕过 draft + publish 语义。
- **状态**: 已修复
- **修复说明**: 报告先写入 `report-draft.md`；质量通过后再 rename 发布为最终报告。
- **参考**:
  - `.trae/skills/repo-research-v2/research.mjs:583`
  - `.trae/skills/repo-research-v2/research.mjs:590`

### RR2-P1-002: 质量门禁集合与规范不一致

- **严重级别**: `P1`
- **文件**: `quality.md`, `gated-checks.mjs`
- **现象**: 实现中缺少 `surprise_gate`、`design_space_gate`、`final_check`。
- **状态**: 已修复
- **修复说明**: 补充 `surprise_gate`、`design_space_gate`，并在聚合结果中计算 `final_check`。
- **参考**:
  - `.trae/skills/repo-research-v2/agents/quality.md:49`
  - `.trae/skills/repo-research-v2/gated-checks.mjs:516`

### RR2-P1-003: Gate 结果未驱动流程决策

- **严重级别**: `P1`
- **文件**: `research.mjs`
- **现象**: 此前 gate 失败仅打印输出，不影响执行控制流。
- **状态**: 已修复
- **修复说明**: 增加质量通过/失败分支，失败时定向重试，通过时发布。
- **参考**:
  - `.trae/skills/repo-research-v2/research.mjs:816`

### RR2-P1-004: quality_gate 前置检查自引用

- **严重级别**: `P1`
- **文件**: `gated-checks.mjs`
- **现象**: 前置条件要求 `quality_gate` 全 true 后才运行 gate，形成自举矛盾。
- **状态**: 已修复
- **修复说明**: 改为结构性前置条件（`design_space` 非空）。
- **参考**:
  - `.trae/skills/repo-research-v2/gated-checks.mjs:597`

### RR2-P1-005: Evidence 日志条目为空或信息不足

- **严重级别**: `P1`
- **文件**: `research.mjs`
- **现象**: 条目曾以空 `key_findings` 写出，削弱下游报告可追溯性。
- **状态**: 已修复
- **修复说明**: 当前已写入非空 findings 并标注强度；并增加 `coverage_delta` 字段占位。
- **参考**:
  - `.trae/skills/repo-research-v2/research.mjs:745`

---

## P2 Issues

### RR2-P2-001: CLI 参数检查时序错误

- **严重级别**: `P2`
- **文件**: `research.mjs`
- **现象**: 缺参时先执行 `resolve(args[0])`，导致类型错误而非 usage 提示。
- **状态**: 已修复
- **修复说明**: 先校验 `repoArg` 再执行 `resolve`。
- **参考**:
  - `.trae/skills/repo-research-v2/research.mjs:629`
