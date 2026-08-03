# Unsloth 架构分析报告

> 分析对象：`ref-only/unsloth`@`8dffde9611f6`
> 视角：Solution Architect（Repository Engineering Research）
> 产物：Repository Knowledge Model + 本报告；所有 claim 均带 `confidence · evidence_level · evidence` 标注

---

## 1. Executive Summary

Unsloth 的架构中心是 **import-time monkey-patch Hugging Face（transformers/peft/trl）+ 手写 Triton/CUDA/MLX 融合内核**。去掉这层补丁，系统退化成普通 transformers/trl，失去全部加速价值。最大 trade-off：为「零改动兼容」与「双后端统一 API」付出的，是与上游版本强耦合、import-time 分支脆弱、以及 Apple Silicon 上仅能跑 SFT 的能力子集。**（confidence: 0.95 · evidence_level: A · evidence: ev-005, ev-007, ev-008, ev-024）**

---

## 2. System Identity & Business Context

### 2.1 What is this repo?

Unsloth 是一个 **LLM 微调加速库 + 桌面 Studio 产品**。它通过两层机制让用户的现有 notebook 不改一行就获得加速：第一层是在导入时全局替换 Hugging Face 生态（transformers/peft/trl）的关键算子；第二层是用手写融合内核（Triton/CUDA/MLX）替换 HF 原生实现。**（confidence: 0.95 · evidence_level: A · evidence: ev-005, ev-007）**

- 类型：Library + Application（finetuning library + Tauri desktop Studio）
- 规模信号：988 个 Python 文件 + 439 TS / 372 TSX 前端 + 25 Rust；292 个测试文件；月度发布节奏（git tag 从 2024-07 到 2026-02）。**（confidence: 0.9 · evidence_level: C/D · evidence: ev-019）**
- 目标用户：ML 研究者 / 独立开发者 / 企业微调团队（库形态）；以及想零配置微调的非专家（Studio 桌面 / Colab 形态）。**（confidence: 0.85 · evidence_level: C · evidence: ev-013, ev-021）**
- 语言/框架：Python + Rust + TypeScript；PyTorch、Triton、HF transformers/peft/trl、Typer、Tauri。构建系统为 setuptools + setuptools-scm。**（confidence: 0.9 · evidence_level: B · evidence: ev-010, ev-021）**

### 2.2 Business Context

**满足什么业务需求：** 降低 LLM 微调的显存与算力门槛，使消费级 GPU（≤24GB）乃至 Apple Silicon 也能跑 QLoRA / 全参微调。这是核心市场痛点——原生 HF 微调在大模型上显存爆炸。**（confidence: 0.9 · evidence_level: C · evidence: ev-007, ev-025）**

**业务范围（含边界）：** 覆盖模型加载（量化）、前向/反向内核加速、训练循环、模型族注册、Studio 桌面 GUI、CLI 工具。明确不覆盖：训练理论本身（Unsloth 不发明新算法）、推理服务的规模化生产部署（Studio 仅本地）。**（confidence: 0.85 · evidence_level: C · evidence: ev-013, ev-028）**

**典型使用场景：**
1. 笔记本上 4bit QLoRA 微调 Llama/Qwen（最主流场景）。
2. Apple Silicon 上跑 SFT（MLX 后端）。
3. Studio 可视化数据准备 + 训练监控（桌面 GUI）。
4. CLI 调用 claude/codex 子代理辅助微调流程。**（confidence: 0.85 · evidence_level: C · evidence: ev-013, ev-014, ev-029）**

**市场差异化：** 相较于原生 PEFT/TRL（无加速）、bitsandbytes（仅量化无内核）、Axolotl（高层编排）、GPTQ/AWQ（仅推理量化），Unsloth 的差异点是 **「patch 零改动 + 内核融合 + 双后端统一 API」三者叠加**。**（confidence: 0.85 · evidence_level: C · evidence: ev-005, ev-007, ev-001）**

### 2.3 High-Level Architecture

**一句话整体架构：** Unsloth 是一个围绕 Hugging Face 生态的 monkey-patch 加速层，通过手写融合内核 + 量化 + 双后端（GPU/MLX）统一 API，把微调成本压到消费级硬件可承受。**（confidence: 0.95 · evidence_level: A · evidence: ev-005, ev-007, ev-001）**

**主要组件及其关系（high-level）：**
- **薄 patch 层（unsloth 包）**：约 988 个 Python 文件中的核心，负责 import-time 替换与内核挂载。
- **重型机械（unsloth_zoo 外部包）**：被多前端（库 / Studio / CLI）复用的训练 util、MLX 模块等下沉于此。**（confidence: 0.9 · evidence_level: A · evidence: ev-010, ev-011）**
- **FastModel 公开 API**：串起 loader → models(Fast*) → kernels 的研究主路径。
- **Studio（Tauri + Python 后端）** 与 **CLI（Typer + MCP 子代理）** 作为可选产品面。**（confidence: 0.9 · evidence_level: A · evidence: ev-013, ev-014）**

**技术栈选择理由：**
- PyTorch + Triton/CUDA：内核融合收益最大，是加速主来源。**（confidence: 0.96 · evidence_level: A · evidence: ev-007, ev-008）**
- HF transformers/peft/trl：patch 目标，借力生态而非重建。**（confidence: 0.95 · evidence_level: A · evidence: ev-005）**
- Typer：CLI 轻量。Tauri + Rust + TS：桌面原生 + 小体积，避开 Electron 内存开销。**（confidence: 0.85 · evidence_level: B · evidence: ev-013）**
- FastAPI/uvicorn：Studio 后端 HTTP 服务。**（confidence: 0.85 · evidence_level: A · evidence: ev-028）**

**部署模型：** 双分发——pip Apache-2.0 库（自托管 / Colab）+ Tauri AGPL-3.0 桌面（本地 GUI），后端为 localhost uvicorn 服务。**（confidence: 0.85 · evidence_level: B · evidence: ev-021, ev-028）**

---

## 3. Architecture Thesis

### 3.1 Central Idea

**架构中心 = import-time monkey-patch Hugging Face + 手写融合内核。** 这不是「又一个新的训练框架」，而是「在用户不知情的情况下，把 HF 的慢路径换掉」。所有对外价值（2x 提速、70% 省显存）都建立在这层透明加速之上。**（confidence: 0.96 · evidence_level: A · evidence: ev-005, ev-007, ev-008）**

### 3.2 If Removed

如果去掉这层 patch：**系统退化成普通 transformers/trl**——零加速、无 70% 省显存、用户必须手动改写 notebook 才能接入 Unsloth 的优化。换句话说，Unloth 的「产品」就是这层补丁本身，而非任何独立组件。这就是为什么它与上游强耦合是设计必然，而非技术债。**（confidence: 0.95 · evidence_level: A · evidence: ev-005, ev-007）**

### 3.3 Architecture Evolution Timeline（历史维度）

Unsloth 没有 CHANGELOG 文件，历史编码在**月度 git tag（2024-07 → 2026-02）**与 commit message 中。**（confidence: 0.82 · evidence_level: D · evidence: ev-019）**

- **2024-07 起点：** 纯 patching 库（首个 commits 为 "Initial commit" / "First upload of Unsloth code"）。此时价值主张已确立——透明加速 HF，而非新框架。**（confidence: 0.82 · evidence_level: D · evidence: ev-020）**
- **2024–2025：** 月度 tag 发布节奏建立；量化（4bit/fp8）与多模型族注册表逐步成熟，`QuantType` 成为模型身份一等维度。**（confidence: 0.85 · evidence_level: A/D · evidence: ev-019, ev-025, ev-026）**
- **当前（8dffde9）：** MLX 后端大幅**内联**进 `__init__.py`（约 1400 行兼容层）；Studio 成为独立产品面（Tauri + Python 后端）；AMD/Intel XPU 支持进入 CI。**（confidence: 0.85 · evidence_level: A/D · evidence: ev-003, ev-004, ev-013, ev-020, ev-027）**

**演进方向判断：** 从「纯库」向「双后端 + Studio 产品」扩张，且近期投资明显偏向 Studio 与硬件广度（AMD/Intel XPU），而非核心内核变更。这与 thesis（patch 层是中心）一致——核心机制稳定，扩张发生在产品面与硬件覆盖上。**（confidence: 0.82 · evidence_level: C/D · evidence: ev-020）**

---

## 4. Key Design Decisions

> 按「先看决策，再看结构」原则。每个决策绑定一个被迫的硬约束（见 §3.2 / narrative c-1..c-5）。

### 4.1 import-time 全局 monkey-patch HF（dd-1）

- **Context：** 用户已有大量 HF notebook，绝不肯为了加速而改写代码。
- **Alternatives（被拒绝）：** 显式 FastModel 子类化 / 包装——需要用户改代码， adoption 成本极高。
- **Trade-off：** 用「与 transformers/peft/trl 版本强耦合」+「必须先于上游导入」的约束，换取「零改动兼容」。
- **Implements Constraint：** c-1。
- **Evidence Level：** confidence 0.95 · A · ev-005, ev-006。**（invariant：unsloth 必须在上游之前导入，否则优化不生效。）**

### 4.2 手写融合内核替换 HF 算子（dd-2）

- **Context：** HF 原生实现未融合、显存占用高，是微调瓶颈根源。
- **Alternatives（被拒绝）：** 直接用 HF 默认实现 + 仅改训练循环——无法获得内核级收益。
- **Trade-off：** 用「每新架构需写 Fast* 类 + 内核」的维护成本，换取 2x 提速 / 70% 省显存（MoE 可达 12x）。
- **Implements Constraint：** c-2。
- **Evidence Level：** confidence 0.96 · A · ev-007, ev-008, ev-009。**（invariant：所有加速收益来自手动内核替换，而非新模型结构。）**

### 4.3 单一 import 双后端（dd-3）

- **Context：** 需同时支持 Apple Silicon（MLX）与 CUDA/ROCm/Intel XPU。
- **Alternatives（被拒绝）：** 两个独立包——分裂 API，用户需按硬件选择。
- **Trade-off：** 用 import-time 分支复杂度 + CUDA 兼容 shim 维护成本，换取统一 FastModel API。
- **Implements Constraint：** c-3。
- **Evidence Level：** confidence 0.9 · A · ev-001, ev-002, ev-003, ev-222。`__init__.py` 长达 1467 行，其中约 1400 行是内联的 MLX/CUDA 兼容层。**（confidence: 0.9 · evidence_level: A · evidence: ev-022）**

### 4.4 核心库与 unsloth_zoo 拆分（dd-4）

- **Context：** 共享重机械需被多前端（库 / Studio / CLI）复用。
- **Alternatives（被拒绝）：** 全部放进 unsloth——核心包膨胀，复用困难。
- **Trade-off：** 用跨包版本错配风险，换取核心包轻量与复用。
- **Implements Constraint：** c-2。
- **Evidence Level：** confidence 0.9 · A · ev-010, ev-011。**（risks rk-2：薄依赖未强约束，zoo 版本错配可直接 ImportError。）**

### 4.5 Studio 用 Tauri（AGPL-3.0）/ 核心 Apache-2.0（dd-5）

- **Context：** 桌面产品需原生后端；核心库需商业友好许可。
- **Alternatives（被拒绝）：** 统一技术栈 / 统一许可——要么牺牲原生体验，要么让核心库染上 copyleft。
- **Trade-off：** 用双栈维护成本 + 许可边界管理，换取 Studio 原生体验与核心商业可用。
- **Implements Constraint：** c-4。
- **Evidence Level：** confidence 0.9 · B · ev-013, ev-021。**（risks rk-4：AGPL 传染，SaaS/分发场景误用 Studio 触发开源义务。）**

### 4.6 量化默认 4bit QLoRA + fp8 为辅（dd-6，扩展决策）

- **Context：** finetuning 显存瓶颈在权重 + 优化器状态两端。
- **Alternatives（被拒绝）：** 仅依赖优化器状态削减（GaLore）——单杠杆不足以在消费级硬件跑大模型。
- **Trade-off：** 用 bitsandbytes 4bit 依赖 + AMD 不稳定（已显式禁用）的风险，换取 70% 省显存 + 与 GaLore 形成双杠杆。
- **Implements Constraint：** c-2。
- **Evidence Level：** confidence 0.9 · A · ev-025, ev-030。`loader.from_pretrained` 默认 `load_in_4bit=True`（QLoRA），`load_in_fp8` 接受 True/False/'block'；尊重用户 `BitsAndBytesConfig`；AMD 4bit 显式禁用（"currently not stable with bitsandbytes"）。**（confidence: 0.9 · evidence_level: A · evidence: ev-025）**

### 4.7 测试重心放在 patch 接口面回归守卫（dd-7，扩展决策）

- **Context：** 上游 API 高频漂移是最高频破坏源；内核数学正确性难以 unit 化。
- **Alternatives（被拒绝）：** 为每个手写内核写数值 unit test——成本高且易过时。
- **Trade-off：** 用「内核正确性仅靠端到端 training sanity」的盲区，换取对上游漂移的快速防护。
- **Implements Constraint：** c-5。
- **Evidence Level：** confidence 0.88 · C · ev-017, ev-018。详见 §7 testability 与 §8 rk-6。

### 4.8 决策耦合：为什么不能孤立改动

这 7 个决策彼此咬合，而非独立开关。**dd-1（import-time patch）是总闸门**——它使 dd-2（内核替换）能在用户无感下生效；dd-3（双后端）依赖 dd-1 在导入早期完成分支；dd-4（zoo 拆分）是 dd-2/dd-3 重型机械的落点；dd-5（双许可）界定 dd-1~dd-4 属于哪个产品面；dd-6（量化）与 dd-7（测试重心）是 dd-2 在「显存」与「可靠性」两个方向的延伸。**（confidence: 0.9 · evidence_level: A · evidence: ev-005, ev-007, ev-010, ev-013, ev-025, ev-017）** 这意味着任何「局部优化」若破坏 import-time 闸门（例如把 patch 改成显式调用），会连锁推翻 dd-2~dd-4 的零改动价值——这正是上游强耦合被接受为「设计必然」而非「技术债」的深层原因。**（confidence: 0.9 · evidence_level: A · evidence: ev-005）**

---

## 5. Resulting Architecture

### 5.1 Boundaries——按「为什么存在」组织

1. **backend gate（_IS_MLX）——最上游 import-time fork。** 决定 MLX 还是 GPU 代码路径；且被单元测试锁定（`test_is_mlx_dispatch_gate.py` 断言 `_IS_MLX` 必须委托 `_is_mlx_available()`）。**（confidence: 0.9 · evidence_level: A · evidence: ev-022）**
2. **HF patch boundary——unsloth → transformers/peft/trl。** import-time 全局替换上游算子，unsloth 必须先于上游导入。**（confidence: 0.95 · evidence_level: A · evidence: ev-005）**
3. **core ↔ unsloth_zoo——薄补丁层 vs 重机械下沉。** 版本错配风险边界。**（confidence: 0.9 · evidence_level: A · evidence: ev-010, ev-011）**
4. **core(APL) ↔ studio(AGPL)——许可 + 产品边界。** 许可边界恰好等于产品边界（库 vs 桌面）。**（confidence: 0.9 · evidence_level: B · evidence: ev-013, ev-021）**
5. **MLX capability-subset boundary——unsloth(MLX) → SFT-only 子集。** CUDA API 被 no-op 化（`_patch_mlx_batch_encoding_to_cuda`，`__init__.py:143-179`），GRPO/DPO/ORPO/FastSentenceTransformer 抛 `NotImplementedError`。**（confidence: 0.9 · evidence_level: A · evidence: ev-022, ev-023, ev-024）**
6. **Studio native boundary——Python train loop ↔ Rust/TS Tauri。** Rust 层（`desktop_backend_owner.rs`）拥有后端进程生命周期 + `lease_secret`/path-grant 安全中介；经 localhost uvicorn HTTP 通信，而非直接 FS/进程调用。**（confidence: 0.88 · evidence_level: A · evidence: ev-027, ev-028）**

### 5.2 Extension Mechanism——扩展哲学

扩展哲学 = **每新模型族写一个 `Fast*` 类（`pre_patch`/`post_patch`）+ 对应内核，注册进 `MODEL_REGISTRY`**。`QuantType` 枚举（NONE/UNSLOTH/BNB_4BIT/FP8）使量化成为模型身份的**一等维度**而非事后处理——`org="unsloth" + QUANT_TYPE.UNSLOTH` 是 `NONE` 的别名。**（confidence: 0.9 · evidence_level: A · evidence: ev-026）** 模式固定但门槛高（需同时写模型类 + 内核），这是 extensibility 评级为 medium 的根因。**（confidence: 0.85 · evidence_level: A · evidence: ev-007）**

---

## 6. Runtime Realization

### 6.1 One Request Story（一个典型微调请求的叙事）

1. **`import unsloth`** → 触发后端选择（mod-init）。**（confidence: 0.95 · evidence_level: A · evidence: ev-001）**
2. **选择后端（`_IS_MLX`）** → 决定 MLX 或 GPU 路径。这一步绑定约束 c-3（双后端统一）。**（confidence: 0.9 · evidence_level: A · evidence: ev-002, ev-222）**
3. **GPU 路径：`_gpu_init` 执行 `import_fixes` + patch 上游** → 必须先于上游导入（约束 c-1）。**（confidence: 0.95 · evidence_level: A · evidence: ev-005, ev-006）**
4. **`FastModel.from_pretrained(量化参数，默认 4bit QLoRA)`** → loader 按量化分派（约束 c-2，dd-6）。**（confidence: 0.9 · evidence_level: A · evidence: ev-011, ev-025）**
5. **`model_patcher.pre_patch()`** → 卸载 HF 原生模块。**（confidence: 0.95 · evidence_level: A · evidence: ev-007）**
6. **加载权重 + `post_patch()` 替换内核** → fast_rms_layernorm / fast_rope / fast_swiglu / fast_cross_entropy / fast_dequantize（提速 + 省显存的核心动作）。**（confidence: 0.96 · evidence_level: A · evidence: ev-007, ev-008, ev-009）**
7. **`get_peft_model` / `UnslothTrainer` 训练** → 优化器更新经 q_galore 低秩投影削减 Adam 状态显存（第二显存杠杆）。**（confidence: 0.85 · evidence_level: A · evidence: ev-030）**

每一步都绑定一个架构约束，而非孤立的步骤——这正是「架构是决策的结果」的体现。

### 6.2 Backpressure & Failure Isolation

- **Studio 后端启动脆弱点：** `run.py` 需修复 CUDA `LD_LIBRARY_PATH`（`_fix_torch_cuda_ld_path` + 单次 re-exec），否则 conda/Docker 基础镜像的 CUDA 会影子化 torch 的 libs 导致 `undefined symbol`。**（confidence: 0.85 · evidence_level: A · evidence: ev-028）**
- **MLX 误用防护：** MLX 上 CUDA 设备调用被 no-op 化（`_unsloth_mlx_cuda_noop` 标记），防止误用 CUDA API 时行为异常。**（confidence: 0.9 · evidence_level: A · evidence: ev-023）**
- **量化稳定性护栏：** AMD 上 4bit 显式禁用（"currently not stable"），避免静默错误。**（confidence: 0.85 · evidence_level: A · evidence: ev-025）**

---

## 7. Quality Attributes

- **Extensibility（medium）：** 新模型需写 `Fast*` 类 + 内核，门槛高但模式固定；注册表 + `QuantType` 使模型/量化扩展结构化。**（confidence: 0.85 · evidence_level: A · evidence: ev-007, ev-026）**
- **Maintainability（low-medium）：** import-time patch + 大量 `import_fixes` + 跨包版本兼容分支 + 1467 行 `__init__` 内联 MLX/CUDA shim，整体脆弱。**（confidence: 0.88 · evidence_level: A · evidence: ev-005, ev-006, ev-011, ev-222）**
- **Performance（high）：** 手动融合内核（2x / 70% / MoE 12x）+ 4bit 量化 + GaLore 三重显存/速度杠杆。**（confidence: 0.96 · evidence_level: A · evidence: ev-007, ev-008, ev-016, ev-025, ev-030）**
- **Testability（low）：** 292 测试文件中绝大多数覆盖 Studio 安装/后端/前端契约；库内核数值正确性**无 unit test**，仅靠端到端 training sanity；库测试本质是 patch-drift 回归守卫（import_fixes_drift、kwargs 门控、fp8 上下文等）。**（confidence: 0.88 · evidence_level: C · evidence: ev-017, ev-018）**
- **Observability（medium）：** Studio 提供训练监控；库本身日志有限；后端启动含 CUDA LD 修复日志重写。**（confidence: 0.8 · evidence_level: A · evidence: ev-016, ev-028）**
- **Security（medium-low）：** CLI/Studio 工具默认开启（`tool_policy`/`host_policy` 默认 on）+ 本地 MCP 子代理委派扩大攻击面；Rust 层用 `lease_secret`/path-grant 中介文件访问，降低直连风险。**（confidence: 0.82 · evidence_level: A · evidence: ev-013, ev-014, ev-027, ev-029）**
- **Deployability（medium）：** 双分发（pip 库 + Tauri 桌面 + Colab）；后端启动依赖 CUDA LD re-exec 修复，脆弱。**（confidence: 0.8 · evidence_level: B · evidence: ev-021, ev-028）**

---

## 8. Risks and Debt

- **rk-1（高）：与 transformers/peft/trl 版本强耦合。** 上游改 API 即碎 → patch 失败或静默走原生慢路径 / ImportError。**（confidence: 0.95 · evidence_level: A · evidence: ev-005, ev-006）**
- **rk-2（中）：unsloth_zoo 版本错配。** 薄依赖未强约束 → 训练 util/MLX 模块缺失 → ImportError 或功能降级。**（confidence: 0.9 · evidence_level: A · evidence: ev-010, ev-011）**
- **rk-3（中）：双后端 import-time 分支复杂度 + CUDA 兼容 shim。** MLX 上误用 CUDA API 时行为异常（虽已 no-op 化）。**（confidence: 0.9 · evidence_level: A · evidence: ev-003, ev-023）**
- **rk-4（中）：Studio AGPL-3.0 许可传染 vs 核心 Apache-2.0。** SaaS/分发场景误用 Studio 触发开源义务。**（confidence: 0.9 · evidence_level: B · evidence: ev-013, ev-021）**
- **rk-5（高）：MLX 后端能力子集。** 无 GRPO/DPO/ORPO、无 FastSentenceTransformer → Apple Silicon 跑非 SFT 训练直接 `NotImplementedError`。**（confidence: 0.9 · evidence_level: A · evidence: ev-003, ev-004, ev-024）**
- **rk-6（高）：内核数值正确性无 unit test。** 某手写内核数值回归可能长期不被发现，直到用户端到端训练异常——这是 testability=low 的直接后果。**（confidence: 0.85 · evidence_level: C · evidence: ev-017, ev-018）**
- **rk-7（中）：tools 默认开启 + 本地 MCP 子代理委派。** 默认开启的工具在被诱导时可能执行非预期本地操作（claude/codex 子代理）。**（confidence: 0.82 · evidence_level: A · evidence: ev-029）**
- **rk-8（中）：Studio 后端依赖 CUDA LD_LIBRARY_PATH re-exec 修复。** conda/Docker CUDA 影子化 torch libs → `undefined symbol`；re-exec 依赖入口正确调用。**（confidence: 0.85 · evidence_level: A · evidence: ev-028）**

---

## 9. Unknowns

- **uk-1（已解答）：** Studio 后端与 Tauri 通信模型——Rust 拥有生命周期 + `lease_secret`/path-grant 中介，localhost uvicorn HTTP。**（evidence: ev-027, ev-028）**
- **uk-2（已解答）：** CLI 子代理 MCP 权限——`host_policy`/`tool_policy` 双策略，工具默认 on，`--enable/disable` 覆盖。**（evidence: ev-029）**
- **uk-3（已解答）：** 量化↔模型族映射——`QuantType` 枚举 + 每族 registry 文件 + loader 量化分支。**（evidence: ev-025, ev-026）**
- **uk-4（need_reading）：** 完整「量化 × 模型族」矩阵未逐行穷举（仅确认机制与枚举），需逐族核对 `registry/_qwen` 等 + loader 量化分支全路径。**（evidence: ev-026）**
- **uk-5（need_reading）：** GaLore 低秩投影的具体秩/缩放实现与数值保证未细读，需深入 `q_galore_projector.py` 内部数学。**（evidence: ev-030）**

---

## 10. Change Difficulty & Blast Radius（改 X 会炸哪里）

> 对应 skill 成功标准：「能回答改 X 会炸哪里（Blast Radius）和哪些改动容易、哪些危险（Change Difficulty）」。

- **改 `unsloth/__init__.py` 的后端分支（_IS_MLX）：** 最危险。它是最上游闸门，错配会导致 MLX/GPU 全路径失效；且被 `test_is_mlx_dispatch_gate.py` 锁定——必须委托 `_is_mlx_available()`，内联判定会直接单测失败。**（confidence: 0.9 · evidence_level: A · evidence: ev-022）**
- **改某个 `Fast*` 模型的 `post_patch` 内核：** 中高风险。影响单一模型族的加速与显存，但回归仅由端到端训练 sanity 发现（无 unit test，见 rk-6），可能长期潜伏。**（confidence: 0.85 · evidence_level: A/C · evidence: ev-007, ev-018）**
- **升级 `transformers`/`peft`/`trl` 大版本：** 高风险。直接触发 rk-1——patch 目标 API 漂移，可能静默走原生慢路径（性能退化但无报错）或 `ImportError`。这是 Unsloth 最常见的「用户侧破碎」来源。**（confidence: 0.95 · evidence_level: A · evidence: ev-005, ev-006）**
- **升级 `unsloth_zoo`：** 中风险。薄依赖未强约束，错配导致训练 util/MLX 模块缺失（rk-2）。**（confidence: 0.9 · evidence_level: A · evidence: ev-010, ev-011）**
- **加一个新模型族：** 中等难度但模式固定——写 `Fast*` 类 + 内核 + 注册进 `MODEL_REGISTRY`（含 `QuantType`）。门槛在「需同时写模型类与内核」而非逻辑复杂。**（confidence: 0.85 · evidence_level: A · evidence: ev-007, ev-026）**
- **在 Apple Silicon 上启用非 SFT 训练：** 不可行。MLX 是 SFT-only 子集，GRPO/DPO/ORPO 直接 `NotImplementedError`（rk-5）——这不是「改动难度」问题，是能力边界。**（confidence: 0.9 · evidence_level: A · evidence: ev-024）**

**结论：** 最容易安全的改动是「加模型族」（模式固定、隔离好）；最危险的是「动后端闸门」与「升上游大版本」（连锁面广、回归隐蔽）。**（confidence: 0.9 · evidence_level: A · evidence: ev-022, ev-005）**

---

## Appendix A: Research Provenance

- **Questions：** 14 个（round-1: 6，round-2: 8），全部 `model_updated`。
- **Hypotheses：** 14 条，全部 `confirmed`（confidence 0.82–0.96）。
- **Evidence：** 30 条（`evidence-log.jsonl`，observation/inference 分离；Tier A 为主，少量 C/D）。
- **Source files read：** `unsloth/__init__.py`(1467 行)、`_gpu_init.py`、`models/loader.py`、`models/*.py`、`kernels/*.py`、`optimizers/*`、`registry/*`、`unsloth_cli/_tool_policy.py`、`studio/backend/run.py`、`studio/src-tauri/src/{desktop_backend_owner,native_intents}.rs`、`tests/`、`pyproject.toml`、`git log`/`git tag`。
- **Rounds：** round-1（架构/运行时/决策），round-2（测试/历史/部署深度 + MLX/量化/Studio 通信/CLI/优化器）。

## Appendix B: Evidence Level Legend

| Level | Basis | 本报告示例 |
|------|------|------|
| **S** | Code + Test + Formal | （本报告无形式化验证，最高到 A） |
| **A** | Code + Test / 直接源码证据 | 内核替换、patch 边界、MLX no-op、量化分支 |
| **B** | Code only（无 test 验证） | 双许可、技术栈选择 |
| **C** | Documentation + Code 交叉验证 | 测试主题分布、规模、用户群 |
| **D** | Documentation / commit only | 月度 tag 发布节奏、演进轨迹 |
| **E** | Inference | （本报告尽量用 A 级源码证据，未依赖纯推断） |

> **Evidence Level ≠ Evidence Tier**（见 SKILL §6.5）：Level 标注 claim 的支撑组合，Tier 标注单条证据来源性质；本报告 claim 多为 A 级（直接源码）。
