# Enterprise Research Agent 精简计划

## 目标

在**不损失任何功能**的前提下，精简 `enterprise-research-agent` 的代码和文档，提高可读性和可维护性。

## 现状分析

| 文件 | 当前行数 | 精简目标 | 预期缩减 |
|------|---------|---------|---------|
| `research.mjs` | 2827 行 | ~2200 行 | ~22% |
| `SKILL.md` | 1076 行 | ~600 行 | ~44% |

### 冗余来源分析

#### research.mjs

1. **文件头注释（1-56行）**：56行详细注释，可精简为10-15行
2. **Section 注释块（如 62-67行）**：每个 section 都有3-5行注释，可合并精简
3. **printUsage()（1741-1913行）**：173行的使用说明，可精简为80行以内
4. **CLI 命令重复模式**：每个命令都重复 `loadSession → 操作 → saveSession` 模式
5. **`argValue` 重复调用**：每个命令中多次调用 `argValue` 解析参数
6. **冗余的辅助函数**：如 `_entityRationale`、`_overallRationale` 等可以内联或精简
7. **重复的 console.log 格式**：各命令输出格式不一致，可统一

#### SKILL.md

1. **重复的概念解释**：同一概念在多个章节重复描述
2. **冗余的表格**：部分表格可以合并或简化
3. **大量示例代码**：CLI 示例占比过大，可精简
4. **重复的设计原则**：Design Principles 与 Research Heuristics 有重叠
5. **边界章节（963-978行）**：16条边界规则，可精简合并

## 精简方案

### 一、research.mjs 精简

#### 1. 移除冗余注释

| 位置 | 当前 | 目标 | 节省行数 |
|------|------|------|---------|
| 文件头注释（1-56） | 56行 | 12行 | 44 |
| Section 注释块 | 共 ~60行 | 共 ~20行 | 40 |
| 代码行内注释 | 共 ~80行 | 移除大部分 | 60 |
| **小计** | - | - | **144** |

**策略**：
- 文件头保留核心设计理念（5-6行）
- Section 注释改为单行描述
- 移除所有 `// ----- Entity -----` 这类分隔注释
- 移除代码行内的描述性注释（如 `// Evidence count`）

#### 2. 精简 printUsage()

| 位置 | 当前 | 目标 | 节省行数 |
|------|------|------|---------|
| Commands 列表 | ~100行 | ~50行 | 50 |
| Options 列表 | ~60行 | ~30行 | 30 |
| Examples | ~60行 | ~20行 | 40 |
| **小计** | - | - | **120** |

**策略**：
- 合并命令分组，减少空行
- Options 使用紧凑格式（一行多项）
- 保留2-3个核心示例，移除重复模式

#### 3. 提取 CLI 参数解析公共逻辑

当前每个命令都重复：
```javascript
const s = loadSession(sessionFile);
// ... 操作 ...
saveSession(s, sessionFile);
```

**策略**：创建 `withSession(fn)` 高阶函数，统一处理 load/save：
```javascript
function withSession(sessionFile, fn) {
  const s = loadSession(sessionFile);
  const result = fn(s);
  saveSession(s, sessionFile);
  return result;
}
```

**节省行数**：约 80 行（每个命令节省 2-3 行，共36个命令）

#### 4. 创建参数解析辅助函数

当前每个命令重复调用 `argValue`：
```javascript
const text = argValue(argv, '--text');
const type = argValue(argv, '--type');
const evidenceIds = parseList(argValue(argv, '--evidence'));
```

**策略**：创建 `parseArgs(argv, spec)` 函数：
```javascript
function parseArgs(argv, spec) {
  const out = {};
  for (const [key, parser] of Object.entries(spec)) {
    const val = argValue(argv, key);
    out[key.replace('--', '')] = parser ? parser(val) : val;
  }
  return out;
}
```

**节省行数**：约 100 行

#### 5. 内联小辅助函数

| 函数 | 当前行数 | 处理方式 | 节省行数 |
|------|---------|---------|---------|
| `_entityRationale`（1128-1137） | 10行 | 内联到调用处 | 10 |
| `_overallRationale`（1139-1149） | 11行 | 内联到调用处 | 11 |
| `_scoreToLevel`（1122-1126） | 5行 | 内联或简化 | 5 |
| **小计** | - | - | **26** |

### 二、SKILL.md 精简

#### 1. 合并重复概念

| 章节 | 处理方式 | 节省行数 |
|------|---------|---------|
| Research Heuristics（67-83行） | 合并到 Design Principles（937-960行） | ~40 |
| Research Contract vs 边界（963-978行） | 边界规则精简为5条核心 | ~25 |
| CLI 命令文档（546-665行） | 移除详细 CLI 示例，保留命令列表 | ~80 |
| **小计** | - | - | **145** |

#### 2. 精简示例和表格

| 内容 | 当前行数 | 目标 | 节省行数 |
|------|---------|------|---------|
| Vendor Research 示例（984-995） | 12行 | 精简为6行 | 6 |
| Regulation Impact 示例（997-1008） | 12行 | 精简为6行 | 6 |
| Capability Sourcing 示例（1010-1021） | 12行 | 精简为6行 | 6 |
| Why not RAG 表格（33-42） | 10行 | 精简为6行 | 4 |
| **小计** | - | - | **22** |

#### 3. 移除冗余描述

| 位置 | 内容 | 节省行数 |
|------|------|---------|
| 术语表（45-63行） | 精简为4-5行核心术语 | ~15 |
| Decision Loop 流程图（247-255行） | 保留图，移除文字描述 | ~10 |
| Contract 代码块（141-155行） | 精简为关键字段 | ~10 |
| **小计** | - | - | **35** |

### 三、预期效果

| 文件 | 精简前 | 精简后 | 缩减比例 |
|------|-------|-------|---------|
| `research.mjs` | 2827 行 | ~2200 行 | ~22% |
| `SKILL.md` | 1076 行 | ~600 行 | ~44% |
| **总计** | 3903 行 | ~2800 行 | **~28%** |

## 不改动的部分（保证功能完整性）

### 1. 数据模型
- ✅ ONTOLOGY 常量（14种实体类型定义）
- ✅ EvidenceGraph 类（entities/relationships/evidence/aliases）
- ✅ QuestionTree 类（动态问题树）
- ✅ ClaimStore 类（Claim 模型）
- ✅ ResearchSession 类（工作上下文）

### 2. 核心算法
- ✅ analyzeGaps()（基于 Ontology 的 Gap 分析）
- ✅ analyzeContradictions()（基于 claims 的冲突检测）
- ✅ assessConfidence()（多因素置信度评估）
- ✅ decide()（确定性 Expand-Converge 决策）
- ✅ validateReport()（报告校验）

### 3. CLI 命令
- ✅ 全部36个命令保持不变
- ✅ 命令参数保持不变
- ✅ 输出格式保持兼容

### 4. API 导出
- ✅ 所有 export 保持不变
- ✅ 编程式调用接口兼容

## 实施步骤

### Phase 1: research.mjs 精简（~2小时）

1. **移除冗余注释**（文件头、section、行内）
2. **提取公共逻辑**（withSession、parseArgs）
3. **精简 printUsage()**（压缩命令列表、选项、示例）
4. **内联小辅助函数**（_entityRationale、_overallRationale）

### Phase 2: SKILL.md 精简（~1小时）

1. **合并重复概念**（Heuristics → Design Principles）
2. **精简示例和表格**（保留核心，移除冗余）
3. **移除冗余描述**（术语表、流程图文字、代码块）
4. **边界规则精简**（16条 → 5条核心）

### Phase 3: 验证（~30分钟）

1. ✅ 运行所有 CLI 命令验证功能正常
2. ✅ 运行 E2E 验证场景（20个验证场景）
3. ✅ 确保 API 导出兼容

## 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| CLI 输出格式变化影响 LLM 解析 | 低 | 中 | 保持核心输出格式不变，仅压缩 usage 文本 |
| 参数解析错误 | 低 | 高 | 严格测试所有36个命令 |
| API 导出变更 | 低 | 高 | 保持 export 列表不变 |
| 文档信息丢失 | 低 | 中 | 保留所有核心概念，仅移除重复描述 |

## 验收标准

1. **功能完整性**：所有36个 CLI 命令正常工作
2. **兼容性**：编程式 API 调用保持兼容
3. **代码质量**：无语法错误，无运行时错误
4. **文档完整性**：SKILL.md 包含所有核心概念和使用说明
5. **E2E 验证**：通过20个验证场景
