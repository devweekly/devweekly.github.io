# Plan: 精简 enterprise-research-agent（不损失功能）

## 目标

保持 `enterprise-research-agent` 单文件、全功能、所有 CLI 命令、所有校验规则不变，仅通过内部重构把 `research.mjs` 从约 2823 行压缩到 2000–2200 行左右，提升可维护性。

## 原则

1. **零功能损失**：不删命令、不改命令签名、不改 schema、不改文件结构、不改 ONTOLOGY/CLAIM 规则。
2. **单文件约束**：所有 JS 代码继续集中在 `research.mjs`。
3. **最小外部依赖**：保持 `fs`/`path`/`url` 三件套，不引入任何 npm 包。
4. **可读性优先**：精简不等于 obfuscation，保留 section header 和关键中文注释。
5. **向后兼容**：现有 session JSON 的 `fromJSON` 继续兼容。

---

## 当前体量

| 文件 | 行数 | 备注 |
|------|------|------|
| `research.mjs` | ~2823 | 13 个 section |
| `SKILL.md` | ~1085 | 文档，不纳入代码精简范围 |

---

## 精简方向与具体项

### 方向 1：统一 CLI 样板代码（预计减 300–400 行）

**现状问题**：
- 36 个 CLI handler 每个都重复写 `loadSession(sessionFile)`、`saveSession(s, sessionFile)`、`try/catch`、错误退出。
- 每个 handler 内单独解析 `--session`、单独校验必填参数、单独做 `process.exit(1)`。

**精简方案**：
- 引入 `runCommand(handler)` wrapper：
  ```javascript
  function runCommand(name, handler) {
    try {
      const result = handler();
      if (result && result.save) saveSession(result.session, sessionFile);
      return result;
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  }
  ```
- 或更紧凑地，把 `main()` 的 `switch` 每个 case 改成直接返回 `{ session, message, print? }`，由外层统一 save 和输出。
- 必填参数校验抽成 `requireArg(argv, '--question')` 辅助函数，替代每个 handler 里的 `if (!x) { console.error('Error: ...'); process.exit(1); }`。

**示例转换**：
```javascript
// before
const question = argValue(argv, '--question');
if (!question) {
  console.error('Error: --question is required');
  process.exit(1);
}
const s = loadSession(sessionFile);
s.setContract(createContract({ question, ... }));
s.saveSession(s, sessionFile);

// after
const s = loadSession(sessionFile);
const question = requireArg(argv, '--question');
s.setContract(createContract({ question, ... }));
s.save();
```

---

### 方向 2：ResearchSession 委托方法自动化（预计减 80–120 行）

**现状问题**：
- `ResearchSession` 中有大量仅做委托的方法：
  ```javascript
  addQuestion(...) { return this.questionTree.addQuestion(...); }
  updateQuestion(...) { return this.questionTree.updateQuestion(...); }
  addClaim(...) { return this.claims.addClaim(...); }
  verifyClaim(...) { return this.claims.verifyClaim(...); }
  linkClaimEvidence(...) { return this.claims.linkEvidence(...); }
  claimCoverage() { return this.claims.coverage(); }
  decide() { return decide(this); }
  checkBudget() { return checkBudget(this); }
  analyze() { ... }
  ```

**精简方案**：
- 对于“纯委托且调用方完全一致”的方法，直接在 CLI handler 中调用 `s.questionTree.addQuestion(...)` / `s.claims.addClaim(...)`，删除 `ResearchSession` 中的薄包装。
- 保留确实需要聚合逻辑的方法：`setContract`、`confirmContract`、`setBudget`、`analyze`、`context`、`toJSON`、`fromJSON`。
- 这样 `ResearchSession` 不再作为“所有子系统 facade”，而是真正的上下文容器。

---

### 方向 3：合并 EvidenceGraph 内部辅助方法（预计减 50–80 行）

**现状问题**：
- `_registerAlias` / `_findEntityIdByNameOrAlias` / `findEntity` / `getEntity` 四者功能接近。
- `addEntity` 中的 Identity Resolution 有两条几乎相同的 merge 路径（by name / by alias），可以合并为一个统一的“尝试合并”函数。

**精简方案**：
- 把 `_registerAlias(name, entityId)` 和查找合并为 `_alias(name) -> entityId | null`。
- `addEntity` 中统一处理：先检查 name，再检查所有 aliases，命中任意一个即合并。
- `findEntity` 与 `getEntity` 保留公共 API，内部共用 `_findEntityIdByNameOrAlias`。

---

### 方向 4：QuestionTree / ClaimStore 通用 Map 存储层（预计减 40–60 行）

**现状问题**：
- `QuestionTree` 和 `ClaimStore` 都是“id 自增 + Map 存储 + toJSON/fromJSON + list/filter”的结构，重复了 30% 的样板代码。

**精简方案**：
- 引入一个内部的 `IdStore` mixin 或工厂函数：
  ```javascript
  function makeIdStore(prefix) {
    return class {
      constructor() { this.items = new Map(); this._counter = 0; }
      nextId() { return `${prefix}${++this._counter}`; }
      get(id) { return this.items.get(id) || null; }
      list(filterFn) { ... }
      toJSON() { return { items: [...this.items.values()], counter: this._counter }; }
      static fromJSON(data) { ... }
    };
  }
  ```
- `QuestionTree` 和 `ClaimStore` 继承 / 组合 `IdStore`，只保留业务特有方法（`addQuestion`、`updateQuestion`、`addClaim`、`verifyClaim`、`coverage`）。
- 因用户要求单文件，此 helper 写在 `research.mjs` 内，不拆文件。

---

### 方向 5：置信度评估辅助函数合并（预计减 60–100 行）

**现状问题**：
- `_scoreToLevel`、`_entityRationale`、`_overallRationale` 三个函数生成 rationale 字符串，逻辑重复度高。
- `assessConfidence` 和 `_assessEntity` 有大量重复的 factor 收集代码。

**精简方案**：
- 把 rationale 生成统一为 `formatRationale({ evidenceCount, sourceCount, staleCount, contradictionCount, crossValidated, maxSourceWeight })`。
- `_assessEntity` 返回 `{ score, factors }`，`assessConfidence` 复用 factors 计算 overall，避免重复遍历 evidence。
- 删除 `_entityRationale` / `_overallRationale`，用同一个格式化器。

---

### 方向 6：报告验证逻辑简化（预计减 50–80 行）

**现状问题**：
- `validateReport` 中对 `keyFindings`、`supportingEvidence`、`recommendations`、`conflicts` 的循环校验有大量重复模式。

**精简方案**：
- 抽 `assertString(obj, field, prefix)`、`assertArrayOfIds(obj, field, graph, idField, prefix)`、`assertEnum(value, allowed, prefix)` 三个辅助函数。
- 用数组驱动校验，例如：
  ```javascript
  for (const [i, f] of report.keyFindings.entries()) {
    mustHave(f, 'id', `keyFindings[${i}]`);
    mustHave(f, 'statement', `keyFindings[${i}]`);
    mustHaveOneOf(f, ['evidenceIds', 'claimIds'], `keyFindings[${i}]`);
    mustEnum(f.confidence, CONFIDENCE_LEVELS, `keyFindings[${i}].confidence`);
  }
  ```

---

### 方向 7：help 文本动态生成（预计减 80–120 行）

**现状问题**：
- `printUsage()` 中 36 个命令的说明是手写大段字符串，占约 180 行，且选项列表也是手写。

**精简方案**：
- 定义命令元数据数组：
  ```javascript
  const COMMANDS = [
    { name: 'init', args: '[--goal <name>]', desc: 'Initialize new research session' },
    { name: 'set-contract', args: '--question <text> [--scope ...]', desc: 'Set Research Contract' },
    ...
  ];
  ```
- `printUsage()` 遍历 `COMMANDS` 自动生成对齐的输出。
- 选项说明同样用元数据数组生成。
- 这样新增/修改命令只需改一处元数据，避免 help 与实现脱节。

---

### 方向 8：删除 SKILL.md 中的冗余或重复说明（可选，文档层面）

**现状问题**：
- `SKILL.md` 在“Script Integration Contract”和“LLM Playbook”中对命令的说明有重复。
- Research Heuristics 在正文、Design Principles 中各出现一次。
- Vision section 与开头引言有重叠。

**精简方案**（如用户希望文档也精简）：
- 在 Design Principles 中直接引用 Research Heuristics，不再重复列举 6 条。
- Vision 保留一句话版本，删除与开头的重复叙述。
- Script Integration Contract 的命令示例只保留链接到 LLM Playbook 的引用，不重复完整命令。

**建议**：本 plan 先聚焦 `research.mjs` 代码精简，`SKILL.md` 作为第二步可选优化。

---

## 实施顺序

按依赖关系从底向上：

1. **工具函数层**：`IdStore` 工厂、`requireArg`/`runCommand` wrapper、`assert*` 校验辅助、`formatRationale`。
2. **数据层**：`EvidenceGraph` 合并 alias 逻辑；`QuestionTree`/`ClaimStore` 应用 `IdStore`；删除 `ResearchSession` 纯委托方法。
3. **分析层**：`assessConfidence` 合并 rationale 生成。
4. **报告层**：`validateReport` 使用 assert 辅助。
5. **CLI 层**：main switch 使用 wrapper 和命令元数据。
6. **Help 层**：`printUsage` 改为动态生成。
7. **回归验证**：跑完整 E2E fixture test（init → contract → budget → plan → question → evidence → entity → relationship → claim → coverage → analyze → decide → report-template → validate-report）。

---

## 风险与回退

| 风险 | 缓解 |
|------|------|
| 压缩 CLI 样板时误删某个命令的错误信息细节 | 用辅助函数保留原错误消息文本 |
| `IdStore` 改变序列化字段名导致旧 session 不兼容 | `fromJSON` 同时兼容旧格式（items / questions / claims） |
| ResearchSession 删除委托方法后 CLI 调用点遗漏 | 全局替换 `s\.addQuestion\(` → `s.questionTree.addQuestion(` 等，并跑全命令验证 |
| help 动态生成后格式不对齐 | 用 `padEnd` 控制列宽，并在修改后人工检查 `--help` |

---

## 预期效果

| 指标 | 当前 | 目标 |
|------|------|------|
| `research.mjs` 行数 | ~2823 | ~2000–2200（减 20–30%） |
| CLI 命令数 | 36 | 36（不变） |
| 功能 | 完整 | 完整 |
| 单文件约束 | 满足 | 满足 |
| 新依赖 | 0 | 0 |

---

## 下一步

用户确认本 plan 后，执行上述 7 步重构，并在最后跑完整 E2E fixture test 验证。
