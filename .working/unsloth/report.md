# Unsloth 架构分析报告

> 基于 `repo-arch-engineering` skill 对 `ref-only/unsloth`@`8dffde9` 的研究产物。
> 证据见 `.working/unsloth/evidence-log.jsonl`；模型见 `repository-model.json`；问题见 `questions/`。
> 标注：`*confidence: x · evidence_level: S/A/B/C/D/E · evidence: evidence-log.jsonl:N*`

## 1. Executive Summary

Unsloth 的架构中心是 **"import-time monkey-patch + 手写融合内核"**：在导入时把 Hugging Face 的 transformers/peft/trl 算子悄悄替换成自写的 Triton/CUDA/MLX 内核，从而让用户的现有 notebook 不改一行就获得 2x 提速、70% 省显存（MoE 最高 12x）*confidence:0.96 · evidence_level:A · evidence:ev-007,ev-008,ev-016*。最大 trade-off 是与上游版本强耦合、必须先于上游导入，一旦上游改 API 即碎 *confidence:0.95 · evidence_level:A · evidence:ev-005*。

## 2. System Identity & Business Context

### 2.1 What is this repo?
Unsloth 是 **LLM 微调库 + 本地 Studio 桌面应用**（Library/Application）。核心 Python 库约 2265 文件，另含 Rust(Tauri) Studio；支持 500+ 模型，面向单卡/消费级 GPU 用户 *confidence:0.9 · evidence_level:A · evidence:ev-010,ev-013,ev-014*。定位：让普通硬件也能高效微调大模型，并把"跑模型/训练"做成可本地部署的产品 *confidence:0.9 · evidence_level:C · evidence:ev-016*。

### 2.2 Business Context
- **满足需求**：普通硬件高效微调 + 本地模型运行/训练。
- **业务范围**：文本/音频/嵌入/视觉的微调与推理；本地优先，不提供托管 SaaS *confidence:0.9 · evidence_level:C · evidence:ev-016*。
- **Use cases**：QLoRA/LoRA/全参微调；本地推理服务（`/v1/responses` 等 OpenAI/Anthropic 兼容端点）；GRPO/FP8/视觉 RL；500K+ 长上下文 packing 训练；Studio 数据配方/模型竞技场/MCP *confidence:0.9 · evidence_level:C · evidence:ev-016*。
- **差异化**：对比原生 transformers/trl（慢、费显存）、Axolotl（配置驱动）、llama.cpp（偏推理）——Unsloth 的差异化是 **import 即加速、双后端、手动融合内核** *confidence:0.85 · evidence_level:E · evidence:ev-016*。

### 2.3 High-Level Architecture
一句话：**Unsloth 是围绕 Hugging Face 生态的"补丁光环"，在 import 时把上游算子换成自写内核，并以统一 FastModel API 暴露双后端** *confidence:0.95 · evidence_level:A · evidence:ev-001,ev-005,ev-007*。
- 组件：核心库 `unsloth`（后端门+模型补丁+内核+优化器+注册表+CLI）依赖外部 `unsloth_zoo` 承载重机械；Studio 是独立 Tauri 桌面应用 *confidence:0.92 · evidence_level:A · evidence:ev-011,ev-013*。
- 技术栈：Python+PyTorch+Triton（内核）；Typer（CLI）；Tauri+Rust+TS（Studio）；pyproject 仅 5 个直接依赖，刻意保持薄 *confidence:0.85 · evidence_level:B · evidence:ev-010*。
- 部署：库经 pip/install.sh 安装；Studio 为桌面应用；也可作为本地 API 服务 *confidence:0.9 · evidence_level:C · evidence:ev-013,ev-016*。

## 3. Architecture Thesis

### 3.1 Central Idea
**架构中心 = import-time monkey-patch + 手动融合内核**，让既有 HF 代码路径无感地走加速实现 *confidence:0.96 · evidence_level:A · evidence:ev-005,ev-007*。

### 3.2 Driving Constraints
- **c-1 必须兼容现有 notebook（不改正代码）** → 选 import-time 全局 patch *confidence:0.95 · evidence_level:A · evidence:ev-005*。
- **c-2 消费级/单卡显存有限** → 手写融合内核 + 反量化/低秩优化器 *confidence:0.9 · evidence_level:A · evidence:ev-009*。
- **c-3 需同时支持 Apple Silicon 与 CUDA/ROCm** → 单一 import 双后端 + MLX CUDA 兼容 shim *confidence:0.95 · evidence_level:A · evidence:ev-001,ev-003*。
- **c-4 重机械需被多前端复用** → 拆出 `unsloth_zoo` 外部包 *confidence:0.9 · evidence_level:A · evidence:ev-011*。

## 4. Key Design Decisions
- **d-1 import-time 全局 patch 上游库** — Context：让用户零改动。Alternative：显式 FastModel 子类化（需改代码）。Trade-off：用上游强耦合换零改动兼容。Implements c-1 *confidence:0.95 · evidence_level:A · evidence:ev-005,ev-006*。
- **d-2 手写内核替换 HF 原生算子** — Context：HF 原生未融合、费显存。Alternative：仅改训练循环用原生算子。Trade-off：用内核维护成本换 2x/70%。Implements c-2 *confidence:0.96 · evidence_level:A · evidence:ev-007,ev-008,ev-009*。
- **d-3 单一 import 双后端** — Context：同时支持 Apple Silicon 与 GPU。Alternative：两个独立包。Trade-off：用分支复杂度换统一 API。Implements c-3 *confidence:0.93 · evidence_level:A · evidence:ev-001,ev-003*。
- **d-4 核心与 unsloth_zoo 拆分** — Context：重机械需复用。Alternative：全放 unsloth。Trade-off：用版本错配风险换轻量复用。Implements c-4 *confidence:0.9 · evidence_level:A · evidence:ev-010,ev-011*。
- **d-5 Studio Tauri+AGPL / 核心 Apache** — Context：桌面需原生后端；核心需商业友好。Alternative：统一栈/统一许可。Trade-off：用双栈+许可管理换原生体验与商业可用。Implements c-4 *confidence:0.93 · evidence_level:A · evidence:ev-013*。

## 5. Resulting Architecture
### 5.1 Boundaries（按"为什么存在"组织）
1. **后端门 `_IS_MLX`**：最上游，决定 MLX 还是 GPU 代码路径 *confidence:0.95 · evidence_level:A · evidence:ev-001*。
2. **HF patch 边界**：unsloth 必须先于 transformers/peft/trl 导入，否则优化不生效（绑定 d-1）*confidence:0.95 · evidence_level:A · evidence:ev-005*。
3. **core ↔ unsloth_zoo**：薄补丁层 vs 重机械下沉（绑定 d-4）*confidence:0.9 · evidence_level:A · evidence:ev-011*。
4. **core(Apache-2.0) ↔ studio(AGPL-3.0)**：许可与技术栈双重边界（绑定 d-5）*confidence:0.93 · evidence_level:A · evidence:ev-013*。

### 5.2 Extension Mechanism
扩展哲学是 **"为新模型族写 `Fast*` 类 + 对应内核"**（模式固定但需手写）；`registry/` 让 Studio 能发现/下载新模型 *confidence:0.92 · evidence_level:A · evidence:ev-007,ev-012*。

## 6. Runtime Realization
### 6.1 One Request Story
`import unsloth` → 选后端(`_IS_MLX`) → GPU 路径 `_gpu_init` patch 上游 → `FastModel.from_pretrained` 按量化参数分派到 `Fast*Model` → `pre_patch` 再 `post_patch` 把 HF 前向换成 `fast_*` 内核 → 训练时 `fast_rms_layernorm/rope/swiglu/cross_entropy` 融合执行，`fast_dequantize` 省显存。每步都对应"无感加速"这一中心约束 *confidence:0.9 · evidence_level:A · evidence:ev-001,ev-005,ev-007,ev-009*。

### 6.2 Backpressure & Failure Isolation
Studio 层提供训练监控与 GPU 用量图；库本身降级依赖上游（梯度检查点、量化），未见独立背压机制 *confidence:0.7 · evidence_level:E · evidence:ev-016*。

## 7. Quality Attributes
- **Extensibility**：中——新模型需写 `Fast*` 类+内核，门槛高但模式固定 *confidence:0.9 · evidence_level:A · evidence:ev-007*。
- **Maintainability**：中低——import-time patch + 大量 `import_fixes` + 跨包版本兼容分支，脆弱 *confidence:0.9 · evidence_level:A · evidence:ev-005,ev-006,ev-011*。
- **Performance**：高——手动融合内核带来 2x/70%/MoE 12x *confidence:0.96 · evidence_level:A · evidence:ev-007,ev-008,ev-016*。
- **Testability**：中——`tests/` 覆盖 python/sh/qlora/saving/security/studio，但内核正确性依赖端到端 *confidence:0.8 · evidence_level:B · evidence:tests/*。
- **Observability**：中——Studio 提供训练监控；库本身日志有限 *confidence:0.75 · evidence_level:C · evidence:ev-016*。
- **Security**：中——Studio 含 MCP 端点+子代理集成，攻击面在桌面应用层 *confidence:0.8 · evidence_level:A · evidence:ev-013,ev-014*。

## 8. Risks and Debt
- **rk-1 与 transformers/peft/trl 版本强耦合** — 上游改 API→patch 失败→慢路径或 ImportError *confidence:0.95 · evidence_level:A · evidence:ev-005,ev-006*。
- **rk-2 unsloth_zoo 版本错配** — 训练/MLX 模块缺失→ImportError 或降级 *confidence:0.9 · evidence_level:A · evidence:ev-010,ev-011*。
- **rk-3 双后端 import-time 分支 + CUDA 兼容 shim** — MLX 上误用 CUDA API 时行为异常（已 no-op 化）*confidence:0.9 · evidence_level:A · evidence:ev-003*。
- **rk-4 Studio AGPL-3.0 传染** — SaaS/分发误用触发开源义务 *confidence:0.93 · evidence_level:A · evidence:ev-013*。
- **rk-5 MLX 后端能力子集** — Apple Silicon 跑非 SFT（GRPO/DPO/ORPO、FastSentenceTransformer）→ NotImplementedError *confidence:0.9 · evidence_level:A · evidence:ev-003,ev-004*。

## 9. Unknowns
- **uk-1** Studio 后端(Python) 与 Tauri(Rust) 的确切进程/通信模型未细读（需 `studio/backend` + `src-tauri`）。
- **uk-2** CLI 子代理 MCP（claude/codex）权限模型未细读（需 `unsloth_cli/_tool_policy.py`）。
- **uk-3** 量化(4bit/FP8) 与模型族映射完整矩阵未穷举（需 `registry/_qwen` 等 + loader 量化分支）。
- **testing / history 维度** 本轮未深入（无针对性问题），见附录 A。

## Appendix A: Research Provenance
- **Questions**: q-001..q-006（round-1，全部 `model_updated`）→ `questions/round-1.reviewed.json`。
- **Evidence**: 16 条（`ev-001`..`ev-016`）→ `evidence-log.jsonl`。
- **Hypotheses**: hyp-001..hyp-006 全部 `confirmed` → `hypotheses.json`。
- **Source files**: `unsloth/__init__.py`, `unsloth/_gpu_init.py`, `unsloth/models/{loader,llama,__init__}.py`, `unsloth/kernels/__init__.py`, `unsloth/registry/__init__.py`, `pyproject.toml`, `cli.py`, `studio/src-tauri/Cargo.toml`, `studio/LICENSE.AGPL-3.0`, `README.md`。

## Appendix B: Evidence Level Legend
- **S** Code+Test+Formal · **A** Code+Test · **B** Code only · **C** Doc+Code 交叉 · **D** Doc only · **E** Inference。
