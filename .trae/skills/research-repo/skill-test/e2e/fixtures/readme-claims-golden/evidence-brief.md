# Evidence Brief: synthetic-readme-claims-mXhS2a

> Generated: 2026-07-28 by research-repo skill (deterministic analysis).
> This brief is the **input** for LLM report generation — not the final report.
> The LLM should read this brief, then write `report.md` per the prompt in the last section.

## 0. Research Principles

The LLM MUST follow these principles when writing the report:

- **Prefer evidence over assumptions** — Every conclusion must cite specific evidence (file path, metric, brief section).
- **Prefer multiple weak signals over one strong signal** — Cross-validate to avoid single-source bias.
- **Distinguish facts from interpretations** — Fact: "X exists in code". Interpretation: "This means Y".
- **State uncertainty explicitly** — Say "Unknown" when evidence is insufficient. Do NOT default to "present".
- **Separate observations from conclusions** — Observation: "X detected". Conclusion: "Therefore Y".
- **Do not infer architecture from naming alone** — Function names ≠ functionality. Check call chains.
- **Treat tests as first-class evidence** — Test code reveals true intent and usage patterns.
- **Treat examples as executable documentation** — example/ directories are as valuable as READMEs.
- **Prefer reusable patterns over implementation details** — Extract patterns, don't get lost in details.
- **Negative findings are equally important** — "X not found" is as valuable as "Y found".
- **Trace density over coverage** — Every Trace must answer one architectural question whose answer would change an engineer's understanding of the system. Low-value Traces should be deleted, not kept to pad the count. 5 sharp Traces beat 8 mediocre ones.
- **Confidence MUST follow a unified standard** — High: ≥3 independent evidence sources; Medium: 2 sources; Low: 1 source; Speculative: no direct evidence (reasoning only). All confidence labels MUST conform to this definition.

## ★ Findings (v2 normalized)

> Every Finding binds to a Research Question (Q1-Q11) with auto-computed confidence / coverage / importance.
> Findings are raw material. The LLM should consume ★★ Evidence Synthesis (Question Resolution) as the primary conclusion input; this section is supporting evidence only. Findings with verified=downgraded/rejected must not be cited as conclusions.

**Summary**: 19 findings (4 critical / 13 high / 2 medium / 0 low); avg confidence 0.14; after verification: 19 verified / 0 downgraded / 0 rejected

**Claim Lifecycle**: Candidate: 0 / Hypothesis: 0 / Supported: 0 / Verified: 17 / Decision: 1 / Reusable Pattern: 1

**Unknown Classification**: Need Reading: 4 / Need External Evidence: 3 / Impossible to Verify: 1

### Research Questions

- **Q1** [critical] How does a request enter the system and what is the entry shape?
- **Q2** [critical] Where is orchestration/control-flow, and what pattern (pipeline/graph/fsm) is used?
- **Q3** [high] Does Retrieval (RAG) really exist, and what is the evidence strength?
- **Q4** [high] Where is prompt management and what is the prompt lifecycle?
- **Q5** [high] What is the tool registry/invocation pattern, and how are tools bound to agents?
- **Q6** [critical] Is this an AI project? What concrete signals confirm or refute this?
- **Q7** [medium] How is correctness validated (tests vs evaluation), and where are the gaps?
- **Q8** [high] What contradicts the README or self-presentation (false claims, hidden gaps)?
- **Q9** [critical] What architecture decisions were made, and what are their tradeoffs?
- **Q10** [high] What constraints drive these decisions (and which modules do they affect)?
- **Q11** [high] What implicit assumptions does the system depend on, and where would they break?

### Findings table

| ID | Q | Importance | Confidence | Coverage | Verified | Lifecycle | Finding |
|----|---|------------|------------|----------|----------|-----------|---------|
| F-001 | Q1 | critical | 0.55 | 0.10 | ✅ verified | reusable_pattern | Repository exposes 1 entry points (sdk=1). Sample: src/index.js. |
| F-002 | Q2 | critical | 0.01 | 0.00 | ✅ verified | verified | No recognizable architecture pattern detected (Unknown). |
| F-003 | Q3 | high | 0.09 | 0.60 | ✅ verified | verified | No Retrieval (RAG) capability detected. CapabilityOntology reports retrieval=n/a. |
| F-004 | Q4 | high | 0.32 | 0.50 | ✅ verified | verified | No prompts detected by AST or regex scan. |
| F-005 | Q5 | high | 0.32 | 0.50 | ✅ verified | verified | No tools detected by AST decorator or schema-first scan. |
| F-006 | Q6 | critical | 0.05 | 0.00 | ✅ verified | verified | Not classified as AI project. CapabilityOntology gate found insufficient AI signals. |
| F-007 | Q7 | medium | 0.45 | 0.00 | ✅ verified | verified | No test files detected. |
| F-008 | Q7 | medium | 0.06 | 0.40 | ✅ verified | verified | No evaluation infrastructure detected (no eval files, hasEvaluation=false). |
| F-009 | Q8 | high | 0.13 | 0.60 | ✅ verified | verified | README claims "Vectorized Execution" but code signals do not confirm it (hasSQL=false). Treated as d |
| F-010 | Q8 | high | 0.13 | 0.60 | ✅ verified | verified | README claims "Distributed Query Planner" but code signals do not confirm it (hasSQL=false). Treated |
| F-011 | Q8 | high | 0.13 | 0.60 | ✅ verified | verified | README claims "LLM Integration" but code signals do not confirm it (hasLLM=false). Treated as docume |
| F-012 | Q8 | high | 0.13 | 0.60 | ✅ verified | verified | README claims "AI Agent" but code signals do not confirm it (hasAgent=false). Treated as documentati |
| F-013 | Q9 | critical | 0.04 | 0.00 | ✅ verified | decision | No architecture decisions extracted (DecisionAnalyzer produced 0 decisions). |
| F-014 | Q10 | high | 0.04 | 0.00 | ✅ verified | verified | No constraints extracted (ConstraintAnalyzer produced 0 constraints). |
| F-015 | Q11 | high | 0.05 | 0.50 | ✅ verified | verified | Assumption A-001 (risk=high): Inputs are always well-formed (no poison/adversarial tests detected).  |
| F-016 | Q11 | high | 0.05 | 0.50 | ✅ verified | verified | Assumption A-003 (risk=medium): No cross-session memory required (stateless or single-session design |
| F-017 | Q11 | high | 0.04 | 0.50 | ✅ verified | verified | Assumption A-002 (risk=low): Node.js runtime is available (specific version not validated). Broken i |
| F-018 | Q11 | high | 0.06 | 0.50 | ✅ verified | verified | Assumption A-004 (risk=low): System behavior is deterministic (no LLM / non-deterministic AI calls d |
| F-019 | Q11 | high | 0.06 | 0.60 | ✅ verified | verified | 1 high-risk assumption(s) detected. These are the most likely failure modes under unexpected conditi |

### Findings detail (JSON-schema structured)

#### F-001 — Q1: How does a request enter the system and what is the entry shape?

- **Finding**: Repository exposes 1 entry points (sdk=1). Sample: src/index.js.
- **Importance**: critical
- **Confidence**: 0.55 (auto-computed: ast+manifest);
- **Coverage**: 0.10 (scan coverage)
- **Verified**: verified
- **Lifecycle**: reusable_pattern (candidate→hypothesis→supported→verified→decision/reusable_pattern)
- **Support**:
  - [ast] entrypoints.entrypoints — 1 entry points via AST main() / filename scan by=entrypoints
  - [manifest] discovery.manifest — manifest=src/index.js by=discovery
- **Checked Locations**: **/cli.py, **/main.py, **/index.ts, manifest scripts field, package.json bin
- **Limitations**: Framework-specific entry hooks (e.g., Spring Boot application.properties, plugin.xml) may not be detected.

#### F-002 — Q2: Where is orchestration/control-flow, and what pattern (pipeline/graph/fsm) is used?

- **Finding**: No recognizable architecture pattern detected (Unknown).
- **Importance**: critical
- **Confidence**: 0.01 (auto-computed: none);
- **Coverage**: 0.00 (scan coverage)
- **Verified**: verified — Negative finding (searched, found nothing) — verified by absence
- **Lifecycle**: verified (candidate→hypothesis→supported→verified→decision/reusable_pattern)
- **Unknown Type**: Need Reading — Orchestration logic is in source code; reading call chains can resolve.
- **Checked Locations**: discovery.topLevelDirs, discovery.architectureSignalDirs
- **Limitations**: Pattern detection is directory-name driven; code-only patterns are missed.

#### F-003 — Q3: Does Retrieval (RAG) really exist, and what is the evidence strength?

- **Finding**: No Retrieval (RAG) capability detected. CapabilityOntology reports retrieval=n/a.
- **Importance**: high
- **Confidence**: 0.09 (auto-computed: inference);
- **Coverage**: 0.60 (scan coverage)
- **Verified**: verified
- **Lifecycle**: verified (candidate→hypothesis→supported→verified→decision/reusable_pattern)
- **Support**:
  - [inference] capabilityOntology.capabilityMatrix.retrieval — retrieval=n/a by=capabilityOntology
- **Checked Locations**: embedding/, vector/, faiss/, pgvector/, chroma/, symbols.functions[].name (retriev/embed/vector search), prompts.prompts[]
- **Limitations**: CapabilityOntology gate may under-classify repos with implicit RAG (no explicit vector store symbols).

#### F-004 — Q4: Where is prompt management and what is the prompt lifecycle?

- **Finding**: No prompts detected by AST or regex scan.
- **Importance**: high
- **Confidence**: 0.32 (auto-computed: none);
- **Coverage**: 0.50 (scan coverage)
- **Verified**: verified — Negative finding (searched, found nothing) — verified by absence
- **Lifecycle**: verified (candidate→hypothesis→supported→verified→decision/reusable_pattern)
- **Unknown Type**: Need Reading — Prompt management is code-internal; reading source can resolve.
- **Checked Locations**: **/*.py (SYSTEM_PROMPT/INSTRUCTION/PROMPT), **/*.ts (systemPrompt/instruction), prompts/, **/prompt*.ts
- **Limitations**: PromptsAnalyzer detects SYSTEM_PROMPT/INSTRUCTION/PROMPT variable assignments; dynamic prompt assembly may be missed.

#### F-005 — Q5: What is the tool registry/invocation pattern, and how are tools bound to agents?

- **Finding**: No tools detected by AST decorator or schema-first scan.
- **Importance**: high
- **Confidence**: 0.32 (auto-computed: none);
- **Coverage**: 0.50 (scan coverage)
- **Verified**: verified — Negative finding (searched, found nothing) — verified by absence
- **Lifecycle**: verified (candidate→hypothesis→supported→verified→decision/reusable_pattern)
- **Unknown Type**: Need Reading — Tool registry is code-internal; reading source can resolve.
- **Checked Locations**: @tool decorator, Tool()/ToolNode(), RPC_TOOLS/ToolDef[], skills/*/execute.py, bundled_skills/*/
- **Limitations**: ToolsAnalyzer detects @tool decorator, Tool() class, RPC_TOOLS schema; custom frameworks may be missed.

#### F-006 — Q6: Is this an AI project? What concrete signals confirm or refute this?

- **Finding**: Not classified as AI project. CapabilityOntology gate found insufficient AI signals.
- **Importance**: critical
- **Confidence**: 0.05 (auto-computed: inference);
- **Coverage**: 0.00 (scan coverage)
- **Verified**: verified
- **Lifecycle**: verified (candidate→hypothesis→supported→verified→decision/reusable_pattern)
- **Unknown Type**: Need Reading — AI project signals are in source code; reading source can resolve.
- **Support**:
  - [inference] capabilityOntology.isAIProject — isAIProject=false by=capabilityOntology
- **Checked Locations**: prompts.prompts[], tools.tools[], informationFlow.llmCallSites[], responsibility.responsibilities[] (LLM Interface)

#### F-007 — Q7: How is correctness validated (tests vs evaluation), and where are the gaps?

- **Finding**: No test files detected.
- **Importance**: medium
- **Confidence**: 0.45 (auto-computed: none);
- **Coverage**: 0.00 (scan coverage)
- **Verified**: verified — Negative finding (searched, found nothing) — verified by absence
- **Lifecycle**: verified (candidate→hypothesis→supported→verified→decision/reusable_pattern)
- **Unknown Type**: Need External Evidence — Correctness assurance requires tests AND runtime/production evidence; repo alone is insufficient.
- **Checked Locations**: **/test_*.py, **/*_test.go, **/*.test.ts, **/*.spec.ts, **/tests/, **/__tests__/
- **Limitations**: Test quality (assertion density, coverage) cannot be inferred from file/function count alone.

#### F-008 — Q7: How is correctness validated (tests vs evaluation), and where are the gaps?

- **Finding**: No evaluation infrastructure detected (no eval files, hasEvaluation=false).
- **Importance**: medium
- **Confidence**: 0.06 (auto-computed: none);
- **Coverage**: 0.40 (scan coverage)
- **Verified**: verified — Negative finding (searched, found nothing) — verified by absence
- **Lifecycle**: verified (candidate→hypothesis→supported→verified→decision/reusable_pattern)
- **Unknown Type**: Need External Evidence — Correctness assurance requires tests AND runtime/production evidence; repo alone is insufficient.
- **Checked Locations**: **/eval*.py, **/benchmark*, **/leaderboard*, evaluations/, metrics/
- **Limitations**: EvaluationsAnalyzer keyword-based; may miss eval logic embedded in test files.

#### F-009 — Q8: What contradicts the README or self-presentation (false claims, hidden gaps)?

- **Finding**: README claims "Vectorized Execution" but code signals do not confirm it (hasSQL=false). Treated as documentation-only claim until source evidence is found.
- **Importance**: high
- **Confidence**: 0.13 (auto-computed: regex+inference);
- **Coverage**: 0.60 (scan coverage)
- **Verified**: verified
- **Lifecycle**: verified (candidate→hypothesis→supported→verified→decision/reusable_pattern)
- **Support**:
  - [regex] README.md — README mentions "Vectorized Execution" by=README
  - [inference] _archetypeHints.signals.hasSQL — hasSQL=false by=_archetypeHints
- **Checked Locations**: README.md, _archetypeHints.signals.hasSQL
- **Limitations**: README claim may be aspirational, planned, or in a module the analyzer did not scan.

#### F-010 — Q8: What contradicts the README or self-presentation (false claims, hidden gaps)?

- **Finding**: README claims "Distributed Query Planner" but code signals do not confirm it (hasSQL=false). Treated as documentation-only claim until source evidence is found.
- **Importance**: high
- **Confidence**: 0.13 (auto-computed: regex+inference);
- **Coverage**: 0.60 (scan coverage)
- **Verified**: verified
- **Lifecycle**: verified (candidate→hypothesis→supported→verified→decision/reusable_pattern)
- **Support**:
  - [regex] README.md — README mentions "Distributed Query Planner" by=README
  - [inference] _archetypeHints.signals.hasSQL — hasSQL=false by=_archetypeHints
- **Checked Locations**: README.md, _archetypeHints.signals.hasSQL
- **Limitations**: README claim may be aspirational, planned, or in a module the analyzer did not scan.

#### F-011 — Q8: What contradicts the README or self-presentation (false claims, hidden gaps)?

- **Finding**: README claims "LLM Integration" but code signals do not confirm it (hasLLM=false). Treated as documentation-only claim until source evidence is found.
- **Importance**: high
- **Confidence**: 0.13 (auto-computed: regex+inference);
- **Coverage**: 0.60 (scan coverage)
- **Verified**: verified
- **Lifecycle**: verified (candidate→hypothesis→supported→verified→decision/reusable_pattern)
- **Support**:
  - [regex] README.md — README mentions "LLM Integration" by=README
  - [inference] _archetypeHints.signals.hasLLM — hasLLM=false by=_archetypeHints
- **Checked Locations**: README.md, _archetypeHints.signals.hasLLM
- **Limitations**: README claim may be aspirational, planned, or in a module the analyzer did not scan.

#### F-012 — Q8: What contradicts the README or self-presentation (false claims, hidden gaps)?

- **Finding**: README claims "AI Agent" but code signals do not confirm it (hasAgent=false). Treated as documentation-only claim until source evidence is found.
- **Importance**: high
- **Confidence**: 0.13 (auto-computed: regex+inference);
- **Coverage**: 0.60 (scan coverage)
- **Verified**: verified
- **Lifecycle**: verified (candidate→hypothesis→supported→verified→decision/reusable_pattern)
- **Support**:
  - [regex] README.md — README mentions "AI Agent" by=README
  - [inference] _archetypeHints.signals.hasAgent — hasAgent=false by=_archetypeHints
- **Checked Locations**: README.md, _archetypeHints.signals.hasAgent
- **Limitations**: README claim may be aspirational, planned, or in a module the analyzer did not scan.

#### F-013 — Q9: What architecture decisions were made, and what are their tradeoffs?

- **Finding**: No architecture decisions extracted (DecisionAnalyzer produced 0 decisions).
- **Importance**: critical
- **Confidence**: 0.04 (auto-computed: none);
- **Coverage**: 0.00 (scan coverage)
- **Verified**: verified — Negative finding (searched, found nothing) — verified by absence
- **Lifecycle**: decision (candidate→hypothesis→supported→verified→decision/reusable_pattern)
- **Unknown Type**: Impossible to Verify — Architectural decisions live in ADRs / team discussions / PRs; not always recoverable from code.
- **Checked Locations**: archPattern, responsibility, tools, informationFlow, tests, capabilityOntology
- **Limitations**: DecisionAnalyzer infers decisions from analyzer outputs; repos with implicit/unconventional patterns may yield nothing.

#### F-014 — Q10: What constraints drive these decisions (and which modules do they affect)?

- **Finding**: No constraints extracted (ConstraintAnalyzer produced 0 constraints).
- **Importance**: high
- **Confidence**: 0.04 (auto-computed: none);
- **Coverage**: 0.00 (scan coverage)
- **Verified**: verified — Negative finding (searched, found nothing) — verified by absence
- **Lifecycle**: verified (candidate→hypothesis→supported→verified→decision/reusable_pattern)
- **Unknown Type**: Need External Evidence — Constraints (performance, compliance, deployment) often external to the codebase.
- **Checked Locations**: discovery.manifest.dependencies, tests.testPatterns, entrypoints, archPattern, ci
- **Limitations**: ConstraintAnalyzer infers constraints from dependencies, test patterns, entry points, and CI; repos with implicit constraints may yield nothing.

#### F-015 — Q11: What implicit assumptions does the system depend on, and where would they break?

- **Finding**: Assumption A-001 (risk=high): Inputs are always well-formed (no poison/adversarial tests detected). Broken if: Adversarial input reaches core logic; unvalidated paths crash or misbehave.
- **Importance**: high
- **Confidence**: 0.05 (auto-computed: inference);
- **Coverage**: 0.50 (scan coverage)
- **Verified**: verified
- **Lifecycle**: verified (candidate→hypothesis→supported→verified→decision/reusable_pattern)
- **Support**:
  - [inference] assumptions.A-001.evidence — tests.testPatterns does NOT include 'poison' by=assumptions
- **Checked Locations**: assumptions.assumptions[] (AssumptionAnalyzer output)
- **Limitations**: Assumption inferred from absence of evidence (e.g., no retry symbol → assumes availability); Risk level is heuristic, not domain-calibrated

#### F-016 — Q11: What implicit assumptions does the system depend on, and where would they break?

- **Finding**: Assumption A-003 (risk=medium): No cross-session memory required (stateless or single-session design). Broken if: Multi-turn conversation spans sessions; user expects continuity.
- **Importance**: high
- **Confidence**: 0.05 (auto-computed: inference);
- **Coverage**: 0.50 (scan coverage)
- **Verified**: verified
- **Lifecycle**: verified (candidate→hypothesis→supported→verified→decision/reusable_pattern)
- **Support**:
  - [inference] assumptions.A-003.evidence — capabilityOntology.capabilityMatrix.memory=n/a by=assumptions
- **Checked Locations**: assumptions.assumptions[] (AssumptionAnalyzer output)
- **Limitations**: Assumption inferred from absence of evidence (e.g., no retry symbol → assumes availability); Risk level is heuristic, not domain-calibrated

#### F-017 — Q11: What implicit assumptions does the system depend on, and where would they break?

- **Finding**: Assumption A-002 (risk=low): Node.js runtime is available (specific version not validated). Broken if: Deployed on incompatible Node.js version (e.g., missing fetch API on old Node).
- **Importance**: high
- **Confidence**: 0.04 (auto-computed: inference);
- **Coverage**: 0.50 (scan coverage)
- **Verified**: verified
- **Lifecycle**: verified (candidate→hypothesis→supported→verified→decision/reusable_pattern)
- **Support**:
  - [inference] assumptions.A-002.evidence — discovery.manifest.language=javascript by=assumptions
- **Checked Locations**: assumptions.assumptions[] (AssumptionAnalyzer output)
- **Limitations**: Assumption inferred from absence of evidence (e.g., no retry symbol → assumes availability); Risk level is heuristic, not domain-calibrated

#### F-018 — Q11: What implicit assumptions does the system depend on, and where would they break?

- **Finding**: Assumption A-004 (risk=low): System behavior is deterministic (no LLM / non-deterministic AI calls detected). Broken if: LLM or probabilistic component is introduced without updating tests.
- **Importance**: high
- **Confidence**: 0.06 (auto-computed: inference);
- **Coverage**: 0.50 (scan coverage)
- **Verified**: verified
- **Lifecycle**: verified (candidate→hypothesis→supported→verified→decision/reusable_pattern)
- **Support**:
  - [inference] assumptions.A-004.evidence — informationFlow.llmCallSites=0 by=assumptions
  - [inference] assumptions.A-004.evidence — capabilityOntology.isAIProject=false by=assumptions
- **Checked Locations**: assumptions.assumptions[] (AssumptionAnalyzer output)
- **Limitations**: Assumption inferred from absence of evidence (e.g., no retry symbol → assumes availability); Risk level is heuristic, not domain-calibrated

#### F-019 — Q11: What implicit assumptions does the system depend on, and where would they break?

- **Finding**: 1 high-risk assumption(s) detected. These are the most likely failure modes under unexpected conditions.
- **Importance**: high
- **Confidence**: 0.06 (auto-computed: inference);
- **Coverage**: 0.60 (scan coverage)
- **Verified**: verified
- **Lifecycle**: verified (candidate→hypothesis→supported→verified→decision/reusable_pattern)
- **Support**:
  - [inference] assumptions.A-001 — Inputs are always well-formed (no poison/adversarial tests detected) by=assumptions
- **Checked Locations**: assumptions.assumptions[] (risk=high)
- **Limitations**: High-risk classification is heuristic; domain-specific calibration needed.


## ★★ Evidence Synthesis (Question Resolution)

> **This section is the PRIMARY input for the LLM report.** It merges analyzer Findings by Research Question, resolves known conflicts, and emits a final verdict.
> The report body MUST be organized around this section, citing `[R-XXX]` first; raw `[F-XXX]` are supporting evidence only.

### Evidence Hierarchy

When evidence conflicts, trust the higher tier:

1. **source_code** — 源码与文件系统事实
2. **ast** — 抽象语法树分析结果
3. **graph** — 依赖图/调用图分析结果
4. **manifest** — 包管理器/CI 配置等元数据
5. **regex** — 基于正则/关键词的文本扫描
6. **keyword** — 目录名/符号名关键词匹配
7. **inference** — 启发式推理/LLM 推断

### Question Resolution Table

| ID | Q | Question | Verdict | Confidence | Resolution |
|----|---|----------|---------|------------|------------|
| R-001 | Q1 | How does a request enter the system and what is the entry sh | Yes / Present | High | Repository exposes 1 entry points (sdk=1). Sample: src/index.js. |
| R-002 | Q2 | Where is orchestration/control-flow, and what pattern (pipel | Unknown | Low | No clear architecture pattern identified. |
| R-003 | Q3 | Does Retrieval (RAG) really exist, and what is the evidence  | No / Absent | Low | No Retrieval capability detected (relevant locations checked). |
| R-004 | Q4 | Where is prompt management and what is the prompt lifecycle? | Yes / Present | Medium | No prompts detected by AST or regex scan. |
| R-005 | Q5 | What is the tool registry/invocation pattern, and how are to | Yes / Present | Medium | No tools detected by AST decorator or schema-first scan. |
| R-006 | Q6 | Is this an AI project? What concrete signals confirm or refu | No / Absent | Low | Not an AI project: Not classified as AI project. CapabilityOntology gate found insufficient AI signa |
| R-007 | Q7 | How is correctness validated (tests vs evaluation), and wher | Yes / Present | Medium | No test files detected. |
| R-008 | Q8 | What contradicts the README or self-presentation (false clai | No / Absent | Medium | No cross-analyzer contradictions or warnings detected. |
| R-009 | Q9 | What architecture decisions were made, and what are their tr | Yes / Present | Medium | 1 decision(s) verified. |
| R-010 | Q10 | What constraints drive these decisions (and which modules do | Yes / Present | Medium | 1 constraint(s) verified. |
| R-011 | Q11 | What implicit assumptions does the system depend on, and whe | Yes / Present | Medium | 5 assumption(s) verified. |

### Resolution Details

#### R-001 — Q1: How does a request enter the system and what is the entry shape?

- **Verdict**: Yes / Present (yes)
- **Confidence**: High (High)
- **Conclusion**: Repository exposes 1 entry points (sdk=1). Sample: src/index.js.
- **Primary Evidence**:
  - [ast] `entrypoints.entrypoints` — 1 entry points via AST main() / filename scan
  - [regex] `discovery.manifest` — manifest=src/index.js

#### R-002 — Q2: Where is orchestration/control-flow, and what pattern (pipeline/graph/fsm) is used?

- **Verdict**: Unknown (unknown)
- **Confidence**: Low (Low)
- **Conclusion**: No clear architecture pattern identified.

#### R-003 — Q3: Does Retrieval (RAG) really exist, and what is the evidence strength?

- **Verdict**: No / Absent (no)
- **Confidence**: Low (Low)
- **Conclusion**: No Retrieval capability detected (relevant locations checked).
- **Primary Evidence**:
  - [regex] `capabilityOntology.capabilityMatrix.retrieval` — retrieval=n/a
- **Analyzer Evidence (for reference only)**:
  - ✅ **inference**: No Retrieval (RAG) capability detected. CapabilityOntology reports retrieval=n/a.
- **Supporting Findings**: F-003
- **Checked Locations**: embedding/, vector/, faiss/, pgvector/, chroma/, symbols.functions[].name (retriev/embed/vector search), prompts.prompts[]

#### R-004 — Q4: Where is prompt management and what is the prompt lifecycle?

- **Verdict**: Yes / Present (yes)
- **Confidence**: Medium (Medium)
- **Conclusion**: No prompts detected by AST or regex scan.
- **Supporting Findings**: F-004
- **Checked Locations**: **/*.py (SYSTEM_PROMPT/INSTRUCTION/PROMPT), **/*.ts (systemPrompt/instruction), prompts/, **/prompt*.ts

#### R-005 — Q5: What is the tool registry/invocation pattern, and how are tools bound to agents?

- **Verdict**: Yes / Present (yes)
- **Confidence**: Medium (Medium)
- **Conclusion**: No tools detected by AST decorator or schema-first scan.
- **Supporting Findings**: F-005
- **Checked Locations**: @tool decorator, Tool()/ToolNode(), RPC_TOOLS/ToolDef[], skills/*/execute.py, bundled_skills/*/

#### R-006 — Q6: Is this an AI project? What concrete signals confirm or refute this?

- **Verdict**: No / Absent (no)
- **Confidence**: Low (Low)
- **Conclusion**: Not an AI project: Not classified as AI project. CapabilityOntology gate found insufficient AI signals..
- **Primary Evidence**:
  - [regex] `capabilityOntology.isAIProject` — isAIProject=false
- **Analyzer Evidence (for reference only)**:
  - ✅ **inference**: Not classified as AI project. CapabilityOntology gate found insufficient AI signals.
- **Supporting Findings**: F-006
- **Checked Locations**: prompts.prompts[], tools.tools[], informationFlow.llmCallSites[], responsibility.responsibilities[] (LLM Interface)

#### R-007 — Q7: How is correctness validated (tests vs evaluation), and where are the gaps?

- **Verdict**: Yes / Present (yes)
- **Confidence**: Medium (Medium)
- **Conclusion**: No test files detected.
- **Supporting Findings**: F-007
- **Checked Locations**: **/test_*.py, **/*_test.go, **/*.test.ts, **/*.spec.ts, **/tests/, **/__tests__/

#### R-008 — Q8: What contradicts the README or self-presentation (false claims, hidden gaps)?

- **Verdict**: No / Absent (no)
- **Confidence**: Medium (Medium)
- **Conclusion**: No cross-analyzer contradictions or warnings detected.

#### R-009 — Q9: What architecture decisions were made, and what are their tradeoffs?

- **Verdict**: Yes / Present (yes)
- **Confidence**: Medium (Medium)
- **Conclusion**: 1 decision(s) verified.
- **Supporting Findings**: F-013
- **Checked Locations**: archPattern, responsibility, tools, informationFlow, tests, capabilityOntology

#### R-010 — Q10: What constraints drive these decisions (and which modules do they affect)?

- **Verdict**: Yes / Present (yes)
- **Confidence**: Medium (Medium)
- **Conclusion**: 1 constraint(s) verified.
- **Supporting Findings**: F-014
- **Checked Locations**: discovery.manifest.dependencies, tests.testPatterns, entrypoints, archPattern, ci

#### R-011 — Q11: What implicit assumptions does the system depend on, and where would they break?

- **Verdict**: Yes / Present (yes)
- **Confidence**: Medium (Medium)
- **Conclusion**: 5 assumption(s) verified.
- **Primary Evidence**:
  - [regex] `assumptions.A-001.evidence` — tests.testPatterns does NOT include 'poison'
  - [regex] `assumptions.A-003.evidence` — capabilityOntology.capabilityMatrix.memory=n/a
  - [regex] `assumptions.A-002.evidence` — discovery.manifest.language=javascript
  - [regex] `assumptions.A-004.evidence` — informationFlow.llmCallSites=0
  - [regex] `assumptions.A-001` — Inputs are always well-formed (no poison/adversarial tests detected)
- **Analyzer Evidence (for reference only)**:
  - ✅ **inference**: Assumption A-001 (risk=high): Inputs are always well-formed (no poison/adversarial tests detected). Broken if: Adversarial input reaches core logic; unvalidated
  - ✅ **inference**: Assumption A-003 (risk=medium): No cross-session memory required (stateless or single-session design). Broken if: Multi-turn conversation spans sessions; user e
  - ✅ **inference**: Assumption A-002 (risk=low): Node.js runtime is available (specific version not validated). Broken if: Deployed on incompatible Node.js version (e.g., missing f
  - ✅ **inference**: Assumption A-004 (risk=low): System behavior is deterministic (no LLM / non-deterministic AI calls detected). Broken if: LLM or probabilistic component is intro
  - ✅ **inference**: 1 high-risk assumption(s) detected. These are the most likely failure modes under unexpected conditions.
- **Supporting Findings**: F-015, F-016, F-017, F-018, F-019
- **Checked Locations**: assumptions.assumptions[] (AssumptionAnalyzer output), assumptions.assumptions[] (risk=high)


## §A.4 Research Coverage

> Per-research-dimension evidence sufficiency. Low-coverage dimensions imply low-confidence conclusions in that area.

### Dimension Coverage

| Dimension | Coverage | Avg Confidence | Findings | Verified | Gap |
|------|----------|--------------|----------|----------|-----|
| Architecture | 100% | 22% (low) | 3 | 3 | Full coverage. |
| AI/Capability | 100% | 23% (low) | 3 | 3 | Full coverage. |
| Testing/Quality | 200% | 26% (low) | 2 | 2 | Full coverage. |
| Documentation | 400% | 13% (low) | 4 | 4 | Full coverage. |
| Decisions | 233% | 5% (low) | 7 | 7 | Full coverage. |

### Summary

- **Overall Coverage**: 207%
- **Strongest Dimension**: Documentation
- **Weakest Dimension**: Architecture — conclusions here should be flagged as low confidence.

> ⚠ **Low-confidence areas**: Architecture, AI/Capability, Testing/Quality, Documentation, Decisions. The report must explicitly flag conclusions in these areas as evidence-sparse.


## 1. Executive Brief

| Dimension | Value |
|-----------|-------|
| Repository | synthetic-readme-claims-mXhS2a (package: readme-claims) |
| Manifest | src/index.js (javascript) |
| Version | 1.0.0 |
| Source files | 1 |
| Top languages | .md (1), .json (1), .js (1) |
| Top-level dirs | src |
| Commits | 0 |
| Contributors | 0 |
| CI provider | none |
| **Project stage** | early-stage (0 commits, 0 contributors) |
| **Ecosystem** | JavaScript/Node ecosystem |

## 2. Architecture Insights

| Metric | Value | Interpretation |
|--------|-------|----------------|
| Modules | 1 | — |
| Import edges | 0 | edge/node ratio: 0.00 |
| Import cycles | 0 | no cycles — clean layering |
| Functions | 1 | 1.0 funcs/module |
| Classes | 0 | N/A |

**Coupling assessment**: edge/node ratio 0.00 → low

**Most depended-upon modules** (high in-degree = core/foundation):
  - `src.index` (in-degree: 0)

**Most influential modules** (high PageRank = architectural bottleneck):
  - `src.index` (PageRank: 1.0000)

**Entry points**: 1 total (sdk: 1)
  Sample entry points:
  - [sdk] `src/index.js` — package index entrypoint

## 2.5. Architecture Semantics (Inference, not Statistics)
Generated by 7 inference analyzers that answer architect-level questions: what pattern? what responsibilities? what capabilities? what risks?

### Responsibility Matrix
Mapped 0/1 modules to responsibility categories.

| Module | Responsibility | Confidence | Files | Capabilities |
|--------|---------------|-----------|-------|--------------|

### Stability & Abstractness (A/I Metrics)
Zone distribution: {"isolated":1}. Zone of Pain = concrete + heavily depended on (hard to change); Zone of Uselessness = over-abstract (rarely used).

| Module | I (Instability) | A (Abstractness) | Zone | Ca | Ce |
|--------|----------------|------------------|------|----|----|
| src | 0 | 0 | isolated | 0 | 0 |

### Capability Ontology
Covers 0/10 capability domains.

| Capability | Maturity | Coverage | Modules | Symbols |
|-----------|----------|----------|---------|---------|
| planning | 0 | n/a | 0 | 0 |
| execution | 0 | n/a | 0 | 0 |
| retrieval | 0 | n/a | 0 | 0 |
| memory | 0 | n/a | 0 | 0 |
| evaluation | 0 | n/a | 0 | 0 |
| safety | 0 | n/a | 0 | 0 |
| tool | 0 | n/a | 0 | 0 |
| context | 0 | n/a | 0 | 0 |
| io | 0 | n/a | 0 | 0 |
| persistence | 0 | n/a | 0 | 0 |

### Evidence Quality Metadata (Analyzer Self-Disclosure)
> Each inference analyzer ships _meta: source / strength / assumptions / limitations / possibleFalsePositives / checkedLocations.
> When citing analyzer claims, LLM should reference strength: strong > moderate > weak. Weak-analyzer claims require LLM source-code verification before trusting.

**ArchitecturePatternAnalyzer** — source: `keyword+graph`, strength: `moderate`, coverage: Directory-driven pattern detection; misses code-only patterns
- Assumptions:
  - Architecture patterns are signaled by directory names (segment match, not substring)
  - Specialized signals gate high-stakes patterns (e.g., Compiler requires codegen/optimizer/semantic/ir)
  - Graph validation (layered direction, linear chain) confirms pattern with +0.1-0.15 confidence
  - Multi-instance checks (≥3 service dirs, ≥3 manifests) confirm Microservices/Monorepo
- Limitations:
  - Cannot detect patterns with no directory-name signal (e.g., pattern implemented purely in code structure)
  - Hexagonal/Clean/Onion patterns share dir signals (domain, adapters, infrastructure) and may be indistinguishable
  - Compiler specialized-signal gate may still false-positive on repos with parser/interpreter subsets (e.g., template engines)
  - Pattern detection is recall-oriented; precision depends on directory naming conventions
- Possible false positives:
  - Repos with 'core/' dir may trigger Hexagonal/Clean/Onion even when no layered architecture exists
  - Repos with 'plugins/' dir may trigger Plugin pattern even if plugins/ contains unrelated code
  - Repos with 'service/' suffix dirs may trigger Microservices with <3 instances (downgraded confidence)

**ResponsibilityAnalyzer** — source: `keyword`, strength: `moderate`, coverage: 100% of non-test source files grouped into modules
- Assumptions:
  - Module boundaries = first 1-2 path segments (packages/foo for monorepo, top dir for flat layout)
  - Test files are excluded (isTestPath) so test fixtures don't pollute module classification
  - One directory match (score 2) or two symbol matches (score 2) are minimum evidence; single symbol match (score 1) is too weak
- Limitations:
  - Cannot detect responsibilities that span multiple modules (e.g., 'security' implemented across crypto/ + auth/)
  - Keyword matching is segment/token-prefix; unconventional naming (e.g., 'dataRepo' for persistence) may be missed
  - Modules with generic names (components/, utils/) often get Uncategorized or false-positive matches
- Possible false positives:
  - Modules named 'search' or 'query' may be tagged Retrieval even when not RAG (e.g., DB search, file search)
  - Modules named 'storage' may be tagged Persistence even for in-memory caches
  - Symbol token-prefix 'persist' may match 'persistenceLayer' in non-DB contexts

**InformationFlowAnalyzer** — source: `regex+graph`, strength: `weak`, coverage: Symbol-name regex; misses LLM calls via DI/registry/extension-point
- Assumptions:
  - LLM call sites are detected via regex on symbol names (LLM_NAME_RE: openai/anthropic/claude/gpt/llm/gemini/mistral/deepseek/qwen/bedrock/chat_completion)
  - Entry points are CLI tools, tools, or HTTP handlers from EntrypointsAnalyzer
  - Flow steps are matched by module responsibility (ResponsibilityAnalyzer)
  - BFS from entry point reaches LLM call site → flow.reachesLLM=true
- Limitations:
  - LLM_NAME_RE is recall-oriented; may false-positive on non-LLM symbols (e.g., 'palette_generator', 'completions' as variable name)
  - Rust mod/use declarations are not resolved to full module paths → reachesLLM may be false-negative for Rust projects
  - Java Eclipse extension-points (plugin.xml) are not parsed → AI subsystems in IDE plugins may be invisible to this analyzer
  - BFS is bounded by graph connectivity; isolated LLM call sites with 0 in/out edges are never reached
- Possible false positives:
  - Symbol names containing 'gpt'/'llm'/'completion' as substrings (e.g., 'Completions' type in UI libraries)
  - Variables named 'openai'/'anthropic' that are not actual LLM clients
  - Test fixtures with mock LLM clients


## 2.7. Architecture Knowledge (Decisions / Constraints / Assumptions)

> Promotes code facts to architecture knowledge: **why designed this way** (Decision), **what constrains it** (Constraint), **what it assumes** (Assumption).

### Assumptions (4, 1 high-risk)

| ID | Risk | Assumption | Broken if |
|----|------|------------|-----------|
| A-001 | 🔴 high | Inputs are always well-formed (no poison/adversarial tests detected) | Adversarial input reaches core logic; unvalidated paths cras |
| A-002 | 🟢 low | Node.js runtime is available (specific version not validated) | Deployed on incompatible Node.js version (e.g., missing fetc |
| A-003 | 🟡 medium | No cross-session memory required (stateless or single-session design) | Multi-turn conversation spans sessions; user expects continu |
| A-004 | 🟢 low | System behavior is deterministic (no LLM / non-deterministic AI calls detected) | LLM or probabilistic component is introduced without updatin |

#### High-risk assumption detail

- **A-001**: Inputs are always well-formed (no poison/adversarial tests detected)
  - Broken if: Adversarial input reaches core logic; unvalidated paths crash or misbehave
  - Evidence: tests.testPatterns does NOT include 'poison'


## 2.9. Architecture Metrics
> Structural metrics from the import graph: Layer / Cycle / Fan-in / Fan-out / Stability / Coupling.

**Summary**: 1 nodes / 0 edges / 0 cycles / 0 layers / density 0 / avg instability 0

### Fan-in / Fan-out

| Metric | Avg | Max | Max Node | Distribution (0 / 1-3 / 4-9 / 10+) |
|--------|-----|-----|----------|--------------------------------------|
| Fan-in | 0 | 0 | — | 1 / 0 / 0 / 0 |
| Fan-out | 0 | 0 | — | 1 / 0 / 0 / 0 |

### Coupling

- Density (edges/(nodes×(nodes-1))): 0
- Avg degree: 0
- Cross-layer edges: 0 (0.0% of total)

| Hub nodes (high fan-in) | Bottleneck nodes (high fan-out) |
|--------------------------|----------------------------------|
| src.index (fan-in=0) | src.index (fan-out=0) |


## 3. AI / Agent Design

No prompts or tools detected. This may not be an AI/Agent project,
or prompt/tool definitions use non-standard patterns.

## 4. Testing & Evaluation

**Testing**: No test files detected. ⚠ This is a significant quality risk.

**Evaluation**: No evaluation/benchmark artifacts detected.
  The LLM should investigate whether evaluation is done externally or is absent.

## 5. Engineering Metrics

| Metric | Value |
|--------|-------|
| Modules (AST nodes) | 1 |
| Import edges | 0 |
| Import cycles | 0 |
| Functions indexed | 1 |
| Call relations | 0 |
| Test files | 0 |
| Total commits | 0 |
| Contributors | 0 |

**Derived indicators**:
  - Coupling density: 0.00 edges/module
  - CI: none detected ⚠

**Architecture signal directories** (high structural importance):
  - `src`

## 5.5. Ontology View

> Inspired by Palantir Ontology: treat the repository as a graph of engineering objects,
> not a collection of files. Every concept is an Object with typed Relationships and linked Evidence.

### Object Type Distribution

| Type | Count |
|------|-------|
| function | 1 |
| config | 1 |
| document | 1 |

### Relationship Type Distribution

| Relationship | Count |
|--------------|-------|

### Semantic Objects (non-function/class)

| Type | Name | File | Properties |
|------|------|------|------------|

### Question-Driven Query Examples

> The following are research query paths through the object graph (Question → Object → Relationship → Evidence)

(Insufficient object relationships to build query examples)

> The LLM should use object-driven language in the report (e.g., "The Agent object connects
> to the Tool object via the uses relationship") rather than file-driven language.

## 5.5b. Core Ontology View (8-type projection)

> Palantir-light: 8 core types (Entity / Module / API / Capability / Concept / Artifact / Decision / Pattern) + 8 unified relationship verbs (implements / depends_on / owns / creates / uses / contains / exposes / replaces).
> This is a rendering-layer projection — analyzers continue to emit implementation-layer types (agent/planner/runner/tool), projected here to 8 core types for future Markdown / HTML / Mermaid / Graph rendering.

### Core Type Distribution

| Core Type | Count | Description |
|---------|------|------|
| Entity | 1 | Code unit (function/class/agent/planner/runner) |
| Module | 0 | Code boundary (repository/module) |
| API | 0 | Exposed interface (tool/prompt) |
| Capability | 0 | System capability (not directly detected yet) |
| Concept | 1 | Domain concept (finding/issue/risk/unknown) |
| Artifact | 2 | Non-code artifact (test/eval/config/doc/dataset/evidence) |
| Decision | 4 | Engineering decision (decision/constraint/assumption) |
| Pattern | 0 | Reusable pattern (pattern/tradeoff/hypothesis) |

### Core Relationship Distribution

| Verb | Count |
|---------|------|
| creates | 1 |

### Rendering Readiness

Analyzer output → Core Ontology projection → multi-format rendering:

```
Analyzer (impl type) → Knowledge Graph (core type) → Renderer
  agent              → Entity                    → Markdown
  tool               → API                       → HTML
  decision           → Decision                  → Mermaid
  pattern            → Pattern                   → Graph (Neo4j)
```


## 5.6. Research Object Graph

> Second-order research objects (Pattern/Decision/Constraint/Tradeoff/Assumption/Hypothesis/Evidence/Finding/Issue/Risk/Unknown) and their relationship graph. Each object has a source analyzer for traceability.

### Object Summary

| Type | Count |
|------|-------|
| assumption | 4 |
| risk | 1 |

- **Total objects**: 5
- **Total relationships**: 1

### Relationship Samples (top 10)

| From | Relation | To |
|------|----------|----|
| risk:A-001-risk | caused_by | assumption:A-001 |


## 6. Negative Findings (What Was NOT Found)

> These "not found" findings are equally important — they prevent the LLM from defaulting to "present".

- No test files found — quality verification strategy unclear
- No evaluation/benchmark infrastructure found
- No explicit prompt definitions detected (may use non-standard patterns or dynamic assembly)
- No explicit tool registrations detected (may use non-decorator patterns)
- No CI/CD configuration detected
- No Git history (may be a new repo or non-Git project)
- No import cycles detected — clean module layering
- No LICENSE file found
- No CONTRIBUTING guide found (external contribution process unclear)
- No SECURITY policy found (vulnerability reporting process unclear)
- No CHANGELOG found (version evolution lacks structured record)
- No AI Agent instruction files found (AGENTS.md / CLAUDE.md / SKILL.md etc.)

## 7. Reading Priority (Top Files)

Ranked by structural importance (PageRank, in-degree, entrypoint, README, tests):

| # | File | Score | Why |
|---|------|-------|-----|
| 1 | `src/index.js` | 120 | high in-degree (+40); high PageRank (+50); entrypoint (+30) |
| 2 | `README.md` | 90 | README (+50); important file (+40) |

**LLM guidance**: Read files in this order. The first 5-10 files typically reveal
the core architecture. Prioritize README, then high-PageRank modules, then entrypoints.

## 8. Reading Guide

### 30-Minute Quick Look
If you only have 30 minutes, read these files:

1. `src/index.js` — high in-degree (+40); high PageRank (+50); entrypoint (+30)
2. `README.md` — README (+50); important file (+40)

### 2-Hour Deep Dive
Then continue with:


> The LLM should reproduce and expand this list in the report's Reading Guide section, ordered by insight density.

## 9. Evidence Summary (NOT v3 research questions)

> ⚠️ **Disambiguation**: This section is a **fixed-template summary** generated by
> script-layer evidence rules. It is **NOT** the research questions or hypotheses
> of the v3 subagent workflow.
> - v3 research questions are **dynamically generated** by the `00-question-planner`
>   subagent (see `subagents/00-question-planner.md`).
> - v3 hypotheses are generated by the `01-hypothesis` subagent using **Bayesian
>   confidence evolution** (see `subagents/01-hypothesis.md`).
> This section is only an evidence reference to help subagents understand the repo.
> **Do NOT** treat H1-purpose / H2-ai-agent etc. as v3 Bayesian hypotheses.
> **Do NOT** treat the Open Questions below as v3 Research Questions.

### Evidence Summary: Script-layer Hypotheses (fixed template, NOT v3)
- **✓ H1-purpose** (high): The repository purpose and target audience can be inferred from README and manifest
- **⚠ H2-ai-agent** (low): This is an AI-agent / LLM-related project with prompts and/or tools
  - Gaps: No prompt/tool/agent signals detected
- **? H3-modular** (medium): The codebase has a modular architecture with identifiable dependency layers
- **⚠ H4-testing** (low): The project relies on automated tests for correctness
  - Gaps: No test files detected
- **✓ H5-entrypoints** (high): Entry points reveal the primary interfaces (CLI, server, SDK)
- **⚠ H6-evaluation** (low): The project measures quality through benchmarks or evaluations
  - Gaps: No evaluation or benchmark artifacts detected
- **⚠ H7-maturity** (low): The project is actively maintained with a non-trivial development history
  - Gaps: No Git history available

### Evidence Summary: Script-layer Open Questions (fixed template, NOT v3)
- [medium] **testing**: Which modules have the most test coverage, and which are under-tested?
- [medium] **evaluation**: What metrics, datasets, or judges are used for evaluation?
