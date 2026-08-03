# Unsloth 架构分析报告

> 分析对象：`ref-only/unsloth`@`8dffde9611f6`
> 视角：Solution Architect（Repository Engineering Research）
> 产物：Repository Knowledge Model + 本报告；所有 claim 均带 `confidence · evidence_level · evidence` 标注
> 质量基准：参考 p7.md 架构报告成熟度标准（System Context / Architecture Style / Data Architecture / Strengths / Risks / Engineering Insights）

---

## 1. Executive Summary

Unsloth 的架构中心是 **import-time monkey-patch Hugging Face（transformers/peft/trl）+ 手写 Triton/CUDA/MLX 融合内核**。去掉这层补丁，系统退化成普通 transformers/trl，失去全部加速价值。最大 trade-off：为「零改动兼容」与「双后端统一 API」付出的，是与上游版本强耦合、import-time 分支脆弱、以及 Apple Silicon 上仅能跑 SFT 的能力子集。**（confidence: 0.95 · evidence_level: A · evidence: ev-005, ev-007, ev-008, ev-024）**

- **系统定位**：LLM 微调加速库 + 桌面 Studio 产品（Library + Application）。
- **核心架构模式**：Patch-based Transparent Acceleration Layer（装饰 Hugging Face）+ Registry-driven Capability Extension（详见 §3.1）。
- **最大工程特点**：在不改写用户一行代码的前提下，把 HF 的慢路径替换为手写融合内核。
- **关键设计取舍**：用「与上游版本强耦合 + import-time 分支脆弱」换取「零改动兼容 + 双后端统一 API」。
- **主要技术债务**：① 与 `transformers/peft/trl` 版本强耦合，上游大版本易静默走慢路径或 `ImportError`；② import-time 分支（尤其 MLX/CUDA 兼容 shim）脆弱且难以单元测试；③ 手写内核数值正确性无单测，仅靠端到端 training sanity 覆盖；④ 核心（Apache-2.0）与 Studio（AGPL-3.0）双许可边界带来分发/SaaS 场景的合规管理成本。**（confidence: 0.9 · evidence_level: A/C · evidence: ev-005, ev-006, ev-017, ev-013, ev-021）**

---

## 2. System Identity & Context

### 2.1 What is this repo?

Unsloth 是一个 **LLM 微调加速库 + 桌面 Studio 产品**。它通过两层机制让用户的现有 notebook 不改一行就获得加速：第一层是在导入时全局替换 Hugging Face 生态（transformers/peft/trl）的关键算子；第二层是用手写融合内核（Triton/CUDA/MLX）替换 HF 原生实现。**（confidence: 0.95 · evidence_level: A · evidence: ev-005, ev-007）**

- 类型：Library + Application（finetuning library + Tauri desktop Studio）
- 规模信号：988 个 Python 文件 + 439 TS / 372 TSX 前端 + 25 Rust；292 个测试文件；月度发布节奏（git tag 从 2024-07 到 2026-02）。**（confidence: 0.9 · evidence_level: C/D · evidence: ev-019）**
- 目标用户：ML 研究者 / 独立开发者 / 企业微调团队（库形态）；以及想零配置微调的非专家（Studio 桌面 / Colab 形态）。**（confidence: 0.85 · evidence_level: C · evidence: ev-013, ev-021）**
- 语言/框架：Python + Rust + TypeScript；PyTorch、Triton、HF transformers/peft/trl、Typer、Tauri。构建系统为 setuptools + setuptools-scm。**（confidence: 0.9 · evidence_level: B · evidence: ev-010, ev-021）**

### 2.2 System Context（C4 Level 1）

> 明确系统负责什么、不负责什么，以及与外部 Actor 的边界（p7.md §2）。

```
                    ML Practitioner (库用户)        Studio User (非专家)
                            |                              |
                            v                              v
                   +-------------------------------+
                   |        Unsloth 系统           |
                   |  (透明加速层 + 量化 + 双后端)   |
                   +-------------------------------+
                      |          |           |           |
          patch目标   量化依赖    硬件后端      模型来源
                      |          |           |           |
                +-----v--+   +---v----+  +----v-----+  +----v--------+
                | HF生态  |   |bitsand- |  | NVIDIA /  |  | HuggingFace |
                |trans-/  |   |bytes    |  | AMD /     |  | Hub        |
                |formers/ |   |(NF4/fp8)|  | Intel /   |  | (权重下载)  |
                |peft/trl |   |         |  | Apple MLX |  |            |
                +--------+   +--------+  +----------+  +------------+
```

| Actor | 作用 | 与系统关系 |
| --- | --- | --- |
| ML Practitioner | 写 HF notebook，期望零改动加速 | 库直接用户；import unsloth 即生效 |
| Studio User | 桌面 GUI 做数据准备 + 训练监控 | 经 Tauri/Rust → localhost uvicorn 后端 |
| Hugging Face 生态 | patch **目标**（transformers/peft/trl） | 被装饰/替换，非依赖重建 |
| bitsandbytes | 4bit/fp8 量化原语 | 量化依赖（AMD 4bit 已禁用） |
| 硬件后端 | NVIDIA CUDA / AMD ROCm / Intel XPU / Apple MLX | 运行时代码路径分派目标 |
| HuggingFace Hub | 模型权重来源 | 经 `MODEL_REGISTRY` 发现与下载 |

**系统负责**：透明加速层、量化加载、融合内核前向/反向、训练循环、模型族注册、Studio 桌面 GUI、CLI。
**系统不负责**：训练算法理论本身（不发明新算法）、规模化推理服务的生产部署（Studio 仅本地）、模型权重内容（来自 Hub）。**（confidence: 0.85 · evidence_level: C · evidence: ev-013, ev-028）**

### 2.3 Business Context

**满足什么业务需求：** 降低 LLM 微调的显存与算力门槛，使消费级 GPU（≤24GB）乃至 Apple Silicon 也能跑 QLoRA / 全参微调。这是核心市场痛点——原生 HF 微调在大模型上显存爆炸。**（confidence: 0.9 · evidence_level: C · evidence: ev-007, ev-025）**

**业务范围（含边界）：** 覆盖模型加载（量化）、前向/反向内核加速、训练循环、模型族注册、Studio 桌面 GUI、CLI 工具。明确不覆盖：训练理论本身（Unsloth 不发明新算法）、推理服务的规模化生产部署（Studio 仅本地）。**（confidence: 0.85 · evidence_level: C · evidence: ev-013, ev-028）**

**典型使用场景：**
1. 笔记本上 4bit QLoRA 微调 Llama/Qwen（最主流场景）。
2. Apple Silicon 上跑 SFT（MLX 后端）。
3. Studio 可视化数据准备 + 训练监控（桌面 GUI）。
4. CLI 调用 claude/codex 子代理辅助微调流程。**（confidence: 0.85 · evidence_level: C · evidence: ev-013, ev-014, ev-029）**

**市场差异化：** 相较于原生 PEFT/TRL（无加速）、bitsandbytes（仅量化无内核）、Axolotl（高层编排）、GPTQ/AWQ（仅推理量化），Unsloth 的差异点是 **「patch 零改动 + 内核融合 + 双后端统一 API」三者叠加**。**（confidence: 0.85 · evidence_level: C · evidence: ev-005, ev-007, ev-001）**

### 2.4 High-Level Architecture

**一句话整体架构：** Unsloth 是一个围绕 Hugging Face 生态的 monkey-patch 加速层，通过手写融合内核 + 量化 + 双后端（GPU/MLX）统一 API，把微调成本压到消费级硬件可承受。**（confidence: 0.95 · evidence_level: A · evidence: ev-005, ev-007, ev-001）**

**主要组件及其关系（high-level）：**
- **薄 patch 层（unsloth 包）**：约 988 个 Python 文件中的核心，负责 import-time 替换与内核挂载。
- **重型机械（unsloth_zoo 外部包）**：被多前端（库 / Studio / CLI）复用的训练 util、MLX 模块等下沉于此。**（confidence: 0.9 · evidence_level: A · evidence: ev-010, ev-011）**
- **FastModel 公开 API**：串起 loader → models(Fast*) → kernels 的研究主路径。
- **Studio（Tauri + Python 后端）** 与 **CLI（Typer + MCP 子代理）** 作为可选产品面。**（confidence: 0.9 · evidence_level: A · evidence: ev-013, ev-014）**
- **入口锚点：** patch 在 `unsloth/__init__.py:1-200` 完成（`_gpu_init` / `_IS_MLX` 后端选择）；模型加载主入口为 `models/loader.py` 的 `FastModel.from_pretrained`；融合内核实现集中在 `kernels/`（`fast_*.py`）。**（confidence: 0.9 · evidence_level: A · evidence: ev-001, ev-022, ev-007）**

**技术栈选择理由：**
- PyTorch + Triton/CUDA：内核融合收益最大，是加速主来源。**（confidence: 0.96 · evidence_level: A · evidence: ev-007, ev-008）**
- HF transformers/peft/trl：patch 目标，借力生态而非重建。**（confidence: 0.95 · evidence_level: A · evidence: ev-005）**
- Typer：CLI 轻量。Tauri + Rust + TS：桌面原生 + 小体积，避开 Electron 内存开销。**（confidence: 0.85 · evidence_level: B · evidence: ev-013）**
- FastAPI/uvicorn：Studio 后端 HTTP 服务。**（confidence: 0.85 · evidence_level: A · evidence: ev-028）**

**部署模型：** 双分发——pip Apache-2.0 库（自托管 / Colab）+ Tauri AGPL-3.0 桌面（本地 GUI），后端为 localhost uvicorn 服务。**（confidence: 0.85 · evidence_level: B · evidence: ev-021, ev-028）**

---

## 3. Architecture Overview

### 3.1 Architecture Style（架构风格识别）

Unsloth 不是传统分层/MVC，而是三种风格的叠加：

1. **Patch-based Transparent Acceleration Layer（装饰器 / monkey-patch）**：在 import 时包裹 HF，而非要求用户改用新 API。`unsloth/__init__.py` 调用 `_gpu_init` 执行 `import_fixes` + `model_patcher` 全局替换上游模块与函数，发生在用户首个 `from transformers import ...` 之前。**（confidence: 0.95 · evidence_level: A · evidence: ev-005, ev-001）**
2. **Facade over Dual Backend（双后端门面）**：对外只暴露 `FastModel` 一个 API，内部按 `_IS_MLX` 在导入早期分派到 MLX 或 GPU 代码路径；MLX 分支刻意把 CUDA API 伪装成 no-op 以兼容调用 `.to('cuda')` 的上游/用户代码。**（confidence: 0.93 · evidence_level: A · evidence: ev-001, ev-003, ev-023）**
3. **Registry-driven Capability Extension（注册式能力扩展）**：模型族与量化类型通过 `MODEL_REGISTRY` / `QuantType` 集中注册，新能力 = 数据条目而非代码分叉。**（confidence: 0.92 · evidence_level: A · evidence: ev-012, ev-026）**

**为什么采用这种风格：** 唯一目标是「用户零改动 adoption」+「双硬件统一 API」。装饰器风格让现有 notebook 直接受益；门面风格隐藏后端差异；注册风格让模型族/量化扩展可预测。**（confidence: 0.92 · evidence_level: A · evidence: ev-005, ev-001, ev-012）**

**带来的约束：** ① import 顺序敏感（必须先于上游导入）；② 与上游 API 强耦合（上游漂移即失效）；③ MLX 后端被迫成为 CUDA 的能力子集（no-op 伪装）。这些约束不是技术债，而是「透明加速」设计目标的必然代价。**（confidence: 0.92 · evidence_level: A · evidence: ev-005, ev-003, ev-024）**

### 3.2 Driving Constraints（塑造架构的硬约束 c-1..c-5）

5 个硬约束塑造了全部关键决策；每个决策在 §4 标注它 implements 哪一个。**（confidence: 0.9 · evidence_level: A · evidence: ev-005, ev-007, ev-001, ev-013, ev-017）**

- **c-1 零改动 adoption：** 用户绝不改写现有 HF notebook——加速必须以 import-time 透明方式生效。
- **c-2 消费级硬件可行：** 微调显存/算力必须压到 ≤24GB GPU 乃至 Apple Silicon 可承受。
- **c-3 双后端统一：** 必须同时支持 CUDA/ROCm/Intel XPU 与 Apple Silicon（MLX），且对外单一 API。
- **c-4 许可与体验分治：** 核心库须商业友好（Apache-2.0）；Studio 桌面须原生体验（Tauri）。
- **c-5 上游漂移高频：** HF 生态 API 高频漂移是最常见破坏源，须快速防护。

### 3.3 Central Idea

**架构中心 = import-time monkey-patch Hugging Face + 手写融合内核。** 这不是「又一个新的训练框架」，而是「在用户不知情的情况下，把 HF 的慢路径换掉」。所有对外价值（2x 提速、70% 省显存）都建立在这层透明加速之上。**（confidence: 0.96 · evidence_level: A · evidence: ev-005, ev-007, ev-008）**

### 3.4 If Removed

如果去掉这层 patch：**系统退化成普通 transformers/trl**——零加速、无 70% 省显存、用户必须手动改写 notebook 才能接入 Unsloth 的优化。换句话说，Unloth 的「产品」就是这层补丁本身，而非任何独立组件。这就是为什么它与上游强耦合是设计必然，而非技术债。**（confidence: 0.95 · evidence_level: A · evidence: ev-005, ev-007）**

### 3.5 Architecture Evolution Timeline（历史维度）

Unsloth 没有 CHANGELOG 文件，历史编码在**月度 git tag（2024-07 → 2026-02）**与 commit message 中。**（confidence: 0.82 · evidence_level: D · evidence: ev-019）**

- **2024-07 起点：** 纯 patching 库（首个 commits 为 "Initial commit" / "First upload of Unsloth code"）。此时价值主张已确立——透明加速 HF，而非新框架。**（confidence: 0.82 · evidence_level: D · evidence: ev-020）**
- **2024–2025：** 月度 tag 发布节奏建立；量化（4bit/fp8）与多模型族注册表逐步成熟，`QuantType` 成为模型身份一等维度。**（confidence: 0.85 · evidence_level: A/D · evidence: ev-019, ev-025, ev-026）**
- **当前（8dffde9）：** MLX 后端大幅**内联**进 `__init__.py`（约 1400 行兼容层）；Studio 成为独立产品面（Tauri + Python 后端）；AMD/Intel XPU 支持进入 CI。**（confidence: 0.85 · evidence_level: A/D · evidence: ev-003, ev-004, ev-013, ev-020, ev-027）**

**演进方向判断：** 从「纯库」向「双后端 + Studio 产品」扩张，且近期投资明显偏向 Studio 与硬件广度（AMD/Intel XPU），而非核心内核变更。这与 thesis（patch 层是中心）一致——核心机制稳定，扩张发生在产品面与硬件覆盖上。**（confidence: 0.82 · evidence_level: C/D · evidence: ev-020）**

---

## 4. Key Design Decisions

> 按「先看决策，再看结构」原则。每个决策绑定一个被迫的硬约束（见 §3.2 c-1..c-5）。

### 4.1 import-time 全局 monkey-patch HF（dd-1）

- **Context：** 用户已有大量 HF notebook，绝不肯为了加速而改写代码。
- **Alternatives（被拒绝）：** 显式 FastModel 子类化 / 包装——需要用户改代码， adoption 成本极高。
- **Trade-off：** 用「与 transformers/peft/trl 版本强耦合」+「必须先于上游导入」的约束，换取「零改动兼容」。
- **Implements Constraint：** c-1。
- **（confidence: 0.95 · evidence_level: A · evidence: ev-005, ev-006）** invariant：unsloth 必须在上游之前导入，否则优化不生效。
- **机制：** 导入时 `unsloth/__init__.py` 调用 `_gpu_init` 执行 `import_fixes`（上游版本适配分支）+ `model_patcher` 全局替换 transformers/peft/trl 的模块与函数；替换动作发生在用户第一个 `from transformers import ...` 之前。**（confidence: 0.9 · evidence_level: A · evidence: ev-001, ev-005）**

### 4.2 手写融合内核替换 HF 算子（dd-2）

- **Context：** HF 原生实现未融合、显存占用高，是微调瓶颈根源。
- **Alternatives（被拒绝）：** 直接用 HF 默认实现 + 仅改训练循环——无法获得内核级收益。
- **Trade-off：** 用「每新架构需写 Fast* 类 + 内核」的维护成本，换取 2x 提速 / 70% 省显存（MoE 可达 12x）。
- **Implements Constraint：** c-2。
- **（confidence: 0.96 · evidence_level: A · evidence: ev-007, ev-008, ev-009）** invariant：所有加速收益来自手动内核替换，而非新模型结构。

### 4.3 单一 import 双后端（dd-3）

- **Context：** 需同时支持 Apple Silicon（MLX）与 CUDA/ROCm/Intel XPU。
- **Alternatives（被拒绝）：** 两个独立包——分裂 API，用户需按硬件选择。
- **Trade-off：** 用 import-time 分支复杂度 + CUDA 兼容 shim 维护成本，换取统一 FastModel API。
- **Implements Constraint：** c-3。
- **（confidence: 0.9 · evidence_level: A · evidence: ev-001, ev-002, ev-003, ev-022）** `__init__.py` 长达 1467 行，其中约 1400 行是内联的 MLX/CUDA 兼容层。

### 4.4 核心库与 unsloth_zoo 拆分（dd-4）

- **Context：** 共享重机械需被多前端（库 / Studio / CLI）复用。
- **Alternatives（被拒绝）：** 全部放进 unsloth——核心包膨胀，复用困难。
- **Trade-off：** 用跨包版本错配风险，换取核心包轻量与复用。
- **Implements Constraint：** c-2。
- **（confidence: 0.9 · evidence_level: A · evidence: ev-010, ev-011）** 注意：zoo 薄依赖未强约束，版本错配可直接 ImportError。

### 4.5 Studio 用 Tauri（AGPL-3.0）/ 核心 Apache-2.0（dd-5）

- **Context：** 桌面产品需原生后端；核心库需商业友好许可。
- **Alternatives（被拒绝）：** 统一技术栈 / 统一许可——要么牺牲原生体验，要么让核心库染上 copyleft。
- **Trade-off：** 用双栈维护成本 + 许可边界管理，换取 Studio 原生体验与核心商业可用。
- **Implements Constraint：** c-4。
- **（confidence: 0.9 · evidence_level: B · evidence: ev-013, ev-021）** 注意：Studio AGPL-3.0 与核心 Apache-2.0 边界——SaaS/分发场景误用 Studio 触发开源义务。

### 4.6 量化默认 4bit QLoRA + fp8 为辅（dd-6，扩展决策）

- **Context：** finetuning 显存瓶颈在权重 + 优化器状态两端。
- **Alternatives（被拒绝）：** 仅依赖优化器状态削减（GaLore）——单杠杆不足以在消费级硬件跑大模型。
- **Trade-off：** 用 bitsandbytes 4bit 依赖 + AMD 不稳定（已显式禁用）的风险，换取 70% 省显存 + 与 GaLore 形成双杠杆。
- **Implements Constraint：** c-2。
- **（confidence: 0.9 · evidence_level: A · evidence: ev-025, ev-030）** `loader.from_pretrained` 默认 `load_in_4bit=True`（QLoRA），`load_in_fp8` 接受 True/False/'block'；尊重用户 `BitsAndBytesConfig`；AMD 4bit 显式禁用（"currently not stable with bitsandbytes"）。

### 4.7 测试重心放在 patch 接口面回归守卫（dd-7，扩展决策）

- **Context：** 上游 API 高频漂移是最高频破坏源；内核数学正确性难以 unit 化。
- **Alternatives（被拒绝）：** 为每个手写内核写数值 unit test——成本高且易过时。
- **Trade-off：** 用「内核正确性仅靠端到端 training sanity」的盲区，换取对上游漂移的快速防护。
- **Implements Constraint：** c-5。
- **（confidence: 0.88 · evidence_level: C · evidence: ev-017, ev-018）** 内核数值正确性无 unit test，仅由端到端 training sanity 覆盖——这是该决策的已知测试盲区。

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

扩展哲学 = **每新模型族写一个 `Fast*` 类（`pre_patch`/`post_patch`）+ 对应内核，注册进 `MODEL_REGISTRY`**。`QuantType` 枚举（NONE/UNSLOTH/BNB_4BIT/FP8）使量化成为模型身份的**一等维度**而非事后处理——`org="unsloth" + QUANT_TYPE.UNSLOTH` 是 `NONE` 的别名。**（confidence: 0.9 · evidence_level: A · evidence: ev-026）** 模式固定但门槛高：扩展者必须同时写 `Fast*` 模型类（复制 HF 对应类的 `pre_patch`/`post_patch` 骨架）与 Triton/CUDA/MLX 三后端之一的内核，且要保证数值结果与 HF 一致——这解释了为何模型族扩展虽「可预测」却并不「轻量」。**（confidence: 0.85 · evidence_level: A · evidence: ev-007, ev-026）**

---

## 6. Data Architecture（数据架构）

> 回答「数据如何流动」——p7.md §7。Unsloth 的加速价值本质上来自对**张量显存**与**优化器状态**两类数据的重新组织，本节还原其数据模型与流转。

### 6.1 核心数据模型

- **模型权重 = 量化张量。** `QuantType` 枚举（NONE / UNSLOTH / BNB_4BIT / FP8）使量化成为模型身份的**一等维度**：`MODEL_REGISTRY` 中以 `org="unsloth" + QUANT_TYPE.UNSLOTH` 作为 `NONE` 的别名。`loader.from_pretrained` 默认 `load_in_4bit=True`（NF4 4bit QLoRA），`load_in_fp8` 接受 `True/False/'block'`，并尊重用户 `BitsAndBytesConfig`。**（confidence: 0.9 · evidence_level: A · evidence: ev-025, ev-026）**
- **优化器状态 = 低秩投影张量。** `optimizers/q_galore_adamw.py` + `q_galore_projector.py` 通过梯度低秩投影削减 Adam 状态显存，是省显存的**第二杠杆**。**（confidence: 0.85 · evidence_level: A · evidence: ev-030）**
- **模型目录 = `MODEL_REGISTRY` 数据表。** `registry/__init__.py` 集中注册六大家族（`_register_deepseek/_gemma/_llama/_mistral/_phi/_qwen`），`ModelInfo` 编码 name / base / version / size / quant_types，`search_models(...)` 供 Studio 发现与 loader 分派。**（confidence: 0.92 · evidence_level: A · evidence: ev-012）**

### 6.2 数据流（一次微调的内存轨迹）

```
HuggingFace Hub 权重 (safetensors/bin)
        |
        v  loader.from_pretrained(load_in_4bit=True)
量化权重张量 (NF4 4bit) ── 驻留 GPU/MLX 显存
        |
        v  post_patch() 替换 forward 内核
fast_rms_layernorm / fast_rope / fast_swiglu / fast_cross_entropy
        |
        v  反向 + 优化器更新
q_galore 低秩投影 ── 削减 Adam 状态显存（第二杠杆）
        |
        v   checkpoint 落盘 (safetensors)
```

- **无持久化数据库**：所有状态是「显存/内存张量 + checkpoint 文件」，序列化沿用 HuggingFace `safetensors`/`bin`，无自定义格式。**（confidence: 0.85 · evidence_level: A · evidence: ev-012, ev-025）**
- **两个正交显存杠杆**：量化（压权重端）+ GaLore（压优化器状态端）同时作用于微调显存的两大消费者，这正是「70% less VRAM」的来源而非单一技巧。**（confidence: 0.9 · evidence_level: A · evidence: ev-025, ev-030）**

### 6.3 数据架构带来的约束

- 量化是模型身份的一部分 → 同一模型因 `QuantType` 产生不同 `Fast*` 加载路径，扩展模型族必须同步扩展 registry 与 quant 分派。**（confidence: 0.9 · evidence_level: A · evidence: ev-026）**
- 优化器状态低秩化依赖 `q_galore` 专用优化器 → 用户若用原生 AdamW 则失去第二杠杆，显存回到原生水平。**（confidence: 0.85 · evidence_level: A · evidence: ev-030）**

---

## 7. Runtime Realization

### 7.1 One Request Story（一个典型微调请求的叙事）

1. **`import unsloth`** → 触发后端选择（mod-init）。**（confidence: 0.95 · evidence_level: A · evidence: ev-001）**
2. **选择后端（`_IS_MLX`）** → 决定 MLX 或 GPU 路径。这一步绑定约束 c-3（双后端统一）。**（confidence: 0.9 · evidence_level: A · evidence: ev-002, ev-001）**
3. **GPU 路径：`_gpu_init` 执行 `import_fixes` + patch 上游** → 必须先于上游导入（约束 c-1）。**（confidence: 0.95 · evidence_level: A · evidence: ev-005, ev-006）**
4. **`FastModel.from_pretrained(量化参数，默认 4bit QLoRA)`** → loader 按量化分派（约束 c-2，dd-6）。**（confidence: 0.9 · evidence_level: A · evidence: ev-011, ev-025）**
5. **`model_patcher.pre_patch()`** → 卸载 HF 原生模块。**（confidence: 0.95 · evidence_level: A · evidence: ev-007）**
6. **加载权重 + `post_patch()` 替换内核** → fast_rms_layernorm / fast_rope / fast_swiglu / fast_cross_entropy / fast_dequantize（提速 + 省显存的核心动作）。**（confidence: 0.96 · evidence_level: A · evidence: ev-007, ev-008, ev-009）**
7. **`get_peft_model` / `UnslothTrainer` 训练** → 优化器更新经 q_galore 低秩投影削减 Adam 状态显存（第二显存杠杆）。**（confidence: 0.85 · evidence_level: A · evidence: ev-030）**

每一步都绑定一个架构约束，而非孤立的步骤——这正是「架构是决策的结果」的体现。

### 7.2 Studio 请求流（桌面训练路径）

Studio 走一条独立的运行时链路，体现「Python train loop ↔ Rust/TS Tauri」边界：**（confidence: 0.88 · evidence_level: A · evidence: ev-027, ev-028）**

```
Tauri(Rust) GUI
   |  launch + own lifecycle
   v
desktop_backend_owner.rs ── lease_secret / path-grant 中介
   |  spawn OS process (单次 re-exec 修复 CUDA LD_LIBRARY_PATH)
   v
uvicorn HTTP (0.0.0.0) ── localhost 通信
   |
   v
Python backend (run.py) ── 复用同一套 FastModel/内核
```

- **进程/线程模型**：Rust 持有 Python 后端进程生命周期，后端崩溃由 Rust 重启而非拖垮 GUI；`lease_secret`/`path-grant` 确保子进程仅能访问被显式授予的路径与密钥。**（confidence: 0.85 · evidence_level: A · evidence: ev-027, ev-028）**
- **状态管理**：训练状态在 Python 后端内存中，GUI 经 HTTP 轮询/推送监控；无跨进程共享内存。**（confidence: 0.85 · evidence_level: A · evidence: ev-028）**

### 7.3 Backpressure & Failure Isolation

- **Studio 后端启动脆弱点：** `run.py` 需修复 CUDA `LD_LIBRARY_PATH`（`_fix_torch_cuda_ld_path` + 单次 re-exec），否则 conda/Docker 基础镜像的 CUDA 会影子化 torch 的 libs 导致 `undefined symbol`。**（confidence: 0.85 · evidence_level: A · evidence: ev-028）**
- **MLX 误用防护：** MLX 上 CUDA 设备调用被 no-op 化（`_unsloth_mlx_cuda_noop` 标记），防止误用 CUDA API 时行为异常。**（confidence: 0.9 · evidence_level: A · evidence: ev-023）**
- **量化稳定性护栏：** AMD 上 4bit 显式禁用（"currently not stable"），避免静默错误。**（confidence: 0.85 · evidence_level: A · evidence: ev-025）**
- **失败隔离（Studio）：** Rust 层（`desktop_backend_owner.rs`）持有后端进程生命周期，后端崩溃由 Rust 重启而非拖垮 GUI；`lease_secret`/`path-grant` 确保子进程仅能访问被显式授予的路径与密钥，避免故障横向扩散到宿主文件系统。**（confidence: 0.85 · evidence_level: A · evidence: ev-027, ev-028）**

---

## 8. Architecture Strengths（架构优势）

> 基于证据，而非「设计很好」式评价（p7.md §9）。

- **S1 透明零改动加速：** 装饰器式 patch 让用户 notebook 不改一行即获加速，是 adoption 的核心驱动力。**（confidence: 0.95 · evidence_level: A · evidence: ev-005, ev-007）**
- **S2 内核融合是真收益：** 加速来自手写 `fast_*` 融合内核（layernorm/rope/swiglu/cross_entropy/dequantize），非框架魔法；MoE 可达 12x。**（confidence: 0.96 · evidence_level: A · evidence: ev-007, ev-008, ev-009）**
- **S3 双后端统一 API：** 单一 `FastModel` 掩盖 CUDA/MLX 差异，MLX 分支用 no-op 伪装 CUDA API 以兼容上游代码。**（confidence: 0.93 · evidence_level: A · evidence: ev-001, ev-003, ev-023）**
- **S4 核心轻量、重机械复用：** 核心依赖极薄（无 torch/transformers 直接声明），训练 util/MLX 模块下沉 `unsloth_zoo` 被多前端复用。**（confidence: 0.9 · evidence_level: A · evidence: ev-010, ev-011）**
- **S5 上游漂移回归守卫：** 测试重心放在 monkey-patch 接口面（import_fixes 漂移、kwargs 门控、registry、attention 实现），精准防护最高频破坏源。**（confidence: 0.88 · evidence_level: C · evidence: ev-017）**

---

## 9. Architecture Risks（架构风险，聚焦 Top 3）

> p7.md §10 明确「高级报告必须包含」。此处仅列最具架构影响的 2-3 项、每项标注 what_breaks（与原 §8 的冗长罗列不同，聚焦证据充分者）。

- **R1 上游版本强耦合（最高频破碎源）。** `transformers`/`peft`/`trl` 大版本漂移 → patch 目标 API 失效，可能**静默走原生慢路径（性能退化但无报错）**或 `ImportError`。Unloth 最常见的「用户侧破碎」来源。**（confidence: 0.95 · evidence_level: A · evidence: ev-005, ev-006）**
- **R2 内核数值正确性盲区。** 手写内核无单测，仅靠端到端 training sanity 覆盖；回归可能长期潜伏、产出**静默错误结果**而非崩溃。**（confidence: 0.88 · evidence_level: C · evidence: ev-017, ev-018）**
- **R3 unsloth_zoo 版本漂移。** 薄依赖未强约束，zoo 错配直接导致训练 util/MLX 模块缺失、`ImportError`。**（confidence: 0.9 · evidence_level: A · evidence: ev-010, ev-011）**
- **（边界风险，非核心）R4 双许可传染：** Studio AGPL-3.0 在 SaaS/分发场景误用触发 copyleft 义务，属合规边界而非架构失效。**（confidence: 0.9 · evidence_level: B · evidence: ev-013, ev-021）**

---

## 10. Change Difficulty & Blast Radius（改 X 会炸哪里）

> 对应 skill 成功标准：「能回答改 X 会炸哪里（Blast Radius）和哪些改动容易、哪些危险（Change Difficulty）」。

- **改 `unsloth/__init__.py` 的后端分支（_IS_MLX）：** 最危险。它是最上游闸门，错配会导致 MLX/GPU 全路径失效；且被 `test_is_mlx_dispatch_gate.py` 锁定——必须委托 `_is_mlx_available()`，内联判定会直接单测失败。**（confidence: 0.9 · evidence_level: A · evidence: ev-022）**
- **改某个 `Fast*` 模型的 `post_patch` 内核：** 中高风险。影响单一模型族的加速与显存，但回归仅由端到端训练 sanity 发现（无 unit test 覆盖），可能长期潜伏。**（confidence: 0.85 · evidence_level: A/C · evidence: ev-007, ev-018）**
- **升级 `transformers`/`peft`/`trl` 大版本：** 高风险。直接触发 R1——patch 目标 API 漂移，可能静默走原生慢路径（性能退化但无报错）或 `ImportError`。这是 Unsloth 最常见的「用户侧破碎」来源。**（confidence: 0.95 · evidence_level: A · evidence: ev-005, ev-006）**
- **升级 `unsloth_zoo`：** 中风险。薄依赖未强约束，错配导致训练 util/MLX 模块缺失（R3）。**（confidence: 0.9 · evidence_level: A · evidence: ev-010, ev-011）**
- **加一个新模型族：** 中等难度但模式固定——写 `Fast*` 类 + 内核 + 注册进 `MODEL_REGISTRY`（含 `QuantType`）。门槛在「需同时写模型类与内核」而非逻辑复杂。**（confidence: 0.85 · evidence_level: A · evidence: ev-007, ev-026）**
- **在 Apple Silicon 上启用非 SFT 训练：** 不可行。MLX 是 SFT-only 子集，GRPO/DPO/ORPO 直接 `NotImplementedError`——这不是「改动难度」问题，是能力边界。**（confidence: 0.9 · evidence_level: A · evidence: ev-024）**

**结论：** 最容易安全的改动是「加模型族」（模式固定、隔离好）；最危险的是「动后端闸门」与「升上游大版本」（连锁面广、回归隐蔽）。**（confidence: 0.9 · evidence_level: A · evidence: ev-022, ev-005）**

---

## 11. Engineering Insights（工程洞察）

> 报告价值最高的部分（p7.md §14）：从「文件 A 调用文件 B」提升到工程哲学。

1. **透明加速 > 更好 API（装饰器优于框架替换）。** Unsloth 选择 monkey-patch 而非新训练框架，唯一目的就是「用户零改动」。adoption 的瓶颈从来不是能力，而是改写成本——用 import-time 装饰器把成本降为零，是它对抗原生 HF/PEFT 的根本优势。**（confidence: 0.95 · evidence_level: A · evidence: ev-005, ev-007）**
2. **能力通过注册扩展，而非代码分叉。** `MODEL_REGISTRY` + `QuantType` 把「支持一个新模型/新量化」从代码改动降级为数据条目；扩展可预测，代价是必须同步两端（registry 分派 + quant 路径）。**（confidence: 0.92 · evidence_level: A · evidence: ev-012, ev-026）**
3. **稳定核心 + 可变外围。** 核心 patch 层机制长期稳定；扩张发生在产品面（Studio）与硬件覆盖（AMD/Intel XPU），而非内核算法。演进投资方向印证了「中心不变、边界扩张」。**（confidence: 0.85 · evidence_level: C/D · evidence: ev-020）**
4. **两个正交显存杠杆，各自攻击最大消费者。** 量化压权重、GaLore 压优化器状态——分别作用于微调显存的两大块，叠加得到「70% less VRAM」，而非依赖单一技巧。**（confidence: 0.9 · evidence_level: A · evidence: ev-025, ev-030）**
5. **失败安全边界（capability-subset + 安全中介）。** MLX 把 CUDA 调用 no-op 化以容错；Studio 用 `lease_secret`/`path-grant` 把子进程约束在授予范围内。两者都是「用边界收缩来限制爆炸半径」。**（confidence: 0.88 · evidence_level: A · evidence: ev-023, ev-027）**
6. **测接口，不测数学。** 把稀缺测试资源压在最高频失效处（上游 API 漂移的 patch 接口面），接受内核数值正确性仅由端到端 sanity 覆盖——用「对易变边界重点守卫」换「对稳定数学的信任」。**（confidence: 0.88 · evidence_level: C · evidence: ev-017, ev-018）**
