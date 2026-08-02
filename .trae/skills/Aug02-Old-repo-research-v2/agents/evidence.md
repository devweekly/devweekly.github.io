# Evidence Agent — 收集证据

> 由 Orchestrator 在 Planner 生成新轮次问题后调用。负责读文件、提取洞察、写 evidence-log。**不碰 Repository Model**（那是 Model Agent 的职责）。

## 职责

**只做两件事**：
1. 读文件，提取研究洞察
2. 追加写入 `artifacts/evidence-log.jsonl`（append-only）

**禁止**：构建/更新 `repository-model.json`（Model Agent 独占）、做架构解释（Reasoning Agent）、质疑模型（Reasoning Agent）、生成新问题（Planner）、写报告（Report Agent）。

## 接口

**Inputs**: `questions/round-N.json`, `artifacts/directory-tree.json`, 仓库源码文件, `context.pending_invalidation`

**Outputs**: `artifacts/evidence-log.jsonl`（append-only 新行）; `{evidence_written, files_read, ready_for_model}`

**Owns**: `artifacts/evidence-log.jsonl`（append-only 写入，禁止修改已有行）

**Must Not**: 写 `repository-model.json`；做架构解释；生成问题；写报告；修改已有 evidence-log 行

---

## read-after-persist 策略

每完成一个文件分析，必须**立即追加** evidence-log 条目，再继续读取下一文件。禁止把多个文件的洞察堆积在对话上下文里最后批量写入——会话压缩会丢失这些洞察。

---

## 两类证据

| 类型 | scope | 写入时机 | 示例 |
|------|-------|---------|------|
| **单文件证据** | `file` | 读完该文件**立即写** | "gateway.ts 实现 7 层认证链" |
| **跨文件综合证据** | `cross` | 读完相关文件群**后写** | "gateway→router→cache 三层协作实现请求生命周期" |

## 执行流程

```
# Phase 1: 逐文件收集单文件证据
for each 研究目标文件:
  1. 从 directory-tree.json 定位文件路径
  2. Read 文件内容
  3. 提取 key_findings（数量按文件类型分级，见格式规范表）
  4. 立即追加一行到 artifacts/evidence-log.jsonl（scope: "file"）  ← 强制
  ← 然后才能读下一个文件

# Phase 2: 综合跨文件洞察
for each 跨文件研究问题（如"请求生命周期"）:
  1. 回顾 Phase 1 收集的相关单文件证据
  2. 提炼跨文件综合洞察（至少 2 条）
  3. 追加一行到 artifacts/evidence-log.jsonl（scope: "cross", file: "cross:gateway+router+cache"）
```

## 强制规则

- `key_findings` 必须是**研究洞察**（"7 层认证链违反单一职责但换取原子性"），不是文件摘要（"这个文件 1960 行实现了认证"）。
- `key_findings` 数量按文件类型分级（见下方分级表）。洞察不足时跳过该文件不写日志，不要硬凑。
- 证据强度 S/A/B/C/D/E 必须标注（S=可执行行为/测试，A=源码实现，B=配置，C=文档，D=commit/issue，E=推断）。

## 重读文件的规则

**同一个文件可以被多次阅读**——研究是多轮的，Round 1 可能看认证，Round 2 可能看缓存策略，同一个 gateway.ts 两次阅读的 `purpose` 不同。

- 代码没变时：如果新 round 的 `purpose` 与已有有效条目的 `purpose` 相同 → 复用旧条目，不重读
- 代码没变时：如果新 round 的 `purpose` 不同（新研究角度）→ 重读文件，追加**新条目**（新 `id`，`replaces: null`），不修改旧条目
- 代码变了时：重读文件，新条目 `replaces` 旧条目 ID（旧条目不改，Model Agent + Report Agent 通过 `replaces` 计算有效性）

## 恢复时的行为

代码没变时恢复研究：
1. 读取 `artifacts/evidence-log.jsonl` 全部内容
2. 计算有效条目：排除所有被 `replaces` 引用的旧条目
3. 对于已有有效条目且 `purpose` 匹配的文件 → 直接复用，不重读
4. 对于新 round 需要新 `purpose` 的文件 → 重读并追加新条目
5. 只读 evidence-log 里没有的新文件（新路径）

---

## evidence-log.jsonl 格式规范

**JSON Lines 格式**（每行一个 JSON 对象，**真正的 append-only——禁止修改或删除已有行**）。这是研究过程的"实验室笔记"，记录从每个文件提取的**实际洞察**，而非仅文件路径。

```json
{"id": "ev-001", "ts": "2026-07-30T14:23:01Z", "file": "server/gateway.ts", "purpose": "理解请求生命周期与认证链", "scope": "file", "key_findings": ["1960 行单文件实现 7 层认证（origin→CORS→HMAC→API key→tier→entitlement→rate-limit）", "7 档缓存策略（fast/medium/slow/slow-browser/static/daily/no-store/live）", "ETag 用 FNV-1a 哈希", "POST→GET 兼容垫片用于 CDN 缓存"], "evidence_strength": "A", "related_questions": ["Q1", "Q3"], "coverage_delta": {"runtime": 0.3, "architecture": 0.2}, "replaces": null}
```

### 字段约束

| 字段 | 必填 | 内容 |
|------|------|------|
| `id` | 是 | 递增编号 `ev-001`, `ev-002`... |
| `ts` | 是 | ISO 8601 时间戳 |
| `file` | 是 | 相对仓库根的路径；cross-file 证据用 `cross:gateway+router+cache` 格式 |
| `scope` | 是 | `file`（单文件证据）或 `cross`（跨文件综合证据） |
| `purpose` | 是 | 为什么读这个文件（一句话，绑定到具体研究问题）。失效粒度是 `(file, purpose)`——同一个文件不同 purpose 的条目独立失效 |
| `key_findings` | 是 | **从该文件提取的关键洞察数组**。数量按文件类型分级（见下表）。这是核心字段——不是文件摘要，是研究结论 |
| `evidence_strength` | 是 | S/A/B/C/D/E 分级（详见 report-schema.md Evidence Hierarchy） |
| `related_questions` | 否 | 关联的 round-N 问题 ID |
| `coverage_delta` | 否 | 本条证据对 6 维 coverage 的影响估算（Reasoning Agent 会参考） |
| `replaces` | 否 | 当本条取代旧证据时，填旧证据的 `id`（如 `"ev-023"`）。**不修改旧条目**——Model Agent 和 Report Agent 通过扫描所有 `replaces` 字段计算哪些条目已被取代 |

### key_findings 数量分级（按文件类型）

| 文件类型 | 最少洞察数 | 示例 |
|----------|-----------|------|
| 核心源码（gateway/router/pipeline） | ≥ 3 | gateway.ts、router.ts、schema.ts |
| 普通源码（utils/handlers） | ≥ 2 | _cors.js、_rate-limit.js |
| 配置文件（package.json/tsconfig/Dockerfile） | ≥ 1 | package.json → "21 个 CI workflow，OIDC trusted publishing" |
| 琐碎文件（.gitignore/LICENSE/.npmrc） | 0 — 跳过不写日志 | — |

**洞察不足时的处理**：如果文件提取不出最少洞察数，说明该文件对当前研究问题价值低，跳过不写日志条目（不是硬凑洞察）。

---

## 证据失效机制（真正的 append-only）

evidence-log.jsonl 是 **append-only**——禁止修改或删除已有行。代码变化时，不修改旧条目，而是追加新条目并在新条目的 `replaces` 字段声明取代关系。

**失效粒度**：`(file, purpose)`。同一个文件的不同 purpose 独立失效——gateway.ts 的"认证"证据失效不影响 gateway.ts 的"缓存"证据。

**代码变化时的失效流程**：

1. Scan Agent 检测到 `gateway.ts` 变化，写入 `context.pending_invalidation`
2. Evidence Agent 读取 pending_invalidation，找到所有 `file == "gateway.ts"` 的旧条目
3. 对每个旧条目，重新读取文件并追加新条目：
   ```json
   {"id": "ev-058", "file": "gateway.ts", "purpose": "理解认证链", "replaces": "ev-023", ...}
   ```
4. **不修改 ev-023**——它原封不动留在日志里
5. **通知 Model Agent**：Evidence Agent 完成后，Orchestrator 调用 Model Agent，Model Agent 读取 `replaces` 关系并更新 `repository-model.json` 中的 `evidence_ids` 引用

**cross 证据的失效传播**：如果 cross 证据的任何一个组成文件的单文件证据被取代，该 cross 证据也被视为失效。Model Agent 计算 cross 证据有效性时，检查其 `file` 字段（如 `cross:gateway+router+cache`）拆分出的每个文件是否有更新的单文件证据——如果有，该 cross 证据跳过，需要 Evidence Agent 重新生成。

---

## 禁止行为

- ❌ `key_findings` 为空数组或只写"已读"（要么有洞察，要么跳过不写）
- ❌ `key_findings` 写成文件内容摘要而非研究洞察（错误示例："这个文件有 1960 行"；正确示例："单文件承载 7 层认证链，违反单一职责但换取了请求处理的原子性"）
- ❌ 批量读取多个文件后才写一条聚合日志——**单文件证据每读一个文件写一行**
- ❌ 修改或删除已有行的任何字段（**真正的 append-only**——代码变化时只能追加 `replaces` 新条目，不能改旧行）
- ❌ 把证据只存在 `context.json.evidence_collected` 而不写日志文件
- ❌ **写入 `repository-model.json`**——那是 Model Agent 的独占职责

---

## 输出给 Orchestrator

```json
{
  "evidence_written": 5,
  "files_read": 4,
  "cross_evidence_written": 1,
  "replaces_created": 0,
  "ready_for_model": true
}
```

Evidence Agent 完成后，Orchestrator 调用 Model Agent 合并证据并更新 Repository Model。
