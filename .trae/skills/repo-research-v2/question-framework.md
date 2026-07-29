# 问题框架（Question Framework）

> 本文档定义 Repository Research 的问题生成、演化和管理机制。**问题是推理轨迹，不是待办清单。**

---

## 问题类型

完整的研究应包含以下类型的问题，按研究阶段演进：

| 类型 | 目的 | 时机 | 典型深度 |
|------|------|------|---------|
| **discovery** | 建立模型 | 研究初期 | depth=1 |
| **critical** | 评估决策质量 | 模型建立后 | depth=2 |
| **challenge** | 推翻错误模型 | 模型初步稳定后 | depth=3 |
| **design_space** | 探索替代方案 | 模型建立后 | depth=2 |
| **counterevidence** | 主动找反证 | 模型稳定后 | depth=3 |
| **maintainer** | 模拟修改 | 研究后期 | depth=2-3 |
| **transfer** | 抽象可复用思想 | 研究后期 | depth=4 |

```
观察到什么？ → 为什么是它不是别的？ → 我的理解可能是错的吗？ → 反证在哪里？ → 修改它影响什么？ → 什么可以泛化？
```

---

## 问题生命周期

每个问题都有明确的生命周期状态，**禁止**使用简单的 open/answered 二分。

```
open → researching → answered → validated → deprecated
   ↘                                    ↗
    → refuted (发现反证，直接关闭)
```

| 状态 | 含义 | 进入条件 |
|------|------|---------|
| `open` | 问题已提出，尚未开始研究 | 初始生成或从其他问题派生 |
| `researching` | 正在收集证据回答 | 开始阅读相关代码/文档 |
| `answered` | 找到了初步答案 | 证据充分，形成初步结论 |
| `validated` | 答案经过挑战验证 | Phase 2b 挑战通过，或被其他问题交叉印证 |
| `deprecated` | 问题不再相关或已被更精确的问题取代 | 新证据使问题失效，或 superseded_by 指向更好问题 |
| `refuted` | 问题本身错误或结论被反证推翻 | 找到强反证，结论不可信 |

**规则**：
- `answered` 不是终态。必须通过 `validated` 才能算真正完成。
- `validated` 问题才允许进入报告。`answered` 但未 `validated` 的问题视为"待验证"。
- `deprecated` 问题**不删除**，只标记状态。历史问题链对审计至关要。

---

## 问题演化：事件驱动

**问题不是因为"到了某个阶段"而变化，而是因为"发生了特定事件"而变化。**

以下事件都会触发 Question Evolution（问题演化）：

| 事件 | 触发时机 | 允许的操作 |
|------|---------|-----------|
| **Repository 类型识别完成** | 扫描完成后立即 | 生成第一版问题 |
| **Phase 0 完成** | 机械分析结束 | 根据新结构证据：删除失效 / 新增发现 / 调整优先级 |
| **Phase 1 完成** | Repository Model 初步形成 | 补充遗漏 / 生成模型验证问题 / 生成反证问题 |
| **Phase 2a 完成** | 架构解释形成 | 生成挑战当前解释的问题 / 生成迁移问题 |
| **Phase 2b 完成** | 模型被挑战 | 根据挑战结果修正问题 / 关闭已证伪问题 |
| **出现无法解释的新证据** | 随时 | 新增 discovery 型问题 / 标记相关问题为 needs_research |
| **一个问题被回答** | 随时 | 派生新问题 / 调整其他问题优先级 |
| **一个假设被证伪** | 随时 | 标记相关问题 deprecated / 生成替代问题 |
| **增量分析发现变化** | commit 不同时 | 标记受影响问题 needs_research / 新增变化相关问题 |

**注意**：事件之间**不要求严格顺序**。真正的研究可能今天发现 Scheduler，马上产生三个新问题；后来又发现 Scheduler 根本不是核心，于是旧问题全部 deprecated。这是正常的。

---

## 问题演化：增量更新规则

**每次重新生成问题，禁止整体替换 questions.json。**

```
重新生成问题时：

保留：
- 仍未回答的问题（open / researching）
- 被证据支持继续存在的问题（answered，但未 validated）

新增：
- 新证据触发的问题
- 派生自已回答问题的后续问题

关闭：
- 已回答并 validated 的问题 → 标记 validated（不删除）
- 已被证伪的问题 → 标记 refuted（不删除）
- 被更精确问题取代的 → 标记 deprecated，填入 superseded_by

禁止：
- 清空 questions.json 后全部重写
- 丢弃 answered 但未 validated 的问题
- 删除 deprecated/refuted 问题
```

**原理**：questions.json 是研究轨迹，不是当前状态快照。删除历史问题会丢失推理链。

---

## 问题生成原则

研究问题必须满足以下六项要求：

| 原则 | 要求 | 违反则 |
|------|------|--------|
| **准确性** | 每个问题必须由当前证据或观察触发，而非固定模板。格式：`观察 → 问题`，而非 `模板 → 问题` | 问题与仓库无关 |
| **延展性** | 一个问题得到部分回答后，必须派生新的问题。问题随研究推进持续深化，而非固定列表 | 研究停留在表面 |
| **创新性** | 优先提出只有该 Repository 才值得问的问题，而非通用架构问题 | 报告千篇一律 |
| **挑战性** | 主动提出可能推翻当前理解的问题，并寻找反证验证 Repository Model | 模型未经检验 |
| **深度性** | 问题的 depth_level 必须逐层递增（1→2→3→4）。禁止连续停留在同一 depth | 研究无法触及"为什么不是别的" |
| **替代性** | 每个设计决策问题必须伴随"为什么不是别的"的追问 | 确认偏误未被挑战 |

派生问题必须记录到 questions.json 的 `derived_from` 字段，形成问题衍生链。

---

## 深度层级

研究必须逐层深入。问题深度标记防止停留在表面：

```
depth=1: What         "系统如何划分职责？"
    ↓ answered
depth=2: How          "为什么用 AppContext 而不是 Redux？"
    ↓ answered
depth=3: Why          "为什么无外部状态库的架构能撑住 201 个 service？"
    ↓ answered
depth=4: Why not      "如果换用 Redux，哪些约束会失效？"
```

**规则**: depth=1 问题全部 answered 后，**必须**生成 depth≥2 的问题。如果所有问题 depth=1，研究不完整。

---

## 问题 Schema

```json
[
  {
    "id": "Q1",
    "question": "系统如何划分职责？",
    "genesis": {
      "trigger": "observation",
      "observation": "src/ 目录有 14 个子目录，api/ 有 81 个端点",
      "depth_level": 1
    },
    "type": "discovery",
    "status": "answered",
    "confidence": "high",
    "answer_summary": "types → config → services → components → app → App.ts 单向依赖",
    "related_evidence": ["AGENTS.md:Dependency Direction"],
    "counterevidence": ["src/components/Panel.ts 直接 import services/"],
    "alternatives_considered": ["为什么不使用 Redux/Zustand"],
    "model_implication": "依赖方向受控是架构不变量",
    "derived_from": []
  }
]
```

### 字段说明

| 字段 | 说明 |
|------|------|
| `id` | 问题唯一标识（Q1, Q2, ...），按生成顺序编号 |
| `question` | 问题文本。必须包含具体仓库上下文，不能是通用模板 |
| `genesis.trigger` | 触发源：`observation` / `surprise` / `challenge` / `contradiction` / `design_gap` |
| `genesis.observation` | 触发问题的具体观察，格式：`观察到什么 → 所以问什么` |
| `genesis.depth_level` | 深度层级：1=What / 2=How / 3=Why / 4=Why not |
| `type` | 问题类型：`discovery` / `critical` / `challenge` / `design_space` / `counterevidence` / `maintainer` / `transfer` |
| `status` | `open` / `researching` / `answered` / `validated` / `deprecated` / `refuted` |
| `confidence` | `high` / `medium` / `low` |
| `answer_summary` | 回答摘要（status=answered 时必填） |
| `related_evidence` | 支持证据 |
| `counterevidence` | 反证（**主动寻找的 disconfirming evidence**） |
| `alternatives_considered` | 考虑过的替代方案 |
| `model_implication` | 答案对 Repository Model 的影响 |
| `derived_from` | 父问题 ID 列表，形成问题衍生链 |
| `superseded_by` | 如果问题被更精确的问题替代，指向新 ID |

---

## 典型问题

### Discovery（建立模型）

- 系统如何划分职责？
- 子系统边界如何定义？
- 数据如何流动？
- 控制流如何组织？
- 生命周期由谁管理？
- 可扩展能力如何实现？
- 哪些约束塑造了当前架构？
- 哪些复杂性被有意隐藏？
- 哪些能力属于公共 API，哪些属于内部实现？
- 哪些设计是刻意省略？

### Critical（评估决策）

- 为什么选这个方案而非默认？
- 为什么 201 个 service 还能撑住而没有演化成 Redux？
- 这个决策在最开始时也是最优的吗？

### Challenge（推翻模型）

- 如果移除这一组件，系统还能成立吗？
- 哪个模块是真正的架构中心，而不是实现细节？
- 哪些抽象是必需的，哪些只是实现选择？
- 是否存在更简单的设计？仓库为什么没有采用？
- 哪些设计看似重要，但实际上可以替换？
- 哪些模块承担了过多职责？
- 哪些复杂性来自业务约束，而不是架构本身？
- 当前解释是否还能同时解释所有证据？

### Design Space（探索替代）

- 为什么不是别的方案？
- 如果换用 Redux，哪些约束会失效？
- 为什么不用依赖注入？

### Counterevidence（主动找反证）

- 如果我的结论是错的，应该在哪里找到证据？
- 如果移除中心，系统是否还能成立？
- 这个结论在什么条件下不成立？

### Maintainer（模拟修改）

- 修改 X 需要改多少文件？
- 哪些复杂度是意外的，哪些是必然的？

### Transfer（抽象泛化）

- 这个思想在什么场景下有价值？
- 哪些工程错误被有意避免？
- 哪些思想值得复用？

---

## 问题生成触发点

### Repository 类型识别完成后

扫描完成后，**立即**识别仓库类型（CLI / 库 / 框架 / 数据库 / 编译器 / 运行时 / 操作系统 / SDK / AI 基础设施 / Web 服务等），并生成第一版问题。

不同类型的仓库关注点完全不同：

| 仓库类型 | 关注重点 |
|---------|---------|
| 编译器 | IR / 优化 / Pass |
| 框架 | 扩展点 / 生命周期 / Hook |
| 数据库 | 存储 / 事务 / 并发 |
| 运行时 | 事件循环 / 调度 / 内存管理 |

### Phase 0 完成后

根据机械分析的新结构证据：
- 删除已失效的问题
- 新增发现型问题
- 调整问题优先级

### Phase 1 完成后

Repository Model 初步形成后：
- 补充遗漏的问题
- 生成模型验证问题
- 生成反证问题

### Phase 2a 完成后

架构解释形成后：
- 生成挑战当前解释的问题
- 生成迁移问题

### Phase 2b 完成后

模型被挑战后：
- 根据挑战结果修正问题
- 关闭已证伪的问题

### 新证据出现时

随时：
- 新增 discovery 型问题
- 标记相关问题为 needs_research

### 一个问题被回答时

随时：
- 派生新问题
- 调整其他问题优先级

### 一个假设被证伪时

随时：
- 标记相关问题 deprecated
- 生成替代问题

### 增量分析发现变化时

commit 不同时：
- 标记受影响问题 needs_research
- 新增变化相关问题
