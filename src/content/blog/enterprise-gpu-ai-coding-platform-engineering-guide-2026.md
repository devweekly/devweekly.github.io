---
author: W
featured: false
draft: false
description: 面向企业级 AI Coding 平台的 GPU 基础设施与推理工程指南，覆盖 NVIDIA B300 / GB300、国产 GPU 与 AI 加速器、异构推理部署、Kubernetes、Agent Runtime、安全、容量规划、运维与实施路线图。
pubDatetime: 2026-10-30T00:00:00Z
title: 企业级 GPU AI Coding 平台：从 B300 集群部署到推理与 Agent 工程
tags:
  - GPU
  - NVIDIA
  - B300
  - 国产GPU
  - Ascend
  - CANN
  - MUSA
  - vLLM
  - GB200
  - GB300
  - LLM
  - inference
  - coding-agent
  - architecture
---

# 企业级 GPU AI Coding 平台：从 B300 集群部署到推理与 Agent 工程

本文讨论的不是在一台工作站上运行一个开源模型，而是建设一套企业内部 AI Coding 服务：模型部署在企业自有或租用的 NVIDIA GPU 集群上，向约 1000 名开发者提供统一的模型 API 和 Coding Agent 能力，并具备生产环境所需的容量、隔离、安全、监控、成本核算和故障恢复能力。

这里有两个不同但必须协同设计的系统：**GPU 推理平台**负责把 GPU 资源转换成稳定的模型服务；**Coding Agent 平台**负责管理开发者会话、代码仓库上下文、工具调用、代码执行和任务验证。把两者混成一个应用，会让资源调度、安全责任和故障边界变得模糊。

本文以 NVIDIA B300 / HGX B300 为主要讨论对象，同时解释 GB300 NVL72 的定位。硬件和软件能力以 2026 年 10 月 30 日能够查到的公开资料为准。厂商规格表示产品能力，不等于特定模型、特定量化和特定 Agent Harness 下的实测性能；容量和成本结论必须通过目标 workload 的 POC 验证。

## 1. 先明确部署对象：GPU、服务器节点和机架不是一回事

讨论采购时，最容易出现的错误是把 GPU 芯片、8-GPU 服务器和 rack-scale 系统都按“多少张卡”比较。它们的互联范围、网络拓扑、供电、散热、管理和租赁单位完全不同。

| 层次 | 典型产品 | 物理含义 | 主要架构问题 |
| --- | --- | --- | --- |
| GPU | NVIDIA B300 / B200 | 单颗 GPU 加速器 | 显存容量、HBM 带宽、计算精度、功耗 |
| GPU 服务器平台 | HGX B300 | 8 张 SXM GPU、NVLink/NVSwitch 和主机平台 | 单节点 GPU 通信、CPU/PCIe 拓扑、节点功耗 |
| 机架级系统 | GB300 NVL72 | 72 张 Blackwell Ultra GPU、36 颗 Grace CPU 和 NVLink Switch | 72-GPU scale-up 域、液冷、机架供电和集群网络 |
| 多机架集群 | 多个 HGX 节点或多个 NVL72 | 多个节点/机架通过外部网络互联 | RDMA Fabric、拓扑感知调度、故障域和扩展成本 |

### 1.1 HGX B300：适合从 8-GPU 节点构建集群

NVIDIA 的 HGX B300 参考架构包含 8 张 Blackwell Ultra GPU。官方参考架构列出的关键规格包括：

| 指标 | HGX B300 |
| --- | --- |
| GPU 数量 | 8 |
| 单 GPU HBM3e | 288 GB |
| 单节点 GPU 显存合计 | 约 2.30 TB |
| 单 GPU HBM 带宽 | 最高 8 TB/s |
| GPU 互联 | 第五代 NVLink + NVSwitch |
| GPU-to-GPU 带宽 | 最高 1.8 TB/s（双向口径，需按厂商定义理解） |
| 节点 NVLink 聚合带宽 | 14.4 TB/s |
| Scale-out 网络 | 8 个 ConnectX-8 SuperNIC，最高 800 Gb/s/adapter（具体系统实现以 OEM BOM 为准） |

这里的 1.8 TB/s 是 GPU 间链路带宽口径，不应与节点聚合带宽 14.4 TB/s 混用，也不应直接与外部以太网/InfiniBand 的端口速率比较。

HGX B300 的 8 张 GPU 构成高速 scale-up 域。若部署 4 台 HGX B300，虽然总共有 32 张 GPU，但并不意味着 32 张 GPU 自动成为一个 NVLink 域。跨节点的 GPU 通信要经过外部计算网络，性能取决于 NIC、交换机、布线、RDMA 配置和应用并行策略。

### 1.2 GB300 NVL72：机架级 scale-up 系统

GB300 NVL72 将 72 张 Blackwell Ultra GPU 和 36 颗 Grace CPU 集成在一个液冷机架系统中。NVIDIA 的参考架构描述了 18 个计算托盘，每个托盘包含 4 张 GPU；机架内通过 NVLink Switch 形成一个 72-GPU NVLink 域，官方资料列出的 NVLink 聚合带宽为 130 TB/s。该参考设计的机架功耗最高约 142 kW。

这类系统的价值在于：对需要大量 GPU 间通信的超大模型或 MoE Expert Parallelism，可以把更多通信留在机架内的 NVLink 域中。但这并不自动意味着它对所有推理任务都比多个 HGX B300 节点便宜或更快。若模型能在单台 8-GPU 节点内运行，额外的机架级互联能力可能没有被充分利用。

GB300 NVL72 也不是“72 张 GPU 的普通服务器”。它需要匹配的液冷设施、机架供电、CDU、液冷管路、泄漏检测、机房承重与运维流程。数据中心是否具备这些条件，可能比 GPU 软件部署本身更早成为项目约束。

### 1.3 B300、B200、GB300 怎么选

| 方案 | 适用场景 | 主要优势 | 主要代价/限制 |
| --- | --- | --- | --- |
| HGX B200 | 成本敏感、模型能够适配 8-GPU 节点 | Blackwell 软件生态、显存容量相对 B300 较小 | 单 GPU 显存少于 B300，复杂模型更容易受显存约束 |
| HGX B300 | 大模型推理、长上下文、较高 KV Cache 容量需求 | 288 GB HBM3e/GPU，8-GPU 节点内高速互联 | 节点价格、供电和散热成本较高 |
| GB300 NVL72 | 大型 MoE、跨多 GPU 的高通信推理、超大模型 | 72-GPU NVLink 域，机架级集成 | 高密度液冷和供电要求，采购与部署复杂度高 |
| H200 | 作为上一代成本/可用性基准 | 供应商选择可能较多，适合做价格基线 | 显存和互联能力较新一代平台弱 |

**建议不要从“1000 个开发者”直接推导出“需要多少张 B300”。** 先确定模型和请求形态，再比较 HGX B300 节点集群与 GB300 NVL72。对企业 Coding Agent，常见的合理起点是先租用或采购一个 8-GPU 节点做 POC，验证目标模型、量化、上下文长度和 Agent 工作流，再决定扩展方式。

## 2. GPU 基础设施工程：硬件清单之外还要设计什么

GPU 节点交付不等于 GPU 平台可用。生产部署至少要同时设计计算、网络、存储、管理和设施五个平面。

### 2.1 计算节点

每台 GPU 节点需要明确：

- GPU 型号、数量、SXM 形态和显存规格；
- CPU 型号、物理核心数、NUMA 拓扑和内存通道；
- GPU 到 CPU 的 PCIe Root Complex 关系；
- GPU、NIC、DPU 和 NVMe 的 PCIe 拓扑；
- 本地 NVMe 容量、读写性能和故障更换方式；
- BMC、TPM 2.0、Secure Boot、固件版本；
- 电源冗余、风扇或液冷方案、保修和现场响应时间。

不能只接受供应商报价单中的“8×B300”。需要拿到完整 BOM、拓扑图、固件/驱动兼容矩阵、功耗范围、冷却要求和验收工具。尤其要核实 OEM 服务器的 NIC 数量、端口速率、DPU 配置、NVMe 盘位以及实际可持续功耗。

### 2.2 网络必须按用途分平面

GPU 集群至少有三类网络流量：

1. **GPU Compute Fabric（East-West）**：节点之间的 GPU 集合通信和模型并行流量，通常使用 InfiniBand 或经过严格设计的 RoCE。
2. **Storage / North-South Fabric**：模型权重加载、数据访问、日志和外部存储流量。
3. **Management / OOB Fabric**：BMC、交换机管理、节点 provisioning、运维访问和故障诊断。

不要让模型通信、开发者 API、存储访问和 BMC 管理全部挤在一张普通以太网里。网络隔离不仅是安全要求，也直接影响推理性能的可预测性。

对于 RoCE，需要具备以太网无损或拥塞管理方面的工程能力，包括 PFC、ECN、拥塞控制、交换机缓冲、队列和端到端验证。不能把“网卡支持 RoCE”理解成网络已经配置正确。对于 InfiniBand，需要理解 Subnet Manager、Fabric Health、端口状态、路由和链路故障诊断。

网络设计应明确：

- 每个 GPU 节点的有效上行带宽和 oversubscription；
- Leaf-Spine 拓扑、双平面或 rail-optimized 设计；
- RDMA 是否端到端启用，是否经过不支持的中间设备；
- NCCL 测试是否覆盖单节点、多节点和故障链路；
- 计算 Fabric 与存储 Fabric 是否隔离；
- 多租户场景下的带宽配额和网络策略。

### 2.3 存储与模型分发

模型权重通常是数百 GB 到 TB 级别。扩容或故障恢复时，如果所有节点同时从远端对象存储拉取权重，模型启动时间和存储出口可能成为瓶颈。

建议分层：

| 存储层 | 用途 | 设计重点 |
| --- | --- | --- |
| 本地 NVMe | 模型热缓存、临时文件、编译缓存 | 容量、吞吐、节点重建后的缓存策略 |
| 共享高性能文件系统 | 多节点模型加载、共享数据 | 并发读、元数据性能、故障域 |
| 对象存储 | 模型权重、数据集、日志归档、评估产物 | 生命周期、版本、校验和、访问权限 |
| 元数据数据库 | 模型版本、部署配置、评估记录 | 备份、事务一致性、审计 |

模型制品需要不可变版本、SHA-256 校验、来源记录、许可信息和安全扫描。生产服务不应直接依赖某个可变的 Hugging Face branch 或未经验证的下载地址。

### 2.4 机房设施和电力散热

B300 HGX 节点和 GB300 NVL72 的机房要求不同。尤其是 NVL72，液冷、供电和机架功率密度是项目级设计，不是服务器团队自行解决的小问题。

设施评估应覆盖：

- 单机柜 IT 负载、峰值功率和冗余供电；
- UPS、PDU、母线和配电余量；
- 液冷 CDU 容量、泵冗余、供回水温度和流量；
- 冷却液质量、过滤、泄漏检测和应急隔离；
- 地板承重、机柜尺寸、布线和维护空间；
- 机房消防、环境监控和运维授权；
- 断电、冷却故障和网络故障时的安全停机策略。

不要将 GPU TDP 简单相加作为机柜最终功耗，也不要只根据产品宣传的峰值算电力预算。应以 OEM 的系统功耗、机架设计和设施工程评估为准。

## 3. 分布式 GPU 软件栈

软件栈需要版本化管理。GPU Driver、CUDA、Container Toolkit、NCCL、OFED/网络驱动、GPU Operator、推理引擎和模型依赖之间存在兼容关系。生产环境不能依赖“升级到最新版应该就行”。

### 3.1 主机操作系统与驱动

需要掌握：

- Linux 发行版、Kernel、systemd、udev、NUMA；
- NVIDIA Data Center Driver 与 CUDA Runtime/Toolkit 的兼容关系；
- NVIDIA Container Toolkit 和 containerd；
- Fabric Manager（按 GPU 平台和部署方式决定）；
- OFED、RDMA Core、NIC 固件和交换机软件；
- 固件、BIOS、BMC、GPU 驱动的升级顺序和回滚方法。

要区分 CUDA Toolkit 与 CUDA Runtime，也要区分宿主机驱动和容器中的 CUDA 用户态库。容器不能替代宿主机驱动；驱动升级也不能被当成普通应用镜像升级。

### 3.2 Kubernetes 与 GPU Operator

Kubernetes 可以管理 GPU 工作负载，但默认调度器只知道资源请求和节点状态。它不会自动理解某个模型的 Tensor Parallel Group 是否必须落在同一个 NVLink 域，也不会天然知道跨节点通信拓扑的性能代价。

NVIDIA GPU Operator 将 GPU 节点的软件栈 Kubernetes 化。官方文档列出的典型组件包括 NVIDIA Driver、Container Toolkit、Device Plugin、DCGM Exporter 和 MIG Manager。实际启用哪些组件，应根据操作系统、驱动管理方式、集群策略和 GPU 型号决定。

需要掌握：

- Kubernetes Node Labels、Taints、Tolerations、Affinity；
- Device Plugin 与 GPU 资源声明；
- GPU Operator、ClusterPolicy、Helm；
- GPU 节点池和普通 CPU 节点池隔离；
- DaemonSet、Pod Security Admission、RBAC；
- GPU 拓扑感知调度和 gang scheduling；
- 节点 drain、升级、cordon、恢复和故障隔离；
- 多租户 GPU 配额与资源公平性。

对模型推理，建议将 API Gateway、Model Router、Agent Runtime、数据库、队列和监控组件部署在 CPU 节点；GPU 节点主要运行推理引擎及必要的 GPU 管理组件。不要把所有业务服务都塞进昂贵的 GPU 节点。

MIG、GPU sharing、time-slicing 和 DRA 不能混为一谈。它们的硬件支持范围、隔离强度和调度语义不同。是否可用于 B300、是否满足目标模型和安全要求，必须以对应版本的官方支持矩阵与实际测试为准。不要因为 Kubernetes 能声明共享 GPU，就把它当成硬件级安全隔离。

### 3.3 NCCL 与分布式通信

NCCL 是多 GPU 集合通信的重要基础。需要理解：

- AllReduce、AllGather、ReduceScatter、Broadcast；
- Ring、Tree、NVLS 等通信算法概念；
- 单节点 NVLink/NVSwitch 与跨节点 RDMA 的区别；
- NCCL Topology Detection；
- NCCL Tests、带宽与延迟测试；
- 环境变量、接口选择、日志和故障诊断；
- GPU Direct RDMA、GPUDirect Storage 的适用条件。

验收不能只运行一次 nvidia-smi。至少要分别测试：

1. 单 GPU CUDA 基础计算；
2. 单节点 8 GPU P2P 和 NCCL；
3. 跨节点 NCCL；
4. GPU 与 NIC 的拓扑亲和性；
5. 节点重启、NIC 故障、交换机端口故障后的恢复。

## 4. 大模型推理工程：从模型文件到稳定 API

对于 AI Coding 平台，推理工程是最直接影响体验和成本的部分。要理解模型结构、精度、并行策略、KV Cache、请求调度和服务指标。

### 4.1 Transformer、Dense 与 MoE

不要求平台工程师训练 Transformer，但需要理解模型推理时发生了什么：

- Attention、MHA、GQA、MLA 等注意力结构；
- Dense 模型与 Mixture of Experts（MoE）；
- Tokenizer、Embedding、模型权重和模型配置；
- Prefill 与 Decode；
- KV Cache；
- Tensor Parallelism、Pipeline Parallelism、Data Parallelism；
- MoE Expert Parallelism 和 Router。

MoE 的总参数量不等于每个 Token 实际参与计算的参数量。但 Expert Routing 会产生 GPU 间 Token Dispatch / Combine 通信，因此模型的激活参数量小，并不代表它可以在少量 GPU 上高效运行。模型结构、Expert 数量、路由策略和通信拓扑都要纳入部署设计。

### 4.2 FP16、BF16、FP8、FP4 与量化

精度选择直接影响模型权重占用、吞吐和生成质量。

| 精度/格式 | 典型用途 | 主要考虑 |
| --- | --- | --- |
| BF16 / FP16 | 精度基线、兼容性对照 | 显存占用较大，适合做质量基线 |
| FP8 | 高性能推理 | 需要检查模型权重和推理引擎支持 |
| FP4 / NVFP4 | Blackwell 平台上的高压缩推理 | 需要评估量化误差、算子支持和模型质量 |
| INT8 / INT4 等 | 特定模型和推理路径 | 不同量化方案的精度和内核支持差异较大 |

不能只根据权重大小计算可部署性。显存还要容纳 KV Cache、CUDA Graph、激活、通信 Buffer、临时 Workspace 和运行时开销。也不能把 FP4 的理论算力直接当成生产吞吐：真实性能取决于模型结构、内核、批处理、上下文长度和通信。

量化验收至少应包含：代码生成正确性、工具调用 JSON/Schema 合法率、函数参数准确率、长上下文检索、代码修改回归率和任务成功率。对 Coding Agent 来说，模型输出格式和工具调用稳定性可能比一般问答的语言流畅度更重要。

### 4.3 并行策略

| 并行方式 | 作用 | 适用场景 | 代价 |
| --- | --- | --- | --- |
| Tensor Parallelism（TP） | 将单层矩阵计算拆到多 GPU | 单模型权重或计算无法高效放入单 GPU | 每层产生通信，依赖高速互联 |
| Pipeline Parallelism（PP） | 将模型层拆分到不同 GPU | 模型深度较大、需要跨节点扩展 | Pipeline Bubble、调度和跨阶段传输 |
| Data Parallelism（DP） | 复制模型副本处理更多请求 | 单个模型副本已能放入资源域，需要提高吞吐 | 增加模型副本和权重显存 |
| Expert Parallelism（EP） | 将 MoE Experts 分布在多 GPU | MoE 模型 | Token Dispatch / Combine 的通信成本 |
| Context / Sequence Parallelism | 将长序列计算拆分 | 超长上下文和特定模型结构 | 实现复杂，依赖引擎支持 |

一个实用的起点是：优先让单个模型副本使用同一台 HGX 节点内的高速 NVLink；只有模型大小、吞吐或 MoE 分布需求确实要求跨节点时，再引入跨节点并行。这个原则不是绝对规则，最终要以模型框架支持和性能测试为准。

### 4.4 KV Cache 决定长上下文并发能力

Coding Agent 的上下文不只是用户问题，还可能包含系统提示、工具定义、仓库文件、代码片段、终端输出、历史对话和工具结果。长上下文会显著占用 KV Cache。

需要掌握：

- KV Cache 的显存估算；
- PagedAttention 或同类分页管理机制；
- Prefix Caching / Automatic Prefix Caching；
- KV Cache 命中率、复用边界和缓存隔离；
- Cache Eviction、Block 管理和显存碎片；
- Chunked Prefill；
- Context Truncation / Compaction；
- 长上下文下的 TTFT、TPOT 和并发退化。

Prefix Cache 的命中并非只由“前缀文本相同”决定，还受到 Tokenization、模型版本、LoRA、缓存配置和安全隔离边界影响。不同租户的缓存能否共享，必须做威胁建模和框架验证，不能为了命中率跨越数据隔离边界。

### 4.5 Prefill / Decode 与请求调度

Prefill 处理输入 Token，决定模型读取长上下文的计算量，通常显著影响 Time To First Token（TTFT）。Decode 逐 Token 生成输出，常受到显存带宽、KV Cache 访问和批处理调度影响，影响 Time Per Output Token（TPOT 或 ITL）。

推理引擎需要处理：

- Continuous Batching；
- Dynamic / In-flight Batching；
- Chunked Prefill；
- Prefix Cache；
- Request Queue；
- 最大并发和最大序列长度；
- 长短请求的公平调度；
- 交互请求与后台任务的优先级；
- 超时、取消、客户端断连和请求重试。

Prefill/Decode Disaggregation 可以将两阶段放到不同 GPU 池，减少阶段间干扰，但需要传输 KV Cache，并增加网络、调度和运维复杂度。它不是默认必须部署的组件。只有测量发现两阶段资源需求明显冲突，并且跨池 KV 传输成本可接受时，才值得引入。

## 5. 推理框架和服务层

不要先选框架再寻找模型。先列出模型、精度、并行策略、API、上下文长度和目标 SLO，再通过兼容性矩阵选择推理框架。

| 框架 | 主要定位 | 评估重点 |
| --- | --- | --- |
| vLLM | 通用 LLM serving，OpenAI-compatible API 和批处理能力 | 目标模型、Blackwell Kernel、FP8/FP4、MoE、KV Cache 和多节点支持 |
| SGLang | 高性能结构化生成与 LLM serving | 目标模型实现、Radix/Prefix Cache、调度、MoE 和工具调用 |
| TensorRT-LLM | NVIDIA 推理优化技术栈 | Blackwell 支持矩阵、构建流程、量化、MoE、部署复杂度和升级成本 |

截至本文日期，NVIDIA GPU Operator 官方文档显示当前 patch release 为 v26.7.2；但这不代表所有 B300 OEM 服务器、操作系统、驱动和推理框架组合都已经过生产验证。vLLM、SGLang 和 TensorRT-LLM 的能力应按具体 release、模型实现和部署配置逐项确认。

建议采用一个主推理引擎和一个候选引擎，不要一开始同时运营三套生产系统。可以让 vLLM 作为首个基线，再用同样模型和请求 Trace 对比 SGLang；若 NVIDIA 优化路径带来明确收益，再评估 TensorRT-LLM。不同框架之间的性能数字只有在模型、精度、上下文、并发、硬件和 SLO 相同的情况下才有比较价值。

### 5.1 推理服务 API

统一 API 层至少要处理：

- OpenAI-compatible Chat Completions 或 Responses API（按 Coding Agent 实际协议选择）；
- Streaming / SSE；
- Tool Calling / Function Calling；
- JSON Schema / Structured Output；
- Cancellation；
- Model ID 和模型版本；
- Usage / Token Accounting；
- Request ID、Trace ID 和租户标识；
- 超时、限流、重试和错误语义。

“兼容 OpenAI API”不是充分条件。不同 Coding Agent 对 tool_calls、并行工具调用、流式事件、usage 统计、finish_reason、上下文窗口和特定 API 扩展的依赖可能不同。需要针对 Claude Code、OpenCode、Copilot SDK 或企业实际使用的 Agent Harness 建立协议兼容测试集。

### 5.2 Model Router

Router 不应只是随机选择一台推理服务器。它需要理解模型能力、租户策略和资源状态。

路由决策可以考虑：

- 任务类型：代码补全、解释、重构、跨文件修改、测试修复；
- 模型能力和质量评估；
- 上下文长度和模型窗口；
- 用户、团队和项目配额；
- GPU Pool 负载、队列长度和缓存命中；
- SLO、请求优先级和任务截止时间；
- 模型故障、容量不足和降级策略。

建议把模型路由策略作为版本化配置管理，并支持 shadow traffic、canary、A/B test 和快速回滚。不要让模型自己决定可以绕过的预算、权限或安全策略。

## 6. 国产 GPU / AI 加速器：推理部署与开发工程

在中国境内部署企业 AI Coding 平台，需要把国产 GPU 与 AI 加速器纳入技术选型。但“国产 GPU”是产业统称，实际产品既有通用 GPU，也有 NPU、MLU、GCU 等 AI 加速器；它们不是 CUDA GPU 的等价替代品。选型不能只比较峰值算力，还要比较软件栈、模型覆盖、算子、集合通信、框架适配和生产运维能力。

本节以 2026 年 10 月 31 日可查到的公开资料为准。厂商发布的模型 Day-0 适配、单卡演示或峰值性能，不代表所有模型、量化格式、长上下文、并行策略和生产负载均已验证。必须以具体芯片型号、驱动、SDK、框架分支和版本矩阵为准。

### 6.1 国产加速器与软件栈概览

| 厂商 / 平台 | 硬件类别 | 软件栈 | 推理框架 / 生态入口 | 工程判断 |
| --- | --- | --- | --- | --- |
| 华为昇腾 Ascend | AI 处理器 / NPU | CANN、AscendCL、torch-npu、MindStudio、MindIE | vLLM Ascend、SGLang、MindIE Motor | 官方文档体系较完整；需严格核对 CANN、驱动、固件、PyTorch 和推理框架版本 |
| 寒武纪 MLU | AI 加速器 | NeuWare、CNToolkit、CNCL、CNRT、MagicMind | Cambricon vLLM（vllm-mlu） | 有基于 vLLM 插件机制的公开适配项目；模型、算子、量化和多卡能力按型号验证 |
| 摩尔线程 MUSA | 全功能 GPU | MUSA SDK、MUSIFY 等 | vLLM-MUSA、SGLang-MUSA | 有 vLLM / SGLang 适配项目，适合评估通用 GPU 编程和推理框架迁移 |
| 沐曦 MetaX | 通用 GPU | MXMACA、MACA SDK、配套 PyTorch / 算子库 | vLLM-MACA、SGLang 适配 | 有独立开发者文档；PyTorch、Triton、FlashAttention、vLLM 通常需使用匹配的适配版本 |
| 壁仞 Biren | 通用 GPU | BIRENSUPA、TorchSUPA | 厂商适配的 vLLM 等 | 已公开模型适配和 vLLM 推理案例；需核实目标模型、量化、并行和多节点通信 |
| 燧原 Enflame | GCU AI 加速器 | TopsRider、torch-gcu | vLLM-GCU | 有基于原生 vLLM 适配 GCU 的公开项目；确认产品型号、驱动和 TopsRider 版本 |
| 海光 Hygon DCU | 通用 GPU 架构的 DCU 加速器 | DTK、HIP / ROCm 兼容层及配套工具 | 厂商适配的 PyTorch、vLLM 等版本 | 以海光当前 DTK 支持矩阵为准；不能仅凭“兼容 ROCm”推断上游组件可原样安装 |

官方入口：

- [昇腾文档中心](https://www.hiascend.com/document)、[昇腾推理开发](https://www.hiascend.com/cn/developer/inference)、[vLLM Ascend 文档](https://docs.vllm.ai/projects/ascend/en/latest/)、[MindIE Motor 文档](https://www.hiascend.com/document/detail/zh/mindie/310/mindiemotor/motordev/docs/zh/architecture.md)。
- [寒武纪 NeuWare](https://www.cambricon.com/index.php?m=content&c=index&a=lists&catid=71)、[Cambricon/vllm-mlu](https://github.com/Cambricon/vllm-mlu)。
- [摩尔线程文档中心](https://docs.mthreads.com/)、[MooreThreads/vllm-musa](https://github.com/MooreThreads/vllm-musa)。
- [沐曦开发者中心](https://developer.metax-tech.com/)、[MetaX-MACA GitHub](https://github.com/metax-maca)。
- [壁仞开发者社区](https://developer.birentech.com/)、[壁仞技术动态](https://www.birentech.com/news/yt4wako63dg63co6kpwpi31o/)。
- [Enflame/vllm-gcu](https://github.com/EnflameTechnology/vllm-gcu)。
- 海光 DCU：要求供应商提供当前 DTK 开发者文档、驱动/固件兼容矩阵和对应推理框架发行包；第三方博客不能代替正式支持承诺。

### 6.2 昇腾：CANN + PyTorch 适配层 + vLLM / MindIE

昇腾开发链路可以分为五层：

1. **硬件与系统**：确认 Atlas / 昇腾服务器型号、NPU 数量、固件、驱动、操作系统和容器环境。
2. **CANN**：安装与设备匹配的 Toolkit、Runtime、编译器和通信组件。版本必须与驱动、固件及上层框架匹配。
3. **框架适配**：使用对应版本的 PyTorch 与 torch-npu，验证设备可见性、张量计算、算子覆盖和多卡通信。
4. **推理引擎**：按模型与产品支持情况选择 vLLM Ascend、SGLang 或 MindIE 组件。
5. **服务层**：由企业 AI Gateway 统一处理身份、路由、限流、配额和审计；推理后端在支持时提供 OpenAI-compatible API。

新项目建议优先研究 vLLM Ascend 和 SGLang 的当前适配状态。昇腾文档提供 vLLM、MindIE 等推理开发入口；MindIE 3.1.0 版本说明提示 MindIE LLM 组件暂停后续功能演进，建议关注 MindIE Motor + vLLM Ascend 的部署路径。因此不要把 MindIE 的不同子组件视为同一个生命周期，也不要不加核对地沿用旧版教程。

CANN 文档中心可见 9.2.0-beta.2 等版本条目。Beta 适合开发验证，不应直接作为生产基线。生产环境应选择厂商明确发布、与目标硬件和上层框架匹配的稳定组合，并锁定软件包版本、镜像 digest 和安装记录。

昇腾专项开发知识包括 torch-npu 设备与算子语义、CANN 算子库、AscendCL、GE 图编译、HCCL 集合通信、算子精度与性能调优、模型量化工具、MindStudio 调试和 Profiling。若模型存在不支持算子，应先确认是否有等价实现，再考虑框架兼容实现或自定义算子；CUDA Extension 不能直接视为 NPU 可执行代码。

### 6.3 DeepSeek 在国产加速器上的部署：从 V3 / R1 到 V4 系列

DeepSeek 是检验国产加速器软件栈成熟度的一个很好的压力测试，但不能把“支持 DeepSeek”理解成支持整个 DeepSeek 家族。V3 / R1、V3.2、V4-Flash、V4.1-Flash 的模型结构、权重格式、量化方式和推理优化路径不同；同一厂商也可能只在某个芯片系列、特定量化权重和指定 Runtime 版本上完成适配。

截至 2026-10-31，公开资料中值得重点跟踪的路径如下。

| 平台 / 项目 | 已公开的 DeepSeek 适配信息 | 硬件 / 部署特征 | 证据与边界 |
| --- | --- | --- | --- |
| **昇腾 + vLLM Ascend** | v0.30.0 教程覆盖 DeepSeek-V4-Flash 多种权重；发布说明列出 V4.1 W8A8 与 TurboQuant INT4 KV Cache | A2 / A3 可部署 W8A8，950DT 有 BF16 权重方案，950PR / 950DT 支持本地量化 W4A4C8；支持 P/D 分离等特性 | V4-Pro 在支持矩阵中仍标为实验性；需按当前模型、芯片和框架版本矩阵验收，不能从 Flash 的支持状态外推 |
| **昇腾 + CANN Recipes** | DeepSeek-V3.2-Exp、V4、V4.1-Flash 等模型优化样例；包括 V4 Attention-FFN 分离、DSpark 投机解码和在线 PD 分离 | 覆盖 Atlas A2 / A3 及昇腾 950PR / 950DT 等不同代际产品，具体能力按模型目录和样例脚本区分 | 这是持续更新的工程配方库，不等于每个样例都已在所有芯片、所有软件版本上完成真实模型验证；逐条查看模型目录、提交记录和验证说明 |
| **昇腾 + KTransformers / KT-Kernel** | DeepSeek-V4-Flash 单 NPU 异构推理教程 | 一颗昇腾 die 承载 Attention、Dense 层和每层 32 个常驻专家；其余 224 个路由专家以 MXFP4 留在 CPU，由 KT-Kernel 的 LLAMAFILE MoE 执行 | 不是“单卡装下并运行整个模型”的传统部署。教程给出的 Atlas 800I A2 主机配置包括 192 核 Kunpeng 920、1.5 TB RAM；CPU 专家卸载的吞吐、NUMA 和内存带宽是核心约束 |
| **寒武纪 MLU + vLLM-MLU** | 仓库更新历史明确列出 2026-04-24 DeepSeek-V4 Day-0 支持 | README 声明仅支持 MLU370 及以上设备，依赖寒武纪 SDK 提供的专用镜像和软件环境 | 这是厂商维护的独立 vLLM 插件仓库；Day-0 支持不代表上游 vLLM 原生支持，也不代表所有量化和并行策略都已覆盖 |
| **其他国产 GPU** | 本次检索没有找到足以确认所有 DeepSeek V4 / V4.1 变体均已在摩尔线程、沐曦、壁仞、燧原和海光 DCU 上形成统一、可复现生产路径的证据 | 应按具体芯片、模型变体、量化格式、框架分支和镜像逐一核实 | 新闻中的“完成适配”可能指模型加载、单轮推理、性能调优或正式产品交付，含义并不相同 |

#### 6.3.1 昇腾：官方 vLLM-Ascend 部署路径

vLLM-Ascend 已有面向 DeepSeek-V4-Flash 的新教程，文档注明基于 vLLM-Ascend v0.30.0 验证。除了早期 v0.13.0rc3 文档中的 DeepSeek-V4-Flash-w8a8-mtp，当前教程还列出不同硬件对应的权重方案：A2 / A3 上的 W8A8，950DT（8×96 GB）上的 BF16，以及 950PR / 950DT 上通过 msmodelslim 本地量化得到的 W4A4C8 / MXFP4 混合精度权重。其资源配置不是“任意一台 8 卡昇腾服务器”：

- Atlas 800I A2：8 张 64 GB NPU，运行 W8A8 权重；
- Atlas 800I A3：8 张 128 GB NPU，运行 W8A8 权重；
- Atlas 950DT：官方新教程列出 8 张 96 GB NPU 的 BF16 权重方案；
- Atlas 950PR / 950DT：可使用 W4A4C8 / MXFP4 混合精度量化权重，量化过程和模型精度需单独验收；
- 较早的多节点示例：至少两台 Atlas 800 A2，每台 8 张 64 GB NPU；
- 关键推理参数涉及 Tensor Parallel、Expert Parallel、Data Parallel、MTP speculative decoding、模型长度、批处理 Token 数和 NPU 显存利用率。

教程还提供 Prefill-Decode Disaggregation 示例。它说明大规模 MoE 推理不只是把 TP 数量调大：Prefill 和 Decode 可以使用不同资源池，通过 KV Cache 传输和调度分别优化首 Token 延迟与 Decode 吞吐。跨节点部署前，必须先验证 HCCL 通信、网卡选择、节点 IP、RDMA / RoCE 网络和模型权重共享路径。

**版本提醒：** v0.13.0rc3 是早期教程绑定的预发布版本，不应继续作为当前部署基线。新教程基于 v0.30.0 验证；当前发布说明进一步列出 DeepSeek-V4.1 在 Atlas 800I A2 / A3 上的 W8A8 服务、Model Runner V2、TurboQuant INT4 KV Cache、torch.compile 和 P/D 部署能力。支持矩阵对 V4-Flash 和 V4-Pro 的标记并不完全相同，V4-Pro 仍需按实验性支持处理。部署时应以目标硬件对应的最新稳定版教程、支持矩阵、容器 Tag 和 Release Notes 为准，并保留可复现的镜像 Digest。

#### 6.3.2 昇腾：CANN Recipes 更适合做模型专项优化入口

[hicann/cann-recipes-infer](https://github.com/hicann/cann-recipes-infer) 是值得加入工程资料库的项目。它不是一个新的通用推理引擎，而是围绕 CANN 平台沉淀模型推理部署和优化配方，覆盖 DeepSeek、Qwen、GLM、Hunyuan 等模型。

从仓库 2026 年 10 月的提交记录可以看到几个值得关注的方向：

- DeepSeek-V3.2-Exp 等模型的部署和推理样例；
- DeepSeek-V4.1-Flash 在昇腾 950PR / 950DT 上的适配工作；
- DeepSeek-V4 的 Attention-FFN Disaggregation（AFD）样例，涉及 P2P 同步、异步执行、双 Microbatch 和 ACLGraph；
- DeepSeek-V4 DSpark 在 Online Prefill / Decode 分离场景下的投机推理支持；
- CED Prefill Cutoff / Sliding-Window Bounded Replay 等模型结构相关优化。

这里最重要的架构变化是：推理优化已经从“选一个 vLLM 参数”进入模型结构与执行路径层面。MoE 专家计算、Attention、Indexer、KV Cache、投机解码、Prefill / Decode 分离可能由不同 Kernel、不同设备或不同阶段协作完成。企业在引入这些优化时，必须同步验证输出正确性、Token 接受率、缓存一致性、异常恢复和多节点通信，不能只比较单次 Benchmark 的 Tokens/s。

#### 6.3.3 昇腾：KTransformers 的 CPU / NPU 异构卸载路径

[KTransformers 的 DeepSeek-V4-Flash Ascend 教程](https://github.com/kvcache-ai/ktransformers/blob/main/doc/en/DeepSeek-V4-Flash_tutorial_for_Ascend_NPU.md) 展示了另一种思路：当单张 NPU 的 HBM 无法容纳完整模型时，不是简单地把模型切到更多 NPU，而是把不同计算路径放到不同处理器上。

教程中的单 NPU 方案将 Attention、Dense 层和每层 32 个常驻专家放在 NPU 上，以 W8A8 执行；其余 224 个路由专家以 MXFP4 保留在主机内存，由 KT-Kernel 的 LLAMAFILE MoE 在 CPU 上计算。教程列出的参考主机包括：

- Atlas 800I A2（910B3）：单 die 64 GB HBM，Kunpeng 920，192 核、8 个 NUMA 节点、1.5 TB RAM；
- Atlas A3（910_93）：单 die 61 GB HBM，教程列出的主机为 40 核、1 个 NUMA 节点、229 GB RAM；
- 软件环境示例：CANN Toolkit 9.0.0、Driver 25.5.1、Python 3.11，以及相互匹配的 torch / torch_npu 版本。

这种设计的收益是降低 NPU HBM 容量要求，代价则是大量 MoE 专家计算和数据访问转移到 CPU。企业必须测量 CPU 专家执行时间、NUMA 远端内存访问、内存带宽、NPU 与 CPU 之间的数据搬运，以及整体 Decode TPOT。不能仅凭“单 NPU 可以启动”就判断它能满足 Coding Agent 的并发和交互延迟要求。

还要注意该教程依赖特定的 SGLang Ascend 镜像、KTransformers Kernel 和定制 SGLang 分支；教程中甚至提醒同一个可变镜像 Tag 在不同拉取时间可能对应不同内容。生产部署必须固定 Git Commit、容器 Digest、模型权重校验和及完整依赖版本，不能只记录镜像 Tag。

#### 6.3.4 寒武纪：vLLM-MLU 的 DeepSeek-V4 支持

[Cambricon/vllm-mlu](https://github.com/Cambricon/vllm-mlu) 基于 vLLM 的插件系统，为 MLU 提供推理后端。仓库 README 的更新历史列出 2026-04-24 DeepSeek-V4 Day-0 支持，并说明当前仓库仅支持 MLU370 及以上设备，运行依赖寒武纪 SDK 和配套容器。

这个项目还有一个对企业平台设计有意义的地方：它展示了厂商通过 vLLM 插件机制维护独立设备后端的模式。业务服务可以继续使用 vLLM 的服务入口和常见 API，但底层算子、设备运行时、通信和容器仍由厂商栈负责。平台团队应把 vllm-mlu、它所依赖的社区 vLLM 版本和 Cambricon SDK 作为一个整体锁定，而不是单独升级其中一个 Python 包。

POC 至少需要核实：DeepSeek-V4 的具体模型变体、权重格式、MLU 型号与数量、最大上下文、Prefix Cache、Chunk Prefill、Speculative Decoding、Expert Parallel、Ray 多节点部署，以及 Tool Calling 的端到端正确性。仓库列出的特性支持不应自动视为每种模型配置均已验证。

#### 6.3.5 如何把 DeepSeek 适配结果转化为企业可用的兼容矩阵

不要在模型注册表里只写 DeepSeek-V4 supported=true。建议把适配状态拆成以下维度，并绑定到精确的软件制品：

| 维度 | 必须记录的字段 |
| --- | --- |
| 模型身份 | 官方模型 ID、模型变体、权重 Commit / Revision、Tokenizer、Chat Template |
| 硬件 | 厂商、芯片 SKU、单卡显存、节点卡数、节点数、CPU / NUMA、互联拓扑 |
| 数值格式 | BF16 / FP16 / FP8 / W8A8 / W4A8 / MXFP4 / TurboQuant 等具体权重与 KV Cache 格式 |
| 软件栈 | OS、Kernel、驱动、固件、CANN / NeuWare / MUSA / MXMACA / DTK、PyTorch、设备插件、推理引擎 |
| 执行模式 | TP / PP / DP / EP、MTP / DSpark、CPU Offload、PD 分离、AFD |
| 功能验证 | Streaming、Tool Calling、JSON Schema、长上下文、停止条件、并发请求、取消和超时 |
| 质量与性能 | 固定评测集结果、输出差异、TTFT、TPOT、Goodput、并发、显存、CPU 内存和成本 |
| 证据状态 | 官方教程 / 合并代码 / 厂商公告 / 社区复现 / 企业生产验收，以及最后验证日期 |

适配状态建议至少分为四级：**代码已支持**、**官方提供部署教程**、**在指定硬件和版本上完成真实模型验证**、**通过企业目标负载与 SLO 验收**。只有最后一级才能进入生产模型路由白名单。

参考项目和文档：

- [vLLM-Ascend：DeepSeek-V4-Flash 部署教程（基于 v0.30.0 验证）](https://docs.vllm.ai/projects/ascend/en/main/tutorials/models/DeepSeek-V4-Flash.html)
- [vLLM-Ascend：DeepSeek-V4 支持矩阵](https://docs.vllm.ai/projects/ascend/en/latest/user_guide/support_matrix/supported_models.html)
- [vLLM-Ascend：Release Notes](https://docs.vllm.ai/projects/ascend/en/latest/user_guide/release_notes.html)
- [早期 v0.13.0 DeepSeek-V4 教程（历史版本）](https://docs.vllm.ai/projects/ascend/en/v0.13.0/tutorials/DeepSeek-V4.html)
- [vllm-project/vllm-ascend](https://github.com/vllm-project/vllm-ascend)
- [hicann/cann-recipes-infer](https://github.com/hicann/cann-recipes-infer)
- [kvcache-ai/ktransformers：DeepSeek-V4-Flash Ascend NPU 教程](https://github.com/kvcache-ai/ktransformers/blob/main/doc/en/DeepSeek-V4-Flash_tutorial_for_Ascend_NPU.md)
- [Cambricon/vllm-mlu](https://github.com/Cambricon/vllm-mlu)

### 6.4 其他国产平台：关注厂商后端和版本绑定

国产平台逐步采用 PyTorch、vLLM 等开发者熟悉的接口，但接口相似不代表底层实现相同。常见方式是维护厂商自己的 PyTorch 发行版、设备后端、算子库、通信库和推理框架分支，或通过上游框架的 out-of-tree platform / plugin 接口接入。

- **寒武纪 vLLM-MLU**：基于社区 vLLM 插件系统为 MLU 提供推理服务能力。检查插件对应的 vLLM 版本、MLU 型号、模型列表、量化、连续批处理、KV Cache 和多卡通信支持。
- **摩尔线程 vLLM-MUSA / SGLang-MUSA**：分别基于 vLLM 和 SGLang 适配 MUSA。使用官方指定的软件栈、容器和依赖版本；不能把 CUDA 镜像简单替换设备挂载后就视为迁移完成。
- **沐曦 MXMACA**：关注官方适配版 PyTorch、Triton、FlashAttention、vLLM 和 SGLang 的版本关系。第三方教程中的版本组合只能作为线索，生产环境以当前官方文档和镜像为准。
- **壁仞 BIRENSUPA / TorchSUPA**：关注 PyTorch 代码迁移、算子覆盖和 vLLM 适配。模型 Day-0 适配只证明特定模型在特定产品和软件版本上完成了指定验证。
- **燧原 TopsRider / vLLM-GCU**：关注 GCU 运行时、torch-gcu、集合通信、算子库和 vLLM-GCU 的版本匹配。API、流式输出、多模态、Tool Calling 和多卡推理必须在目标服务器实测。
- **海光 DCU / DTK**：确认 DTK 与操作系统、内核、驱动、PyTorch、编译工具链及推理框架的支持矩阵。即使存在 HIP 或 ROCm 兼容接口，也要逐项确认编译器、算子、通信库和性能工具的实际支持范围。

上游 vLLM 提供 platform 抽象和 out-of-tree platform 扩展机制，厂商可以通过独立后端适配硬件。但某项功能最终是否可用，取决于后端实现，而不是 vLLM 上游 API 本身。企业应同时跟踪上游 vLLM 与厂商后端版本，避免上游升级后厂商插件尚未跟进。

### 6.5 从 CUDA 迁移：不是替换一个容器镜像

| 层面 | CUDA 环境常见依赖 | 国产平台需要核对的内容 |
| --- | --- | --- |
| 设备与运行时 | CUDA Runtime、Driver、NVIDIA Container Toolkit | 厂商 Runtime、驱动、设备插件、容器 Runtime 和设备挂载 |
| 深度学习框架 | PyTorch CUDA wheel、cuDNN | 厂商适配的 PyTorch / 设备后端、算子覆盖和版本组合 |
| 自定义算子 | CUDA C++、CUDA Extension、Triton、CUTLASS | 是否有兼容实现；是否需要重写为厂商算子或自定义 Kernel |
| 推理引擎 | vLLM、SGLang、TensorRT-LLM | 厂商后端、支持的模型架构、Attention、量化和调度特性 |
| 多卡通信 | NCCL、NVLink、InfiniBand / RoCE | 厂商集合通信库、卡间互联、RDMA、拓扑发现和故障诊断 |
| 可观测性 | DCGM、NVIDIA SMI、Nsight | 厂商健康监控、Profiler、日志、温度/功耗/显存和错误码 |

迁移路径分三类：

1. **模型不改、替换推理后端**：模型结构和权重格式已被厂商引擎支持时，优先采用官方适配和部署镜像，成本最低。
2. **框架适配、补齐算子**：模型可运行但存在算子缺失、性能回退或精度差异时，定位到 PyTorch 算子、Attention、量化或自定义算子层，优先复用厂商实现。
3. **模型图或执行策略调整**：架构不支持、算子组合不兼容或内存行为不适配时，再考虑替换算子、调整并行策略、量化方案或模型结构。所有改动都要做输出质量回归。

`torch.cuda` 兼容层、自动代码迁移工具或设备 API 映射只能降低初期改动，无法自动解决 CUDA Kernel、Triton Kernel、NCCL 通信、图捕获、量化内核和推理调度的语义差异。

### 6.6 生产部署架构：统一平台入口，隔离异构后端

```mermaid
flowchart TB
    IDE["IDE / Coding Agent"]
    Agent["Agent Runtime / Sandbox"]
    Gateway["Unified AI Gateway / Model Router"]
    Registry["Model Registry + Compatibility Matrix"]
    Ascend["Ascend Pool\nCANN + vLLM Ascend / MindIE"]
    GPU["MUSA / MetaX Pool\nMUSA / MXMACA + vLLM / SGLang"]
    Other["MLU / GCU / DCU / Biren Pool\nVendor Runtime + Adapted Serving"]
    Obs["Unified Metrics / Logs / Traces / Cost"]
    IDE --> Agent --> Gateway
    Gateway --> Registry
    Registry --> Ascend
    Registry --> GPU
    Registry --> Other
    Ascend --> Obs
    GPU --> Obs
    Other --> Obs
```

- **统一 API，不强求统一底层实现**：统一 API、Streaming、模型别名和错误协议；后端内部允许不同 Runtime 和推理引擎。
- **模型路由感知能力**：Model Registry 除模型名称外，还应记录芯片型号、框架版本、量化格式、上下文上限、Tool Calling、结构化输出、多模态和并行能力。
- **镜像按硬件栈维护**：不同厂商驱动和用户态 Runtime 不宜强行放进同一个通用 GPU 镜像。采用独立、不可变的基础镜像，由统一 CI 构建与扫描。
- **Kubernetes 统一管理，设备插件按厂商部署**：统一 Namespace、Quota、NetworkPolicy、发布流程；节点标签、Device Plugin、RuntimeClass、拓扑调度和监控适配按厂商实现。
- **Agent 与 GPU 解耦**：Agent Runtime 不应直接依赖 CUDA、CANN 或某个厂商 SDK，只调用 AI Gateway。更换模型池不应影响 Agent 生命周期和工具安全边界。

### 6.7 POC 验收：服务启动不等于生产可用

| 验证域 | 测试内容 | 验收要求 |
| --- | --- | --- |
| 安装与兼容性 | OS、Kernel、驱动、固件、SDK、PyTorch、推理框架 | 形成可重复安装的版本锁定清单 |
| 模型覆盖 | 权重加载、Tokenizer、模型结构和自定义代码 | 无未解释的算子缺失或隐式 CPU 回退 |
| 功能正确性 | 普通生成、Streaming、停止词、批处理、长上下文 | 与参考实现做输出和行为对照 |
| Coding 能力 | Tool Calling、并行工具调用、JSON Schema、代码生成和补丁任务 | 固定任务集成功率达到预定义门槛 |
| 精度 | 实际支持的 BF16 / FP16 / FP8 / INT8 / INT4 | 记录质量变化、异常输出和数值误差 |
| 性能 | TTFT、TPOT、吞吐、Goodput、并发、KV Cache | 相同 SLO、上下文和到达率下比较 |
| 多卡与网络 | P2P、集合通信、TP / PP / EP、跨节点 RDMA | 达到设计目标，故障可定位 |
| 稳定性 | 长压测、OOM、进程重启、节点维护、升级回滚 | 恢复流程可执行，无持续资源泄漏 |
| 运维 | 健康、错误码、温度、功耗、显存、日志和告警 | 指标可采集并关联模型请求和节点 |
| 供应链 | 镜像、驱动、SDK、权重、许可证和漏洞 | 有来源、版本、校验和及回滚记录 |

Coding Agent 场景还要验证工具调用参数是否符合 Schema、长上下文是否丢失代码约束、模型是否能完成多轮工具闭环。模型能流畅回答，不代表它适合 Coding Agent。

性能报告必须公开芯片型号与数量、节点拓扑、软件版本、模型版本、量化格式、输入输出长度分布、并发、请求到达率、缓存冷/热状态和 SLO。不同厂商各自发布的最佳成绩不能直接放在一张表里排名。

### 6.8 企业选型建议

- **昇腾**：优先验证服务器、CANN、PyTorch、vLLM Ascend / MindIE 的完整组合，以及目标模型多卡能力；重点看软件版本治理、模型覆盖和交付支持。
- **摩尔线程、沐曦、壁仞**：作为通用 GPU 路线重点比较，检查 PyTorch / vLLM / SGLang 适配、CUDA 迁移成本、自定义 Kernel 和集群互联能力。
- **寒武纪、燧原、海光 DCU**：结合具体加速器定位和软件栈，核实模型覆盖、框架适配和规模化部署能力；不要仅凭设备 API 名称判断它与通用 GPU 的可替换程度。
- **混合部署**：国产算力与 NVIDIA 并存时，统一 API Gateway、模型注册、配额、日志和评测体系；按模型能力、数据驻留、成本和 SLO 路由，避免 Agent 应用直接感知设备品牌。

最终决策应比较 **Cost per Successful Coding Task**，而不是单卡理论 FLOPS 或厂商宣传的 Tokens/s。模型质量、框架适配人力、算子开发成本、节点利用率、故障恢复、软件升级和供应商支持都要计入 TCO。

---

### 6.9 国产 GPU 学习路线：把 CUDA 知识迁移过来，但不要照搬 CUDA 代码

如果已经学过前面 NVIDIA GPU、CUDA、PyTorch、NCCL 和推理框架的内容，学习国产 GPU 不需要从“什么是 GPU”重新开始。更有效的方式是保留已经掌握的并行计算、内存层次、Kernel、算子、分布式通信和推理系统知识，再逐层学习目标厂商的软件栈与硬件执行模型。

但要先明确一个边界：**CUDA 知识可以迁移，CUDA 二进制、CUDA 专有 API、NVIDIA 的硬件假设和性能经验不能直接迁移。** 不同国产加速器之间也不是一个统一的国产 CUDA。昇腾、摩尔线程、寒武纪、沐曦、壁仞、燧原和海光有各自的设备模型、编译器、Runtime、算子库、通信库和版本配套关系。

#### 推荐学习顺序

建议按下面的顺序学习。不要一开始就钻进某个厂商的 Kernel 语言，也不要同时安装多家 SDK。

**第一步：先选定一套真实硬件和软件版本，建立可复现环境。**

先选一个准备实际部署的目标平台，例如 Atlas 昇腾、摩尔线程服务器 GPU 或寒武纪 MLU。记录具体芯片 SKU、服务器型号、CPU 架构、OS / Kernel、驱动、固件、SDK、PyTorch、推理框架和容器版本。优先使用厂商提供的开发容器或经过验证的整机环境，先完成设备识别、设备信息查询、内存分配、简单计算和多卡可见性检查。

这一阶段的目标不是调性能，而是形成一份可以复现的环境清单。驱动、固件、编译器、Runtime、框架插件往往存在严格的版本配套关系；不要把不同教程中的安装命令拼成一个环境。

**第二步：从 PyTorch 迁移开始，先让熟悉的模型跑起来。**

先学习目标平台的 PyTorch 后端，复用熟悉的 Tensor、Module、Autograd、Optimizer、AMP 和 Distributed API。把一个已经在 NVIDIA GPU 上跑通的模型迁移过来，验证模型加载、前向、反向、保存恢复、混合精度和多卡训练 / 推理。

主要入口因平台而异：

- 昇腾：PyTorch + `torch_npu`，重点理解 `torch.npu`、算子支持情况、设备内存和 HCCL 分布式通信；
- 摩尔线程：PyTorch + `torch_musa`，重点理解 `torch.musa`、MUSA SDK 和 MCCL；其 CUDA 迁移工具可以降低部分代码改造量；
- 寒武纪：PyTorch + `torch_mlu`，先掌握 CNToolkit、CNNL、CNCL 和官方 PyTorch Container 的依赖关系；
- 沐曦、壁仞、燧原、海光 DCU：先从各自官方 PyTorch 适配层和经过验证的容器开始，不要因为接口看起来类似 CUDA 就假定第三方扩展都能直接使用。

这一阶段应优先修复代码中的 CUDA 假设，例如硬编码的 `"cuda"`、`.cuda()`、`torch.cuda.*`、自定义 CUDA Extension、NCCL backend 和只支持 CUDA 的第三方库。把设备选择、通信后端、AMP 和算子能力封装在平台适配层中，而不是在业务代码里散落厂商判断。

**第三步：学习推理框架和模型部署，不要急着自己写算子。**

先使用目标平台已有的 vLLM、SGLang、厂商推理引擎或模型部署配方，跑通一个实际 LLM。重点观察模型权重格式、量化方式、Tokenizer / Chat Template、KV Cache、Continuous Batching、TP / PP / EP、Prefill / Decode、Speculative Decoding 和多节点通信。

以 DeepSeek 为练习对象时，应该选定具体模型变体和权重格式，例如 V4-Flash 的指定 W8A8 或 MXFP4 路径，而不是笼统地测试“DeepSeek”。确认服务可以启动后，还要验证 Streaming、Tool Calling、JSON 输出、长上下文、并发、TTFT、TPOT、Goodput 和错误恢复。先使用已有高性能 Kernel 和算子库，明确瓶颈之后再决定是否需要自己开发算子。

**第四步：补齐目标平台的 Runtime、内存和通信模型。**

这一阶段相当于把 CUDA Runtime、Driver API、cuBLAS / cuDNN、NCCL 的知识映射到目标平台，但不要只记 API 名称，要理解 Host / Device 执行边界、设备内存、异步 Stream、Event、同步、数据搬运、图执行、集合通信和错误处理。

| NVIDIA 已学过的概念 | 国产平台需要进一步学习的对应内容 |
| --- | --- |
| CUDA Driver / Runtime、Stream、Event | 各厂商 Driver / Runtime、队列或 Stream、Event、异步执行和设备上下文 |
| CUDA Memory、Pinned Memory、Unified Memory | 设备内存、Host / Device 数据搬运、缓存与本地片上存储；具体机制按芯片架构学习 |
| cuBLAS、cuDNN、CUTLASS | 各平台矩阵 / 深度学习算子库、算子模板库和融合算子 |
| NCCL、NCCL Tests | HCCL、MCCL、CNCL 或厂商对应通信库；学习集合通信、拓扑、带宽和多节点故障定位 |
| Nsight Systems / Compute | 厂商 Profiling、算子耗时分析、内存分析、精度调试和系统级 Trace |
| CUDA Graph | 对应平台的图执行、编译图或图捕获能力；不要假定语义和限制完全相同 |

尤其要重新理解片上存储与计算单元。NVIDIA 的 SM、Warp、Shared Memory、Tensor Core 不能直接等同于其他芯片的计算核心、线程模型、片上缓存和矩阵单元。比如昇腾 AI Core 的 Cube / Vector、Unified Buffer、L0 存储和 SIMD / SIMT 组合，都需要按昇腾自己的编程模型学习。

**第五步：开始写一个最小自定义算子，再学习底层 Kernel 语言。**

不要从 FlashAttention 或完整 MoE Kernel 开始。建议按以下练习顺序，每一步都同时写正确性测试和性能基准：

1. Vector Add：熟悉 Host / Device、内存分配、Kernel 启动和数据搬运；
2. Reduction / Softmax：理解并行归约、同步、数值稳定性和精度误差；
3. GEMM：理解分块、矩阵单元、数据复用、片上存储和流水线；
4. LayerNorm / RMSNorm：练习融合算子、内存带宽和小算子启动开销；
5. Attention：进一步理解访存模式、KV Cache、Mask、长序列和融合；
6. MoE Routing / Grouped GEMM：理解专家分发、负载均衡、通信与计算重叠。

按目标平台选择底层语言和工具：

- **昇腾**：先学习 Ascend C 的 SIMD / SIMT 编程模型、Host / Device、TPipe / TQue、内存层次、异步执行、编译、调试和性能分析。掌握基础后，再学习 CATLASS、PyPTO，以及 TileLang 的 Ascend 后端。Ascend 950 的编程模型和工具链有新能力，必须使用对应芯片和 CANN 版本的文档，不要把旧型号教程直接套到新型号。
- **摩尔线程**：先按 MUSA 编程指南学习 Host / Device、Grid / Block / Thread、Warp、寄存器 / 共享 / 全局内存、Runtime API 和 Kernel 启动，再做 MUSA Extension 和性能分析。MUSA 与 CUDA 的编程习惯有相似之处，但 Warp 大小、硬件代际和库支持可能不同，不能把 NVIDIA 的 Block 配置和 Occupancy 经验原样复制。
- **寒武纪**：先掌握 CNRT 运行时、MLU 存储模型、MLU Core 并行与同步，再学习 BANG C、CNNL 和 MLU-OPS 的算子开发、测试及性能调优。可从官方 MLU-OPS 的 Add / VectorAdd 示例开始。
- **沐曦、壁仞、燧原、海光 DCU**：先掌握厂商提供的 Runtime、PyTorch 插件和官方算子库，再确认是否提供成熟的自定义 Kernel 语言、编译器和调优工具。不要仅凭“CUDA 兼容”或 API 相似就跳过设备架构与版本矩阵学习。

**第六步：学习更高层的 Kernel DSL 和编译器，再看深度优化。**

如果已经掌握 CUDA Kernel、算子性能分析和底层硬件概念，可以进一步学习 TileLang、Triton 及其国产平台适配。它们有机会让开发者用更高层的 Tile / Tensor 表达方式描述计算，再由编译器映射到不同硬件；但各后端的成熟度、支持算子、编译路径和性能并不一致。

特别值得关注的是 DeepSeek 与昇腾生态的开源项目：

- [TileLang](https://github.com/tile-ai/tilelang)：主仓库已有 Ascend 950 后端文档，展示 Ascend C / PTO 代码生成、Cube / Vector 执行和自动调度等能力；其它硬件的适配器可能位于独立仓库，需按项目状态分别判断。
- [DeepSeek TileKernels](https://github.com/deepseek-ai/TileKernels)：基于 TileLang 的算子库，适合对照同一算子的 CUDA 与 Ascend 后端实现，学习跨后端 Kernel 的组织方式。
- [DeepSeek DeepGEMM-Ascend](https://github.com/deepseek-ai/DeepGEMM-Ascend)：用于理解昇腾上的高性能 GEMM 和模型专项计算优化。
- [DeepSeek DeepEP-Ascend](https://github.com/deepseek-ai/DeepEP-Ascend)：用于理解 MoE 场景下的专家并行和通信优化。

不要把“有一个 backend”理解成“所有 Triton / TileLang 程序都能无修改运行”。应检查对应后端支持的芯片型号、算子子集、编译器版本、测试覆盖和真实设备验证情况。

**第七步：最后再学习多机集群、性能工程和生产化。**

在单机单卡、单机多卡都稳定之后，再进入多节点通信、拓扑感知、集合通信调优、通信计算重叠、Prefill / Decode 分离、故障恢复和 Kubernetes 设备调度。把设备监控、算子 Profiling、推理指标和 Agent Trace 串起来，最终形成从 Kernel 到模型 API 的端到端性能分析能力。

#### 学习时最容易踩的坑

- **把 CUDA 兼容当成二进制兼容。** 能复用 PyTorch 接口，不代表 CUDA Extension、PTX、CUTLASS、NCCL 或依赖 CUDA 私有 API 的库可以直接运行。
- **只改 device 字符串。** `cuda` 改成 `npu` / `mlu` / `musa` 只是入口修改；算子覆盖、AMP、分布式通信、内存行为和第三方依赖仍需逐项验证。
- **忽略硬件执行模型差异。** Warp 大小、计算单元、片上内存、矩阵指令、同步语义和数据布局不同，原有 CUDA Kernel 的 Block、Tile、Shared Memory 和流水策略不一定适用。
- **混装 SDK 和框架版本。** Driver、Firmware、Toolkit、Compiler、Runtime、PyTorch、插件、推理引擎和容器需要按厂商兼容矩阵锁定。不要在一个环境里混用不同版本教程的安装步骤。
- **拿单卡 Demo 代替生产验证。** 模型能加载不代表长上下文、多卡、多节点、量化、Tool Calling 和高并发都能正常工作。
- **只看 Tokens/s。** 同时测量输出质量、精度误差、TTFT、TPOT、Goodput、尾延迟、显存 / 主机内存、CPU 占用、功耗和故障恢复。
- **没有区分实验性能力和生产能力。** 文档中的 Beta、Preview、Experimental、社区分支和厂商正式发行版要分开记录。生产基线应固定版本、Commit、容器 Digest 和模型权重校验和。
- **一开始就同时学所有国产平台。** 先选一个平台把 PyTorch、推理、算子、Profiling 和多卡链路完整走通，再横向比较其它平台。这样才能区分是模型问题、框架问题还是设备后端问题。

#### 一个可执行的四阶段学习计划

| 阶段 | 练习成果 | 完成标准 |
| --- | --- | --- |
| 1. 环境与框架 | 在目标设备运行 PyTorch 模型和一个 LLM | 单卡推理正确；环境版本清单可复现 |
| 2. 推理与分布式 | 部署 vLLM / SGLang 或厂商引擎，完成多卡推理 | 验证 TP / EP、通信、长上下文、Tool Calling 和性能指标 |
| 3. 算子开发 | 完成 Vector Add、Softmax、GEMM、RMSNorm 中至少三个算子 | 有正确性测试、精度比较、Profiling 和优化前后基准 |
| 4. 生产化 | 部署多副本或多节点服务并接入统一模型网关 | 有容量测试、监控、故障演练、版本回滚和 SLO 验收 |

对已经掌握 CUDA 的工程师，最值得花时间的不是重新学习线程块和矩阵乘法的基本概念，而是理解**目标芯片的执行模型、软件栈边界、算子库覆盖、编译器行为和性能分析方法**。这几项决定了 CUDA 经验能迁移多少，以及剩下的迁移成本究竟在哪里。


## 7. Coding Agent 平台：不要把 Agent 当成普通聊天请求

1000 名开发者的 AI Coding 平台，真正消耗资源的单位不是“用户登录数”，而是活跃 Agent Session 和任务执行轨迹。

一次 Agent 任务可能包含多轮模型调用、文件读取、代码搜索、工具执行、测试、错误分析和重试。模型输出 Token 量只是成本的一部分，Agent 工具运行和上下文构造也会产生 CPU、内存、存储和网络开销。

### 6.1 Agent Runtime 的职责

Agent Runtime 应负责：

- Session 和 Task 生命周期；
- Prompt、上下文和模型调用编排；
- Tool Calling 和结果回传；
- 文件、终端、测试、Git 等工具执行；
- 超时、取消、重试和检查点；
- 人工确认和权限升级；
- 任务状态、日志和审计；
- 任务结果验证和交付。

Agent Runtime 不应该直接管理 GPU 驱动、NCCL 或模型进程。它通过 AI Gateway 调用推理服务，避免把模型服务和业务 Agent 的发布周期绑定。

### 6.2 Agent Sandbox 与凭证隔离

Coding Agent 可以读写代码、运行 shell、安装依赖、访问网络和调用 MCP 工具，因此它的风险远高于只读聊天机器人。

最低安全要求：

- 每个用户或任务有独立 Workspace / Sandbox；
- 非 root 用户、只读根文件系统和资源限制；
- 默认禁止任意网络出口，按需开放域名或服务；
- 短期、最小权限的身份凭证；
- 不把长期 API Key、云凭证和生产 Secret 暴露给模型上下文；
- MCP Server 的凭证由受控服务端注入；
- 文件系统、进程、网络和容器之间隔离；
- 工具调用进行授权检查和审计；
- 对敏感动作实施人工确认；
- 任务结束后销毁或按策略保留 Workspace。

2026 年 10 月 21 日，NVIDIA 发布了 OpenShell Reference Architecture 相关技术文章，描述 Gateway、Supervisor、Sandbox 和 Policy Prover 等边界，并讨论 BlueField-4 / NVIDIA Sentry 等硬件辅助治理方向。这是值得评估的新参考架构，但不能仅凭厂商参考设计就认定其已经适合所有企业生产环境。应通过威胁建模、隔离测试、逃逸测试和运维验证评估。

### 6.3 Agent 与 GPU 服务的边界

```mermaid
flowchart TB
    Dev["Developers / IDE"]
    Harness["Coding Agent Harness"]
    Sandbox["Isolated Workspace / Sandbox"]
    Gateway["AI Gateway"]
    Router["Model Router"]
    PoolA["B300 Inference Pool"]
    PoolB["Fallback / Secondary Model Pool"]
    Tools["Governed Tools / MCP"]
    Repo["Git / Repository Services"]
    Obs["Logs / Metrics / Traces / Audit"]
    Policy["Identity / Policy / Budget"]

    Dev --> Harness
    Harness <--> Sandbox
    Harness --> Gateway
    Harness --> Tools
    Tools --> Repo
    Gateway --> Router
    Router --> PoolA
    Router --> PoolB
    Policy -.-> Gateway
    Policy -.-> Harness
    Policy -.-> Sandbox
    Harness --> Obs
    Gateway --> Obs
    Router --> Obs
    PoolA --> Obs
    PoolB --> Obs
```

这张图是逻辑架构，不代表每个方框都必须部署成独立微服务。初期可以将 Router 和 Gateway 合并为一个可独立扩展的服务，但 Agent Runtime、GPU 推理进程和不可信代码执行环境应保持明确的安全边界。

## 8. 1000 名开发者的容量规划

“1000 个账号”不是容量指标。至少要区分：

- Registered Developers：注册开发者数量；
- Daily Active Developers：日活开发者；
- Concurrent Agent Sessions：同时运行的 Agent Session；
- Concurrent Model Requests：同时在途的模型请求；
- Request Arrival Rate：请求到达速率；
- Input / Output Token Distribution：输入和输出 Token 分布；
- Context Length Distribution：上下文长度分布；
- Task Duration：Agent 任务持续时间；
- Retry / Tool Call Distribution：重试和工具调用分布。

一个开发者可能只偶尔问一个问题，也可能同时运行多个 Agent。一个 Agent Session 也不等于一个模型请求：工具调用结束后可能发起下一轮请求。因此不能用“1000 人 ÷ 每张卡能服务多少用户”这种方式计算 GPU 数量。

### 7.1 先建立负载模型

建议从现有 Coding Agent 日志或试点用户采样，得到以下分布：

| 维度 | 需要采集的内容 |
| --- | --- |
| 用户行为 | 日活、活跃时段、每人每天任务数 |
| Agent 并发 | 每用户并发 Session、Session 持续时间 |
| 模型请求 | 每个任务模型调用次数、请求到达间隔、重试次数 |
| 输入长度 | System Prompt、工具定义、仓库上下文、历史消息的 Token 分布 |
| 输出长度 | 普通回复、代码生成、工具参数和总结的 Token 分布 |
| 上下文增长 | Session 生命周期内 Context Length 的变化 |
| 模型分布 | 不同模型、量化和任务路由比例 |
| 服务质量 | 可接受 TTFT、TPOT、端到端延迟和失败率 |

在没有真实数据时，可以设置低、中、高三种情景做预算，但这些数字只能作为压测输入，不应被写成 B300 的确定服务能力。

### 7.2 容量计算的基本方法

对单个模型部署副本，先测出在目标 SLO 下的有效吞吐 Goodput，而不是峰值吞吐。设：

- D：目标输入/输出 Token 需求率；
- G：单个副本在满足 SLO 时的实测有效吞吐；
- R：故障、突发和升级预留比例。

可以先用下面的公式估算副本数量：

[
N = leftlceil rac{D}{G} 	imes (1 + R) ightceil
]

但这里的 D 和 G 必须按输入/输出阶段、模型、上下文长度和负载分布拆分。不同模型、不同精度、不同并行策略的吞吐不能直接相加。若有多个模型池，应分别计算后再汇总。

此外，容量必须同时满足显存约束：

[
M_{weights} + M_{KV} + M_{runtime} + M_{workspace} + M_{reserve}
leq M_{available}
]

模型权重能装进 GPU，不代表能够满足目标并发。长上下文和高并发通常首先消耗 KV Cache。要通过真实引擎测量，而不是只按参数量乘以每参数字节数来估算。

### 7.3 Benchmark 应测什么

| 指标 | 含义 | 主要用于判断 |
| --- | --- | --- |
| TTFT p50/p95/p99 | 首 Token 延迟 | 输入处理、队列和 Prefill |
| TPOT / ITL p50/p95/p99 | 输出 Token 间隔 | Decode 体验 |
| End-to-End Latency | 完整请求耗时 | 用户整体等待时间 |
| Input / Output Tokens/s | 输入、输出吞吐 | 资源产出 |
| Goodput | 满足延迟、错误率和质量门槛的有效吞吐 | 真正可承诺的服务能力 |
| Queue Time | 排队时间 | 调度和容量不足 |
| KV Cache Usage / Hit Rate | KV Cache 占用和复用 | 长上下文并发与缓存收益 |
| GPU Utilization / HBM | GPU 使用率和显存 | 瓶颈定位，不是最终成功指标 |
| OOM / Retry / Cancellation | 失败和重试 | 稳定性与浪费 |
| Cost per Successful Task | 每个成功代码任务成本 | 企业 FinOps |

对 Coding Agent 还要增加业务指标：

- Task Success Rate；
- Human Intervention Rate；
- Tests Passed / Regression Rate；
- Tool Call Success Rate；
- Invalid Tool Arguments；
- Tokens per Successful Task；
- Time to Complete a Task；
- Cost per Successful Task。

高 Token Throughput 不等于高业务产出。如果模型生成得更快，但代码任务失败率更高，实际单位成功任务成本可能更差。

### 7.4 推荐的 POC 压测矩阵

| 维度 | 建议测试档位 |
| --- | --- |
| GPU 配置 | 单 GPU、单节点 8 GPU；之后再测多节点 |
| 并发 Agent Session | 50、100、200、300，按实际业务修订 |
| 上下文长度 | 8K、32K、64K、128K；必要时增加更长档位 |
| 输入/输出分布 | 使用生产采样 Trace，不用统一固定长度代替 |
| 模型精度 | BF16/FP8 基线，候选 FP4/NVFP4 |
| 请求模式 | 突发、稳定到达、长短请求混合、后台批量任务 |
| 缓存 | 冷启动、Prefix Cache 命中、缓存失效 |
| 故障 | 单副本退出、GPU OOM、节点重启、网络中断、模型加载失败 |
| 发布 | 滚动升级、双版本并存、回滚和缓存冷启动 |

50/100/200/300 是测试梯度，不是 B300 对应的用户承载承诺。必须用同一个 Agent Harness、相同工具、相同仓库和相同任务集比较不同 GPU 与推理引擎。

## 9. 可观测性：GPU 指标、推理指标和 Agent Trace 必须关联

只监控 GPU Utilization 无法解释开发者为什么觉得慢。只看 API 延迟也无法定位是队列、Prefill、Decode、网络还是工具执行导致的。

建议建立三层可观测性：

| 层次 | 指标/日志 | 典型问题 |
| --- | --- | --- |
| Infrastructure | GPU 温度、功耗、HBM、XID、ECC、NVLink、PCIe、NIC、RDMA、磁盘、节点健康 | GPU 降频、链路异常、硬件故障 |
| Inference | Queue Time、TTFT、TPOT、Tokens/s、Batch Size、KV Cache、OOM、请求错误 | 模型服务过载、缓存不足、调度不公平 |
| Agent | Session、Task、模型调用、Tool Call、Workspace、测试结果、人工介入、任务成本 | Agent 循环、工具失败、上下文膨胀、任务未完成 |

推荐的基础组件：

- NVIDIA DCGM / DCGM Exporter：GPU 指标；
- Prometheus：时序指标；
- Grafana：仪表盘；
- OpenTelemetry：Trace、Metric、Log 的统一关联；
- Loki 或 Elasticsearch：日志；
- ClickHouse 或其他分析型存储：大规模调用与成本分析（按数据量和现有平台决定）。

每个 Agent Task 应有稳定的 Trace ID；每一次模型请求、工具调用和测试执行都应成为可关联的 Span。日志中记录模型版本、量化、推理节点、Token 用量、队列等待、延迟、错误类型和成本。Prompt 与代码内容是否落日志，需要根据数据分类、隐私和保留政策单独决定，默认应避免记录敏感源代码和 Secret 明文。

## 10. 安全与治理：模型 API 不是唯一的攻击面

企业 AI Coding 服务至少涉及四类安全边界：

1. 开发者身份和企业授权；
2. 模型请求、上下文和数据保护；
3. Agent 工具、MCP 和代码执行；
4. GPU 集群、模型制品和基础设施管理。

### 9.1 身份与访问控制

- 接入企业 SSO / OIDC；
- 用户、团队、项目和环境级授权；
- Model Allowlist 和模型能力策略；
- API Key 短期化、可撤销和最小权限；
- 组织、团队、用户和 Session 多层预算；
- 管理员操作、模型发布和策略变更审计。

### 9.2 数据保护

- 代码仓库、Prompt、模型输入输出按数据分类管理；
- 明确数据是否离开企业网络、是否进入第三方模型或遥测服务；
- 明确日志内容、采样、保留期和访问权限；
- 对 Secret、Token、证书和个人数据做检测与脱敏；
- 模型权重、Tokenizer、依赖和容器镜像做来源校验；
- 模型服务与 Agent Workspace 的网络隔离；
- 对跨租户缓存和共享文件系统进行威胁建模。

### 9.3 Agent 工具安全

Agent 的权限必须由平台策略强制执行，不能依赖 System Prompt 要求模型“不要做危险的事”。

对 shell、文件、Git、数据库、云 API 和 MCP 工具，应定义明确的权限边界。对生产环境写操作、删除、发布、凭证读取和外部通信，使用独立授权或人工确认。Sandbox 应默认拒绝未授权网络出口，凭证通过受控 Broker 按请求注入，而不是放进环境变量或模型上下文。

## 11. 生产运维与可靠性设计

GPU 平台的故障不仅是 Pod Crash。还包括 GPU XID、ECC 错误、NVLink 退化、NIC/RDMA 问题、交换机拥塞、驱动不兼容、模型加载失败、KV Cache OOM 和推理引擎死锁。

至少要建立以下 Runbook：

| 事件 | 检测信号 | 处理原则 |
| --- | --- | --- |
| GPU 健康异常 | DCGM Health、XID、ECC、温度/功耗异常 | 隔离节点或 GPU，采集诊断信息，按 OEM 流程维修 |
| NVLink / NCCL 故障 | P2P 测试失败、NCCL timeout、链路错误 | 检查拓扑、交换机/固件/驱动，避免盲目重启整个集群 |
| GPU OOM | 推理引擎 OOM、KV Cache 分配失败 | 限制上下文/并发，检查缓存和批处理配置，必要时扩容 |
| 模型加载失败 | 权重校验、启动超时、内存不足 | 检查制品、磁盘、版本兼容和加载并发 |
| 请求积压 | Queue Time、TTFT 持续升高 | 限流、优先级调度、切换备用池或降低后台负载 |
| 节点维护 | Node NotReady、驱动升级 | Drain、迁移流量、验证备用容量，再进行维护 |
| 网络故障 | RDMA 错误、丢包、拥塞、吞吐下降 | 检查 NIC、交换机、光模块、PFC/ECN 和路由 |
| 区域/机房故障 | 多节点不可用 | 按灾备设计切换到备用区域/服务商或外部模型 |

生产发布需要版本锁定和分阶段升级：

1. 先在隔离测试节点验证 Driver、CUDA、NCCL、GPU Operator 和推理引擎；
2. 使用固定评估集验证模型质量和工具调用；
3. 对少量流量 Canary；
4. 观察延迟、错误率、GPU 健康和 Agent 成功率；
5. 达到门槛后逐步扩流；
6. 保留可回滚的镜像、模型制品和配置版本。

不要在高峰时段同时升级 GPU Driver、Kubernetes、推理引擎和模型。每次变更应尽量控制变量。

## 12. 成本模型与供应商采购

GPU 租赁成本只是平台总成本的一部分。至少要把成本拆成：

[
TCO = GPU + Network + Storage + Facility + Software + People + Support + FailureReserve
]

其中 GPU 成本不能只用标价乘以卡数。应比较在目标 SLO 下的有效吞吐，以及每个成功代码任务的全成本。

[
CostPerSuccessfulTask =
rac{GPU + Infrastructure + Platform + Operations + FailedAttempts}
{SuccessfulTasks}
]

采购询价应要求供应商回答：

- 报价是按 GPU、8-GPU 节点还是完整 NVL72 机架；
- 是否承诺整组节点同时可用；
- GPU 是否属于同一 NVLink 域；
- NIC、交换机、RDMA 和 oversubscription 配置；
- 节点间网络是否独占，是否有带宽保障；
- 是否包含存储、模型缓存和流量费用；
- 是否提供 DCGM、NCCL、硬件健康和故障数据；
- SLA、故障更换时限和维护窗口；
- 预留容量、扩容提前期、缩容条款；
- 数据驻留、日志、远程运维和人员访问方式；
- 价格是否包含软件、支持、税费和跨区域流量。

长期合同前先做短期 POC。需要对比按需、预留、容量块和长期承诺的 break-even utilization。未测出真实工作负载下的 Goodput，不应把公开的每 GPU 小时价格直接转换成年度预算结论。

## 13. 工程团队需要哪些能力

不要求所有人都成为 CUDA Kernel Engineer。企业建设团队需要覆盖基础设施、分布式系统、推理服务、Agent 应用、安全和 SRE。

| 角色 | 主要责任 | 必备知识 |
| --- | --- | --- |
| GPU / Infrastructure Engineer | 服务器、GPU、网络、存储、机房 | B300/HGX、Linux、PCIe、NVLink、RDMA、液冷 |
| Platform Engineer | Kubernetes、GPU Operator、自动化和调度 | Kubernetes、Helm、Terraform、Ansible、GitOps |
| ML Systems / Inference Engineer | 模型部署、并行、量化、性能优化 | CUDA 基础、NCCL、vLLM、SGLang、TensorRT-LLM |
| Backend / AI Platform Engineer | Gateway、Router、配额、会话和 API | Go/Java/Python/TypeScript、API、Redis、队列、数据库 |
| Agent Engineer | Coding Agent、工具、上下文和沙箱集成 | Agent Runtime、Tool Calling、MCP、代码执行 |
| SRE / Observability Engineer | 监控、告警、故障响应、容量和成本 | Prometheus、Grafana、OpenTelemetry、Incident Management |
| Security Engineer | 身份、策略、凭证、网络和审计 | IAM、OIDC、OPA、Sandbox、供应链安全、威胁建模 |

如果企业已经有成熟 Kubernetes、网络和 SRE 团队，新增 GPU 推理平台的初期核心团队可以从 3–5 名专职工程师开始，再由安全、网络和数据中心团队提供专业支持。这个人数只适用于模型推理平台的初期建设，不包括基础模型训练、数据集研发、模型微调和 7×24 大规模现场硬件运维。若没有现成基础设施能力，团队规模和交付周期都需要上调。

## 14. 建议的实施路线图

不要一次采购几十张 GPU 后才开始验证模型。按阶段交付，每阶段都有明确退出条件。

| 阶段 | 时间参考 | 工作内容 | 退出条件 |
| --- | --- | --- | --- |
| 0. Discovery | 1–2 周 | 采集开发者行为、模型候选、代码任务、数据分类、区域和预算约束 | Workload Profile、需求基线和采购约束确认 |
| 1. Single-node POC | 2–3 周 | 一台 8-GPU HGX B300 或租用等价节点；部署驱动、CUDA、推理引擎和目标模型 | 模型加载、单节点 NCCL、API、质量和初步性能通过 |
| 2. Agent Integration | 2–3 周 | 接入真实 Coding Agent、工具、代码仓库和 Sandbox | 端到端代码任务可运行，权限和审计有效 |
| 3. Multi-node Scale | 2–4 周 | 增加节点、配置 RDMA Fabric、调度和缓存 | 跨节点通信、扩容、故障隔离和负载测试通过 |
| 4. Production Hardening | 2–4 周 | HA、SLO、监控、告警、容量、发布和灾备 | SLO、故障演练、安全测试和运维 Runbook 通过 |
| 5. Rollout | 分批 | 先试点团队，再逐步开放更多开发者 | 业务指标、成本和用户反馈达到门槛 |

时间只是典型项目拆分，不是交付承诺。机房液冷改造、网络采购、GPU 供应和安全审批可能成为关键路径，且往往不在软件团队控制范围内。

## 15. 验收标准：用可交付结果判断平台是否完成

| 验收域 | 验收内容 |
| --- | --- |
| Hardware | GPU、HBM、NVLink、NIC、NVMe、BMC、功耗和温度状态可验证 |
| Fabric | 单节点和跨节点 NCCL 测试达到设计目标，网络故障可定位 |
| Kubernetes | GPU 节点可注册、调度、隔离、维护和恢复 |
| Model Serving | 模型可重复部署，API/Streaming/Tool Calling 兼容性测试通过 |
| Performance | 在目标上下文和并发下达到约定 TTFT、TPOT、Goodput |
| Quality | 固定 Coding Benchmark 和内部任务集达到最低质量门槛 |
| Agent | 任务执行、工具调用、Sandbox、人工确认和结果验证可审计 |
| Security | 越权、网络逃逸、凭证暴露、跨租户访问测试通过 |
| Reliability | 节点故障、GPU 故障、网络故障、模型升级和回滚演练通过 |
| FinOps | GPU、模型、用户、团队和成功任务成本可归因 |

建议把性能验收写成负载合同：模型版本、量化格式、输入输出长度分布、并发、到达率、缓存条件、SLO 和质量门槛都必须固定。否则供应商或团队之间的 benchmark 数字没有可比性。

## 16. 学习与工程准备清单

### GPU 与数据中心

- NVIDIA Blackwell / Blackwell Ultra 架构；
- 国产 GPU 学习路线见第 6.9 节：PyTorch 后端、推理框架、Runtime、算子开发、TileLang / Triton 和多机生产化；
- HGX B300、GB300 NVL72 参考架构；
- HBM、NVLink、NVSwitch、PCIe、NUMA；
- InfiniBand、RoCE、RDMA、ConnectX、BlueField；
- BMC、固件、机架供电、液冷和 CDU。

### 集群平台

- Linux、NVIDIA Driver、CUDA；
- NVIDIA Container Toolkit、containerd；
- Kubernetes、GPU Operator、Device Plugin；
- NCCL、NCCL Tests、GPU Direct RDMA；
- Helm、Terraform、Ansible、GitOps；
- 节点池、拓扑感知调度、gang scheduling 和故障隔离。

### 推理系统

- Transformer、MoE、Attention、Tokenizer；
- FP8、FP4/NVFP4 和量化质量评估；
- TP、PP、DP、EP；
- KV Cache、PagedAttention、Prefix Cache；
- Prefill、Decode、Continuous Batching；
- vLLM、SGLang、TensorRT-LLM；
- TTFT、TPOT、Goodput、长上下文压测。

### AI Coding 平台

- OpenAI-compatible API、Streaming、Tool Calling；
- Agent Runtime、Session、Task Lifecycle；
- MCP、工具授权、结果回传；
- Repository Context、代码检索和上下文压缩；
- Sandbox、Workspace、网络出口治理；
- Model Router、Token Budget、租户配额；
- Agent Evaluation、回归测试和 Human-in-the-loop。

### 生产运维与安全

- Prometheus、Grafana、DCGM Exporter；
- OpenTelemetry、Trace、Log、Metrics；
- SLO、SLA、Error Budget、Incident Response；
- IAM、OIDC、OPA、Secret Broker；
- 镜像签名、SBOM、模型制品校验；
- 数据分类、日志保留、审计和 FinOps。

## 17. 推荐的官方资料与工程入口

以下资料优先作为团队的学习和设计依据。阅读时应固定文档版本，尤其是 GPU Operator、CUDA、vLLM、SGLang 和 TensorRT-LLM；不要把 latest 文档中的能力直接视为当前生产环境已验证能力。

### NVIDIA 硬件与数据中心

- [NVIDIA HGX AI Factory — Components](https://docs.nvidia.com/enterprise-reference-architectures/hgx-ai-factory/latest/components.html)：HGX B300 节点规格、组件和系统要求。
- [NVIDIA NVL72 AI Factory — Overview](https://docs.nvidia.com/enterprise-reference-architectures/nvl72-ai-factory/latest/overview.html)：GB300 NVL72 机架级参考架构。
- [NVIDIA NVL72 AI Factory — System Hardware & Components](https://docs.nvidia.com/enterprise-reference-architectures/nvl72-ai-factory/latest/components.html)：计算托盘、NVLink Switch、网络和功耗。
- [NVIDIA NVL72 AI Factory — Networking Physical Topologies](https://docs.nvidia.com/enterprise-reference-architectures/nvl72-ai-factory/latest/networking-physical-topologies.html)：计算 Fabric 与 North-South 网络拓扑。
- [NVIDIA GPU Operator](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/)：Kubernetes GPU 软件栈。
- [NVIDIA NCCL Documentation](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/)：多 GPU 通信。
- [NVIDIA DCGM](https://docs.nvidia.com/datacenter/dcgm/latest/)：GPU 健康和遥测。
- [NVIDIA DCGM Exporter](https://docs.nvidia.com/datacenter/cloud-native/gpu-telemetry/latest/dcgm-exporter.html)：Prometheus GPU 指标。

### 国产 GPU / NPU 学习资料

- [昇腾开发者学习中心](https://www.hiascend.com/developer/learn)：包含应用开发、推理开发、训练开发、框架开发和 Ascend C 算子开发课程。
- [CANN 文档中心](https://www.hiascend.com/cann/document)：CANN 架构、Ascend C、CATLASS、PyPTO、Runtime、HCCL、调试与性能分析；阅读时选择与目标芯片匹配的正式版本。
- [Ascend C 编程指南：异构系统与编程模型](https://www.hiascend.com/document/detail/zh/CANNCommunityEdition/920beta2/programug/Ascendcopdevg/asc-devkit/docs/zh/guide/getting_started/quick_start/heterogeneous_system_and_programming_model.md)：理解 Host / Device、SIMD / SIMT 和 Ascend C 学习路径。该链接当前属于 Beta 文档，学习概念可以参考，生产环境需切换正式版本。
- [TileLang Ascend 950 Backend](https://github.com/tile-ai/tilelang/blob/main/tilelang/ascend/README.md)：TileLang 的 Ascend 950 后端、Ascend C / PTO 代码生成、编译和 Profiling。
- [DeepSeek TileKernels](https://github.com/deepseek-ai/TileKernels)：跨 CUDA / Ascend 后端的 TileLang 算子实现。
- [DeepSeek DeepGEMM-Ascend](https://github.com/deepseek-ai/DeepGEMM-Ascend)：昇腾 GEMM 优化实现。
- [DeepSeek DeepEP-Ascend](https://github.com/deepseek-ai/DeepEP-Ascend)：昇腾 MoE 专家并行通信组件。
- [MUSA 编程指南](https://docs.mthreads.com/en/musa-sdk/musa-sdk-doc-online/history_version/v5.1.0/programming_guide/)：按入门、编程模型、语法、API、硬件架构和性能优化的顺序学习。
- [MooreThreads / torch_musa](https://github.com/MooreThreads/torch_musa)：PyTorch 后端、CUDA 迁移、MUSA Extension 和示例。
- [MooreThreads / tutorial_on_musa](https://github.com/MooreThreads/tutorial_on_musa)：MUSA 训练、推理和模型示例。
- [Cambricon / torch_mlu](https://github.com/Cambricon/torch_mlu)：PyTorch MLU 后端和依赖版本说明。
- [Cambricon / mlu-ops](https://github.com/Cambricon/mlu-ops)：BANG C 算子开发、测试和性能调优教程。

### 推理框架

- [vLLM Documentation](https://docs.vllm.ai/)：模型推理、并行、KV Cache 和 Serving。
- [SGLang Documentation](https://docs.sglang.ai/)：结构化生成和高性能 Serving。
- [TensorRT-LLM Documentation](https://nvidia.github.io/TensorRT-LLM/)：NVIDIA 推理优化框架。
- [NVIDIA TensorRT Documentation](https://docs.nvidia.com/deeplearning/tensorrt/latest/)：TensorRT 核心能力与支持矩阵。

### Agent 安全与平台工程

- [NVIDIA OpenShell](https://github.com/NVIDIA/OpenShell)：Agent Sandbox 和治理运行时。
- [NVIDIA Technical Blog: OpenShell Reference Architecture](https://developer.nvidia.com/blog/how-nvidia-openshell-reference-architecture-secures-and-governs-ai-agent-workloads-at-scale/)：2026 年 10 月发布的 Agent 治理参考架构。
- [Kubernetes Documentation](https://kubernetes.io/docs/home/)：容器编排与资源管理。
- [OpenTelemetry Documentation](https://opentelemetry.io/docs/)：分布式追踪、指标和日志。
- [OWASP Top 10 for LLM Applications](https://owasp.org/www-project-top-10-for-large-language-model-applications/)：LLM 应用安全风险参考。
- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework)：AI 风险治理框架。

---

## 18. DeepSeek、Kimi、GLM 的开源项目：哪些与企业 GPU 平台直接相关

本章关注 DeepSeek、Moonshot AI（Kimi）和 Z.ai / 智谱（GLM）公开的代码仓库，而不只是模型权重。它们的开源内容覆盖不同层次：完整或部分推理引擎、CUDA Kernel 和 MoE 通信库、KV Cache 基础设施、Coding Agent Runtime、模型训练和评测。

需要先区分三个概念：

- **模型开源 / Open Weights**：提供模型权重、配置、Tokenizer 和模型说明。它解决“运行哪个模型”，不等于提供生产 Serving 系统。
- **推理组件开源**：提供 Attention Kernel、GEMM、Expert Parallelism、KV Cache 或调度模块。它们解决推理系统的局部性能问题，通常需要集成到 vLLM、SGLang 等运行时。
- **生产服务系统开源**：提供模型执行引擎、请求调度、缓存、路由和故障处理等更完整的能力。即使如此，也要检查公开版本是否包含线上服务所需的全部组件。

### 17.1 DeepSeek：最值得关注的是推理内核、MoE 通信和 DeepInfer

DeepSeek 的开源仓库与 GPU 推理架构关系非常直接。其技术路线不是只发布模型，而是把支撑大规模 MoE 推理的底层能力逐步拆出来。

| 项目 | 所属层次 | 解决的问题 | 与 B300 / GB300 的关系 | 建议关注度 |
| --- | --- | --- | --- | --- |
| [DeepInfer](https://github.com/deepseek-ai/DeepInfer) | 推理执行引擎 | DeepSeek-V4.1-Flash 高性能离线推理，包含模型运行时、调度、并行、采样和结构化输出 | 直接涉及 SM100 GPU、Attention DP、Context Parallel、MoE EP/EPLB、推测解码 | **最高：重点 POC** |
| [DeepEP](https://github.com/deepseek-ai/DeepEP) | MoE 通信库 | Expert Parallelism 的 Token Dispatch / Combine、All-to-All 通信 | 依赖 NVLink 和跨节点 RDMA；与 HGX B300 多节点和 GB300 NVL72 互联拓扑直接相关 | **最高：重点研究** |
| [DeepGEMM](https://github.com/deepseek-ai/DeepGEMM) | GEMM / Tensor Core Kernel | FP8、FP4、BF16 矩阵计算及融合 MoE GEMM | 影响 Blackwell 上 MoE 专家矩阵计算效率 | **最高：持续跟踪** |
| [FlashMLA](https://github.com/deepseek-ai/FlashMLA) | Attention Kernel | Multi-head Latent Attention、稀疏 Attention、FP8/FP4 KV Cache 相关计算 | 对采用 MLA / DeepSeek Sparse Attention 的模型尤其重要；需核对 GPU 架构和 CUDA 版本 | **高：模型相关** |
| [TileKernels](https://github.com/deepseek-ai/TileKernels) | Kernel 集合 | MoE Routing、量化、Engram、RoPE 等优化算子 | 可作为 Blackwell Kernel 优化与 TileLang 开发的参考 | **高：底层工程跟踪** |
| [DeepSelect](https://github.com/deepseek-ai/DeepSelect) | Top-K / Sparse Attention Kernel | DSA 和采样中的 Top-K 选择 | 对稀疏 Attention 的索引和选择路径有价值 | 中高：模型相关 |
| [DeepJIT](https://github.com/deepseek-ai/DeepJIT) | Kernel JIT 编译 | GPU / xPU Kernel 的运行时编译支持 | 是 DeepGEMM、DeepEP 等底层组件的构建和运行路径之一 | 中：理解依赖 |
| [deepseek-recipe](https://github.com/deepseek-ai/deepseek-recipe) | Tokenizer / API 协议适配 | 高性能 Token 编解码及 API 协议行为对齐 | 对 API Gateway 和 Model Adapter 的协议兼容测试有参考价值，不负责 GPU 调度 | 中：接口层参考 |
| [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) | Coding Agent Harness | 插件化 Agent、工具和工作流执行 | 位于 GPU 推理服务上层，可研究 Agent Runtime、插件边界和工具扩展 | 高：Agent 层参考 |
| [3FS](https://github.com/deepseek-ai/3FS) | 分布式文件系统 | 面向 AI 训练和推理的高性能分布式文件存储 | 可研究大模型权重加载、共享数据和高吞吐存储；不一定需要直接采用 | 中：存储架构参考 |
| [DeepSpec](https://github.com/deepseek-ai/DeepSpec) | 推测解码研究与评测 | Speculative Decoding 算法训练和评估 | 对降低 Decode 成本有参考价值，需看是否已被主推理引擎更成熟地集成 | 中：专项研究 |

#### DeepInfer 应该怎样理解

DeepInfer 是这组项目中最值得首先验证的项目，但必须准确理解它的公开边界。它面向 DeepSeek-V4.1-Flash，公开内容包括优化 Kernel、模型和 Sampler Runtime、Attention DP / Balanced CP、MoE EP 与 EPLB、推测解码、异步调度、Batch-invariant Inference 和 Structured Output。

它并不等于下载后就能得到完整的 DeepSeek 在线服务。官方公开说明指出，完整服务还需要 KV Cache 系统、Prefill/Decode 或 Vision Encoder 的分离部署，以及跨 Data Parallel 副本的负载均衡。公开版本没有把这些服务组件全部包含进来。生产部署还需要自行提供 API、身份认证、配额、路由、缓存、监控和多副本故障处理。

这一区别对架构决策很重要：**DeepInfer 可以作为 DeepSeek 模型的专用推理执行路径进行 POC，但不能直接替代企业统一 Serving Control Plane。** 如果企业同时部署 DeepSeek、Kimi 和 GLM，仍然需要一个统一入口和统一运营层。

DeepInfer 的公开依赖和硬件要求也需要进入 POC 兼容性矩阵。当前 README 提到 Linux、Python 3.12、CUDA 13，以及 NVIDIA SM100 GPU；项目也列出 Ascend 950 支持。不能因为它是 DeepSeek 官方项目，就假设任意 CUDA、驱动、推理框架版本和所有 Blackwell SKU 都可以直接运行。需要锁定 commit、CUDA、编译器、PyTorch、NCCL 和 GPU 型号后验证。

#### DeepEP 为什么值得 B300 集群工程师重点学习

DeepEP 不是一个完整推理服务，而是 MoE Expert Parallelism 通信库。MoE 模型在每个 Token 上选择若干 Experts，Token 需要被发送到相应 GPU 上的 Expert，再把结果汇总回来。这个 Dispatch / Combine 过程可能跨 GPU、跨节点，通信效率会直接影响端到端 Decode 和 Prefill 性能。

对 B300 集群来说，应重点验证：

- 单个 HGX B300 节点内 NVLink / NVSwitch 通信；
- 多节点之间通过 InfiniBand 或 RoCE RDMA 进行的通信；
- GPU 与 NIC 的 PCIe / NUMA 亲和关系；
- All-to-All 的小消息延迟和大消息带宽；
- Expert 负载不均衡、热点 Expert 和 EPLB；
- 通信与 GEMM 计算是否能够有效重叠；
- 节点或链路异常时，通信是否超时、恢复或正确失败。

DeepEP 文档列出的环境要求包括 Hopper 或更新 GPU、CUDA 13.1 及以上、NCCL 2.32.3 及以上，以及节点内 NVLink 和节点间 RDMA。它明确说明 InfiniBand 是经过充分测试的网络，RoCE 在理论上兼容，但不能据此认定任意 RoCE Fabric 已经验证。企业若使用 RoCE，必须自行完成端到端压力和故障测试。

#### DeepSeek Harness 与 DeepInfer 是两个不同层次

DeepSeek Harness 是插件化 Coding Agent 项目，关注 Agent 如何组织工具、插件和任务执行；DeepInfer 则关注模型如何在 GPU 上执行。两者可以处于同一企业平台的不同层：

- Harness / Agent Runtime：会话、工具调用、任务编排、工作区和执行过程；
- AI Gateway：模型路由、身份、配额、审计和协议兼容；
- DeepInfer / vLLM / SGLang：模型推理执行；
- DeepEP / DeepGEMM / FlashMLA：更底层的通信和计算 Kernel。

对于企业 AI Coding 平台，DeepSeek Harness 值得作为 Agent Runtime 的架构参考，但不应与 GPU Serving 层混为一谈。若企业已有 Agent Runtime，应重点比较插件生命周期、工具权限、状态持久化、任务恢复和审计能力，而不是为了使用某个模型就替换整个 Agent 平台。

### 17.2 Moonshot AI / Kimi：Mooncake 是最有架构价值的项目

Moonshot 的开源项目覆盖模型、Coding Agent、MoE 通信、Attention Kernel 和 KV Cache 基础设施。其中对 GPU 集群架构最有价值的不是 Kimi Code，而是 Mooncake。

| 项目 | 所属层次 | 解决的问题 | 与 B300 / GB300 的关系 | 建议关注度 |
| --- | --- | --- | --- | --- |
| [Mooncake](https://github.com/kvcache-ai/Mooncake) | KV Cache / Transfer / Serving Infrastructure | KV-centric 架构、Prefill/Decode 分离、分布式 KV Cache 和高速数据传输 | 对长上下文、多轮 Agent、跨节点 KV 复用和 RDMA 传输很有价值 | **最高：重点研究和 POC** |
| [MoonEP](https://github.com/MoonshotAI/MoonEP) | MoE Expert Parallelism | 动态冗余 Experts，改善不同 Rank 的 Token 负载平衡 | 与 DeepEP 属于相邻问题域，可比较负载均衡和通信机制 | 高：MoE 专项比较 |
| [FlashKDA](https://github.com/MoonshotAI/FlashKDA) | Attention Kernel | Kimi Delta Attention 的高性能 Kernel | 只有采用 KDA / 对应 Kimi 模型架构时才直接相关 | 中高：模型相关 |
| [checkpoint-engine](https://github.com/MoonshotAI/checkpoint-engine) | 模型权重热更新 | 在 LLM 推理引擎运行期间更新模型权重 | 适用于模型版本切换、权重更新和减少服务中断的设计研究 | 中高：发布运维方向 |
| [kimi-code](https://github.com/MoonshotAI/kimi-code) | Coding Agent | CLI Agent、代码工作流和开发者交互 | 位于 Agent Runtime 层，不负责 GPU 推理集群管理 | 高：Agent 层参考 |
| [Kimi-K2 / Kimi-K2.5 / Kimi-K3](https://github.com/MoonshotAI) | 模型与模型架构 | MoE、Agentic Coding、长上下文和多模态能力 | 用于模型候选和架构适配测试，不是部署控制平面 | 高：模型选型 |
| [Kimi-Vendor-Verifier](https://github.com/MoonshotAI/Kimi-Vendor-Verifier) | 模型 API 一致性验证 | 检查不同模型服务商的 API 输出是否保持一致 | 对多模型供应商、多推理后端的兼容性回归有参考价值 | 中：验证工具 |

#### Mooncake：把 KV Cache 从 GPU 进程内部资源提升为集群级基础设施

传统推理服务通常由一个模型实例管理自己的 KV Cache。请求进入哪个实例，前缀缓存就主要在该实例内部复用。实例重启、请求被路由到其它节点或模型扩容时，缓存复用会受到限制。

Mooncake 的设计把 KV Cache 作为核心资源来管理：分离 Prefill 与 Decode 集群，并利用 GPU 节点中未充分利用的 CPU、DRAM、SSD 和 NIC 资源，形成分层、分布式的 KV Cache 池。它的主要组件可以按职责理解：

- **Mooncake Transfer Engine**：提供跨节点、跨存储和异构设备的数据传输能力，支持 RDMA、拓扑感知路径选择和多网卡带宽聚合。
- **Mooncake Store**：提供分布式 KV Cache 和模型权重相关存储能力。
- **KV-aware Scheduler / Conductor 思路**：根据缓存复用、请求负载和 SLO 选择 Prefill / Decode 实例。
- **Prefill / Decode Disaggregation**：把输入处理和逐 Token 生成拆到不同资源池，允许独立扩缩容。

对 Coding Agent 来说，Mooncake 的价值尤其明显。多个任务可能共享系统提示、工具定义、代码仓库公共上下文，且一个 Session 会产生多轮模型请求。若路由、缓存键和安全隔离设计合理，跨请求复用 KV 可以减少重复 Prefill；长上下文场景还可以把部分缓存放到 GPU 之外的存储层。

但它不是“装上 Mooncake 就能自动节省成本”。必须测量 KV Cache 的实际命中率、缓存块大小、数据传输成本、SSD/DRAM 带宽、缓存淘汰策略、租户隔离和 SLO。若请求前缀高度动态、上下文复用率低，分布式缓存系统本身的网络和运维成本可能超过收益。

Mooncake 也不是只能配 Kimi 模型。其项目定位是 Serving Infrastructure，并已与 vLLM、SGLang 等生态集成。对企业平台来说，应该把它作为可选 KV Cache / Transfer 层评估，而不是绑定某个模型厂商。

#### MoonEP 与 DeepEP：不要把两个项目视为同一个东西

DeepEP 和 MoonEP 都与 MoE Expert Parallelism 有关，但设计重点并不完全相同。DeepEP 更侧重高性能 EP Dispatch / Combine 通信原语；MoonEP 的项目定位强调通过动态冗余 Experts 改善各 Rank 的 Token 负载平衡。

在实际部署中应比较：通信延迟、带宽、Expert 热点、负载均衡开销、冗余 Expert 的显存成本、与 vLLM / SGLang / DeepInfer 的集成方式，以及跨节点网络要求。不要只比较单个 All-to-All Benchmark。

### 17.3 Z.ai / 智谱 GLM：重点在模型适配和 Agent 能力，不是独立 GPU Serving 栈

GLM 官方仓库主要提供模型权重、模型说明、工具调用和推理部署 Recipes。就目前公开项目而言，GLM 并没有一个与 vLLM、SGLang 或 NVIDIA Dynamo 对等的通用 GPU Serving Control Plane。

| 项目 / 资源 | 所属层次 | 解决的问题 | 与 B300 / GB300 的关系 | 建议关注度 |
| --- | --- | --- | --- | --- |
| [zai-org/GLM-5](https://github.com/zai-org/GLM-5) | 模型、部署 Recipes、Agent Skills | GLM-5 系列权重、模型配置、工具调用和本地部署说明 | 用于验证 vLLM / SGLang 对 GLM 的模型实现、Parser、量化和并行支持 | **最高：模型适配基线** |
| [GLM-5.3-Flash 等模型权重](https://github.com/zai-org/GLM-5) | 模型 | 不同规模和精度的模型变体 | 可用于测试 B300 上 FP8 / 其它支持格式的吞吐与质量 | 高：模型候选 |
| [THUDM/slime](https://github.com/THUDM/slime) | RL 后训练框架 | LLM 强化学习扩展和训练 | 若未来要做自有模型后训练才需要；不是在线推理服务 | 中：后训练方向 |
| [THUDM/AgentRL](https://github.com/THUDM/AgentRL) | Agent RL | 多轮、多任务 Agent 强化学习 | 用于研究 Agent 行为优化和训练，不属于在线 Agent Runtime | 中：研究方向 |
| [THUDM/IndexCache](https://github.com/THUDM/IndexCache) | Sparse Attention 优化研究 | 跨层索引复用，降低稀疏 Attention 的索引开销 | 对 GLM 稀疏 Attention 和长上下文架构有研究价值 | 中：模型架构方向 |
| [THUDM/AgentBench](https://github.com/THUDM/AgentBench) | Agent Benchmark | 评估模型在不同 Agent 环境中的能力 | 可作为模型和 Agent Harness 评测的补充，不是 GPU 压测工具 | 中：评测参考 |
| [THUDM/DeepDive](https://github.com/THUDM/DeepDive) | Deep Search Agent / RL | 多轮搜索 Agent 与知识图谱相关研究 | 与 Coding GPU 平台不是直接依赖，但可参考多轮 Agent 评估和执行 | 低到中：按需研究 |

GLM-5 系列的部署说明值得重点阅读，因为它清楚地展示了模型能力与 Serving Engine 的分工：模型仓库提供权重和参数配置，实际部署推荐使用 vLLM、SGLang 等推理引擎，并配置对应的 Reasoning Parser、Tool Call Parser 和 Speculative Decoding。换言之，GLM 模型是否能在企业平台稳定运行，很大程度上取决于推理引擎的模型适配是否成熟。

对于 Coding Agent，不能只验证 Chat Completions API 返回正常。需要单独测试 GLM 的 thinking 内容处理、reasoning parser、tool-call parser、并行工具调用、JSON 参数格式、长任务中间状态和多轮上下文。尤其要验证 Agent Harness 是否正确处理模型的思考字段与工具调用边界，避免把内部 reasoning 内容错误地当作普通回答或持久化到不合适的日志中。

GLM-5 仓库还提供模型相关的 Agent Skill 和示例，可以用来理解 GLM 的推荐使用方式，但这并不等于提供了完整的企业 Agent Runtime。企业仍需要自行实现 Session 生命周期、工具权限、沙箱、审计、任务恢复和模型路由。

### 17.4 三家项目在架构中的位置

下面的图将三家公司的开源项目映射到企业 GPU AI Coding 平台。它表示逻辑分层，不意味着所有组件都应该同时部署。

```mermaid
flowchart TB
    Dev["Developer / IDE"]
    Agent["Agent Runtime / Harness"]
    Gateway["AI Gateway / Model Router"]
    Serving["Inference Engine"]
    KV["KV Cache / Transfer / Scheduler"]
    EP["MoE Communication"]
    Kernel["Attention / GEMM / Quantization Kernels"]
    GPU["HGX B300 / GB300 NVL72"]

    Dev --> Agent --> Gateway --> Serving
    Serving <--> KV
    Serving <--> EP
    Serving --> Kernel --> GPU

    DSAgent["DeepSeek Harness"]
    KimiAgent["Kimi Code"]
    GLMSkill["GLM Skills / Examples"]
    DSInfer["DeepInfer"]
    Mooncake["Mooncake"]
    DeepEP["DeepEP"]
    MoonEP["MoonEP"]
    DSKernel["DeepGEMM / FlashMLA / TileKernels"]
    KKernel["FlashKDA"]

    DSAgent -. "Agent 层参考" .-> Agent
    KimiAgent -. "Agent 层参考" .-> Agent
    GLMSkill -. "模型使用参考" .-> Agent
    DSInfer -. "模型专用执行引擎" .-> Serving
    Mooncake -. "KV / Transfer" .-> KV
    DeepEP -. "EP 通信" .-> EP
    MoonEP -. "EP 负载均衡" .-> EP
    DSKernel -. "计算 Kernel" .-> Kernel
    KKernel -. "Kimi 架构 Kernel" .-> Kernel
```

### 17.5 面向企业 B300 项目的优先级建议

| 优先级 | 项目 | 建议动作 | 原因 |
| --- | --- | --- | --- |
| P0 | DeepSeek DeepInfer | 使用目标 DeepSeek 模型做独立 POC；确认它与统一 Serving 层的集成边界 | 官方推理执行路径，可能带来模型专用性能收益，但公开版不是完整在线服务 |
| P0 | DeepEP | 在单节点 NVLink 和跨节点 RDMA 环境分别测试 | MoE 模型的通信效率可能成为 B300 集群的核心瓶颈 |
| P0 | Mooncake | 先验证 KV Cache 命中、Store 和 Transfer Engine，再考虑 Prefill/Decode 分离 | Coding Agent 多轮请求和共享前缀有潜在收益 |
| P0 | vLLM / SGLang | 作为 DeepSeek、Kimi、GLM 的统一基线引擎 | 跨模型兼容性和生态成熟度比单一厂商专用引擎更重要 |
| P1 | DeepGEMM / FlashMLA / TileKernels | 跟踪其在目标模型和 Blackwell 上的上游集成及性能差异 | 决定 FP8/FP4、Attention 和 MoE Kernel 的性能上限 |
| P1 | MoonEP | 与 DeepEP 在相同 MoE Trace 下比较 | 关注动态 Expert 负载平衡是否能提高集群有效吞吐 |
| P1 | DeepSeek Harness / Kimi Code | 评估 Agent Runtime 的插件、工具和任务管理设计 | 对上层 Coding Agent 平台有参考价值，但不应替代 GPU Serving |
| P1 | GLM-5 部署 Recipes | 建立模型适配自动化和 Tool/Reasoning Parser 回归测试 | 多模型平台必须保证模型协议行为一致 |
| P2 | checkpoint-engine | 在多副本模型更新和无中断发布有明确需求时做验证 | 解决模型权重更新问题，不是首期必需组件 |
| P2 | 3FS | 只有模型加载或共享存储成为瓶颈时才做专项评估 | 企业已有高性能存储时不一定值得替换 |
| P2 | slime / AgentRL / DeepSpec | 只有开展后训练、Agent RL 或推测解码研发时再投入 | 不属于首期在线推理平台的必要依赖 |

建议把三家项目分为两条技术路线：一条是**模型专用优化**，例如 DeepInfer、DeepEP、FlashMLA；另一条是**通用平台基础设施**，例如 Mooncake、vLLM、SGLang 和统一 Gateway。模型专用优化应通过适配层引入，不能让企业平台的控制面被单一模型厂商的实现锁定。

## 19. 其它值得关注的 GPU 大模型部署与推理开源项目

DeepSeek、Kimi 和 GLM 的项目能反映模型厂商自身的技术路线，但企业平台不能只依赖模型厂商的仓库。真正的生产部署生态由多个社区共同构成：推理引擎、分布式 Serving、KV Cache、GPU Kernel、量化、Kubernetes 管理、监控和 Benchmark 各有专门项目。

本节按工程职责分类。项目被列入并不代表应该全部引入；优先选择少数成熟组件，避免出现多个 Gateway、多个 Scheduler 和多套 KV Cache 管理系统互相争抢职责。

### 18.1 核心推理引擎：先比较这三个

| 项目 | 定位 | 主要能力 | 对 B300 的评估建议 |
| --- | --- | --- | --- |
| [vLLM](https://github.com/vllm-project/vllm) | 通用 LLM Serving Engine | PagedAttention、Continuous Batching、Prefix Caching、OpenAI API、TP/PP/EP 和多种 KV Connector | **首选基线**。模型覆盖广、生态和集成多，优先验证目标模型的 Blackwell Kernel、量化和多节点 EP |
| [SGLang](https://github.com/sgl-project/sglang) | 高性能 Serving Runtime | RadixAttention、结构化生成、Prefix Cache、Speculative Decoding、MoE 和多种分布式 Serving 路径 | **必须并行评估**。特别关注 GLM、Kimi、DeepSeek 的模型适配、Blackwell 镜像和 Agent 多轮缓存 |
| [TensorRT-LLM](https://github.com/NVIDIA/TensorRT-LLM) | NVIDIA 优化推理框架 | TensorRT 优化、量化、专用 Kernel、分布式推理和 Serving | **NVIDIA 环境重点候选**。适合验证 NVFP4、Blackwell 专项优化；要考虑 Engine Build、版本矩阵和模型支持成本 |

三者不是简单的“谁的 tokens/s 更高”。对企业 Coding Agent，建议用相同模型权重、量化格式、上下文长度、请求 Trace 和 Agent Harness，分别测量 TTFT、TPOT、Goodput、KV Cache 命中率、工具调用正确率和每个成功任务成本。

首期不要把三种引擎全部作为长期生产系统运营。建议 vLLM 作为兼容性基线，SGLang 作为性能和 Agent 工作负载候选；如果 TensorRT-LLM 在目标 B300 配置上带来足够明确的收益，再决定是否承担其专用构建和维护流程。

### 18.2 分布式 Serving 与控制平面：把单机引擎变成集群服务

| 项目 | 定位 | 主要职责 | 适合解决的问题 |
| --- | --- | --- | --- |
| [NVIDIA Dynamo](https://github.com/ai-dynamo/dynamo) | 分布式推理框架 / 控制层 | Frontend、KV-aware Router、SLO Planner、KV 管理、NIXL、Prefill/Decode 分离和 Grove | 多节点、多 GPU Pool、Prefill/Decode 独立扩缩容、KV-aware 路由 |
| [llm-d](https://github.com/llm-d/llm-d) | Kubernetes-native 推理平台 | 在 Kubernetes 上编排 vLLM、SGLang 等 Model Server，提供 Inference Scheduler、Endpoint Picker、Prefix Cache 感知路由和运维路径 | 已有 Kubernetes 平台，希望用云原生方式部署和运营推理服务 |
| [AIBrix](https://github.com/vllm-project/aibrix) | Kubernetes LLM Control Plane | Gateway、模型路由、推理指标驱动 Autoscaling、LoRA 生命周期、KV Cache 和多引擎管理 | 多模型、多副本、多租户和成本优化 |
| [Ray](https://github.com/ray-project/ray) / [KubeRay](https://github.com/ray-project/kuberay) | 分布式计算与编排 | 分布式任务、Actor、Serve 和集群管理 | 需要自定义分布式执行或特定推理框架依赖 Ray 时 |
| [KServe](https://github.com/kserve/kserve) | Kubernetes Model Serving | 模型服务 CRD、部署、扩缩容和标准化 Serving 接口 | 企业已有 KServe 生态或同时部署传统 ML / 多模态模型时 |

#### Dynamo、llm-d 和 AIBrix 如何选择

这三个项目都在解决推理服务的集群化问题，但抽象边界和生态重点不同。

- **Dynamo** 更偏向分布式推理运行时和数据路径，强调 KV-aware Routing、Prefill/Decode Disaggregation、NIXL 数据传输、SLO Planner，以及与 vLLM、SGLang、TensorRT-LLM 的组合。
- **llm-d** 更偏向 Kubernetes-native 的推理编排和生产运营，把模型 Server 与 Router / Scheduler 分开，提供 Well-Lit Paths、InferencePool、Endpoint Picker、Prefix Cache 感知调度和生产运维能力。
- **AIBrix** 更偏向 LLM 应用基础设施和控制面，关注 Gateway、模型与 LoRA 生命周期、推理指标驱动扩缩容、KV Cache 和多模型运营。

不建议把三者全部部署后再决定谁负责路由。它们在 Gateway、Scheduler、Autoscaler、KV-aware Routing 等领域存在重叠。POC 时应画出实际组件边界，明确每个能力只有一个 Owner。例如：由 Dynamo 负责 P/D 和 KV 传输，外层 Gateway 负责企业身份与配额；或者由 llm-d 负责 Kubernetes InferencePool 和调度，底层引擎使用 vLLM。不要让两个控制平面同时管理同一批 Pod 和同一组流量策略。

### 18.3 KV Cache、数据传输和 Prefill / Decode 分离

| 项目 | 定位 | 核心能力 | 评估重点 |
| --- | --- | --- | --- |
| [Mooncake](https://github.com/kvcache-ai/Mooncake) | KV Cache Store / Transfer Engine | 分布式 KV Cache、RDMA Transfer、Prefill/Decode 分离 | 长上下文、多轮 Agent、跨实例前缀复用 |
| [LMCache](https://github.com/LMCache/LMCache) | KV Cache 管理与 Offload | GPU、CPU、磁盘等层级的 KV 缓存和复用 | 与 vLLM / SGLang 的连接器、缓存命中和 Offload 成本 |
| [NIXL](https://github.com/ai-dynamo/nixl) | NVIDIA 低延迟数据传输库 | KV Cache 等数据在 GPU、主机和存储之间的传输 | GPU Direct RDMA、NVLink、InfiniBand / UCX 和拓扑适配 |
| [UCX](https://github.com/openucx/ucx) | HPC 通信框架 | 高性能网络通信抽象 | RDMA / InfiniBand / RoCE 底层传输和网络诊断 |
| [NCCL](https://github.com/NVIDIA/nccl) | GPU Collective Communication | AllReduce、AllGather、ReduceScatter 等集合通信 | Tensor / Expert Parallelism 的核心依赖，不是通用 KV Store |
| [3FS](https://github.com/deepseek-ai/3FS) | 分布式文件系统 | 高性能共享文件和数据访问 | 模型权重加载、数据集和大规模缓存存储 |

这里要区分 **Collective Communication** 和 **Point-to-Point KV Transfer**。NCCL 主要解决 GPU 集合通信；NIXL、Mooncake Transfer Engine 关注数据在生产者和消费者之间的传输；Mooncake Store、LMCache 关注 KV Cache 的存储、复用和分层管理。它们可以协作，但不能简单互相替代。

对于 1000 人 Coding Agent 平台，KV Cache 项目值得重点研究，但部署顺序应是：

1. 先验证引擎内部 Prefix Cache；
2. 采集真实 Agent Session 的前缀复用率和上下文分布；
3. 再测试 CPU / DRAM / SSD Offload；
4. 当单实例缓存局部性明显限制容量时，才测试跨节点共享 KV；
5. 最后再决定是否分离 Prefill 和 Decode。

如果直接从第一天就部署跨节点 KV Cache 和 P/D 分离，复杂度会明显增加，而且可能尚未有足够流量证明收益。

### 18.4 GPU Kernel 与算子库：决定性能上限

| 项目 | 主要职责 | 与 B300 的关系 | 建议 |
| --- | --- | --- | --- |
| [FlashInfer](https://github.com/flashinfer-ai/flashinfer) | Attention、KV Cache、GEMM、MoE、Sampling Kernel | 支持 Paged/Ragged KV、MLA、FP8/FP4、Blackwell GEMM 等 | **重点关注**，检查目标引擎是否已集成，避免重复手工替换 |
| [FlashAttention](https://github.com/Dao-AILab/flash-attention) | 高效 Attention Kernel | 是多个推理框架常用的 Attention 实现基础之一 | 关注具体版本、GPU 架构和模型 Attention 类型 |
| [CUTLASS](https://github.com/NVIDIA/cutlass) | CUDA C++ Kernel 模板库 | Blackwell Tensor Core 和矩阵计算优化的重要基础 | Kernel 工程师重点学习 |
| [Triton](https://github.com/triton-lang/triton) | GPU Kernel 编程语言 / 编译器 | 用于快速开发和优化 GPU Kernel；注意它不是 Triton Inference Server | 对自定义算子和性能调优很有价值 |
| [TileLang](https://github.com/tile-ai/tilelang) | Tile-based Kernel DSL | DeepSeek TileKernels 等项目使用的 Kernel 开发方向 | 适合研究高性能算子和多后端 Kernel |
| [DeepGEMM](https://github.com/deepseek-ai/DeepGEMM) | FP8 / FP4 GEMM 和 MoE Kernel | DeepSeek 模型和 Blackwell 低精度矩阵计算相关 | 对 MoE / FP8 / FP4 workload 重点评估 |
| [DeepEP](https://github.com/deepseek-ai/DeepEP) | MoE 通信 Kernel | Expert Parallelism 的 Dispatch / Combine | 与 GPU 网络和 NCCL 测试一起评估 |
| [AITER](https://github.com/ROCm/aiter) | AMD GPU 优化算子 | AMD MI 系列平台的算子路径 | 只有考虑 AMD GPU 时重点投入 |

大多数企业平台团队不应该自己维护一套 Attention Kernel。优先使用 vLLM / SGLang / TensorRT-LLM 已验证的 Kernel 组合，只有 Profiling 证明某个算子是瓶颈，且上游没有合适实现时，才开发自定义 Kernel。

### 18.5 量化与模型压缩

| 项目 | 主要职责 | 适用场景 | 注意事项 |
| --- | --- | --- | --- |
| [NVIDIA Model Optimizer](https://github.com/NVIDIA/Model-Optimizer) | NVIDIA 模型量化和优化工具 | FP8、NVFP4 等 NVIDIA GPU 优化路径 | 重点验证 Blackwell 格式、校准和推理引擎集成 |
| [llm-compressor](https://github.com/vllm-project/llm-compressor) | LLM 量化与压缩 | 为 vLLM 等推理后端准备量化模型 | 检查模型结构、量化算法、权重格式和运行时支持 |
| [bitsandbytes](https://github.com/bitsandbytes-foundation/bitsandbytes) | 低比特量化和优化器组件 | 低成本实验、特定模型量化 | 不要假定其量化路径等同于 Blackwell 原生 NVFP4 |
| [AutoGPTQ](https://github.com/AutoGPTQ/AutoGPTQ) | GPTQ 量化 | 既有 GPTQ 模型和兼容生态 | 需要确认维护状态、模型支持和目标 GPU Kernel；不建议未经验证作为新平台默认方案 |

量化工具与推理引擎必须配套选择。量化产物的格式、Group Size、Scale、Activation Quantization、KV Cache 精度和 Kernel 支持都可能不同。一个模型可以被量化，不代表目标 Serving Engine 能以高性能加载它。

对 B300 的建议是先用模型官方 FP8 权重建立基线，再测试 NVIDIA 原生 FP4 / NVFP4 或模型官方支持的低精度方案。比较时要同时看模型质量、工具调用正确率、长上下文退化、吞吐和成本，不能只看显存缩小比例。

### 18.6 Kubernetes GPU 管理、可观测性与性能测试

| 项目 | 主要职责 | 建议关注点 |
| --- | --- | --- |
| [NVIDIA GPU Operator](https://github.com/NVIDIA/gpu-operator) | 在 Kubernetes 部署 Driver、Device Plugin、Container Toolkit、DCGM 等组件 | GPU 节点标准化、升级、驱动管理和健康状态 |
| [NVIDIA DCGM](https://github.com/NVIDIA/DCGM) | GPU 健康、性能和遥测 | XID、ECC、温度、功耗、HBM、NVLink 和 GPU Health |
| [Prometheus](https://github.com/prometheus/prometheus) / [Grafana](https://github.com/grafana/grafana) | 指标采集与可视化 | GPU、推理引擎、Router 和 Agent 的统一 Dashboard |
| [OpenTelemetry](https://github.com/open-telemetry/opentelemetry-collector) | Trace / Metric / Log 采集 | 关联 Agent Task、模型请求、KV Cache 和 GPU Worker |
| [NVIDIA AIPerf](https://github.com/NVIDIA/aiperf) | 生成式 AI Serving 性能测试 | TTFT、ITL、吞吐和并发测试；注意固定模型和请求分布 |
| [vLLM Benchmarks](https://github.com/vllm-project/vllm/tree/main/benchmarks) | vLLM Serving Benchmark | 适合推理引擎基准测试和回归 |
| [GuideLLM](https://github.com/vllm-project/guidellm) | LLM Serving 负载生成和性能分析 | 通过真实或合成请求分布测试服务能力 |
| [GenAI-Perf](https://github.com/triton-inference-server/perf_analyzer) | 生成式 AI 推理性能分析工具 | 适合兼容相关接口的 Serving Benchmark，注意与 AIPerf 的工具定位重叠 |

性能工具也要分层：NCCL Tests 测通信，DCGM 测硬件状态，AIPerf / GuideLLM / vLLM Bench 测 Serving，Agent Evaluation 测代码任务成功率。没有一个工具可以替代完整的端到端压测。

### 18.7 Triton Inference Server 与 Triton 语言不要混淆

NVIDIA 生态里有两个容易混淆的项目：

- [Triton Inference Server](https://github.com/triton-inference-server/server)：模型 Serving Server，支持多种模型后端和协议，适合传统 ML、视觉、Embedding、Reranker 及多模型组合服务。
- [Triton Language](https://github.com/triton-lang/triton)：GPU Kernel 编程语言和编译器，用来编写 GPU 算子。

在当前以自回归 LLM 为主的 Coding Agent 平台中，vLLM、SGLang、TensorRT-LLM 更适合作为核心 LLM Runtime；Triton Inference Server 可以承担非自回归模型或多模型组合 Serving，Triton Language 则属于 Kernel 开发工具。不要把它们当成同一层的替代品。

### 18.8 推荐的企业技术组合

对一个以 B300 / HGX B300 为主、约 1000 名开发者使用的企业平台，建议按阶段组合，而不是一次性引入全部开源项目。

| 架构层 | 首选候选 | 第二候选 / 专项组件 | 首期是否必须 |
| --- | --- | --- | --- |
| GPU Node Runtime | NVIDIA Driver + CUDA + Container Toolkit | OFED / RDMA Core、Fabric Manager | 是 |
| Kubernetes GPU | NVIDIA GPU Operator | KubeRay（确有 Ray 负载时） | 已有 K8s 时建议 |
| GPU Communication | NCCL + NCCL Tests | DeepEP、MoonEP、NIXL | NCCL 必须；EP / NIXL 按模型架构决定 |
| Model Serving | vLLM | SGLang；TensorRT-LLM | 是，至少选一个 |
| Model-specific Runtime | DeepInfer（仅目标 DeepSeek 模型） | 其它模型专用实现 | 否 |
| Distributed Serving | llm-d 或 NVIDIA Dynamo 或 AIBrix | 根据现有 K8s 和推理架构选择 | 初期可以不引入 |
| KV Cache | 引擎内置 Prefix Cache | LMCache / Mooncake | 内置缓存先行，外部缓存按数据验证 |
| Kernel | 推理引擎内置 Kernel | FlashInfer、DeepGEMM、FlashMLA、CUTLASS | 不需要全部直接管理 |
| Quantization | 模型官方 FP8 + Model Optimizer / llm-compressor | FP4 / NVFP4 专项路径 | FP8 基线必须，低精度按质量验证 |
| Metrics / Logs / Trace | DCGM + Prometheus + Grafana + OpenTelemetry | Loki / ClickHouse 等 | 是 |
| Serving Benchmark | AIPerf / GuideLLM / vLLM Bench | 自建 Trace Replay | 是 |
| Agent Evaluation | 企业内部 Coding Task Set | AgentBench 等公开评测 | 是，必须有内部任务集 |

#### 推荐的初期架构

```mermaid
flowchart TB
    subgraph Control["企业控制与管理层（CPU Nodes）"]
      Auth["SSO / IAM / Policy"]
      Gateway["AI Gateway / Model Router"]
      Orchestrator["llm-d / Dynamo / 自建控制层（择一）"]
      Observability["Prometheus / Grafana / OpenTelemetry"]
    end

    subgraph Compute["GPU 推理层（HGX B300）"]
      EngineA["vLLM Pool"]
      EngineB["SGLang Pool"]
      Specialized["DeepInfer Pool（可选）"]
      Kernels["CUDA / NCCL / DeepEP / Kernel Libraries"]
      EngineA --> Kernels
      EngineB --> Kernels
      Specialized --> Kernels
    end

    subgraph Cache["可选 KV Cache 层"]
      Local["Engine Prefix Cache"]
      Shared["Mooncake / LMCache（按需）"]
      Local --> Shared
    end

    Agent["Coding Agent Runtime / Sandbox"] --> Gateway
    Auth -.-> Gateway
    Gateway --> Orchestrator
    Orchestrator --> EngineA
    Orchestrator --> EngineB
    Orchestrator --> Specialized
    EngineA <--> Cache
    EngineB <--> Cache
    Specialized <--> Cache
    Compute --> Observability
    Control --> Observability
```

图中的 llm-d、Dynamo 和 AIBrix 是可选控制层，不是要求同时部署。初期若只有一个模型、一个引擎和少量副本，可以先用简单 Gateway + Kubernetes Service；等到多模型、多副本、KV-aware Routing 和独立 P/D Pool 成为真实需求，再引入更完整的控制平面。

### 18.9 最终选型原则

对于 B300 企业推理平台，最重要的不是开源项目数量，而是清楚划分职责并保持可替换性：

1. **模型与 Serving Engine 解耦**：模型仓库提供权重和模型配置，推理引擎负责运行，Gateway 负责模型路由和企业策略。
2. **推理引擎与控制平面解耦**：vLLM / SGLang / TensorRT-LLM 负责执行，Dynamo / llm-d / AIBrix 负责集群层调度和运营。
3. **计算通信与 KV 数据传输分开**：NCCL / DeepEP 处理集合通信和 MoE 通信，NIXL / Mooncake Transfer Engine 处理 KV 等数据移动。
4. **内存缓存先于分布式缓存**：先把引擎内 Prefix Cache 用好，再根据真实命中率引入 LMCache 或 Mooncake。
5. **Kernel 采用上游集成优先**：先使用推理引擎已经验证的 Kernel，只有 Profiling 找到瓶颈才替换或自研。
6. **性能基准与业务评测并行**：AIPerf / GuideLLM 测服务吞吐，内部 Coding Task Set 测代码任务成功率和单位成功任务成本。
7. **控制平面只保留一个主 Owner**：避免 Dynamo、llm-d、AIBrix 和自建 Gateway 对路由、扩缩容和模型生命周期产生重叠控制。

对于当前项目，建议先深入阅读和 POC 的项目顺序是：**vLLM、SGLang、DeepEP、DeepInfer、Mooncake、NVIDIA Dynamo / llm-d（二选一先做架构比较）、FlashInfer、NVIDIA GPU Operator、DCGM、AIPerf**。这组项目覆盖从 GPU 节点到模型 Serving、分布式推理、缓存、观测和压测的主要技术链路。其余项目根据模型架构和实际瓶颈逐步引入，而不是预先全部部署。



## 20. 业界真实案例：企业为什么自部署 GPU 推理，以及生产环境究竟怎么做

本章从企业实践而不是开源组件出发，回答几个架构决策问题：为什么不直接调用闭源模型 API？租 AWS、Google Cloud、IBM Cloud 或专业 GPU Cloud 的 GPU，算不算自部署？谁在使用这些平台？生产系统如何组织 GPU、Kubernetes、推理引擎、缓存和调度？实际踩过哪些坑？

案例按控制边界分为三类：企业自有或自控推理平台；租 CSP / GPU Cloud 资源但自行运营推理服务；把推理基础设施交给专业平台运营商。第三类不是严格意义上的企业自部署，但对判断自建平台是否值得非常重要。厂商公开的性能和成本数字均保留其原始口径，不视为独立审计结果；公开资料没有披露的架构细节不会自行补齐。

### 19.1 自部署的定义：GPU 归谁所有不是关键

自部署（self-hosted / self-managed inference）的关键不是 GPU 的产权，而是企业是否控制模型服务的数据面和运行边界。

| 模式 | GPU 资产归属 | 谁运营推理引擎与调度 | 数据和模型控制 | 是否属于企业自部署 |
| --- | --- | --- | --- | --- |
| 企业自购 GPU、机房自建 | 企业 | 企业 | 企业 | 是，典型 On-Prem |
| 企业租用 AWS EC2 GPU，在自己的 VPC / EKS 运行 vLLM | CSP | 企业 | 企业控制主要服务边界 | 是，Cloud Self-Hosted |
| 企业租用 CoreWeave / Lambda / Nebius 专属 GPU 集群，自行部署 K8s 和推理栈 | GPU Cloud | 企业或双方分工 | 取决于租户隔离、网络、运维权限和合同 | 可以是，需核实责任边界 |
| 企业租 Dedicated Endpoint，自己控制模型配置、容量和流量，但不管理节点和推理引擎 | CSP / GPU Cloud | 服务商 | 企业有一定模型和端点控制权 | 不是严格自部署，是 Dedicated Managed Inference |
| Together AI / Fireworks / Bedrock / Vertex 等托管模型 API | 服务商 | 服务商 | 主要由 API 合同、区域和保留策略约束 | 否，Managed API |

企业在自己的 AWS Account 中创建 EKS、P4d/P5 GPU 节点、FSx for Lustre、VPC、IAM 和 ALB，把模型权重放进自己的存储，由自己运营 vLLM，即使没有购买 A100，也属于 Cloud Self-Hosted。反过来，服务商使用开源权重并不代表客户自部署；如果服务商管理节点、驱动、推理引擎和调度，客户只是调用 API，那么仍然是托管推理。

### 19.2 IBM Research + Red Hat：544 张 H100 服务数千个 Coding Agent

这是与本文目标最直接相关的公开案例之一。IBM Research 在 2026 年 9 月发布基于 llm-d 的部署报告：IBM Research、Red Hat 团队使用 544 张 NVIDIA H100 部署 GLM-5.2（约 753B 总参数、约 39B 激活参数的 MoE 模型），面向内部关键业务负载，并用 Agentic Benchmark 验证数千个并发 Coding Agent 的服务能力。IBM 报告称，峰值输出吞吐超过每分钟 660 万 Token，测试中最高支持 3,000 个并发 Coding Agent 且没有发生请求抢占。按其采用的当期云 GPU 租赁价格估算，单位 Token 成本约为商业闭源 API 的 1/5 到 1/10。这个 5–10 倍是 IBM 对特定模型、流量、租赁价格和 API 对比口径的测算，不是任何企业都能复制的固定成本优势。

该案例最重要的不是 544 张卡，而是它对 Agentic Workload 的分析。团队基于 219 个真实 Claude Code Session 的数据，观察到典型请求的输入远大于输出：中位数约 195K 输入 Token，而输出约 317 Token；96% 的主 Agent 请求至少复用了前一个请求 90% 的输入内容。子 Agent 还会在没有预告的情况下并发启动，形成瞬时流量尖峰。这意味着 Coding Agent 的推理负载与普通聊天机器人不同：主要成本可能是重复读取上下文，而不是生成回答。

系统组合包括：llm-d 做 Kubernetes-native 分布式推理编排；GLM-5.2 MoE 采用 Wide Expert Parallelism + Data Parallel Attention；Prefill 与 Decode 拆分为独立资源池；NIXL 在两组之间传输 KV Cache；Prefix-aware Routing 把请求路由到已经持有相关前缀缓存的 Worker；GPU KV Cache、CPU DRAM 分层缓存和 Peer-to-Peer KV Cache Sharing；Multi-Token Prediction 提升高并发 Decode 吞吐。

公开的测试数据很有价值：精确 Prefix Matching 相比近似路由，在 CyberGym 测试中带来 79% 更高吞吐和 67% 更低 TTFT；完整系统把输入 Token 中约 85.2% 从缓存提供，未命中后需要重新 Prefill 的部分降到 14.8%。NIXL 在测试期间完成约 620 万次 KV Cache Transfer，平均每次约 2.71 GiB，Fleet P90 吞吐约 580 Gb/s，未观察到传输失败。

**给谁用：** 大规模内部 Coding Agent、长上下文多轮 Agent 平台、已经拥有 H100 GPU Fleet 并希望提高其价值的组织。

**关键经验：** 不能用普通 Chat Completion 的 QPS / Tokens per Second 模型估算 Coding Agent。要从 Agent Trace 得到输入长度、上下文重复率、子 Agent 并发、Prefill / Decode 比例和缓存命中率。对这类负载，路由是否命中 Prefix Cache、KV Cache 是否能跨 Worker 复用，可能比单 GPU 理论峰值算力更重要。

**不要照搬：** 544 张 H100 是特定模型和负载的规模，不是 1000 名开发者的参考采购量。3000 并发是报告中的 benchmark / 内部负载结果，也不能直接等同于 3000 名同时活跃开发人员。必须用自己的 Agent Harness 和 Trace 重测。

来源：[IBM Research：How llm-d makes the most of the hardware you already have（2026-09-08）](https://research.ibm.com/blog/running-open-models-on-h100-gpus-with-llmd)；[llm-d](https://llm-d.ai/)。

### 19.3 Shopify：把高 Token 消耗的子任务交给自托管 Specialist Model

Shopify 在 2026 年 10 月公开了 Sidekick 的 Task Expert 实践。它不是把一个开源模型直接替换所有闭源模型，而是采用分层 Agent 架构：Frontier Model 负责与商家交互、规划和决定调用什么工具；上下文很重、任务边界清晰的子任务交给 Shopify 自己 Post-train 并托管的开源模型。

一个具体例子是 GraphQL Subagent。商家询问哪些商品库存不足时，子 Agent 要读取 Shopify API Schema、搜索文档、编写并执行 GraphQL Query，再返回结果。该任务的输入 Token 约为输出 Token 的 40 倍。若一直使用按 Token 计费的 Frontier API，重复读取 Schema 和文档会造成较高成本。

Shopify 基于 NVIDIA Nemotron 3.5 Lightning 做任务后训练。该 MoE 模型总参数约 30B，每 Token 激活约 3B。Shopify 报告称，经过六轮持续改进和约 61,000 条修复样本后，模型在其 GraphQL 任务 Judge 上达到 74.5 分，高于 Frontier Model 的 73 分；生产流量回放中，中位数完整响应时间为 0.87 秒，而 Frontier API 为 6.50 秒；最慢 1% 请求也快约 8 倍。该 Specialist Model 的服务成本比 Frontier Model 低约 90%。Shopify 还表示，跨其 Post-trained Models，自托管服务成本比 Frontier API 低约 90%–98%。

值得借鉴的是它的工程流程，而不只是模型：先定义业务任务质量 Rubric；先把 Frontier Agent 做到足够好，形成质量基线；选择开源模型，在真实 Subagent、真实工具和同一个 Judge 中评估；从一开始就用 AIPerf 回放生产 Trace，输入内容使用合成文本，避免在性能测试中暴露客户数据；对 Batch Workload 比较 vLLM、SGLang 和 TensorRT-LLM；每晚把生产失败案例转化为训练数据，通过 Judge、Critic 和模拟商家回放持续修复模型。

Shopify 还披露，使用 NVIDIA Megatron Bridge 在 Nebius 上进行跨节点后训练；同一个 FP8 后训练任务中，8 张 B300 相比 8 张 H200 快 1.86 倍，GPU-hours 减少 46%。这是训练效率对比，不应误读成推理吞吐提升。

**给谁用：** 大型 SaaS、企业内部 Agent、具有稳定且重复的业务子任务、输入上下文显著大于输出的工作负载。

**关键经验：** 自部署收益不一定来自把主模型全部换成开源模型。更稳妥的做法是把任务拆开：复杂规划继续使用 Frontier Model；Schema 查询、分类、抽取、固定工具调用等可评测子任务交给 Specialist Model。通过任务级评测、后训练和生产数据闭环，降低成本并减少单一供应商依赖。

**不要照搬：** Shopify 有明确业务任务、生产数据和专门评测体系。没有可靠 Ground Truth、Judge 校准和失败样本治理时，单纯 Fine-tune 不会自动得到同样收益。

来源：[Shopify Engineering：How Shopify turns open models into task experts（2026-10-21）](https://shopify.engineering/open-model-task-experts)。

### 19.4 Perplexity：租 AWS A100 / H100，自己运营推理 API

Perplexity 的 pplx-api 是“租用 CSP GPU 仍然属于自部署”的典型案例。NVIDIA 客户案例披露，Perplexity 最初将 pplx-api 部署在 AWS EC2 P4d 实例上，每台 P4d 配备 8 张 A100 GPU；推理服务使用 TensorRT-LLM，并通过 AWS 与 Kubernetes 的集成扩展到数百张 GPU。模型服务面向外部开发者，支持多个开源模型。

NVIDIA 案例给出的结果包括：相对其他部署平台，pplx-api 延迟最高可降低约 3.1 倍、首 Token 延迟最高可降低约 4.3 倍；切换外部推理 API 调用到 pplx-api 后，报告成本降低约 4 倍、每年节省约 60 万美元。后续在 AWS P5 H100 + FP8 配置下，相同配置比较 A100，延迟减半、吞吐提升约 200%。这些是 Perplexity / NVIDIA 公布的特定比较结果，不代表 H100 对任何模型都能得到相同提升。

架构特点：GPU 资源租自 AWS EC2，不需要自己建设机房；模型服务和 API 产品由 Perplexity 自己运营；TensorRT-LLM 用于推理优化；Kubernetes 负责大规模部署和弹性扩展；通过小型 Classifier Model 把不同请求路由到不同 GPU Pod / 模型。

**给谁用：** 对外提供模型 API 的 AI 产品公司、需要高并发和稳定 SLA 的 SaaS、希望控制模型和推理优化而不愿自己建数据中心的团队。

**关键经验：** 企业自部署的合理起点可以是租 CSP GPU，而不是先采购硬件。用租赁资源验证模型、服务架构、流量和单位成本，证明稳定需求后再决定长期 Reserved Capacity、Dedicated Cluster 或自购。

来源：[NVIDIA Customer Story：Perplexity](https://www.nvidia.com/en-us/case-studies/perplexity/)；[NVIDIA：Fast, Low-Cost Inference Offers Key to Profitable AI](https://blogs.nvidia.com/blog/ai-inference-platform/)。

### 19.5 Netflix：把 LLM Serving 接入已有模型平台，而不是另建孤岛

Netflix 在 2026 年公开了内部 Model Scoring Service（MSS）承载 LLM 的实践。它没有把 LLM Serving 当成完全独立的新平台，而是把模型推理集成到已有 JVM Serving Layer 和 MSS 中。

已有 JVM Serving Layer 继续负责路由、Feature Retrieval、Candidate Generation、Post-processing 和 Logging。较小模型可以在 CPU 进程内运行；较大的 GPU 推理请求委托给 MSS。MSS 由 NVIDIA Triton 管理模型加载、Batching、GPU 调度和多框架 Serving，vLLM 负责实际 LLM Inference。系统同时提供内部 gRPC、KServe HTTP / gRPC 以及 OpenAI-compatible HTTP 接口。

Netflix 公开的生产问题尤其有价值。Triton 的 vLLM Backend 与特定 vLLM API Surface 编译绑定，版本不匹配可能导致 Backend 完全无法加载，因此团队在构建服务镜像时固定兼容版本，并禁止模型作者在 Packaging 阶段自行覆盖 vLLM 版本。Triton 的 vLLM Backend 只需 JSON 配置模型权重和 Tokenizer，运行时动态生成 I/O Tensor Spec，降低模型制品与 Frontend 升级的耦合；需要自定义 Preprocess / Postprocess 或非标准执行流程的模型，则保留 Python Backend 作为 Escape Hatch。

模型冷启动也被纳入平台设计：从 S3 或 Hugging Face 在启动时下载大型模型太慢，Netflix 在模型发布时就把权重物化到 Amazon FSx，启动时优先从高性能文件系统读取。部署层由 Java Control Plane 负责版本、健康检查、Autoscaling 和 Multi-region Rollout；模型接口稳定时采用 Red-Black 部署，接口发生破坏性变化时采用 Versioned Deployment，让新旧模型版本并行存在，代价是升级期间暂时增加 GPU 成本。

可观测性方面，Triton 内置的 Metrics Bridge 只暴露了 40 多项 vLLM Metrics 中的 9 项，遗漏 Token Throughput、KV Cache Utilization 和 Prefix Cache Hit Rate 等关键指标。Netflix 因此增加轻量 Metrics Proxy，把 Triton HTTP Metrics 与 vLLM Prometheus MultiProcessCollector 的数据合并到统一 /metrics Endpoint。Constrained Decoding 的初始 Python 实现还受到 GIL 限制：Logits Processor 在 CPU 侧逐请求串行执行，Batch 越大尾延迟越差；团队迁移到 vLLM V1 的 Batch-level Processor，并把热点逻辑改为 C++，同时处理 Chunked Prefill 和 KV Cache Preemption 后 Token History 改变导致的状态机恢复问题。另一个 API 契约问题是 response_format 在某条集成路径中被接受却被丢弃，可能导致 JSON 约束没有真正生效。

**给谁用：** 已经拥有成熟 Model Serving、MLOps 或 Feature Serving 平台的大型企业；不希望 LLM 再造一套独立控制面。

**关键经验：** LLM 不一定要成为全新的平台孤岛。可以复用已有 Serving、Logging、Routing、KServe 和模型生命周期管理能力，只把 GPU Runtime 和 LLM 特有的 KV Cache / Decoding 能力作为专门扩展。API 兼容性必须做端到端契约测试，不能只检查 Gateway 返回 200。

来源：[Netflix TechBlog：In-House LLM Serving at Netflix（2026-07-17）](https://netflixtechblog.com/in-house-llm-serving-at-netflix-a5a8e799ea2c)；[InfoQ 对 Netflix 技术分享的整理（2026-07-27）](https://www.infoq.com/news/2026/07/netflix-llm-platform/)。

### 19.6 Observe.AI：EKS 上真正的成本优化来自启动链路

Observe.AI 为 Contact Center Quality Assurance 提供 GenAI Moments，使用 LLM 分析客户与客服的对话。它在 AWS 上使用 EKS 运营 GPU 推理。业务增长时，系统遇到两个问题：GPU 推理成本较高，以及流量突增时新 GPU 节点和模型启动太慢。

AWS 客户案例披露，模型从原先约 12–15 分钟的启动时间降到约 100 秒，LLM 每百万 Token 成本降低 40% 以上，整体基础设施成本也降低 40% 以上。

关键优化并不是换一个更大的 GPU，而是改造模型冷启动和弹性扩容链路：原先新节点需要把模型权重从 S3 下载到本地磁盘，再加载到 GPU；团队引入 Run:ai Model Streamer，让模型权重可以从 S3 直接流入 GPU Memory。原先新节点启动时还要下载大型 Inference Container；团队改用 Bottlerocket AMI，并通过 EBS Snapshot 预置推理镜像，结合 EBS Fast Snapshot Restore 加速节点准备。扩缩容原先主要参考 CloudWatch Metrics；团队改为直接读取 SQS Queue 中的任务需求，让扩容依据更接近真正的待处理工作量。

**给谁用：** 业务负载有明显峰谷、使用异步队列、模型较大且 GPU 节点需要动态扩容的企业，例如客服质检、批量文档处理、离线代码分析和后台 Agent。

**关键经验：** GPU Auto Scaling 不等于 Kubernetes 把 Pod 副本数加上去。节点启动、镜像拉取、权重下载、模型加载、CUDA Graph 初始化和健康检查都可能耗时。必须把从发现需求到模型真正 Ready 的完整时间作为容量指标。

来源：[AWS Customer Story：Observe.AI cuts AI inference costs by over 40%](https://aws.amazon.com/solutions/case-studies/observeai-case-study/)。

### 19.7 AWS EKS + vLLM：客户在自己的 AWS Account 中运营模型服务

AWS 在 2025 年发布的参考架构展示了企业在自己 AWS Account 中部署 vLLM 的完整路径。架构使用 EKS、EC2 P4d（每台 8×A100）、EFA、FSx for Lustre、AWS Deep Learning Container、LeaderWorkerSet 和 ALB。

模型权重存放在 FSx for Lustre；vLLM Pod 通过 Tensor Parallelism / Pipeline Parallelism 使用多 GPU，跨节点场景通过 EFA 提供高性能网络；ALB 对外暴露统一 API。AWS Deep Learning Container 提供经过预配置和测试的推理环境，降低 CUDA、NCCL、驱动和 EFA 依赖的安装工作。

这不是特定企业的生产客户案例，而是 AWS 给自管 ML 用户的工程参考实现。它说明 CSP 可以托管 Kubernetes Control Plane 和提供 GPU 实例，但客户仍然自己管理模型权重、推理容器、模型配置和业务 API。

**适用对象：** 已经使用 AWS、希望在现有 VPC / IAM / KMS / EKS 治理体系内运行模型服务的企业。

**需要注意：** 参考架构中的 P4d、FSx、EFA 和 LeaderWorkerSet 只是可运行起点，不等于生产平台已经完成。企业仍需补充私有模型仓库、镜像扫描、模型制品签名、身份认证、租户隔离、限流、审计、故障切换、容量配额和成本归属。多节点推理还需要独立验证 EFA / NCCL 拓扑和实际网络吞吐。

来源：[AWS Architecture Blog：Deploy LLMs on Amazon EKS using vLLM Deep Learning Containers（2025-08-14）](https://aws.amazon.com/blogs/architecture/deploy-llms-on-amazon-eks-using-vllm-deep-learning-containers)；[AWS EKS Load & Serve Models](https://docs.aws.amazon.com/eks/latest/userguide/ml-inference-load-serve-model.html)。

### 19.8 Google Distributed Cloud Air-Gapped：监管和数据主权驱动的隔离部署

Google Distributed Cloud（GDC）Air-Gapped 提供了一个 Open Weight Model 参考架构，面向不能连接公有云、不能把数据发送到外部模型 API 的环境。它支持在客户控制的隔离集群中使用 Kubernetes 部署 vLLM 或 Ollama，模型权重存放在 Persistent Volume，镜像放入私有 Harbor Registry，通过 NetworkPolicy 和 ProjectNetworkPolicy 控制访问。

部署过程包括：在有互联网的工作站下载模型权重和容器镜像；通过受控流程把容器镜像复制到隔离环境 Harbor；把模型权重上传到持久化卷，而不是打包进 Container Image；vLLM / Ollama Pod 挂载 PVC 后加载模型；Kubernetes Service / LoadBalancer 提供内部 API；Open WebUI 可作为可选 UI；使用 GPU Resource 和 Tensor Parallelism 部署模型，按环境能力使用 MIG。

文档指出一个实际扩展限制：示例中的模型 PVC 使用 ReadWriteOnce；若 StorageClass 不支持 ReadOnlyMany，一个模型 Deployment 不能简单地挂载同一个 PVC 扩展多个副本，每个 Deployment 可能需要独立 PVC。这类存储访问模式限制容易在 POC 时被忽略，到了扩容阶段才暴露。

**给谁用：** 银行、政府、国防、医疗、关键基础设施、研发数据高度敏感且有网络隔离要求的组织。

**关键经验：** Air-Gapped 不只是没有公网。镜像、模型权重、Tokenizer、依赖包、许可证、漏洞修复和升级都需要离线供应链流程。必须把模型制品、容器镜像、SBOM、签名、校验和、版本审批和离线补丁纳入平台设计。

来源：[Google Cloud：Open Weight Models reference architecture on GDC air-gapped](https://docs.cloud.google.com/distributed-cloud/hosted/docs/latest/gdcag/solutions/open-weight-models/reference-architecture)。

### 19.9 Cognition / Devin：在 CoreWeave 租用大规模 GPU，按 Agent 推理需求扩容

Cognition 公开表示，其在 CoreWeave 上运行 Devin 的训练、强化学习和生产推理，从桥接容量扩展到数千张 GPU，历时不到九个月。2026 年 CoreWeave 公告还提到，Cognition 与 CoreWeave 部署了 Vera Rubin NVL72，并由 Cognition 工程师执行客户侧推理基准；针对 SWE-2 Agentic Coding Workload，公开数据称相较 GB200 NVL72，Token Throughput 最高提升约 4.8 倍。

这个案例说明专业 GPU Cloud 的价值不仅是按小时出租 GPU，还包括提前获得新一代硬件、机架级系统、网络和现场工程支持。对 Agentic Coding，长上下文、高并发、连续多步推理使 GPU 资源成为产品交付能力的一部分。

公开资料没有完整披露 Devin 的生产推理集群具体软件栈、每个模型的 GPU 分配、实际利用率和完整成本，因此不能把它写成 CoreWeave 上某个可直接复制的 vLLM 部署方案。

**给谁用：** AI Native 产品公司、Agent SaaS、模型能力和推理吞吐直接决定收入的企业；需要快速获得大规模 GPU，而不愿从零建设数据中心的组织。

**关键经验：** 专业 GPU Cloud 可以把机房、GPU 服务器、网络和部分集群运营交给供应商，但企业仍要管理模型服务、Agent 调度、请求优先级、KV Cache、模型升级、容量预测和业务 SLO。合同必须明确 GPU 代际、节点拓扑、网络带宽、故障替换、维护窗口、可用性、数据位置、网络隔离、预留容量和扩容交付时间。

来源：[CoreWeave：Cognition at Production Scale](https://investors.coreweave.com/news/news-details/2026/CoreWeave-Delivers-NVIDIA-Vera-Rubin-NVL72-Performance-at-Production-Scale-Starting-With-Cognition/default.aspx)。

### 19.10 Together AI + IBM Cloud + NVIDIA：专属 B300 集群由谁运营？

2026 年 8 月，IBM 宣布与 Together AI 达成多年期、约 2.4 亿美元的合作，在 IBM Cloud 上部署大规模 NVIDIA HGX B300 集群，采用 NVIDIA Spectrum-X Ethernet。IBM 提供 Cloud Infrastructure，NVIDIA 提供 GPU 和网络技术，Together AI 负责 Inference Platform。Together AI 在 2026 年 10 月介绍了该集群的企业推理用途。

这是一个清楚的职责分工案例：GPU 服务器、机房、电力、网络和云基础设施由 IBM 提供；GPU 与网络平台由 NVIDIA 提供；模型运行、Serving Engine、模型适配和 Token 服务由 Together AI 运营；企业客户通过 Together AI 的服务消费推理能力。

它不是每个企业在自己的账户中自建推理集群，而是专业推理服务商租用 / 采购 CSP 的 Dedicated GPU Capacity，再运营推理服务。对企业用户而言，这是介于公有 API 和完全自部署之间的方案。

**给谁用：** 对开源模型有需求，但没有足够 GPU Infra 团队的企业；需要专属容量、较稳定价格和服务 SLA，又不想自己维护驱动、Kubernetes、NCCL 和推理引擎的组织。

**关键经验：** 采购合同要把 Dedicated GPU 拆成可验证内容：是否独占物理 GPU、是否独占节点、网络是否独占、模型权重是否可自定义、服务商能否访问请求内容、模型更新和回滚由谁执行、容量扩容是否有保证、故障期间是否有替代资源。专属容量不等于数据主权，也不等于企业拥有完整运行控制权。

来源：[Together AI：Expanding our enterprise inference capacity with IBM Cloud and NVIDIA（2026-10-06）](https://www.together.ai/blog/expanding-our-enterprise-inference-capacity-with-ibm-cloud-and-nvidia)；[IBM 新闻稿（2026-08-11）](https://www.prnewswire.com/news-releases/ibm-and-together-ai-sign-multi-year-agreement-to-scale-open-source-ai-inference-with-nvidia-ai-infrastructure-on-ibm-cloud-302847748.html)。

### 19.11 全球金融科技公司 + Together Dedicated Model Inference：56 张 B200 上的 Coding Agent 生产流量

Together AI 在 2026 年 9 月公开了一个匿名全球金融科技客户案例。客户用 GLM-5.2 运行内部 Coding Assistant，工作负载具有明显的工作时间峰值、低平均生成速率、长上下文和突发并发特征。它不是企业自己管理物理 GPU 和推理引擎，而是使用 Together 的 Dedicated Model Inference（DMI）；但客户工程团队拥有 Endpoint 配置、扩缩容、模型升级和蓝绿测试控制权。

公开的生产配置包括：GLM-5.2 在 56 张 B200 上运行，14 个 Replica、每个 Replica 4 张 B200，Context Length 为 256K。客户优先考虑并发容量，而不是单 Replica 的最大吞吐。

这个案例公开了真实的故障分析过程：客户把模型部署从较多小 Replica 调整为较少大 Replica，GPU 总数不变，但 Prefill 容量和 KV Cache Headroom 的比例发生变化。调整后几天内，Prefill 接近 100% 容量，请求开始排队 1–3 分钟，Decode Throughput 降到约 5 Token/s。Metrics API 分析一条持续 192 秒的慢请求后发现，它不是自己的计算量过大，而是排在其他请求形成的约 2.3M Token Pending Prefill 队列后面。团队发现默认 Cache-aware-by-hash 路由不适合当前会话分布，恢复经过调优的 Cache-session-aware Routing，并调整 Max In-flight per Worker 后，当天完成配置修复且没有停机。

流量分布也很重要：客户报告的 Input Sequence Length p50 / p90 / p95 约为 81K / 163K / 178K Token，RPS p50 / p90 / p95 约为 3 / 6 / 7。它是低 RPS、超长输入、峰值并发显著的负载，不应该按普通聊天服务的平均 RPS 估算。

客户还评估过 1M Context，但发现上下文长度翻倍会压缩并发容量，因此选择 256K / 512K 的工作区间。模型从 GLM-5.1 升级 GLM-5.2 时，在同一账户和 Endpoint Pattern 下完成切换，并通过自助控制面进行配置调整和蓝绿测试。

**给谁用：** 金融科技、银行、证券、保险等拥有大量开发团队、Coding Agent 在工作时间集中使用、希望平台团队控制容量和模型发布节奏的组织。

**关键经验：** GPU 总数相同，不代表服务能力相同。Replica 数量、每个 Replica 的 GPU 数、Prefill / Decode 资源比例、Context Length、KV Cache 和 Router 策略都会改变有效并发。模型配置变更必须作为容量变更进行压测和灰度，不能当成普通参数调整。

**部署边界：** 这是 Dedicated Managed Inference，不是客户自己维护 GPU Driver / K8s / vLLM 的完整自部署。它展示了企业希望获得的运维自主权，也提醒我们：即使购买了专属 GPU 容量，若没有可操作的 Metrics API 和 Endpoint Configuration API，平台团队仍会成为所有扩容和故障排查的瓶颈。

来源：[Together AI：How a global fintech scaled coding agent traffic with Dedicated Model Inference（2026-09-18）](https://www.together.ai/blog/global-fintech-scales-coding-agent-traffic-with-dedicated-model-inference)。

### 19.12 Samsung Semiconductor：On-Prem 平台首先解决数据控制和研发效率

Open WebUI 公布的 Samsung Semiconductor 客户案例称，Samsung Semiconductor 在内部 Kubernetes 集群部署了自托管 AI 平台，运行内部 LLM 和 SLM，使用内部数据库、内部网络隔离、内部 Observability Stack，并集成身份和审计控制。案例披露，团队先用 100 名分析人员进行 14 天试点，再在 30 天内扩大推广；研发团队报告开发周期缩短约 30%。

这类案例与大规模 GPU 推理服务有明显区别：公开材料强调安全的内部 AI 使用入口、模型访问治理和研发流程效率，没有披露 GPU 型号、推理引擎、模型规模和底层 GPU 集群拓扑。因此不能从这份材料推导用了多少 GPU 或推理吞吐是多少。

不过它披露了一个值得企业架构师注意的采用数据：首周活跃使用率较高，但后续每日活跃用户稳定在目标员工的 5%–10%。这说明“给 1000–5000 名员工部署一个私有 Chat UI”与“1000–5000 人每天都高频使用”完全不同。

**给谁用：** 半导体研发、专有设计数据、实验室文档、内部知识和软件研发场景；首先需要建立员工使用入口、身份、审计和数据边界的企业。

**关键经验：** 不要用员工总数推算 GPU 数量。先通过 Pilot 测出 DAU、并发 Session、每 Session 输入 Token、Agent / Chat 比例和峰值时间。平台推广也不能只交付 UI，还要有 SSO、审计、使用培训、帮助台和模型选择策略。

**证据限制：** 该案例来自 Open WebUI 的客户案例页面，属于产品供应商发布的客户材料，性能和效率结果未经独立审计；它没有提供底层 GPU 和模型服务细节。

来源：[Open WebUI：Samsung Semiconductor Private On-Prem AI Platform](https://docs.openwebui.com/enterprise/customers/samsung-semiconductor/)。

### 19.13 Uber：混合使用自有机房 GPU 和 GCP GPU，资源编排跨集群

Uber 在 2026 年披露的 LLM Training Infrastructure 案例不是纯推理平台案例，但它说明企业不必在“全部自建”与“全部公有云”之间二选一。

Uber 的内部 LLM 工作流同时使用自有 On-Prem 集群中的 A100 GPU，以及 Google Cloud 上的 H100 GPU VM。其 On-Prem 主机配置为 4×A100，GCP 主机使用 8×H100。资源通过内部 Crane Infrastructure 管理，Kubernetes 负责集群和硬件资源，Ray / KubeRay 负责分布式任务；多个 Kubernetes Cluster 通过 Federation Layer 根据资源可用性调度任务。

训练栈使用 PyTorch、Ray、Hugging Face、DeepSpeed 和 NCCL，数据来自 Uber HDFS、Terrablob 和 Hugging Face。Uber 还讨论了 ZeRO-3 CPU Optimizer Offload 和 FlashAttention 对显存与训练吞吐的影响。

**给谁用：** 已有企业数据中心和 GPU 资产，同时又需要 CSP 弹性资源的组织；需要在自有 GPU 和租赁 GPU 之间调度训练、微调、Batch Inference 或评估任务。

**关键经验：** 混合 GPU Fleet 的难点不是简单地把两个 Kubernetes Cluster 接起来，而是统一资源描述、GPU 型号能力、镜像和驱动兼容性、数据位置、网络带宽、身份凭据和任务可迁移性。不同云和本地集群的 GPU SKU、网络、存储和驱动栈并不完全等价。调度器必须知道任务能否跨集群运行，而不能只看还有多少张 GPU。

**证据限制：** Uber 文章重点是 LLM Training / Fine-tuning Infrastructure，而不是证明同一套跨集群架构已经承担所有在线推理流量。它适合作为 Hybrid GPU Resource Management 案例，不应误称为生产 Coding Agent Serving 案例。

来源：[Uber Engineering：Open Source and In-House: How Uber Optimizes LLM Training（2026-04-14）](https://www.uber.com/us/en/blog/open-source-and-in-house-how-uber-optimizes-llm-training/)。

### 19.14 Deutsche Telekom Industrial AI Cloud：把 GPU 作为主权 AI 基础设施提供给企业和公共部门

Deutsche Telekom 与 NVIDIA 建设了位于德国慕尼黑的 Industrial AI Cloud。Telekom 公开资料称，该 AI Factory 在 2026 年启动，采用最多约 10,000 张 NVIDIA Blackwell GPU（B200 与 RTX PRO 等），配套约 20 PB 存储，目标客户包括德国和欧洲企业、科研机构与公共部门。平台提供从数据中心、GPU Compute、软件平台、安全到行业应用的完整服务能力。

它不是某家企业的内部自部署，而是区域性 Sovereign AI Infrastructure Provider。客户可以在本地司法管辖区内获得大规模 GPU 训练和推理能力，同时不必自行建设数据中心。

公开客户和合作生态包括 SAP、Siemens、EY、Agile Robots、Wandelbots、Quantum Systems、PhysicsX 等；SOOFI 项目计划在该平台上训练和运行约 100B 参数的主权欧洲语言模型。

**给谁用：** 有数据主权、区域监管、工业数据和政府业务要求的欧洲企业与公共部门；需要大规模 GPU，但没有自建数据中心条件的机构。

**关键经验：** 主权云不只是数据中心在本地。企业还要核实运营主体、管理员访问、远程运维、模型权重存放、日志和备份位置、供应链、加密密钥控制、跨境支持人员和故障恢复地点。数据驻留不自动等于完整数字主权。

来源：[Deutsche Telekom：Industrial AI Cloud（2026-02-04）](https://www.telekom.com/en/newsroom/latest-updates/media-information/2026/2/germany-s-first-ai-factory-for-industry)；[Deutsche Telekom：AI sovereignty for Germany and Europe（2025-11-04）](https://www.telekom.com/en/newsroom/latest-updates/media-information/2025/11/ai-sovereignty-for-germany-and-europe)。

### 19.15 Ada：GPU Slicing 解决多模型协作中的资源碎片化

Ada 的客户服务 Agent 使用多个模型协作完成推理任务，其中一部分模型规模较小，并不需要独占一整张 GPU。AWS 客户案例披露，Ada 在迁移到 EKS 后，将模型容器部署在 Kubernetes 上，并对 Reasoning Engine 使用的 GPU 进行切分。AWS 报告称，GPU Slicing 让 GPU 使用成本效率提升约 20%；整体迁移还改善了部署速度和运维效率。

这个案例提醒我们：企业内部并不是每个模型都需要 8 张 B300。模型池中可能同时存在大模型、Embedding、Reranker、Classifier、Guardrail、Small Language Model 和语音 / 视觉子模型。若所有服务都独占整卡，容易产生 GPU Fragmentation。

但 GPU Sharing / Slicing 要区分 MIG、Time-slicing、MPS 和软件层虚拟化。它们的隔离、安全、显存保护、故障域和性能可预测性不同。多租户场景不能只为提高 GPU 利用率而牺牲性能隔离和安全边界。

**给谁用：** 多模型、多服务、模型尺寸差异明显的企业 AI 平台；同时运行 Embedding、Reranker、分类、Guardrail 和多个小模型的团队。

来源：[AWS Customer Story：Ada on Amazon EKS](https://aws.amazon.com/solutions/case-studies/ada-support-eks-case-study/)。

### 19.16 反面参照：Superhuman / Grammarly 从自建 vLLM 转向托管 Serving

Superhuman（原 Grammarly）曾经运行自建 vLLM Serving Stack 和内部模型管理工具，支撑语法纠错模型。随着业务规模达到峰值 200K+ QPS，L40S GPU Fleet 的性能优化、容量规划、自动扩缩容和每次模型迭代所需的手工调优，逐渐占用精干 ML Infrastructure 团队的大量精力。

2026 年，Superhuman 与 Databricks 合作迁移到 Databricks Model Serving Provisioned Throughput。公开材料称，联合优化将单个 H100 Pod 的吞吐从约 750 QPS 提高到 1,200 QPS，提升约 60%，并实现亚秒级 P99 延迟。优化包括 FP8 量化、减少 Python CPU 开销、把部分后处理从关键路径移走，以及 Attention Kernel 优化。团队在迁移前后通过质量评测和性能目标验证模型没有质量退化。

这不是自部署成功案例，而是一个重要边界案例：即使企业已经有能力维护 vLLM，继续自建也未必有最高的业务价值。若团队真正的差异化在模型和产品，而 GPU Serving 的 Day-2 Operations 已成为负担，托管 Provisioned Throughput 可能更合理。

**给谁用：** 已经拥有内部推理平台、但规模和 SLA 要求不断增长的产品团队；需要判断是否应继续扩充 Infra Team，还是把 Serving 交给专业平台运营商。

来源：[Databricks：How Superhuman and Databricks built a 200K QPS inference platform together（2026-05-08）](https://www.databricks.com/blog/how-superhuman-and-databricks-built-200k-qps-inference-platform-together)。

### 19.17 案例横向比较：不同组织到底在为什么付钱？

| 案例 | 资源模式 | 谁使用 | 核心驱动 | 公开的工程经验 |
| --- | --- | --- | --- | --- |
| IBM Research / Red Hat | H100 Fleet，按云租赁价格核算 | 数千并发 Coding Agent / 内部业务 | Agentic 输入 Token 成本、长上下文、模型自主权 | Prefix-aware Routing、KV 分层、P/D 分离、NIXL |
| Shopify | 自有 GPU 服务 Specialist Model，Nebius 用于后训练 | Sidekick 子 Agent | 高重复输入、任务专用模型、成本与响应速度 | Task Expert、Judge、生产数据闭环、Trace Replay |
| Perplexity | AWS P4d / P5 租赁 GPU | 外部 API 开发者与产品用户 | API 成本、延迟、模型控制 | TensorRT-LLM、Kubernetes、模型路由 |
| Netflix | 内部 Model Scoring Service / GPU Runtime | Netflix 内部产品与 ML 工作流 | 复用现有 Serving、统一接口和生产控制 | Triton + vLLM、版本锁定、端到端 API 契约 |
| Observe.AI | AWS EKS + GPU EC2 | 客户服务质检工作流 | 弹性、冷启动、单位 Token 成本 | S3 到 GPU 权重加载、镜像预热、队列驱动扩容 |
| AWS EKS 参考架构 | AWS GPU 实例租赁 | 客户自己的应用和开发者 | 在客户 AWS Account 中自管模型服务 | EKS、EFA、FSx for Lustre、vLLM |
| Google GDC Air-Gapped | 客户控制的隔离基础设施 | 监管行业、内部用户 | 数据主权、网络隔离、BYOM | 离线制品供应链、PVC、Harbor、NetworkPolicy |
| Cognition / Devin | CoreWeave 专业 GPU Cloud | 外部 Agent 产品用户 | 快速获得大规模 GPU 和新一代硬件 | GPU Cloud 合作、Agentic Throughput、Rack-scale |
| Together AI | IBM Cloud Dedicated B300 | Together 的企业推理客户 | 大规模专属推理容量 | CSP / GPU Cloud / Inference Provider 分工 |
| Global Fintech | Together Dedicated Model Inference | 内部 Coding Agent | 峰值并发、长上下文、容量自助 | Prefill 排队、缓存路由、Context 与并发取舍 |
| Samsung Semiconductor | On-Prem Kubernetes | 研发人员和内部员工 | 研发数据保护、身份审计、员工效率 | 内部网络、SSO、审计、先试点再推广 |
| Uber | On-Prem A100 + GCP H100 | 内部模型研发团队 | 混合资源、训练弹性和资源利用 | Kubernetes Federation、Ray / KubeRay |
| Deutsche Telekom | 区域 Sovereign AI Cloud | 欧洲企业、科研和公共部门 | 数据主权、区域算力供给 | 本地数据中心、企业级 GPU 服务 |
| Ada | AWS EKS + GPU Sharing | 客户服务 Agent | 多模型资源碎片化 | GPU Slicing、Kubernetes 多模型编排 |
| Superhuman | 从自建 vLLM 转托管 Serving | 大规模产品用户 | Infra 运维负担和 SLA | FP8、CPU 热路径、Shadow / A/B 与托管服务 |

这些案例对应几种不同经济和责任模型：自己买 GPU、自己运营；租 CSP GPU、自己运营；租专业 GPU Cloud 的 Dedicated Cluster；Dedicated Managed Inference；以及普通 Managed API。它们不是简单的技术先进程度排序，而是企业控制权、成本和运营责任的不同组合。

### 19.18 企业为什么要自部署：五类驱动因素，不能只讲“省钱”

**第一类：数据边界和监管要求。** 银行、保险、政府、医疗、国防、半导体研发和知识产权密集型企业，可能不允许源代码、客户数据、研究文档或交易数据离开企业控制的网络和司法管辖区。自部署能把模型权重、推理请求、日志和缓存放在企业控制的环境内。但这不自动解决安全问题：仍需做模型供应链、管理员访问、审计、密钥、日志脱敏、Prompt Injection 和数据外泄控制。

**第二类：长期、大量、可预测的 Token 消耗。** Coding Agent 的每个任务会调用模型多次，并可能启动并行子 Agent。输入 Token 常常远大于输出 Token，而且历史上下文重复出现。按 Token 计费的 API 成本会随着 Agent 使用量增加。IBM 和 Shopify 的案例都说明，当输入上下文很重、请求重复率高、任务可以专门优化时，开源模型 + 自有推理优化可能显著降低单位任务成本。

**第三类：性能和服务行为可控。** 企业可以决定模型版本、量化精度、Context Length、Batching、KV Cache、路由策略、优先级、最大并发、模型更新窗口和故障降级策略。对内部 IDE / Coding Agent，企业可以按开发者、项目、任务优先级分配资源，而不必完全受外部 API 的限流和服务策略影响。

**第四类：模型定制和技术自主。** 企业可以做 LoRA / Fine-tuning、模型蒸馏、Tokenizer / Parser 适配、Tool Calling 约束、特定领域 Specialist Model，以及内部评测和持续改进。模型权重可控意味着模型行为可以被版本化、验证和回滚。

**第五类：供应商风险和长期议价能力。** API 价格、模型版本、限流策略、可用区域和服务条款可能变化。自部署或混合部署可以降低单一供应商依赖，但也把一部分供应商风险转移成企业自己的硬件供应、软件兼容和运维风险。

必须强调：**“数据不能出企业”是自部署的强理由，但“自部署一定更便宜”不是。** 对低用量、波动很大、模型更新很快、没有 GPU 工程团队的组织，托管 API 往往更经济。

### 19.19 为什么租 CSP GPU 仍然有价值：它解决资本和设施问题，不会自动消除推理运维

租 GPU 的好处是：不需要一次性采购昂贵 GPU 服务器、交换机、机柜、电力和液冷设施；可以先租 1 台 8-GPU 节点或小型 GPU Pool 做 POC，避免过早锁定硬件；可以按需扩容，获得不同 GPU 代际和区域；可以复用 CSP 的 VPC、IAM、KMS、对象存储、Kubernetes 和监控；可以通过 Reserved Capacity / Savings Plans / Dedicated Cluster 获得比按需实例更稳定的容量和价格；并把数据中心设施运维交给 CSP。

租 GPU 仍然需要企业自己处理：GPU Driver、CUDA、NCCL、容器、推理引擎和模型兼容；模型权重下载、存储、版本、缓存和启动时间；GPU 节点故障、XID、ECC、网络链路、RDMA、NCCL 错误；K8s 调度、模型 Replica、扩缩容、流量路由和负载隔离；KV Cache、Prefix Cache、Prefill / Decode、Batching 和量化；模型 API、认证、配额、审计、成本分摊和 SLO；云资源 Quota、区域容量、Spot 中断、预留合同和跨区恢复。

因此，租 CSP GPU 不是“把运维外包给 AWS”。它通常只是把服务器采购、机房、供电和部分底层设施运维外包了；推理平台的 Day-2 Operations 仍然在企业。

### 19.20 自部署最容易踩的坑：从案例归纳的 12 条经验

1. **按开发者人数买 GPU。** 注册用户、DAU、同时活跃 Agent、并发请求和 GPU 并发不是同一件事。先采集 Agent Trace，再建立容量模型。
2. **用普通聊天流量估算 Coding Agent。** 输入上下文可能达到数万到数十万 Token，输出却很短；还会并发启动子 Agent。要按 Input Length、Prefix Reuse、Subagent Burst 和 Prefill / Decode 分别建模。
3. **只看 Tokens/s，不看 Goodput。** 峰值 Token Throughput 不等于满足 SLO 的有效请求数。必须同时测 TTFT、TPOT / ITL、P95/P99、排队时间、请求完成率、错误率和 Agent Task Success Rate。
4. **忽略 KV Cache 和路由。** 长上下文下，缓存命中率和请求是否命中持有前缀的 Worker，可能直接决定系统能否承受并发。IBM 的数据说明，Prefix-aware Routing 的影响可能非常显著。
5. **盲目增加 Context Length。** Context 越长，单请求 KV Cache 占用越高，可并发 Session 越少。Together 金融科技案例展示，1M Context 不一定比 256K / 512K 更适合 Coding Agent。
6. **只增加 GPU，不看 Prefill / Decode 比例。** Prefill 队列饱和时，Decode GPU 可能仍有资源；反之亦然。需要通过真实 Trace 判断是否值得做 P/D Disaggregation。
7. **把 Auto Scaling 当成即时扩容。** GPU 节点启动、镜像拉取、模型权重加载和 Runtime 初始化可能需要数分钟。必须有 Warm Pool、模型预热、镜像预置、权重流式加载和队列驱动扩容。
8. **不测试版本兼容矩阵。** Driver、CUDA、NCCL、Triton、vLLM、模型代码和 Kernel 版本互相影响。Netflix 案例表明，组件各自升级可能让部署无法加载或让 API 参数静默失效。
9. **以为 OpenAI-Compatible 就完全兼容。** Tool Calling、Reasoning Parser、Structured Output、Streaming、Cancellation、Logprobs、Response Format 和错误语义都要做契约测试。不能只验证 API 返回 200。
10. **只测推理 Benchmark，不测真实业务质量。** FP8 / FP4、模型替换和 Fine-tuning 可能改变代码正确率、工具调用成功率和长任务稳定性。必须有内部 Coding Task Set、回归集和 Canary。
11. **低估存储和制品供应链。** 多副本扩容时，模型权重可能成为启动瓶颈；Air-Gapped 环境还需要离线镜像和模型供应链。模型权重不应临时从公共仓库下载到生产节点。
12. **忽略 GPU 故障和故障域。** 大规模集群中 GPU、NIC、交换机和节点故障是常态。要有 DCGM / XID 监控、节点隔离、Replica 冗余、模型重载和容量余量。GPU 利用率 100% 不是理想目标，生产服务必须保留处理突发和故障的 Headroom。

### 19.21 自有 GPU、租 CSP GPU、Dedicated GPU Cloud、托管 API：经济性如何比较

不要只比较“每 GPU 小时价格”和“每百万 Token API 价格”。应统一到满足业务质量和 SLO 的成本口径。定义 GPU 租赁、预留或折旧成本为 \(C_{gpu}\)，网络和跨区传输成本为 \(C_{network}\)，模型权重、缓存、日志和高性能文件系统成本为 \(C_{storage}\)，Kubernetes、监控、网关和数据库成本为 \(C_{platform}\)，GPU Infra、Inference Engineering、SRE、安全和模型评测人力为 \(C_{people}\)，自有 GPU 的电力、制冷、机房和资本成本为 \(C_{facility}\)，质量与 SLA 达标的业务任务数为 \(N_{success}\)。

\[
CostPerSuccessfulTask =
\frac{C_{gpu}+C_{network}+C_{storage}+C_{platform}+C_{people}+C_{facility}}
{N_{success}}
\]

API 方案的分子则应包含输入 / 输出 Token 费用、缓存费用、工具相关费用、专属吞吐或 SLA 附加费用，以及供应商切换和数据治理成本。

| 场景 | 典型特征 | 更可能合适的模式 |
| --- | --- | --- |
| 低用量、峰谷很大、模型需求频繁变化 | GPU 长时间闲置，难以摊薄固定成本 | 托管 API / Serverless Inference |
| 稳定中高用量、需要模型控制，但团队不想建机房 | GPU 利用率可预测，已有 K8s / SRE 能力 | CSP GPU + 自管推理，或 Dedicated GPU Cloud |
| 长期高利用率、严格数据主权、模型和推理是核心能力 | 有足够平台团队，且有设施和采购能力 | 自购 GPU / 私有 GPU Cloud |
| 用量大但缺乏 GPU 平台人才 | 需要固定容量和较稳定成本 | Dedicated Managed Inference |
| 工作负载混合 | 简单任务多、复杂任务少，部分任务有敏感数据 | Hybrid：托管 API + 自管开源模型 + Specialist Model |

自部署的盈亏平衡点不是一个固定 GPU 利用率。它取决于模型、输入 / 输出 Token 比例、API 单价、GPU 租赁单价、上下文长度、KV Cache 命中率、模型量化、SLO 和人力成本。建议用实际 Trace 计算每种方案的单位成功任务成本，而不是只算理论 Tokens/s。

### 19.22 对 1000 名开发者平台的建议：先混合，再逐步扩大自管范围

从这些案例推导，1000 名开发者的企业 Coding Agent 不必一开始就把所有请求迁移到自有 B300。更合理的路线是把模型按任务和数据边界分层：

- **高敏感代码和企业私有上下文：** 优先进入企业控制的 VPC / 私有 GPU 集群，或经过严格验证的 Dedicated Inference。
- **高频、输入很重、任务边界明确的工作：** 评估 Specialist Model、自托管开源模型和 Prefix Cache，优先从这类任务获取成本收益。
- **复杂规划、疑难调试和高质量代码生成：** 在质量和合规允许时保留 Frontier API，避免为了统一部署而牺牲任务成功率。
- **Embedding、Reranker、Classifier、Guardrail 等小模型：** 使用独立小模型池，必要时评估 MIG / GPU Sharing，避免占用大模型 GPU。
- **离线代码扫描、批量文档处理和评估：** 使用可中断或低优先级 GPU Pool，与交互式 Coding Agent 隔离。
- **峰值突发：** 通过弹性 CSP Capacity 或 Managed API 作为 Burst Capacity，避免为了极少数峰值长期购买大量闲置 GPU。

建议实施顺序：先从现有 Coding Agent 采集脱敏 Trace，记录每任务模型调用次数、Input / Output Token、上下文长度、Cache Prefix、并行子 Agent、峰值并发、取消率、重试率和任务成功率；再选一个 Frontier API、一个开源模型和一个 Specialist Model，统一 Agent Harness、Tool Schema 和评测集；租 1–2 个 8-GPU 节点做 POC，验证单节点部署、模型质量、并发、TTFT、TPOT、KV Cache 和单位任务成本；之后测试多节点网络、RDMA / EFA / RoCE、NCCL、模型并行、权重加载、节点故障和扩容；首期选 vLLM 或 SGLang 建立稳定基线，不要同时运营多个复杂推理控制平面；真实数据证明需要时，再引入 llm-d / Dynamo、外部 KV Cache、P/D 分离和更复杂路由；最后保留托管 API 作为弹性和质量后备。

~~~mermaid
flowchart TB
    Dev["约 1000 名开发者 / IDE / Coding Agent"]
    Agent["企业 Agent Runtime<br/>Session、工具调用、Sandbox、任务验证"]
    Gateway["AI Gateway<br/>SSO、Policy、Quota、审计、模型路由"]
    Router["Workload Router<br/>数据分类、任务类型、SLO、成本策略"]

    subgraph Managed["托管模型与弹性容量"]
      API["Frontier API / Managed Inference"]
      Dedicated["Dedicated Managed Endpoint"]
    end

    subgraph Private["企业自管推理平台（CSP GPU 或自有 GPU）"]
      Control["Kubernetes / llm-d 或 Dynamo<br/>Deployment、Autoscaling、Routing"]
      subgraph GPU["GPU Worker Pools"]
        Code["Coding Model Pool<br/>vLLM / SGLang"]
        Expert["Specialist Model Pool<br/>分类、抽取、工具子任务"]
        Batch["Batch / Offline Pool"]
      end
      KV["Prefix Cache / KV Cache<br/>GPU → CPU DRAM → 可选共享缓存"]
      Obs["DCGM / Prometheus / OTel<br/>TTFT、TPOT、Goodput、成本"]
      Control --> Code
      Control --> Expert
      Control --> Batch
      Code <--> KV
      Expert <--> KV
      GPU --> Obs
    end

    Dev --> Agent --> Gateway --> Router
    Router --> API
    Router --> Dedicated
    Router --> Control
    Gateway --> Obs
    Agent --> Obs
~~~

图中的托管 API 不是自部署的一部分，而是混合架构中的质量兜底和弹性容量。企业自管 GPU Pool 也不一定全部放在 On-Prem：可以先放在企业自己的 CSP Account / VPC 中，等负载、成本和运维能力稳定后再考虑长期预留或采购。

### 19.23 选型前必须向 CSP / GPU Cloud 问清楚的问题

| 维度 | 必须问的问题 | 为什么重要 |
| --- | --- | --- |
| GPU 资产 | 是物理独占 GPU、整机独占还是共享 GPU？能否指定型号、显存和代际？ | 避免把虚拟切片当成独占 GPU |
| 拓扑 | 8 GPU 是否同一 NVLink 域？跨节点是什么 NIC、交换机和网络？ | 决定 TP / EP / P-D 的可行性 |
| 网络 | InfiniBand / RoCE / EFA 的有效带宽、超售比、拥塞控制和 RDMA 支持如何？ | 标称带宽不等于端到端有效带宽 |
| 容量 | 当前可交付数量、扩容 Lead Time、预留容量、故障替代 GPU 的承诺是什么？ | 新 GPU 紧缺时，合同容量和实际交付可能不同 |
| 隔离 | VPC、节点、网络、存储和管理面分别如何隔离？运维人员能否访问内存或日志？ | Dedicated 不等于完整数据隔离 |
| 数据 | Prompt、Completion、日志、模型权重和 KV Cache 是否会被服务商留存？ | 数据治理不能只看 API Retention Policy |
| 运维 | Driver、Firmware、K8s、GPU Operator、NCCL、推理引擎由谁升级？谁负责回滚？ | 防止升级责任出现空档 |
| SLA | GPU 故障、网络故障、存储故障和整个节点故障分别如何计算 SLA？ | 不能只看 API Endpoint 可用性 |
| 计费 | 按 GPU-hour、节点小时、预留容量还是 Token 计费？闲置容量、存储、出口、支持如何计费？ | 计算真实 TCO |
| 退出 | 模型权重、缓存、日志和监控数据如何导出？终止合同后数据如何销毁？ | 避免被供应商锁定 |

### 19.24 本章结论

业界实践已经证明，企业自部署并不意味着必须拥有自己的 GPU 数据中心。Perplexity 在 AWS 上租 GPU 并运营自己的推理 API；IBM / Red Hat 以 H100 为基础验证数千个 Coding Agent 的开源模型服务；Cognition 在 CoreWeave 上获得大规模 Agentic Inference Capacity；Together AI 在 IBM Cloud 上运营专属 B300 推理集群。这些都说明 GPU 资产、推理平台和业务应用可以由不同主体分别负责。

企业真正需要做的决策是：**哪些控制权必须掌握在自己手里，哪些基础设施能力可以交给 CSP 或专业推理平台。** 数据边界、模型选择、请求路由、Agent Trace、质量评估和成本归属通常是企业需要保留的能力；机房、电力、GPU 服务器、部分 Kubernetes 管理和推理引擎运维则可以按组织能力外包。

对约 1000 名开发者的 Coding Agent 平台，最值得借鉴的不是某个案例的 GPU 数量，而是三条共同经验：用真实 Agent Trace 而不是用户数估算容量，重点分析长上下文、重复输入、子 Agent 并发和 Prefill / Decode；用模型路由和 Specialist Model 把不同任务放到合适的成本层级，不要强制所有请求使用同一个大模型；把推理平台视为长期生产系统，建立版本兼容、缓存策略、冷启动优化、故障恢复、可观测性和单位成功任务成本核算。

如果企业还没有成熟的 GPU Infra 团队，优先从租用 CSP GPU 的自管 POC 或 Dedicated Managed Inference 开始。只有当真实负载、质量收益、利用率和三年 TCO 都证明自管有优势时，再扩大长期预留容量或自购 GPU。自部署的目标不是拥有更多 GPU，而是以可接受的运营复杂度，获得数据、模型、性能和成本的可控性。


## 21. 更多业界案例：金融、医疗、自动化、制造业与云 GPU 平台

第 19 章已经讨论了大型 Coding Agent、企业自托管平台和 GPU Cloud。本章继续补充另一组案例，重点看不同产业的需求差异：金融机构为什么在自己的数据中心运行模型；医院如何让未经匿名化的病历留在院内；企业自动化平台为什么愿意租用 H200 并把 KV Cache 路由作为核心优化；汽车公司如何把 vLLM 纳入 Kubernetes 的生产运维；以及 CSP 和服务器厂商怎样把这些实践产品化。

先说明证据口径。本章把案例分成三类：

- **客户生产 / 客户试点：** 有明确客户名称和部署结果，但仍需区分正式生产与有限范围 Pilot。
- **客户与供应商联合技术实践：** 有真实客户负载和工程配置，但性能数字可能来自双方联合测试或特定配置。
- **厂商参考架构：** 提供可复现的基础设施实现，说明“可以怎样部署”，不代表某个终端企业已经按该配置生产运行。

供应商发布的性能数字保留其原始口径，不视为独立审计结果；没有公开的信息不推断。

### 20.1 BC Card：韩国金融机构把 On-Prem GPU 推理平台用于多个业务流程

BC Card 是韩国支付和金融服务公司。Red Hat 于 2026 年 9 月发布的客户案例称，BC Card 基于 Red Hat OpenShift AI 建设了企业 AI 模型部署和运营平台，运行在 On-Prem GPU 环境中，覆盖加盟商筛查、RPA 和呼叫中心自动化等业务。

公开案例给出的结果是：通过 vLLM、FP8 Dynamic Quantization 和 SLM Swarm Architecture，GPU 推理成本最高降低 70%，推理速度提升 2–3 倍，相关业务每年累计节省约 102,000 小时工作量。

这个案例的架构意义在于，它不是只为一个聊天机器人部署一套大模型，而是建立一个可部署和运营多种 AI 模型的企业平台。金融机构的不同业务任务并不需要统一使用最大模型：加盟商筛查可能是信息抽取、风险分类和规则判断；RPA 需要结构化理解和工具调用；呼叫中心自动化则涉及语音转写、摘要、意图识别和辅助应答。将多个小模型组织成 SLM Swarm，可以让每个任务使用更合适的模型和资源，而不是把所有请求都路由给单个大模型。

**部署边界：** 案例明确为 On-Prem GPU 和 OpenShift AI，但公开摘要没有给出 GPU 型号、GPU 数量、具体模型、节点拓扑、存储和网络配置。因此不能据此估算 BC Card 的集群规模，也不能推断其是否采用了多节点 Tensor Parallel 或 Prefill/Decode 分离。

**给谁用：** 银行、支付机构、保险和大型金融服务组织；尤其是希望在同一个平台上运行多个受监管业务模型，而不是各部门自行搭建孤立推理服务的企业。

**可借鉴经验：** 把模型服务做成平台能力，把业务任务做成可替换的 Model Endpoint；对不同任务建立独立质量评估和资源配额；量化和小模型编排应以业务质量为约束，而不是只追求 GPU 利用率。金融场景还要把模型调用、输入数据类别、输出、人工复核和模型版本纳入审计。

**证据等级：** 厂商发布的具名客户案例。性能和效率数据是 Red Hat / 客户案例口径，公开摘要没有披露完整测试方法。

来源：[Red Hat：BC Card enhances financial AI operations system with Red Hat OpenShift AI（2026-09-01）](https://www.redhat.com/en/resources/bc-card-openshift-ai-case-study)。

### 20.2 Tesla：从简单 vLLM StatefulSet 演进到 KServe + llm-d 的生产级推理管理

KServe 在 2026 年 4 月发布了一篇由 KServe、Red Hat 和 Tesla 工程师共同署名的生产实践文章。Tesla 的工程师明确参与了这套系统在生产环境中的验证。文章讨论的核心不是如何第一次启动 vLLM，而是如何在 Kubernetes 中规模化管理数百个 LLM、适配不同 Serving Topology，并处理 Day-2 Operations。

团队最初把 vLLM 放在 Kubernetes StatefulSet 中。随着模型数量和部署规模增加，暴露出几个问题：

1. **模型文件加载慢。** Llama 3 级别的模型权重达到数百 GB，直接依赖普通 NFS 读取 safetensors 不可接受。
2. **本地卷导致节点绑定。** 改用本地 LVM Persistent Volume 后，模型加载更快，但 Pod 和节点绑定变得僵硬；节点故障时需要人工删除 PVC 并重新调度，故障恢复操作不可接受。
3. **普通 Round Robin 不适合 LLM。** 请求被随机分配到 Worker，无法利用 Worker 上已有的 KV Cache；长 Prefill 请求可能集中在部分 GPU 上，其他 GPU 却没有得到有效利用。
4. **推理拓扑需要演进。** 团队不希望 Kubernetes Operator 把系统锁定在单一 Prefill/Decode 架构，也希望通过标准 Kubernetes API 控制 vLLM 参数和硬件配置。

最终采用 KServe + llm-d + vLLM，并结合 Envoy、Envoy AI Gateway 和 Gateway API Inference Extension，实现 Prefix-cache-aware Routing。KServe 的 LLMInferenceService / LLMInferenceConfig 作为 Kubernetes API 暴露部署配置，llm-d 负责推理编排和路由，vLLM 负责模型执行。

文章披露，在一套使用 Llama 3.1 70B、4 张 AMD MI300X、Tensor Parallel Size 为 4、最大上下文长度 65,536 的部署中，启用 Prefix Cache-aware Routing 后，输出 Token/s 提升约 3 倍，TTFT 降低约 2 倍。这是特定部署的前后对比，不代表所有模型和流量都能获得相同比例的收益。

**给谁用：** 已有 Kubernetes 和 GPU Fleet、需要同时管理大量模型或多个模型版本的企业；尤其适合汽车、制造、研发等拥有多个内部 AI 应用团队的组织。

**关键经验：** GPU 推理的生产问题不止是模型进程是否存活。模型权重存储、节点故障后的卷恢复、Prefix Cache 命中、路由策略和推理拓扑都必须进入平台设计。用本地 NVMe 可以解决模型加载速度，却可能增加节点亲和和故障恢复复杂度；不能只优化启动性能而忽略可恢复性。

**架构判断：** Tesla 这个案例值得作为 KServe + llm-d 的真实生产采用参考，但文章没有披露完整 GPU Fleet 规模、集群位置、云厂商和所有模型。因此不应将其描述成某种特定数量的 On-Prem GPU 集群。

来源：[KServe：Production-Grade LLM Inference at Scale with KServe, llm-d, and vLLM（2026-04-21）](https://kserve.github.io/website/blog/production-grade-llm-inference-kserve-llm-d-vllm)。

### 20.3 Workato：租 DigitalOcean H200，Dynamo + vLLM 支撑企业 Agentic Automation

Workato 是企业自动化平台，AI Research Lab 正在把 Agentic AI 能力用于跨业务系统的推理、行动和流程编排。Workato 的平台累计处理超过 1 万亿次自动化工作负载，因此模型推理成本、吞吐和尾延迟会直接影响产品经济性。

2026 年 3 月，DigitalOcean 公布了与 Workato 的联合部署和优化结果。Workato 使用 DigitalOcean Agentic Inference Cloud，由 DigitalOcean 提供 GPU 基础设施和 Managed Kubernetes，推理栈采用 NVIDIA Dynamo + vLLM，GPU 使用 NVIDIA H200。团队选择 H200 的重要原因是 141 GB HBM3e 显存，可以承载 100K Token 上下文对应的模型权重、KV Cache 和 Activation Buffer。公开测试中，整体工作负载内存占用约 125 GB。尽管单张 H200 能容纳该工作负载，团队仍使用每节点 8-way Tensor Parallel，以提高持续并发下的吞吐和延迟稳定性。

系统并不是简单地把多个 vLLM Pod 放在 Load Balancer 后面，而是拆分为几个协作组件：

- Dynamo Frontend：作为集群级 Router / Scheduler，决定请求应该交给哪个 Worker。
- vLLM Workers：运行模型并处理 Prefill / Decode。
- KV Cache Manager：跟踪各 Worker 的 KV Block、缓存重用和淘汰状态。
- DOKS：提供 Kubernetes 调度、服务发现和 Worker 部署环境。

默认 Prefix Cache 只能让单个 Worker 利用本地缓存。如果两个具有相同长前缀的请求被分配到不同 Worker，仍可能重复计算 Prefill。Dynamo 的 KV-aware Router 维护跨 Worker 的缓存状态，综合 KV Overlap、Prefill 计算量和 Decode 负载选择 Worker。

DigitalOcean 的技术文章报告，在相同 H200 硬件对比中，KV-aware Routing 使每 GPU 吞吐提升约 67%，高并发场景端到端延迟最多降低约 79%，TTFT 最多降低约 77%；对比其 A100 配置，H200 在相当性能下的硬件成本优势约 33%。DigitalOcean 的客户公告还报告模型推理成本降低 67%，达到每百万 Token 约 0.77 美元。所有数字都依赖其模型、负载、测试配置和服务计价口径，不能直接当作企业租赁 H200 的报价。

**部署边界：** 这是租用 DigitalOcean 的 GPU Cloud / Managed Kubernetes 并使用其 Agentic Inference Cloud，不是 Workato 自己管理底层 GPU 节点和 Kubernetes Control Plane 的完整自部署。Workato 参与模型和推理架构调优，DigitalOcean 承担平台和基础设施运营。

**给谁用：** 企业自动化平台、Agent SaaS、需要处理大量企业工作流的 AI 产品；特别是长上下文、重复前缀、并发 Agent 较多的工作负载。

**关键经验：** 对长上下文 Agent，集群级 KV-aware Routing 能直接改变单位 GPU 成本。它的价值不在于让单张 GPU 的 Kernel 更快，而在于避免不同 Worker 重复计算相同前缀。代价是系统复杂度明显上升：Router、Worker、KV Manager 需要同步状态，故障恢复和状态过期也必须纳入设计。没有足够的跨请求前缀重用时，额外的全局协调未必值得。

来源：[DigitalOcean：How DigitalOcean’s Agentic Inference Cloud powered by NVIDIA GPUs Achieved 67% Lower Inference Costs for Workato（2026-03-04 更新）](https://www.digitalocean.com/blog/workato-nvidia-technical-deep-dive-agentic-inference-cloud)；[DigitalOcean Investor Relations：DigitalOcean Powers Workato’s Agentic Enterprise with Production-scale AI（2026-03-03）](https://investors.digitalocean.com/news/news-details/2026/DigitalOcean-Powers-Workatos-Agentic-Enterprise-with-Production-scale-AI/default.aspx)。

### 20.4 University Hospital Bonn：8 张 A100 在院内运行 DeepSeek-R1，处理未经匿名化的医疗数据

德国 University Hospital Bonn 的放射科和 IT 团队在 2025 年 7 月开展了一周的自托管 LLM 试点，并于 2026 年 3 月公开了研究论文。该案例对医疗、金融和其它高敏感数据行业很有参考价值，因为它明确把“数据不能离开机构网络”作为系统设计的前提。

系统部署在医院自己的服务器上，配置为 8 张 NVIDIA A100 80 GB PCIe GPU，运行量化后的 DeepSeek-R1（671B 参数模型），推理服务使用 vLLM，前端使用 Open WebUI，并通过 Docker / Nginx 等组件组织服务。医院采用严格的网络分区、主机级 Egress Filtering 和主动隔离监控，确保模型服务不能未经授权访问外部网络。配套部署包还包含自动化隔离和加固测试。

医院通过临床管理、合规、数据保护和信息安全审批，获准在受控环境中处理未经匿名化的 PHI（Protected Health Information）。一周 Pilot 有 22 名住院医师和放射科医生参与，使用 10 个预定义 Prompt Template。

结果值得注意：系统稳定性和可用性评价较高；报告翻译、文字纠错、简化和基于已有文本的指南建议表现较好；基于影像发现开放式生成诊断结论时，出现了更多关键错误，例如临床相关幻觉或遗漏。研究团队因此明确强调，这套系统用于放射科文本辅助，不是自主临床决策系统。

**给谁用：** 医院、医疗影像中心、临床研究机构，以及必须在内部处理未匿名化数据的组织。

**关键经验：**

- 安全架构应假设系统可能被攻破，采用 Network Segmentation、Host-enforced Egress Filtering 和持续 Isolation Monitoring，而不是只依赖“没有配置公网地址”。
- 模型部署审批必须和技术建设并行。医院涉及临床管理、合规、数据保护、信息安全等多个责任主体。
- 先从源文本约束明确的任务开始，例如翻译、校正、摘要和简化；开放式生成新结论必须单独验证，不能因模型在文字任务上表现好就直接扩展到临床决策。
- 模型本身可以替换，网络隔离、日志治理、身份和审批机制应独立于模型实现。

**证据限制：** 这是医院作者发布的 arXiv Preprint，属于单中心、一周、22 人的用户试点，并非经过同行评审的临床疗效研究。错误数据来自参与者报告；不能把试点结果解释为模型可安全自主诊断。论文称该架构是面向超过 10,000 名员工正式服务的基础，但没有给出全院推广后的实际使用率和容量数据。

来源：[arXiv：Secure On-Premise Deployment of Open-Weights Large Language Models in Radiology: An Isolation-First Architecture with Prospective Pilot Evaluation（2026-03-25）](https://arxiv.org/abs/2604.22768)；[医院公开部署包 ukb-gpt](https://github.com/ukbonn/ukb-gpt)。

### 20.5 Dell + Meta PyTorch：把 vLLM Production Stack 产品化为 On-Prem AI Factory 的推理层

Dell 与 Meta PyTorch 团队在 2026 年公开了面向 Dell AI Factory 的 Enterprise-Ready vLLM Production Stack。它不是单个终端客户的案例，而是服务器厂商与开源框架团队合作，把 On-Prem LLM Serving 需要的组件组合成企业参考平台。

底层由 Dell PowerEdge GPU Server、PowerScale Storage 和网络设备组成；Kubernetes 负责工作负载编排；vLLM 负责模型推理；vLLM Production Stack 提供 Kubernetes 原生部署、KV Cache-aware Routing、自动扩缩容、分布式追踪和监控、安全能力，以及 PII Detection / Jailbreak Prevention 等应用侧防护。方案还讨论 KV Cache Offloading 和 Semantic Routing，并展示了运行在该推理框架上的多任务 Chatbot。

这个方案值得关注的不是某一项硬件 Benchmark，而是它试图将企业平台需要的能力组合起来：模型 Runtime、Kubernetes Operator、缓存路由、Observability、安全和数据平台集成。对企业来说，这比直接把一个 vLLM Container 放在 GPU 节点上更接近长期运营的平台。

**给谁用：** 希望在企业机房或私有云建设 AI Factory 的大型组织；尤其是已经使用 Dell 服务器、存储和企业 Kubernetes 的客户。

**关键经验：** On-Prem 平台必须把存储、网络、GPU、模型 Runtime 和企业安全作为一套系统设计。KV Cache Offloading 也不是免费收益：缓存从 GPU 移到 CPU / 外部存储后，必须测量 PCIe、网络和存储传输成本，确认节省的 GPU HBM 是否抵得过搬运延迟。

**证据等级：** 厂商联合参考架构和演示，不代表已有某个具名客户按全部组件上线。实际采购时仍应要求 Dell 提供指定 GPU SKU、NVLink / NIC 拓扑、存储吞吐、vLLM 版本矩阵和故障恢复测试结果。

来源：[Dell Technologies：Enterprise-Ready LLM Inferencing with the vLLM Production Stack on Dell AI Factory（2026-05-20）](https://infohub.delltechnologies.com/en-us/p/enterprise-ready-llm-inferencing-with-the-vllm-production-stack-on-dell-ai-factory/)。

### 20.6 Oracle OCI：用 OKE + vLLM + Qdrant + Terraform 建立可自管的 GPU RAG / Agent 平台

Oracle 在 2026 年 7 月发布了一个完整的 OCI Open-Source AI 参考应用：在 Oracle Container Engine for Kubernetes（OKE）上运行 GPU-backed LLM、Qdrant、RAG 和 Agent Tool Calling，并通过 Terraform 一次性创建基础设施。

架构包含 React / Nginx Frontend、FastAPI Backend、Qdrant Vector Database、vLLM Inference Endpoint 和 OCI Load Balancer。GPU 推理运行在独立 GPU Node Pool，使用 NVIDIA A10；CPU 应用和 GPU 推理分池，Kubernetes Device Plugin 将 nvidia.com/gpu 暴露为可调度资源。Worker 节点位于 Private Subnet，不分配 Public IP；只有 Load Balancer 对外暴露。IAM、Container Registry、网络、节点池和集群通过 Terraform 定义。

这个参考实现还做了一个很重要的抽象：Backend 对推理后端保持相对无关。vLLM 通过 OpenAI-compatible API 暴露模型，业务 Backend 不需要知道 GPU 位于哪台机器，也不需要直接调用 CUDA 或访问 GPU 节点。

**给谁用：** 已经采用 OCI、希望把模型推理和 RAG / Agent 应用放在自己云账户内运营的企业；适合小规模 POC、部门级服务和作为后续企业平台的起点。

**关键经验：** GPU Node Pool 必须与 CPU 应用分离，避免昂贵 GPU 被普通 Web / Backend Pod 占用；模型服务接口应通过内部 Service 暴露，而不是直接开放 GPU 节点；Terraform 应覆盖 IAM、网络、Registry 和 GPU Node Pool，不要只用 Terraform 创建 VM，剩余部分再手工配置。

**证据等级：** Oracle 官方可运行参考应用，不是具名终端客户生产案例。示例使用 A10，不能据此推断 OCI 的大型多节点 GPU 推理能力或特定模型吞吐。

来源：[Oracle Cloud Infrastructure：Open-Source AI on OCI: Serving LLMs on Kubernetes with vLLM, Qdrant, and Terraform（2026-07-15）](https://blogs.oracle.com/cloud-infrastructure/open-source-ai-oci-with-vllm-qdrant)。

### 20.7 OVHcloud：租用 L40S GPU，在 Managed Kubernetes 上运行多模态 Qwen3-VL

OVHcloud 在 2026 年 10 月发布了 vLLM + Managed Kubernetes Service（MKS）的 Vision-Language Model 参考架构。方案运行 Qwen3-VL-8B-Instruct，使用两台 NVIDIA L40S GPU Node，提供 OpenAI-compatible API，监控采用 Prometheus、Grafana 和 DCGM。

请求路径为 Load Balancer → Gateway → NGINX Ingress → vLLM Service → GPU Pod。GPU Worker Pool 和 Monitoring CPU Pool 分离，模型推理与监控服务不会争抢 GPU。平台还展示 TTFT、Throughput、GPU 利用率等指标，并将服务放在 OVHcloud Public Cloud 的欧洲数据中心。

它展示了另一种租 GPU 的方式：企业不一定要自己运营 Kubernetes Control Plane。MKS 由 OVHcloud 管理，企业管理 GPU Worker Pool、vLLM、模型、Ingress、监控和应用。相比租裸 GPU VM，这减少了部分 Kubernetes 运维工作，但推理 Runtime、模型版本、缓存、容量和业务 API 仍由客户负责。

**给谁用：** 欧洲企业、需要数据区域控制和数字主权的组织；希望使用开源推理栈，但不愿维护 Kubernetes Control Plane 的团队。

**关键经验：** 托管 Kubernetes 不等于托管推理。企业仍需自己处理 vLLM 升级、模型兼容、GPU Driver、推理参数、API 安全、请求配额和性能目标。参考架构中的两个 L40S 节点也不自动构成高可用：还需要验证跨 AZ、节点故障、模型加载和流量切换。

**证据等级：** OVHcloud 官方部署指南，属于可复现参考架构，不是具名客户生产结果。

来源：[OVHcloud：Reference Architecture: Deploying a vision-language model with vLLM on OVHcloud MKS（2026-10-04）](https://blog.ovhcloud.com/en/posts/reference-architecture-deploying-a-vision-language-model-with-vllm-on-ovhcloud-mks-for-high-performance-inference-and-full-observability/)。

### 20.8 Azure Arc：在 On-Prem / Edge Kubernetes 上运行 Ollama 和 vLLM

Microsoft Azure Kubernetes Service Engineering Blog 在 2026 年 4 月展示了通过 AKS enabled by Azure Arc 管理本地或边缘 Kubernetes 集群，并直接部署 Ollama 和 vLLM 的方案。这个案例的意义在于：企业不必把 GPU 节点迁移到 Azure 公有云，也可以通过 Azure Arc 统一管理分布在本地和边缘的 Kubernetes 环境。

文章给出的 Ollama 示例使用 Kubernetes Deployment，将 Pod 通过 Node Selector 放到带 NVIDIA GPU 的节点，并申请 nvidia.com/gpu: 1；通过 Kubernetes Service 暴露推理 API。模型权重可以在 Pod 中拉取，之后通过 HTTP API 调用。该系列还覆盖 Triton / TensorRT-LLM、NVIDIA Dynamo 多节点推理、RDMA 和 GPU 资源管理等相关主题。

**给谁用：** 制造业、零售、能源、分支机构；需要在工厂、实验室、门店或数据中心部署 GPU 推理，同时希望使用统一 Kubernetes 管理面。

**关键经验：** Edge / On-Prem 的网络、存储和升级条件与公有云不同。模型权重不应在每次 Pod 重启时从互联网拉取；应使用企业镜像和模型制品仓库，设计离线更新、缓存和回滚流程。单副本 Ollama 适合验证连接和设备调度，不应直接视为生产级高并发服务。生产环境还要补齐认证、TLS、限流、模型版本管理、GPU 故障检测和多副本路由。

**证据等级：** Microsoft 官方技术教程 / 参考部署，不是具名终端客户案例，也没有给出该示例的生产吞吐数据。

来源：[Microsoft AKS Engineering Blog：AI Inference on AKS enabled by Azure Arc: Generative AI with Open-Source LLM Server（2026-04-07）](https://blog.aks.azure.com/2026/04/07/ai-inference-on-aks-arc-part-3)。

### 20.9 案例横向比较：新增案例揭示了哪些不同的架构模式？

| 案例 | 部署模式 | 工作负载 / 用户 | 核心技术 | 最重要的经验 | 证据等级 |
| --- | --- | --- | --- | --- | --- |
| BC Card | On-Prem OpenShift AI | 金融筛查、RPA、呼叫中心 | vLLM、FP8、SLM Swarm | 多个小模型协作，按任务选择模型 | 具名客户案例 |
| Tesla | 生产环境 Kubernetes GPU Fleet | 数百个模型 / 内部应用 | KServe、llm-d、vLLM、Envoy | 存储、故障恢复和 KV-aware Routing 都是 Day-2 核心 | 客户工程师参与的生产实践 |
| Workato | DigitalOcean Managed GPU / Kubernetes | 企业 Agentic Automation | H200、Dynamo、vLLM、KV Manager | 跨 Worker KV-aware Routing 减少重复 Prefill | 客户联合技术实践 |
| University Hospital Bonn | On-Prem 8×A100 | 放射科医生、医疗文本辅助 | DeepSeek-R1、vLLM、Open WebUI | 网络隔离和任务风险分级比模型参数更重要 | 单中心 Pilot / Preprint |
| Dell + Meta | On-Prem AI Factory 参考栈 | 企业多任务 Chatbot / RAG | vLLM Production Stack、K8s、KV Offload | 把推理、存储、安全和可观测性产品化 | 厂商参考架构 |
| Oracle OCI | 租 GPU + 自管 OKE 工作负载 | RAG / Agent 应用 | A10、vLLM、Qdrant、Terraform | CPU / GPU Node Pool 分离、Private Subnet、IaC | 厂商参考应用 |
| OVHcloud | 租 L40S + Managed K8s | 多模态推理 | Qwen3-VL、vLLM、MKS、DCGM | Managed K8s 不等于 Managed Inference | 厂商参考架构 |
| Azure Arc | On-Prem / Edge Kubernetes | 本地模型推理 | Ollama、vLLM、AKS Arc | 统一管理面和离线模型供应链 | 厂商教程 |

### 20.10 从这些案例再提炼六条工程经验

**1. 金融行业往往需要的是模型平台，不是单一模型 Endpoint。** BC Card 的案例表明，风险筛查、RPA 和呼叫中心并不需要完全相同的模型。企业平台应提供统一身份、模型注册、部署、审计和配额能力，但允许每个任务使用不同模型、精度和 GPU 资源。

**2. 医疗和敏感数据场景需要把网络隔离做成可验证的系统属性。** Bonn 的做法不是简单地把服务部署在内网，而是通过 Network Segmentation、Egress Filtering、Isolation Monitoring 和自动化测试验证没有未授权外联。合规审批和员工使用治理同样属于系统设计的一部分。

**3. Kubernetes StatefulSet 不是完整的 LLM Serving 平台。** Tesla 的实践说明，模型权重存储、节点故障后的 PVC 恢复、Prefix Cache 路由和推理拓扑演进，都需要专门设计。一个可以启动的 Pod 和一个可持续运营的模型平台之间差距很大。

**4. 长上下文 Agent 的优化重点逐渐从单 GPU 性能转向集群级缓存调度。** Workato 使用 Dynamo 跟踪跨 Worker KV 状态，说明请求路由已经成为推理性能的一部分。但这种架构只在存在足够缓存重用时才值得增加复杂度，不能把 KV Manager 当作所有模型服务的默认组件。

**5. Managed Kubernetes 是一个很有价值的中间层。** OCI、OVHcloud 和 DigitalOcean 的实践说明，企业可以把 Kubernetes Control Plane 交给云厂商，而自己控制模型、推理容器、请求策略和业务 API。这样既不是普通托管 API，也不需要承担完整的 K8s Control Plane 运维。

**6. 厂商参考架构要经过客户负载验证才能进入生产设计。** Dell AI Factory、OCI OKE、OVHcloud MKS 和 Azure Arc 提供了部署起点，但没有证明在 1000 名开发者、数百个并发 Agent 或大规模 MoE 模型下的吞吐、故障恢复和成本。必须用目标模型、真实 Trace、目标 SLO 和故障注入测试验证。

对企业 GPU 平台而言，这些新增案例进一步说明：架构选择不是简单比较 vLLM、SGLang 或 TensorRT-LLM 谁更快，而是确定企业需要控制到哪一层。可以由 CSP 托管 Kubernetes，也可以租专属 GPU；可以在 On-Prem 做网络隔离，也可以把大规模推理交给 Dedicated Inference Provider。真正需要企业自己掌握的是模型质量、数据边界、请求策略、容量预测、成本归属和故障责任。

## 结论

企业级 GPU AI Coding 平台不是“买几台 B300、安装 vLLM、开放一个 API”这么简单。真正的工程工作横跨 GPU 硬件、RDMA 网络、Kubernetes、分布式推理、Agent Runtime、安全隔离和生产运维。

对于约 1000 名开发者的目标，合理的推进方式是先建立真实 workload profile，用一台 8-GPU HGX B300 节点验证模型与 Agent Harness，再逐步验证多节点网络和服务容量。只有当模型并行通信确实需要更大的 scale-up 域时，才应把 GB300 NVL72 纳入优先方案。采购规模应由满足 SLO 的 Goodput 和每个成功代码任务成本决定，而不是由注册用户数、GPU 峰值算力或厂商宣传的 Tokens/s 决定。

最终交付物应当是一套可重复部署、可观测、可审计、可升级、可回滚并能持续进行容量与成本管理的企业 AI 平台，而不只是一个模型推理 Endpoint。
