# 运行失败分析报告

> 来源：用户提供的运行记录截图/日志（任务 `9dae335b`、`895349e9`，2026/11/9）。
> 分析范围：`tools/novel-generation` 生成流水线、模型运行时、上下文注入。
> 本报告仅分析，未修改代码。

## 1. 失败现象

两条运行记录均以 `exit=1` 结束，且：

- `正文=false`、`终审=false`、`状态提交=false` — 章节从未进入终审，自然也没有状态提交。
- 日志末尾：`模型链均失败（deepseek-v4.1-flash → hy4free，来源 config）：deepseek-v4.1-flash: 调用超时（120000ms），已中断 | hy4free: 调用超时（120000ms），已中断`。
- 上下文注入行：`[write] 注入：事实包 0 字 / 分析参考 0 字 / 检索片段 6 条`。
- 任务 `9dae335b`（Legacy 旧版）：已完成 1/5 章，第 2 章未通过终审或 Story State 提交门禁；恢复 0 次。

## 2. 根因分析

### 2.1 主因：模型链全部超时（外部服务/网络问题）

- 偏好链 `deepseek-v4.1-flash → hy4free`（来源：CodeBuddy 产品配置）两个模型均在 120000ms 超时被中断。
- `generate.ts` 的 `runAgentText` 会对每个模型尝试超时/中断/重试，但两个模型都失败后无更多候选 → 抛出"模型链均失败"。
- 这是**外部模型服务或网络可达性问题**，不是生成逻辑 bug：模型在 30s/60s/90s 都"已收文本 0 字"，说明请求根本未返回任何内容，大概率是网络不通、代理异常、或 CodeBuddy 会话/凭据过期。

### 2.2 次因：分析参考 0 字（story_analysis 快照未注入）

- `[write] 注入：… 分析参考 0 字` 说明 `buildStoryAnalysisContext` 未产出任何内容。
- 可能原因：`story_analysis` 表为空、快照 `analysisVersion` 低于当前 v6、或 `complete=false`。按 ADR，旧版快照不得注入。
- 结果：写作阶段失去了人物小传/主线/伏笔/关系等全文分析参考，仅靠 6 条 BM25 检索片段，弱化了 continuity 保障（但不是失败直接原因）。

### 2.3 次因：事实包 0 字（writing-brief 无命中）

- `writing-brief.ts` 按任务词面匹配人物/情节线/伏笔，本章 brief 与库中条目无词面重合 → 事实包为空。
- 这是已知的弱匹配问题（与此前分析报告问题点 3 一致），不直接导致失败，但进一步削弱 continuity。

### 2.4 任务 9dae335b 的额外信息

- Legacy 旧版任务，已完成 1/5 章，第 2 章未通过终审或 Story State 提交门禁。
- 说明第 1 章可能已成功生成并提交了状态，第 2 章在生成过程中因模型超时失败。恢复 0 次表示尚未从检查点恢复。

## 3. 为什么"正文=false / 终审=false / 状态提交=false"

流水线顺序：规划 → 正文 → 对白 → 叙事声音 → Anti-AI → 终审 → 状态提取 → 提交。
模型在"正文"阶段（`generateStory`/`runAgentText`）就超时失败，因此后续所有阶段均未执行，`chapter.md` 未写出，终审与状态提交自然为 false。这不是门禁拒绝，而是**生成未完成**。

## 4. 建议的排查与恢复步骤

1. **检查运行时**：执行 `npm run dev -- check-runtime`，确认 CLI 登录状态与模型目录解析（`models` 命令）。
2. **检查网络/代理**：确认 CodeBuddy Agent SDK 能访问模型端点；必要时设置 `ACC_PRODUCT_CONFIG_PATH` 或检查 `~/.codebuddy/local_storage/*.info`。
3. **重新生成分析快照**：若 `story_analysis` 为空或版本过旧，运行 `npm run dev -- analyze-story --world <worldId>`（可加 `--delta` 复用旧长文本），确保 v6 快照完整。
4. **从检查点恢复**：生成运行已落盘阶段缓存（`.output/<world>/chapter-*/pipeline-manifest.json`），可用 `--resume-dir <dir>` 从最后一个完整阶段恢复，避免重跑已完成阶段。
5. **调整超时**：若模型稳定但慢，可提高 `--timeout-ms`（默认 120000ms），或换用更快的模型。
6. **strict-model**：实验时用 `--strict-model` 禁止静默回退，确保失败如实上报。

## 5. 结论

- **直接原因**：模型链（deepseek-v4.1-flash → hy4free）全部超时，无可用响应，生成在正文阶段失败。
- **加剧因素**：分析参考 0 字（快照缺失/过旧）+ 事实包 0 字（词面匹配无命中），削弱了上下文质量，但不是失败的直接原因。
- **非代码 bug**：生成逻辑、门禁、状态提交链路本身正常；失败源于外部模型服务不可用/网络不通。修复网络/凭据后重跑或从检查点恢复即可。

> 以上为分析报告，未修改任何代码。
