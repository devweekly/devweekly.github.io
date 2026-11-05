---
author: W
featured: false
draft: false
description: 面向 2000 名开发者企业级 AI Coding Workbench 的 GPU 基础设施与推理工程指南，涵盖 AWS 与 Azure GPU 租用、H100/H200/Blackwell、模型路由、Agent Runtime、容量规划、成本估算、安全与 Day-2 运维。
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

本文以至少 2000 名开发者、日常中到重度使用为目标，讨论企业 AI Coding 平台的 Workbench、模型服务与 GPU 基础设施。模型部署在企业自有基础设施，或 AWS EC2 / Azure GPU VM 上，通过统一 API 向 Coding Agent 提供推理服务。平台还需要管理开发者会话、仓库上下文、工具执行、租户隔离、容量、监控、成本和故障恢复。

架构分为两个相互协作的部分：GPU 推理平台负责模型部署、GPU 调度和请求处理；Coding Agent 平台负责会话生命周期、上下文组装、工具调用、代码执行与任务验证。两者通过模型 API 交互，资源管理和安全边界分别设计。

本文主要讨论 NVIDIA B300 / HGX B300，并将 GB300 NVL72 作为机架级方案进行比较。硬件和软件信息以 2026 年 10 月 30 日可查到的公开资料为准。厂商规格不能代替目标模型、量化方式和 Agent Harness 下的实测结果，容量与成本仍需通过实际 workload 验证。

## 1. 先明确部署对象：GPU、服务器节点和机架不是一回事

采购比较不能只看 GPU 数量。单颗 GPU、8-GPU 服务器和 rack-scale 系统在互联范围、网络拓扑、供电、散热、管理方式及租赁计价单位上都有差异，不能直接按卡数折算。

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

GB300 NVL72 的优势主要体现在需要大量 GPU 间通信的超大模型和 MoE Expert Parallelism 场景，更多通信可以留在机架内的 NVLink 域中。若模型本身能放进一台 8-GPU HGX 节点，NVL72 的机架级互联能力未必能转化为更高吞吐或更低成本。是否值得采用，需要用目标模型和请求分布测试。

GB300 NVL72 也不是“72 张 GPU 的普通服务器”。它需要匹配的液冷设施、机架供电、CDU、液冷管路、泄漏检测、机房承重与运维流程。数据中心是否具备这些条件，可能比 GPU 软件部署本身更早成为项目约束。

### 1.3 B300、B200、GB300 怎么选

| 方案 | 适用场景 | 主要优势 | 主要代价/限制 |
| --- | --- | --- | --- |
| HGX B200 | 成本敏感、模型能够适配 8-GPU 节点 | Blackwell 软件生态、显存容量相对 B300 较小 | 单 GPU 显存少于 B300，复杂模型更容易受显存约束 |
| HGX B300 | 大模型推理、长上下文、较高 KV Cache 容量需求 | 288 GB HBM3e/GPU，8-GPU 节点内高速互联 | 节点价格、供电和散热成本较高 |
| GB300 NVL72 | 大型 MoE、跨多 GPU 的高通信推理、超大模型 | 72-GPU NVLink 域，机架级集成 | 高密度液冷和供电要求，采购与部署复杂度高 |
| H200 | 作为上一代成本/可用性基准 | 供应商选择可能较多，适合做价格基线 | 显存和互联能力较新一代平台弱 |

开发者人数不能直接换算成 GPU 数量。容量估算需要先确定模型、上下文长度、请求到达率、并发和 Agent 工作流，再比较 HGX B300 节点集群与 GB300 NVL72。可以先租用一个 8-GPU 节点完成 POC，测出目标负载下的吞吐、延迟、显存占用和单位任务成本，再决定采购或扩容。

## 2. GPU 基础设施工程：硬件清单之外还要设计什么

GPU 服务器到货后，还需要完成网络、存储、管理和机房设施的集成，才能承载推理工作负载。

### 2.1 计算节点

选 GPU 节点时，最容易被报价单掩盖的是主机平台和 GPU 之间的关系。两台都标着“8×B300”的服务器，可能采用不同的 CPU、NUMA 和 PCIe 拓扑；NIC 如果挂在不合适的 PCIe Root Complex 下，GPU Direct RDMA 的实际路径就可能与设计预期不同。模型权重加载也会受本地 NVMe 吞吐和盘位影响。

采购阶段应把完整 BOM、GPU/NIC/NVMe 拓扑图和固件兼容矩阵作为交付物。TPM、Secure Boot、BMC 管理、电源冗余和冷却方式也要写进验收条件。尤其要确认 OEM 提供的是多少个真正可用的高速网络端口、是否包含 DPU，以及标称功耗是否对应持续运行而非短时峰值。

### 2.2 网络必须按用途分平面

GPU 集群的网络最好按流量路径分开设计。GPU Compute Fabric 承担节点间集合通信和模型并行流量，通常采用 InfiniBand 或经过完整调优的 RoCE；Storage Fabric 负责模型权重加载和数据访问；Management / OOB 网络则用于 BMC、交换机管理、节点 provisioning 和故障诊断。把这几类流量混在普通业务网络里，故障时很难隔离问题，存储突发流量也可能干扰 GPU 间通信。

RoCE 的难点不在网卡是否支持，而在端到端拥塞控制是否一致。PFC、ECN、交换机缓冲和队列配置需要结合实际拓扑验证；InfiniBand 则要持续监控 Subnet Manager、Fabric Health、端口状态和路由。Leaf-Spine 的 oversubscription、双平面或 rail-optimized 设计，以及 RDMA 是否经过不支持的中间设备，都应通过 NCCL 单节点、多节点和故障链路测试来确认。多租户环境还要明确带宽配额，避免一个大规模任务挤占其他在线请求。

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

机房评估要从整机和机架的持续负载出发，核对 UPS、PDU、母线和配电余量，而不是把 GPU TDP 相加后就当成最终功耗。HGX B300 与 GB300 NVL72 的差异尤其明显：后者需要核算 CDU 和泵的冗余、供回水温度与流量，还要安排冷却液过滤、泄漏检测和应急隔离。机柜承重、布线空间、消防、环境监控和现场维护通道也会影响能否按计划交付。

采购前应要求 OEM 提供整机功耗范围和机架设施设计，再由数据中心团队确认供电与散热余量。还要演练断电或冷却故障时的安全停机过程；如果设施团队无法承接液冷系统的日常维护，NVL72 即使算力合适，也不应直接进入采购。

## 3. 分布式 GPU 软件栈

GPU Driver、CUDA、Container Toolkit、NCCL、OFED、GPU Operator、推理引擎和模型依赖之间存在版本约束。应把经过验证的组合固化为部署基线，升级时按兼容矩阵测试，而不是直接追随各组件最新版。

### 3.1 主机操作系统与驱动

主机基线通常由 Linux 发行版和 Kernel、NVIDIA Data Center Driver、CUDA Runtime、Container Toolkit、containerd，以及网络侧的 OFED / RDMA Core 和 NIC 固件共同决定。Fabric Manager 是否需要安装，要按具体 GPU 平台确认。CUDA Toolkit 是开发和编译工具集，Runtime 是应用运行时依赖；容器可以封装用户态库，却不能替代宿主机驱动。

这些组件存在兼容关系，升级不能各自追最新版。生产环境应把 BIOS、BMC、GPU 驱动、CUDA、NCCL、OFED 和交换机软件纳入同一份经过验证的版本基线，并明确升级顺序与回滚方式。

### 3.2 Kubernetes 与 GPU Operator

Kubernetes 可以管理 GPU 工作负载，但默认调度器只知道资源请求和节点状态。它不会自动理解某个模型的 Tensor Parallel Group 是否必须落在同一个 NVLink 域，也不会天然知道跨节点通信拓扑的性能代价。

NVIDIA GPU Operator 将 GPU 节点的软件栈 Kubernetes 化。官方文档列出的典型组件包括 NVIDIA Driver、Container Toolkit、Device Plugin、DCGM Exporter 和 MIG Manager。实际启用哪些组件，应根据操作系统、驱动管理方式、集群策略和 GPU 型号决定。

落到 Kubernetes 后，工程重点是让调度器知道节点差异，并避免 GPU 任务被拆到不合适的资源域。Node Labels、Taints 和 Affinity 用于区分 GPU 型号及用途；Device Plugin 暴露可分配资源，GPU Operator 管理驱动、Container Toolkit、DCGM Exporter 等节点组件。对于需要多卡协同的模型，还要验证拓扑感知调度和 gang scheduling 是否能保证一组 Pod 同时获得所需资源。

生产集群通常把 GPU 节点池与 CPU 节点池分开。Gateway、Router、Agent Runtime、数据库和队列没有必要占用昂贵的 GPU 节点。节点 drain、驱动升级和故障隔离也应先在小规模节点池演练，再扩大到在线推理池；多租户配额则要与实际 GPU 隔离能力匹配，不能只依赖 Kubernetes 的资源声明。

MIG、GPU sharing、time-slicing 和 DRA 不能混为一谈。它们的硬件支持范围、隔离强度和调度语义不同。是否可用于 B300、是否满足目标模型和安全要求，必须以对应版本的官方支持矩阵与实际测试为准。不要因为 Kubernetes 能声明共享 GPU，就把它当成硬件级安全隔离。

### 3.3 NCCL 与分布式通信

NCCL 把多 GPU 的集合通信封装成 AllReduce、AllGather、ReduceScatter 等操作，底层可能根据拓扑选择 Ring、Tree 或 NVLS 等算法。平台工程师不必手工实现这些算法，但必须能判断通信究竟发生在单节点 NVLink/NVSwitch 内，还是跨节点 RDMA 网络上。两种路径的带宽、延迟和故障点完全不同，GPU Direct RDMA 也只有在 GPU、NIC、驱动和网络路径都满足条件时才会生效。

节点验收应从单 GPU CUDA 计算开始，再检查 8-GPU P2P、单节点 NCCL 和跨节点 NCCL。随后验证 GPU 与 NIC 的拓扑亲和性，并在节点重启、NIC 失效或交换机端口故障时重复测试。单次 nvidia-smi 只能说明设备被识别，不能证明通信链路可用于生产。

## 4. 大模型推理工程：从模型文件到稳定 API

AI Coding 的交互体验和运行成本很大程度上取决于推理服务。模型结构影响并行方式，精度影响显存和输出质量，KV Cache 与请求调度则决定长上下文场景下能承载多少并发。

### 4.1 Transformer、Dense 与 MoE

平台工程师不需要训练 Transformer，但需要知道模型结构会怎样改变推理资源需求。Attention 的实现可能采用 MHA、GQA 或 MLA；模型也可能是每层都参与计算的 Dense 结构，或由 Router 将 Token 分配给部分 Expert 的 MoE。Tokenizer 和模型配置决定输入如何转换为 Token，Prefill 阶段处理输入上下文，Decode 阶段逐步生成结果，两阶段对算力和显存的压力并不相同。

MoE 经常被误解为“激活参数少，所以 GPU 要求低”。它减少了每个 Token 实际参与计算的 Expert 数量，却引入 Token Dispatch / Combine 通信。Expert 分布在不同 GPU 时，路由流量可能成为瓶颈。因此，模型总参数量和激活参数量都不足以单独决定节点数量，还要结合 Expert 布局、并行策略和互联拓扑测试。

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

KV Cache 的大小取决于模型层数、注意力结构、KV Head 数、数据精度和当前活跃序列长度。PagedAttention 一类机制把缓存拆成可管理的 Block，减少连续显存分配带来的浪费；Prefix Cache 则尝试复用系统提示、工具定义等重复前缀。对于 Coding Agent，缓存策略需要和上下文组装方式一起设计，因为仓库文件、终端输出和历史工具结果会让每个 Session 的上下文迅速增长。

缓存并非越多越好。系统需要在命中率、Block 回收、显存碎片和租户隔离之间取舍。Prefix Cache 的命中还受到 Tokenization、模型版本、LoRA 和缓存配置影响；不同租户是否共享缓存必须经过威胁建模。长上下文压测应观察 TTFT、TPOT 和并发随上下文长度变化的曲线，而不是只测短 Prompt 下的峰值吞吐。

### 4.5 Prefill / Decode 与请求调度

Prefill 处理输入 Token，决定模型读取长上下文的计算量，通常影响 Time To First Token（TTFT）；Decode 逐 Token 生成输出，常受到显存带宽、KV Cache 访问和批处理调度影响，进而影响 Time Per Output Token（TPOT 或 ITL）。

推理引擎会持续把新请求加入正在运行的 Batch，这就是 Continuous Batching 一类调度机制的价值。长 Prompt 可以通过 Chunked Prefill 分段处理，减少它长时间占用调度窗口；Prefix Cache 能复用重复上下文，但缓存命中不能以跨租户泄露为代价。请求队列还需要限制最大并发和序列长度，否则少量超长上下文任务就可能挤压交互请求。

对 Coding 平台，调度策略应区分 IDE 中等待反馈的交互请求和可以延后执行的后台任务。后台代码扫描、批量迁移或评测任务应有独立队列、配额和取消机制；用户关闭 Session 后，Runtime 需要能取消尚未完成的模型请求。超时与重试也必须有明确语义，避免客户端断连后服务端仍持续消耗 GPU。Prefill/Decode Disaggregation 可以将两个阶段放到不同 GPU 池，但只有在测量发现资源需求明显冲突、且跨池 KV 传输成本可接受时才值得引入。

## 5. 推理框架和服务层

推理框架应根据目标模型和服务要求选择。先确认模型架构、权重格式、量化方式、并行策略、上下文长度、API 兼容性和 SLO，再验证 vLLM、SGLang 或 TensorRT-LLM 的具体版本是否支持。

| 框架 | 主要定位 | 评估重点 |
| --- | --- | --- |
| vLLM | 通用 LLM serving，OpenAI-compatible API 和批处理能力 | 目标模型、Blackwell Kernel、FP8/FP4、MoE、KV Cache 和多节点支持 |
| SGLang | 高性能结构化生成与 LLM serving | 目标模型实现、Radix/Prefix Cache、调度、MoE 和工具调用 |
| TensorRT-LLM | NVIDIA 推理优化技术栈 | Blackwell 支持矩阵、构建流程、量化、MoE、部署复杂度和升级成本 |

截至本文日期，NVIDIA GPU Operator 官方文档显示当前 patch release 为 v26.7.2；但这不代表所有 B300 OEM 服务器、操作系统、驱动和推理框架组合都已经过生产验证。vLLM、SGLang 和 TensorRT-LLM 的能力应按具体 release、模型实现和部署配置逐项确认。

建议采用一个主推理引擎和一个候选引擎，不要一开始同时运营三套生产系统。可以让 vLLM 作为首个基线，再用同样模型和请求 Trace 对比 SGLang；若 NVIDIA 优化路径带来明确收益，再评估 TensorRT-LLM。不同框架之间的性能数字只有在模型、精度、上下文、并发、硬件和 SLO 相同的情况下才有比较价值。

### 5.1 推理服务 API

统一 API 的工作不止是把请求转发到模型。Coding Agent 可能依赖 Chat Completions，也可能使用 Responses 一类接口；流式事件、Tool Calling、JSON Schema 输出、取消请求和错误语义都要与客户端约定一致。服务端还要返回可追踪的 Request ID、Trace ID、模型版本和 Token Usage，才能把一次 Agent 任务的模型成本与后续工具执行关联起来。

“兼容 OpenAI API”只能作为初筛条件。不同 Harness 对并行工具调用、流式事件顺序、finish_reason、usage 统计和上下文窗口的处理并不完全相同。应直接拿 Claude Code、OpenCode、Copilot SDK 或企业实际使用的客户端跑协议回归测试，确认取消、重试和客户端断连时不会留下持续运行的推理请求。

### 5.2 Model Router

Router 需要同时看任务和服务状态。一个小范围代码解释可能适合低成本模型；跨模块重构则要看模型在真实仓库任务上的成功率，而不只是公开榜单。上下文长度决定模型是否能接收完整输入，GPU Pool 的队列和缓存状态影响等待时间，用户与项目配额则限制资源消耗。SLO、任务截止时间和数据分类也会改变可选模型范围。

路由策略应作为版本化配置发布，先用 Shadow Traffic 观察决策，再对少量流量 Canary。发生模型故障或容量不足时，可以切换到经过验证的候选模型，但降级不能绕过数据驻留、模型 Allowlist 或预算规则。模型本身不能获得修改这些策略的权限。

## 6. 国产 GPU / AI 加速器：推理部署与开发工程

在中国境内部署时，国产 GPU 和 AI 加速器也应纳入候选范围。市场上的产品包括通用 GPU，以及 NPU、MLU、GCU 等不同架构的加速器，软件栈和编程模型并不统一。选型需要核对目标模型的支持情况、算子覆盖、集合通信、框架适配和运维工具，峰值算力只能作为其中一项指标。

以下比较依据截至 2026 年 10 月 31 日公开的产品资料、项目代码和部署文档。厂商公布的 Day-0 适配、单卡演示或峰值性能，不能证明其它模型变体、量化格式、长上下文和多节点负载也已通过验证。评估时需要落实到芯片型号、驱动、SDK、框架分支和具体版本。

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


### 6.3 DeepSeek 在国产加速器上的部署：把“支持”拆成可验证的兼容矩阵

DeepSeek 是检验国产加速器软件栈成熟度的有效负载，但“支持 DeepSeek”不是足够精确的结论。V3 / R1、V3.2、V4-Flash、V4.1-Flash 的模型结构、权重格式和优化路径不同；同一芯片也可能只支持特定量化格式、推理框架分支和软件版本。

| 平台 / 路径 | 公开适配重点 | 工程边界 |
| --- | --- | --- |
| **昇腾 + vLLM Ascend** | V4-Flash、V4.1-Flash 的 W8A8、BF16 或混合精度方案；部分版本支持 MTP、TurboQuant KV Cache 和 Prefill / Decode 分离 | 不同芯片型号的支持矩阵不同；V4-Pro 等未稳定覆盖的组合仍需按实验性能力处理 |
| **昇腾 + CANN Recipes** | DeepSeek-V3.2 / V4 系列的模型专项部署、Attention-FFN 分离、投机解码和在线 P/D 分离样例 | 配方库是持续更新的工程样例，不代表所有芯片和版本均已完成生产验证 |
| **昇腾 + KTransformers** | 将 Attention、Dense 层和常驻专家放在 NPU，将部分 MoE 专家卸载到 CPU / 主机内存 | 能降低 NPU HBM 要求，但性能受 CPU、NUMA、内存带宽和数据搬运影响；不能以模型启动成功代替端到端延迟验收 |
| **寒武纪 + vLLM-MLU** | 独立 vLLM 插件仓库公开列出 DeepSeek-V4 Day-0 适配 | 需绑定 MLU 型号、SDK、容器和上游 vLLM 版本；Day-0 支持不代表所有量化、并行和长上下文配置都可用 |
| **其他国产加速器** | 各厂商持续发布模型适配和推理框架后端 | 对具体模型变体、量化、算子覆盖、多卡通信和多节点部署，需取得可复现的版本与测试证据 |

建议把适配状态记录为一组可测试的维度，而不是简单写成“支持”：

- **硬件与系统：** 芯片型号、卡数、固件、驱动、主机 CPU / 内存和 NUMA 拓扑。
- **模型制品：** 模型变体、权重格式、Tokenizer、量化方法、校验和。
- **软件栈：** Runtime / SDK、PyTorch、推理引擎、插件分支、容器 Digest。
- **功能：** 最大上下文、Tool Calling、Streaming、Prefix Cache、Speculative Decoding、TP / EP、P/D 分离。
- **性能与质量：** TTFT、TPOT、并发、吞吐、显存、输出正确性和任务成功率。
- **运维：** 节点重启、进程故障、权重加载、监控、升级与回滚。
参考入口：[vLLM Ascend](https://docs.vllm.ai/projects/ascend/en/latest/)、[CANN Recipes](https://github.com/hicann/cann-recipes-infer)、[KTransformers](https://github.com/kvcache-ai/ktransformers)、[Cambricon/vllm-mlu](https://github.com/Cambricon/vllm-mlu)。生产评估应固定 Git Commit、镜像 Digest 和模型校验和；不要把预发布教程、可变镜像 Tag 或单卡演示当作生产兼容承诺。

### 6.4 其他国产平台：关注厂商后端和版本绑定

国产平台逐步采用 PyTorch、vLLM 等开发者熟悉的接口，但接口相似不代表底层实现相同。寒武纪通过 vLLM-MLU 接入推理服务；摩尔线程维护 vLLM-MUSA 和 SGLang-MUSA；沐曦的 MXMACA 需要与适配版 PyTorch、Triton、FlashAttention 和推理框架配套使用。壁仞、燧原和海光也分别维护 BIRENSUPA / TorchSUPA、TopsRider / vLLM-GCU、DTK 等软件栈。

这些平台的共同难点是版本绑定。模型 Day-0 适配只说明某个模型在指定芯片和软件版本上完成了特定验证，不代表所有量化格式、Tool Calling、多卡通信或长上下文能力都已可用。企业应把硬件型号、驱动、运行时、算子库、PyTorch、推理框架和模型版本作为一个组合进行验收，并同时跟踪上游框架与厂商后端的升级节奏。

vLLM 的 platform 抽象和 out-of-tree plugin 机制降低了接入成本，但功能最终仍取决于厂商后端实现。不能因为上游 API 存在某项能力，就推断所有设备后端都已支持。

### 6.5 CUDA 迁移涉及的运行时、算子与通信适配

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

![异构 GPU 后端统一入口与隔离部署池](/diagrams/enterprise-gpu-ai-coding-platform/01-heterogeneous-backends.svg)

[查看完整 HTML 图表](/diagrams/enterprise-gpu-ai-coding-platform/01-heterogeneous-backends.html)

异构部署的统一边界应放在 API 和平台控制面，不应强行统一各厂商的底层 Runtime。AI Gateway 对上提供一致的 API、Streaming、模型别名和错误协议；对下则允许每个 GPU Pool 使用经过验证的驱动、镜像和推理引擎。Model Registry 除了模型名称，还要记录芯片型号、框架版本、量化格式、上下文上限、Tool Calling、结构化输出和并行能力，Router 才能判断某个请求是否真的能在目标后端运行。

镜像应按硬件软件栈分别构建，保持不可变，并由统一 CI 完成扫描和发布。Kubernetes 可以统一 Namespace、Quota、NetworkPolicy 和发布流程，但节点标签、Device Plugin、RuntimeClass、拓扑调度及监控适配仍需按厂商实现。Agent Runtime 只调用 AI Gateway，不直接依赖 CUDA、CANN 或厂商 SDK；更换 GPU Pool 时，Session 生命周期和工具安全边界不应受到影响。

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

昇腾应优先验证服务器、CANN、PyTorch、vLLM Ascend / MindIE 的完整组合，重点观察软件版本治理、目标模型的多卡能力和厂商交付支持。摩尔线程、沐曦和壁仞可以作为通用 GPU 路线重点比较，评估 PyTorch / vLLM / SGLang 适配、CUDA 迁移成本、自定义 Kernel 和集群互联。寒武纪、燧原与海光 DCU 则应结合具体加速器定位核实模型覆盖和框架适配，不要只凭设备 API 名称判断其与通用 GPU 的可替换程度。

如果国产算力与 NVIDIA 并存，平台仍可统一 API Gateway、模型注册、配额、日志和评测体系，再按模型能力、数据驻留、成本和 SLO 路由。最终比较对象应是 Cost per Successful Coding Task：模型质量、框架适配人力、算子开发、节点利用率、故障恢复、软件升级和供应商支持都要计入 TCO。

### 6.9 国产 GPU 学习路线：把 CUDA 知识迁移过来，但不要照搬 CUDA 代码

如果已经学过前面 NVIDIA GPU、CUDA、PyTorch、NCCL 和推理框架的内容，学习国产 GPU 不需要从“什么是 GPU”重新开始。更有效的方式是保留已经掌握的并行计算、内存层次、Kernel、算子、分布式通信和推理系统知识，再逐层学习目标厂商的软件栈与硬件执行模型。

但要先明确一个边界：**CUDA 知识可以迁移，CUDA 二进制、CUDA 专有 API、NVIDIA 的硬件假设和性能经验不能直接迁移。** 不同国产加速器之间也不是一个统一的国产 CUDA。昇腾、摩尔线程、寒武纪、沐曦、壁仞、燧原和海光有各自的设备模型、编译器、Runtime、算子库、通信库和版本配套关系。


国产加速器的学习不宜从逐个重写 CUDA Kernel 开始。先掌握 PyTorch 设备后端、Runtime / SDK、推理框架适配和算子覆盖，再研究集合通信、性能分析与自定义算子。企业工程师还需要理解容器部署、设备插件、版本兼容矩阵和多节点故障定位。学习路线应围绕目标芯片和目标模型展开，不必为所有平台建立同等深度的知识储备。

## 7. Coding Agent 平台：会话执行与推理服务的职责边界

平台容量应按活跃 Agent Session 和任务执行轨迹估算，不能用注册用户数或登录人数代替并发负载。一个任务可能触发多轮模型调用、仓库检索、文件读写、终端命令、测试和重试。Token 消耗之外，还要统计 Sandbox 的 CPU、内存、磁盘和网络使用量。

### 7.1 Agent Runtime 的职责

Agent Runtime 管理一次 Coding 任务从创建到交付的完整过程：它保存 Session 和 Task 状态，组装 Prompt 与仓库上下文，调用模型，并把模型返回的工具请求交给文件、终端、测试或 Git 工具执行。工具结果再回到对话循环，直到任务完成、失败、取消或需要人工批准。超时、重试、检查点和审计记录也属于 Runtime 的职责，因为这些状态决定任务能否恢复以及出了问题能否追查。

GPU 驱动、NCCL 和模型进程由独立的推理平台管理。Runtime 通过 AI Gateway 调用模型 API，双方分别发布和扩缩容。这样 GPU 节点维护不会直接影响 Session 状态，Agent Harness 的升级也不需要重启模型集群。

### 7.2 Agent Sandbox 与凭证隔离

Coding Agent 可以读写代码、运行 shell、安装依赖、访问网络和调用 MCP 工具，因此它的风险远高于只读聊天机器人。Sandbox 应按任务隔离：每个 Workspace 使用非 root 身份运行，限制 CPU、内存、磁盘和进程数；根文件系统尽量只读，网络出口默认关闭，只对构建依赖或企业内部服务开放必要域名。这样即使模型生成了危险命令，影响范围也被限制在当前任务的执行环境内。

凭证不应进入模型上下文。云凭证、生产 Secret 和长期 API Key 由受控服务端管理，MCP Server 在完成授权后注入短期凭证。工具调用要经过权限检查并留下审计记录；删除分支、发布制品、访问生产环境等敏感动作应要求人工批准。任务结束后按保留策略销毁 Workspace，确需保留时也要明确访问权限和期限。

2026 年 10 月 21 日，NVIDIA 发布的 OpenShell Reference Architecture 描述了 Gateway、Supervisor、Sandbox 和 Policy Prover 等边界，并讨论 BlueField-4 / NVIDIA Sentry 的硬件辅助治理方向。它可以作为设计参考，但仍需通过威胁建模、容器逃逸测试、网络隔离测试和运维演练验证适用性。

### 7.3 Agent 与 GPU 服务的边界

![Agent Runtime 与 GPU 推理服务的边界](/diagrams/enterprise-gpu-ai-coding-platform/02-agent-inference-boundary.svg)

[查看完整 HTML 图表](/diagrams/enterprise-gpu-ai-coding-platform/02-agent-inference-boundary.html)

这张图是逻辑架构，不代表每个方框都必须部署成独立微服务。初期可以将 Router 和 Gateway 合并为一个可独立扩展的服务，但 Agent Runtime、GPU 推理进程和不可信代码执行环境应保持明确的安全边界。

## 8. 2000 名开发者的容量规划

2000 名开发者只说明潜在用户规模，不能直接推导 GPU 数量。容量规划要从真实使用行为开始：日活人数决定有多少人实际使用平台，同时运行的 Agent Session 决定任务池规模，而在途模型请求才直接形成推理并发。一个 Session 会在模型调用、工具执行和等待用户确认之间切换，因此它通常不会持续占用一条 GPU 推理请求。

压测前应从现有 Coding 工具或试点环境采集请求到达速率、输入输出 Token 分布、上下文长度、任务持续时间和工具调用/重试分布。尤其要保留长尾数据：少数开发者可能同时启动多个 Agent，少数任务也可能因为大仓库上下文和多轮修复持续很久。用平均值计算会低估这些峰值；直接按注册人数计算则会严重高估常态负载。

### 8.1 先建立负载模型

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

### 8.2 容量计算的基本方法

对单个模型部署副本，先测出在目标 SLO 下的有效吞吐 Goodput，而不是峰值吞吐。设 D 为目标输入/输出 Token 需求率，G 为单个副本在满足 SLO 时的实测有效吞吐，R 为故障、突发和升级预留比例。副本数量可以先按下面的关系估算：

`replicas = ceil((D / G) * (1 + R))`

D 和 G 必须按输入/输出阶段、模型、上下文长度和负载分布拆分。不同模型、精度和并行策略的吞吐不能直接相加；若有多个模型池，应分别计算后再汇总。

容量还要满足显存约束：

`M_weights + M_KV + M_runtime + M_workspace + M_reserve <= M_available`

模型权重能装进 GPU，不代表能够满足目标并发。长上下文和高并发通常首先消耗 KV Cache。要通过真实引擎测量，而不是只按参数量乘以每参数字节数估算。

### 8.3 Benchmark 应测什么

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

Coding Agent 的评测不能止于推理服务指标。还要统计任务成功率、人工介入率、测试通过和回归情况、Tool Call 成功率、无效参数比例、每个成功任务消耗的 Token，以及从任务创建到完成的时间。高 Token Throughput 不等于高业务产出：如果模型生成更快，却需要更多人工修复，单位成功任务成本反而会上升。

### 8.4 POC 压测矩阵

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

只监控 GPU Utilization 无法解释开发者为什么觉得慢，只看 API 延迟也无法定位问题是在队列、Prefill、Decode、网络还是工具执行。可观测性需要把三个层次关联起来：基础设施侧记录 GPU 温度、功耗、HBM、XID、ECC、NVLink、PCIe、NIC、RDMA 和磁盘状态；推理侧记录 Queue Time、TTFT、TPOT、Batch Size、KV Cache、OOM 和请求错误；Agent 侧则跟踪 Session、Task、模型调用、Tool Call、Workspace、测试结果、人工介入和任务成本。

实现上，DCGM / DCGM Exporter 提供 GPU 指标，Prometheus 和 Grafana 负责采集与展示，OpenTelemetry 用于关联 Trace、Metric 和 Log。日志系统可以采用 Loki、Elasticsearch 或现有企业平台；调用量和成本分析则可落到 ClickHouse 等分析型存储，具体选择取决于数据量和现有技术栈。

每个 Agent Task 应有稳定的 Trace ID，每次模型请求、工具调用和测试执行都成为可关联的 Span。日志中记录模型版本、量化、推理节点、Token 用量、队列等待、延迟、错误类型和成本。Prompt 与代码内容是否落日志，需要根据数据分类、隐私和保留政策单独决定，默认避免记录敏感源代码和 Secret 明文。

## 10. 安全与治理：模型 API 不是唯一的攻击面

企业 AI Coding 服务至少涉及四类安全边界：

1. 开发者身份和企业授权；
2. 模型请求、上下文和数据保护；
3. Agent 工具、MCP 和代码执行；
4. GPU 集群、模型制品和基础设施管理。

### 10.1 身份与访问控制

身份层应接入企业 SSO / OIDC，并把授权范围落实到用户、团队、项目和运行环境。模型 Allowlist 决定哪些模型可以处理哪些数据；API Key 应短期化、可撤销且遵循最小权限。预算也不能只设在组织级，团队、用户和 Session 都需要可追踪的额度，避免一个后台任务消耗掉整个部门的资源。管理员操作、模型发布和策略变更应进入审计记录。

### 10.2 数据保护

代码仓库、Prompt、模型输入输出和工具结果都应按企业数据分类管理。每个模型路由目标都要明确数据是否离开企业网络、是否进入第三方模型服务或遥测系统；日志则需要定义采样范围、保留期限和可访问角色。Secret、Token、证书和个人数据应在进入模型或日志前检测并按策略脱敏。

模型权重、Tokenizer、容器镜像和依赖包也属于供应链输入，需要校验来源和版本。Agent Workspace 与模型服务之间应有明确网络边界；跨租户 Prefix Cache 或共享文件系统则必须单独进行威胁建模，不能因为共享能降低成本就默认允许。

### 10.3 Agent 工具安全

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

GPU 租赁成本只是平台总成本的一部分。成本模型还要覆盖网络、存储、机房设施、软件、工程人力、支持合同和故障预留。对企业 Coding 平台，单纯比较 GPU 小时价格没有意义；真正应该比较的是目标 SLO 下的有效吞吐，以及每个成功代码任务的全成本。

成本核算可用两个简单表达式统一口径：

`TCO = GPU + Network + Storage + Facility + Software + People + Support + FailureReserve`

`CostPerSuccessfulTask = (GPU + Infrastructure + Platform + Operations + FailedAttempts) / SuccessfulTasks`

采购询价时，先确认供应商卖的是什么资源单位：单卡、8-GPU 节点，还是完整 NVL72 机架。随后核实节点能否同时交付、GPU 是否处于同一 NVLink 域、NIC 和交换机是否独占、RDMA 与 oversubscription 如何配置。网络带宽保障、模型缓存和存储费用也要写进报价边界，避免低估实际账单。

合同还应明确 DCGM、NCCL 和硬件健康数据是否可见，故障更换时限、维护窗口、预留容量和扩容提前期如何约定。数据驻留、日志、远程运维和人员访问方式不能留到上线前再谈。价格需要说明是否包含软件、技术支持、税费和跨区域流量。长期合同前先做短期 POC，并根据真实工作负载计算 break-even utilization；没有 Goodput 数据，不应把公开 GPU 小时单价直接换算成年预算。

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


## 16. 工程能力准备

GPU Coding 平台需要的能力横跨数据中心、Linux / CUDA、Kubernetes、推理引擎、Agent Runtime、安全和 SRE。团队不需要每个人掌握全部技术，但必须明确 GPU 节点、网络、Serving、模型质量、Agent 工具和安全责任的归属。实施路线应优先围绕目标负载补齐能力，而不是把工具清单当作培训大纲。


## 17. 官方资料与工程入口

资料应按目标硬件和部署版本查阅，尤其不要把 latest 文档中的能力直接视为当前生产环境已验证能力。

- **硬件与集群：** [HGX B300 AI Factory](https://docs.nvidia.com/enterprise-reference-architectures/hgx-ai-factory/latest/overview.html)、[NVL72 AI Factory](https://docs.nvidia.com/enterprise-reference-architectures/nvl72-ai-factory/latest/overview.html)、[NVIDIA GPU Operator](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/)、[NCCL](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/overview.html)。
- **国产加速器：** [昇腾开发者中心](https://www.hiascend.com/developer/)、[CANN 文档](https://www.hiascend.com/cann/document)、[寒武纪 vLLM-MLU](https://github.com/Cambricon/vllm-mlu)、[摩尔线程文档](https://docs.mthreads.com/)、[沐曦开发者中心](https://developer.metax-tech.com/)。
- **推理与 Serving：** [vLLM](https://docs.vllm.ai/)、[SGLang](https://docs.sglang.ai/)、[TensorRT-LLM](https://nvidia.github.io/TensorRT-LLM/)。
- **Agent 与治理：** [NVIDIA OpenShell](https://github.com/NVIDIA/OpenShell)、[Kubernetes](https://kubernetes.io/docs/home/)、[OpenTelemetry](https://opentelemetry.io/docs/)。


## 18. DeepSeek、Kimi、GLM 的关键开源项目

模型厂商发布的代码并不都属于同一层。模型权重决定运行什么，推理引擎决定如何执行，Kernel / 通信库优化局部计算路径，KV Cache 与调度组件影响集群吞吐，Agent Harness 则负责会话和工具执行。选型时应先确认职责边界，避免把多个项目误认为可互相替代的 Serving 平台。

### 18.1 模型厂商项目：关注能否补足通用推理引擎

| 项目 | 所属层次 | 主要价值 | 对 B300 平台的评估重点 |
| --- | --- | --- | --- |
| [DeepInfer](https://github.com/deepseek-ai/DeepInfer) | 专用推理执行 | 面向 DeepSeek 模型的执行、调度、并行和优化 Kernel | 与 vLLM / SGLang 的集成边界、在线 API、KV Cache 和多副本运营是否需要自行补齐 |
| [DeepEP](https://github.com/deepseek-ai/DeepEP) | MoE 通信 | Expert Parallelism 的 Dispatch / Combine 通信 | 单节点 NVLink 与跨节点 RDMA 的通信效率、热点 Expert 和负载均衡 |
| [DeepGEMM](https://github.com/deepseek-ai/DeepGEMM)、[FlashMLA](https://github.com/deepseek-ai/FlashMLA)、[DeepJIT](https://github.com/deepseek-ai/DeepJIT) | GPU Kernel | GEMM、MLA 等模型关键算子优化 | 是否已被目标推理引擎集成，避免重复维护自定义 Kernel |
| [Mooncake](https://github.com/kvcache-ai/Mooncake) | KV Cache / 数据传输 | 分布式 KV Cache、Transfer Engine、Prefill / Decode 分离 | 长上下文和多轮 Agent 是否有足够缓存复用收益，RDMA 与存储开销是否可接受 |
| MoonEP | MoE 负载均衡 | 通过冗余 Expert 等机制改善 Rank 间负载分布 | 与 DeepEP 的通信原语定位不同，应比较端到端延迟和显存成本 |
| DeepSeek Harness | Coding Agent | Agent 会话、工具和任务执行的架构参考 | 与企业现有 Agent Runtime 的差异；不要与模型推理执行层混为一谈 |
| [GLM 模型与工具](https://github.com/zai-org/GLM-5) | 模型 / Agent 能力 | 模型权重、部署说明、工具调用和 Agent Skills | 验证目标 Serving Runtime 的模型实现、Parser、量化和工具调用兼容性 |

DeepInfer 不等于完整在线推理平台；DeepEP 也不是 Model Server。企业仍需提供统一 API、身份认证、配额、路由、审计、缓存、监控和故障恢复。Mooncake 将 KV Cache 视为可跨实例管理的资源，只有在多轮请求、共享前缀和跨实例复用带来可测量收益时，才值得引入额外的数据传输与调度复杂度。

## 19. GPU 推理生态中的通用开源组件

![开源项目在企业 GPU 推理栈中的位置](/diagrams/enterprise-gpu-ai-coding-platform/03-open-source-stack-mapping.svg)

[查看完整 HTML 图表](/diagrams/enterprise-gpu-ai-coding-platform/03-open-source-stack-mapping.html)

| 类别 | 代表项目 | 主要职责 | 适用判断 |
| --- | --- | --- | --- |
| 推理引擎 | [vLLM](https://github.com/vllm-project/vllm)、[SGLang](https://github.com/sgl-project/sglang)、[TensorRT-LLM](https://github.com/NVIDIA/TensorRT-LLM) | 模型执行、Batching、KV Cache、并行和 API | 先以目标模型和 GPU 上的实测结果选主运行时，不要无理由同时维护多个引擎 |
| 分布式 Serving | [NVIDIA Dynamo](https://github.com/ai-dynamo/dynamo)、[llm-d](https://github.com/llm-d/llm-d)、[AIBrix](https://github.com/vllm-project/aibrix) | 推理调度、路由、扩缩容、KV 感知和集群运营 | Dynamo 偏推理数据路径与分布式运行时；llm-d 偏 Kubernetes 原生推理编排；AIBrix 偏 LLM 应用基础设施 |
| KV Cache | [Mooncake](https://github.com/kvcache-ai/Mooncake)、[LMCache](https://github.com/LMCache/LMCache)、[NIXL](https://github.com/ai-dynamo/nixl) | KV Cache 复用、Offload 和跨节点传输 | 先量化缓存命中率、传输开销和 GPU 显存压力，再决定是否需要独立缓存层 |
| Kernel / 算子 | [FlashInfer](https://github.com/flashinfer-ai/flashinfer)、[FlashAttention](https://github.com/Dao-AILab/flash-attention)、[Triton](https://github.com/triton-lang/triton) | Attention、GEMM、Sampling 和 GPU Kernel 编程 | 优先使用推理引擎已集成的实现；只有 Profile 证明瓶颈且收益明确时才自定义 |
| 量化 | [NVIDIA Model Optimizer](https://github.com/NVIDIA/Model-Optimizer)、[llm-compressor](https://github.com/vllm-project/llm-compressor)、[bitsandbytes](https://github.com/bitsandbytes-foundation/bitsandbytes) | FP8 / FP4、权重量化与模型压缩 | 同时评估任务质量、显存、吞吐和目标 Runtime 的格式支持 |
| 运维与测试 | [GPU Operator](https://github.com/NVIDIA/gpu-operator)、[DCGM](https://github.com/NVIDIA/DCGM)、[Prometheus](https://github.com/prometheus/prometheus)、[Grafana](https://github.com/grafana/grafana) | GPU 节点管理、健康监控和指标可视化 | 纳入既有 Kubernetes、Observability 和 SRE 流程，避免再建一套孤立平台 |

不要把 NVIDIA Triton Inference Server 与 Triton Language 混淆：前者是模型 Serving Server，后者是 GPU Kernel 编程语言。对 2000 名开发者的初期平台，通常只需要一个主推理引擎、一个 Gateway / Router、Kubernetes GPU 管理和统一监控；Dynamo、llm-d、独立 KV Cache 或自定义 Kernel 应由明确的性能瓶颈驱动，而不是一次性全部引入。

### 19.1 推荐的评估顺序

1. 用 vLLM 或 SGLang 建立目标模型的单节点基线。
2. 对 MoE 模型单独验证 DeepEP 等通信优化，区分节点内 NVLink 和节点间 RDMA。
3. 对长上下文、多轮 Agent 测量 Prefix Cache 命中和 KV Cache 压力，再评估 Mooncake / LMCache。
4. 当单节点或简单多副本方案无法满足 SLO 时，再比较 Dynamo、llm-d 或 AIBrix。
5. 只有 Profile 显示算子是主要瓶颈时，才考虑引入额外 Kernel 或量化路径，并以任务质量回归作为发布门槛。

## 20. 业界真实案例：企业为什么自部署 GPU 推理，以及生产环境究竟怎么做

前面几章讨论的是平台组件和部署方法。本章转向已经公开的企业实践，重点看四件事：企业为什么选择自管推理；租用云 GPU 是否仍算自部署；生产系统怎样组合 GPU、Kubernetes、推理引擎、缓存和调度；以及上线后暴露了哪些问题。

案例按控制边界分为三类：企业自有或自控推理平台；租 CSP / GPU Cloud 资源但自行运营推理服务；把推理基础设施交给专业平台运营商。第三类不是严格意义上的企业自部署，但对判断自建平台是否值得非常重要。厂商公开的性能和成本数字均保留其原始口径，不视为独立审计结果；公开资料没有披露的架构细节不会自行补齐。

### 20.1 自部署的定义：GPU 所有权与运营责任

自部署（self-hosted / self-managed inference）的关键不是 GPU 的产权，而是企业是否控制模型服务的数据面和运行边界。

| 模式 | GPU 资产归属 | 谁运营推理引擎与调度 | 数据和模型控制 | 是否属于企业自部署 |
| --- | --- | --- | --- | --- |
| 企业自购 GPU、机房自建 | 企业 | 企业 | 企业 | 是，典型 On-Prem |
| 企业租用 AWS EC2 GPU，在自己的 VPC / EKS 运行 vLLM | CSP | 企业 | 企业控制主要服务边界 | 是，Cloud Self-Hosted |
| 企业租用 CoreWeave / Lambda / Nebius 专属 GPU 集群，自行部署 K8s 和推理栈 | GPU Cloud | 企业或双方分工 | 取决于租户隔离、网络、运维权限和合同 | 可以是，需核实责任边界 |
| 企业租 Dedicated Endpoint，自己控制模型配置、容量和流量，但不管理节点和推理引擎 | CSP / GPU Cloud | 服务商 | 企业有一定模型和端点控制权 | 不是严格自部署，是 Dedicated Managed Inference |
| Together AI / Fireworks / Bedrock / Vertex 等托管模型 API | 服务商 | 服务商 | 主要由 API 合同、区域和保留策略约束 | 否，Managed API |

企业在自己的 AWS Account 中创建 EKS、P4d/P5 GPU 节点、FSx for Lustre、VPC、IAM 和 ALB，把模型权重放进自己的存储，由自己运营 vLLM，即使没有购买 A100，也属于 Cloud Self-Hosted。反过来，服务商使用开源权重并不代表客户自部署；如果服务商管理节点、驱动、推理引擎和调度，客户只是调用 API，那么仍然是托管推理。

### 20.2 IBM Research + Red Hat：544 张 H100 服务数千个 Coding Agent

这是与本文目标最直接相关的公开案例之一。IBM Research 在 2026 年 9 月发布基于 llm-d 的部署报告：IBM Research、Red Hat 团队使用 544 张 NVIDIA H100 部署 GLM-5.2（约 753B 总参数、约 39B 激活参数的 MoE 模型），面向内部关键业务负载，并用 Agentic Benchmark 验证数千个并发 Coding Agent 的服务能力。IBM 报告称，峰值输出吞吐超过每分钟 660 万 Token，测试中最高支持 3,000 个并发 Coding Agent 且没有发生请求抢占。按其采用的当期云 GPU 租赁价格估算，单位 Token 成本约为商业闭源 API 的 1/5 到 1/10。这个 5–10 倍是 IBM 对特定模型、流量、租赁价格和 API 对比口径的测算，不是任何企业都能复制的固定成本优势。

这项工作的价值不只是部署了 544 张 GPU，更在于它公开了对 Agentic Workload 的分析。团队基于 219 个真实 Claude Code Session 的数据，观察到典型请求的输入远大于输出：中位数约 195K 输入 Token，而输出约 317 Token；96% 的主 Agent 请求至少复用了前一个请求 90% 的输入内容。子 Agent 还会在没有预告的情况下并发启动，形成瞬时流量尖峰。这意味着 Coding Agent 的推理负载与普通聊天机器人不同：主要成本可能是重复读取上下文，而不是生成回答。

系统组合包括：llm-d 做 Kubernetes-native 分布式推理编排；GLM-5.2 MoE 采用 Wide Expert Parallelism + Data Parallel Attention；Prefill 与 Decode 拆分为独立资源池；NIXL 在两组之间传输 KV Cache；Prefix-aware Routing 把请求路由到已经持有相关前缀缓存的 Worker；GPU KV Cache、CPU DRAM 分层缓存和 Peer-to-Peer KV Cache Sharing；Multi-Token Prediction 提升高并发 Decode 吞吐。

公开的测试数据很有价值：精确 Prefix Matching 相比近似路由，在 CyberGym 测试中带来 79% 更高吞吐和 67% 更低 TTFT；完整系统把输入 Token 中约 85.2% 从缓存提供，未命中后需要重新 Prefill 的部分降到 14.8%。NIXL 在测试期间完成约 620 万次 KV Cache Transfer，平均每次约 2.71 GiB，Fleet P90 吞吐约 580 Gb/s，未观察到传输失败。

这类平台主要面向大规模内部 Coding Agent、长上下文多轮 Agent 平台、已经拥有 H100 GPU Fleet 并希望提高其价值的组织。

从 IBM 的数据里能看出，不能用普通 Chat Completion 的 QPS / Tokens per Second 模型估算 Coding Agent。要从 Agent Trace 得到输入长度、上下文重复率、子 Agent 并发、Prefill / Decode 比例和缓存命中率。对这类负载，路由是否命中 Prefix Cache、KV Cache 是否能跨 Worker 复用，可能比单 GPU 理论峰值算力更重要。

这组数字不能直接外推：544 张 H100 是特定模型和负载的规模，不是 1000 名开发者的参考采购量。3000 并发是报告中的 benchmark / 内部负载结果，也不能直接等同于 3000 名同时活跃开发人员。必须用自己的 Agent Harness 和 Trace 重测。

来源：[IBM Research：How llm-d makes the most of the hardware you already have（2026-09-08）](https://research.ibm.com/blog/running-open-models-on-h100-gpus-with-llmd)；[llm-d](https://llm-d.ai/)。

### 20.3 Shopify：将高 Token 消耗子任务交给自托管 Specialist Model

Shopify 在 2026 年 10 月公开了 Sidekick 的 Task Expert 实践。它不是把一个开源模型直接替换所有闭源模型，而是采用分层 Agent 架构：Frontier Model 负责与商家交互、规划和决定调用什么工具；上下文很重、任务边界清晰的子任务交给 Shopify 自己 Post-train 并托管的开源模型。

一个具体例子是 GraphQL Subagent。商家询问哪些商品库存不足时，子 Agent 要读取 Shopify API Schema、搜索文档、编写并执行 GraphQL Query，再返回结果。该任务的输入 Token 约为输出 Token 的 40 倍。若一直使用按 Token 计费的 Frontier API，重复读取 Schema 和文档会造成较高成本。

Shopify 基于 NVIDIA Nemotron 3.5 Lightning 做任务后训练。该 MoE 模型总参数约 30B，每 Token 激活约 3B。Shopify 报告称，经过六轮持续改进和约 61,000 条修复样本后，模型在其 GraphQL 任务 Judge 上达到 74.5 分，高于 Frontier Model 的 73 分；生产流量回放中，中位数完整响应时间为 0.87 秒，而 Frontier API 为 6.50 秒；最慢 1% 请求也快约 8 倍。该 Specialist Model 的服务成本比 Frontier Model 低约 90%。Shopify 还表示，跨其 Post-trained Models，自托管服务成本比 Frontier API 低约 90%–98%。

Shopify 的流程比单纯替换模型更有参考价值：先定义业务任务的质量 Rubric，建立 Frontier Agent 的质量基线；再选择开源模型，在真实 Subagent、真实工具和同一套 Judge 中评估；从一开始就用 AIPerf 回放生产 Trace，输入内容使用合成文本，避免在性能测试中暴露客户数据；对 Batch Workload 比较 vLLM、SGLang 和 TensorRT-LLM；每晚把生产失败案例转化为训练数据，通过 Judge、Critic 和模拟商家回放持续修复模型。

Shopify 还披露，使用 NVIDIA Megatron Bridge 在 Nebius 上进行跨节点后训练；同一个 FP8 后训练任务中，8 张 B300 相比 8 张 H200 快 1.86 倍，GPU-hours 减少 46%。这是训练效率对比，不应误读成推理吞吐提升。

这种拆分方式适合大型 SaaS、企业内部 Agent、具有稳定且重复的业务子任务、输入上下文显著大于输出的工作负载。

Shopify 这次实践的重点是，自部署收益不一定来自把主模型全部换成开源模型。更稳妥的做法是把任务拆开：复杂规划继续使用 Frontier Model；Schema 查询、分类、抽取、固定工具调用等可评测子任务交给 Specialist Model。通过任务级评测、后训练和生产数据闭环，降低成本并减少单一供应商依赖。

需要具备的前提是，Shopify 有明确业务任务、生产数据和专门评测体系。没有可靠 Ground Truth、Judge 校准和失败样本治理时，单纯 Fine-tune 不会自动得到同样收益。

来源：[Shopify Engineering：How Shopify turns open models into task experts（2026-10-21）](https://shopify.engineering/open-model-task-experts)。

### 20.4 Perplexity：租用 AWS A100 / H100 并自营推理 API

Perplexity 的 pplx-api 是“租用 CSP GPU 仍然属于自部署”的典型案例。NVIDIA 客户案例披露，Perplexity 最初将 pplx-api 部署在 AWS EC2 P4d 实例上，每台 P4d 配备 8 张 A100 GPU；推理服务使用 TensorRT-LLM，并通过 AWS 与 Kubernetes 的集成扩展到数百张 GPU。模型服务面向外部开发者，支持多个开源模型。

NVIDIA 案例给出的结果包括：相对其他部署平台，pplx-api 延迟最高可降低约 3.1 倍、首 Token 延迟最高可降低约 4.3 倍；切换外部推理 API 调用到 pplx-api 后，报告成本降低约 4 倍、每年节省约 60 万美元。后续在 AWS P5 H100 + FP8 配置下，相同配置比较 A100，延迟减半、吞吐提升约 200%。这些是 Perplexity / NVIDIA 公布的特定比较结果，不代表 H100 对任何模型都能得到相同提升。

架构特点：GPU 资源租自 AWS EC2，不需要自己建设机房；模型服务和 API 产品由 Perplexity 自己运营；TensorRT-LLM 用于推理优化；Kubernetes 负责大规模部署和弹性扩展；通过小型 Classifier Model 把不同请求路由到不同 GPU Pod / 模型。

这种模式主要面向对外提供模型 API 的 AI 产品公司、需要高并发和稳定 SLA 的 SaaS、希望控制模型和推理优化而不愿自己建数据中心的团队。

对资源规划更有用的结论是，企业自部署的合理起点可以是租 CSP GPU，而不是先采购硬件。用租赁资源验证模型、服务架构、流量和单位成本，证明稳定需求后再决定长期 Reserved Capacity、Dedicated Cluster 或自购。

来源：[NVIDIA Customer Story：Perplexity](https://www.nvidia.com/en-us/case-studies/perplexity/)；[NVIDIA：Fast, Low-Cost Inference Offers Key to Profitable AI](https://blogs.nvidia.com/blog/ai-inference-platform/)。

### 20.5 Netflix：将 LLM Serving 接入现有模型平台

Netflix 在 2026 年公开了内部 Model Scoring Service（MSS）承载 LLM 的实践。它没有把 LLM Serving 当成完全独立的新平台，而是把模型推理集成到已有 JVM Serving Layer 和 MSS 中。

已有 JVM Serving Layer 继续负责路由、Feature Retrieval、Candidate Generation、Post-processing 和 Logging。较小模型可以在 CPU 进程内运行；较大的 GPU 推理请求委托给 MSS。MSS 由 NVIDIA Triton 管理模型加载、Batching、GPU 调度和多框架 Serving，vLLM 负责实际 LLM Inference。系统同时提供内部 gRPC、KServe HTTP / gRPC 以及 OpenAI-compatible HTTP 接口。

Netflix 公开的生产问题尤其有价值。Triton 的 vLLM Backend 与特定 vLLM API Surface 编译绑定，版本不匹配可能导致 Backend 完全无法加载，因此团队在构建服务镜像时固定兼容版本，并禁止模型作者在 Packaging 阶段自行覆盖 vLLM 版本。Triton 的 vLLM Backend 只需 JSON 配置模型权重和 Tokenizer，运行时动态生成 I/O Tensor Spec，降低模型制品与 Frontend 升级的耦合；需要自定义 Preprocess / Postprocess 或非标准执行流程的模型，则保留 Python Backend 作为 Escape Hatch。

模型冷启动也被纳入平台设计：从 S3 或 Hugging Face 在启动时下载大型模型太慢，Netflix 在模型发布时就把权重物化到 Amazon FSx，启动时优先从高性能文件系统读取。部署层由 Java Control Plane 负责版本、健康检查、Autoscaling 和 Multi-region Rollout；模型接口稳定时采用 Red-Black 部署，接口发生破坏性变化时采用 Versioned Deployment，让新旧模型版本并行存在，代价是升级期间暂时增加 GPU 成本。

可观测性方面，Triton 内置的 Metrics Bridge 只暴露了 40 多项 vLLM Metrics 中的 9 项，遗漏 Token Throughput、KV Cache Utilization 和 Prefix Cache Hit Rate 等关键指标。Netflix 因此增加轻量 Metrics Proxy，把 Triton HTTP Metrics 与 vLLM Prometheus MultiProcessCollector 的数据合并到统一 /metrics Endpoint。Constrained Decoding 的初始 Python 实现还受到 GIL 限制：Logits Processor 在 CPU 侧逐请求串行执行，Batch 越大尾延迟越差；团队迁移到 vLLM V1 的 Batch-level Processor，并把热点逻辑改为 C++，同时处理 Chunked Prefill 和 KV Cache Preemption 后 Token History 改变导致的状态机恢复问题。另一个 API 契约问题是 response_format 在某条集成路径中被接受却被丢弃，可能导致 JSON 约束没有真正生效。

如果企业已经有成熟的 Model Serving、MLOps 或 Feature Serving 平台，可以把 LLM Serving 接入现有控制面，避免再维护一套孤立系统。

Netflix 暴露出的工程问题是，LLM 不一定要成为全新的平台孤岛。可以复用已有 Serving、Logging、Routing、KServe 和模型生命周期管理能力，只把 GPU Runtime 和 LLM 特有的 KV Cache / Decoding 能力作为专门扩展。API 兼容性必须做端到端契约测试，不能只检查 Gateway 返回 200。

来源：[Netflix TechBlog：In-House LLM Serving at Netflix（2026-07-17）](https://netflixtechblog.com/in-house-llm-serving-at-netflix-a5a8e799ea2c)；[InfoQ 对 Netflix 技术分享的整理（2026-07-27）](https://www.infoq.com/news/2026/07/netflix-llm-platform/)。

### 20.6 Observe.AI：EKS 上的成本优化与启动链路

Observe.AI 为 Contact Center Quality Assurance 提供 GenAI Moments，使用 LLM 分析客户与客服的对话。它在 AWS 上使用 EKS 运营 GPU 推理。业务增长时，系统遇到两个问题：GPU 推理成本较高，以及流量突增时新 GPU 节点和模型启动太慢。

AWS 客户案例披露，模型从原先约 12–15 分钟的启动时间降到约 100 秒，LLM 每百万 Token 成本降低 40% 以上，整体基础设施成本也降低 40% 以上。

关键优化并不是换一个更大的 GPU，而是改造模型冷启动和弹性扩容链路：原先新节点需要把模型权重从 S3 下载到本地磁盘，再加载到 GPU；团队引入 Run:ai Model Streamer，让模型权重可以从 S3 直接流入 GPU Memory。原先新节点启动时还要下载大型 Inference Container；团队改用 Bottlerocket AMI，并通过 EBS Snapshot 预置推理镜像，结合 EBS Fast Snapshot Restore 加速节点准备。扩缩容原先主要参考 CloudWatch Metrics；团队改为直接读取 SQS Queue 中的任务需求，让扩容依据更接近真正的待处理工作量。

这类优化适合业务负载有明显峰谷、使用异步队列、模型较大且 GPU 节点需要动态扩容的企业，例如客服质检、批量文档处理、离线代码分析和后台 Agent。

Observe.AI 的实践说明，GPU Auto Scaling 不只是增加 Kubernetes Pod 副本。节点启动、镜像拉取、权重下载、模型加载、CUDA Graph 初始化和健康检查都可能耗时。必须把从发现需求到模型真正 Ready 的完整时间作为容量指标。

来源：[AWS Customer Story：Observe.AI cuts AI inference costs by over 40%](https://aws.amazon.com/solutions/case-studies/observeai-case-study/)。

### 20.7 AWS EKS + vLLM：客户在自己的 AWS Account 中运营模型服务

AWS 在 2025 年发布的参考架构展示了企业在自己 AWS Account 中部署 vLLM 的完整路径。架构使用 EKS、EC2 P4d（每台 8×A100）、EFA、FSx for Lustre、AWS Deep Learning Container、LeaderWorkerSet 和 ALB。

模型权重存放在 FSx for Lustre；vLLM Pod 通过 Tensor Parallelism / Pipeline Parallelism 使用多 GPU，跨节点场景通过 EFA 提供高性能网络；ALB 对外暴露统一 API。AWS Deep Learning Container 提供经过预配置和测试的推理环境，降低 CUDA、NCCL、驱动和 EFA 依赖的安装工作。

这不是特定企业的生产客户案例，而是 AWS 给自管 ML 用户的工程参考实现。它说明 CSP 可以托管 Kubernetes Control Plane 和提供 GPU 实例，但客户仍然自己管理模型权重、推理容器、模型配置和业务 API。

这套方案适合：已经使用 AWS、希望在现有 VPC / IAM / KMS / EKS 治理体系内运行模型服务的企业。

落地前还要确认：参考架构中的 P4d、FSx、EFA 和 LeaderWorkerSet 只是可运行起点，不等于生产平台已经完成。企业仍需补充私有模型仓库、镜像扫描、模型制品签名、身份认证、租户隔离、限流、审计、故障切换、容量配额和成本归属。多节点推理还需要独立验证 EFA / NCCL 拓扑和实际网络吞吐。

来源：[AWS Architecture Blog：Deploy LLMs on Amazon EKS using vLLM Deep Learning Containers（2025-08-14）](https://aws.amazon.com/blogs/architecture/deploy-llms-on-amazon-eks-using-vllm-deep-learning-containers)；[AWS EKS Load & Serve Models](https://docs.aws.amazon.com/eks/latest/userguide/ml-inference-load-serve-model.html)。

### 20.8 Google Distributed Cloud Air-Gapped：监管和数据主权驱动的隔离部署

Google Distributed Cloud（GDC）Air-Gapped 提供了一个 Open Weight Model 参考架构，面向不能连接公有云、不能把数据发送到外部模型 API 的环境。它支持在客户控制的隔离集群中使用 Kubernetes 部署 vLLM 或 Ollama，模型权重存放在 Persistent Volume，镜像放入私有 Harbor Registry，通过 NetworkPolicy 和 ProjectNetworkPolicy 控制访问。

部署过程包括：在有互联网的工作站下载模型权重和容器镜像；通过受控流程把容器镜像复制到隔离环境 Harbor；把模型权重上传到持久化卷，而不是打包进 Container Image；vLLM / Ollama Pod 挂载 PVC 后加载模型；Kubernetes Service / LoadBalancer 提供内部 API；Open WebUI 可作为可选 UI；使用 GPU Resource 和 Tensor Parallelism 部署模型，按环境能力使用 MIG。

文档指出一个实际扩展限制：示例中的模型 PVC 使用 ReadWriteOnce；若 StorageClass 不支持 ReadOnlyMany，一个模型 Deployment 不能简单地挂载同一个 PVC 扩展多个副本，每个 Deployment 可能需要独立 PVC。这类存储访问模式限制容易在 POC 时被忽略，到了扩容阶段才暴露。

这种部署更适合银行、政府、国防、医疗、关键基础设施、研发数据高度敏感且有网络隔离要求的组织。

这里最容易漏掉的是，Air-Gapped 不只是没有公网。镜像、模型权重、Tokenizer、依赖包、许可证、漏洞修复和升级都需要离线供应链流程。必须把模型制品、容器镜像、SBOM、签名、校验和、版本审批和离线补丁纳入平台设计。

来源：[Google Cloud：Open Weight Models reference architecture on GDC air-gapped](https://docs.cloud.google.com/distributed-cloud/hosted/docs/latest/gdcag/solutions/open-weight-models/reference-architecture)。

### 20.9 Cognition / Devin：在 CoreWeave 租用 GPU 并按 Agent 负载扩容

Cognition 公开表示，其在 CoreWeave 上运行 Devin 的训练、强化学习和生产推理，从桥接容量扩展到数千张 GPU，历时不到九个月。2026 年 CoreWeave 公告还提到，Cognition 与 CoreWeave 部署了 Vera Rubin NVL72，并由 Cognition 工程师执行客户侧推理基准；针对 SWE-2 Agentic Coding Workload，公开数据称相较 GB200 NVL72，Token Throughput 最高提升约 4.8 倍。

专业 GPU Cloud 提供的不只是按小时出租 GPU，还可能包括新一代硬件供给、机架级系统、网络和现场工程支持。对 Agentic Coding，长上下文、高并发、连续多步推理使 GPU 资源成为产品交付能力的一部分。

公开资料没有完整披露 Devin 的生产推理集群具体软件栈、每个模型的 GPU 分配、实际利用率和完整成本，因此不能把它写成 CoreWeave 上某个可直接复制的 vLLM 部署方案。

这套模式面向 AI Native 产品公司和 Agent SaaS，尤其适合模型能力与推理吞吐直接影响收入、又需要快速获得大规模 GPU 的团队。

落到实施阶段，专业 GPU Cloud 可以把机房、GPU 服务器、网络和部分集群运营交给供应商，但企业仍要管理模型服务、Agent 调度、请求优先级、KV Cache、模型升级、容量预测和业务 SLO。合同必须明确 GPU 代际、节点拓扑、网络带宽、故障替换、维护窗口、可用性、数据位置、网络隔离、预留容量和扩容交付时间。

来源：[CoreWeave：Cognition at Production Scale](https://investors.coreweave.com/news/news-details/2026/CoreWeave-Delivers-NVIDIA-Vera-Rubin-NVL72-Performance-at-Production-Scale-Starting-With-Cognition/default.aspx)。

### 20.10 Together AI + IBM Cloud + NVIDIA：专属 B300 集群的运营分工

2026 年 8 月，IBM 宣布与 Together AI 达成多年期、约 2.4 亿美元的合作，在 IBM Cloud 上部署大规模 NVIDIA HGX B300 集群，采用 NVIDIA Spectrum-X Ethernet。IBM 提供 Cloud Infrastructure，NVIDIA 提供 GPU 和网络技术，Together AI 负责 Inference Platform。Together AI 在 2026 年 10 月介绍了该集群的企业推理用途。

这是一个清楚的职责分工案例：GPU 服务器、机房、电力、网络和云基础设施由 IBM 提供；GPU 与网络平台由 NVIDIA 提供；模型运行、Serving Engine、模型适配和 Token 服务由 Together AI 运营；企业客户通过 Together AI 的服务消费推理能力。

它不是每个企业在自己的账户中自建推理集群，而是专业推理服务商租用 / 采购 CSP 的 Dedicated GPU Capacity，再运营推理服务。对企业用户而言，这是介于公有 API 和完全自部署之间的方案。

如果企业希望使用开源模型，但没有足够的 GPU Infra 团队，可以考虑这种模式。专属容量、相对稳定的价格和服务 SLA，可以减少自行维护驱动、Kubernetes、NCCL 与推理引擎的工作。

上线前，采购合同要把 Dedicated GPU 拆成可验证内容：是否独占物理 GPU、是否独占节点、网络是否独占、模型权重是否可自定义、服务商能否访问请求内容、模型更新和回滚由谁执行、容量扩容是否有保证、故障期间是否有替代资源。专属容量不等于数据主权，也不等于企业拥有完整运行控制权。

来源：[Together AI：Expanding our enterprise inference capacity with IBM Cloud and NVIDIA（2026-10-06）](https://www.together.ai/blog/expanding-our-enterprise-inference-capacity-with-ibm-cloud-and-nvidia)；[IBM 新闻稿（2026-08-11）](https://www.prnewswire.com/news-releases/ibm-and-together-ai-sign-multi-year-agreement-to-scale-open-source-ai-inference-with-nvidia-ai-infrastructure-on-ibm-cloud-302847748.html)。

### 20.11 全球金融科技公司 + Together Dedicated Model Inference：56 张 B200 承载 Coding Agent 生产流量

Together AI 在 2026 年 9 月公开了一个匿名全球金融科技客户案例。客户用 GLM-5.2 运行内部 Coding Assistant，工作负载具有明显的工作时间峰值、低平均生成速率、长上下文和突发并发特征。它不是企业自己管理物理 GPU 和推理引擎，而是使用 Together 的 Dedicated Model Inference（DMI）；但客户工程团队拥有 Endpoint 配置、扩缩容、模型升级和蓝绿测试控制权。

公开的生产配置包括：GLM-5.2 在 56 张 B200 上运行，14 个 Replica、每个 Replica 4 张 B200，Context Length 为 256K。客户优先考虑并发容量，而不是单 Replica 的最大吞吐。

这个案例公开了真实的故障分析过程：客户把模型部署从较多小 Replica 调整为较少大 Replica，GPU 总数不变，但 Prefill 容量和 KV Cache Headroom 的比例发生变化。调整后几天内，Prefill 接近 100% 容量，请求开始排队 1–3 分钟，Decode Throughput 降到约 5 Token/s。Metrics API 分析一条持续 192 秒的慢请求后发现，它不是自己的计算量过大，而是排在其他请求形成的约 2.3M Token Pending Prefill 队列后面。团队发现默认 Cache-aware-by-hash 路由不适合当前会话分布，恢复经过调优的 Cache-session-aware Routing，并调整 Max In-flight per Worker 后，当天完成配置修复且没有停机。

流量分布也很重要：客户报告的 Input Sequence Length p50 / p90 / p95 约为 81K / 163K / 178K Token，RPS p50 / p90 / p95 约为 3 / 6 / 7。它是低 RPS、超长输入、峰值并发显著的负载，不应该按普通聊天服务的平均 RPS 估算。

客户还评估过 1M Context，但发现上下文长度翻倍会压缩并发容量，因此选择 256K / 512K 的工作区间。模型从 GLM-5.1 升级 GLM-5.2 时，在同一账户和 Endpoint Pattern 下完成切换，并通过自助控制面进行配置调整和蓝绿测试。

这类部署面向拥有大量开发人员、Coding Agent 使用高峰集中在工作时间的金融科技公司、银行、证券和保险机构。平台团队可以统一管理容量和模型发布节奏。

GPU 总数相同，服务能力也可能相差很大。Replica 数量、每个 Replica 的 GPU 数、Prefill / Decode 资源比例、Context Length、KV Cache 和 Router 策略都会改变有效并发。模型配置变更必须作为容量变更进行压测和灰度，不能当成普通参数调整。

**部署边界：** 这是 Dedicated Managed Inference，不是客户自己维护 GPU Driver / K8s / vLLM 的完整自部署。它展示了企业希望获得的运维自主权，也提醒我们：即使购买了专属 GPU 容量，若没有可操作的 Metrics API 和 Endpoint Configuration API，平台团队仍会成为所有扩容和故障排查的瓶颈。

来源：[Together AI：How a global fintech scaled coding agent traffic with Dedicated Model Inference（2026-09-18）](https://www.together.ai/blog/global-fintech-scales-coding-agent-traffic-with-dedicated-model-inference)。

### 20.12 Samsung Semiconductor：On-Prem 平台的数据控制与研发效率

Open WebUI 公布的 Samsung Semiconductor 客户案例称，Samsung Semiconductor 在内部 Kubernetes 集群部署了自托管 AI 平台，运行内部 LLM 和 SLM，使用内部数据库、内部网络隔离、内部 Observability Stack，并集成身份和审计控制。案例披露，团队先用 100 名分析人员进行 14 天试点，再在 30 天内扩大推广；研发团队报告开发周期缩短约 30%。

这类案例与大规模 GPU 推理服务有明显区别：公开材料强调安全的内部 AI 使用入口、模型访问治理和研发流程效率，没有披露 GPU 型号、推理引擎、模型规模和底层 GPU 集群拓扑。因此不能从这份材料推导用了多少 GPU 或推理吞吐是多少。

不过它披露了一个值得企业架构师注意的采用数据：首周活跃使用率较高，但后续每日活跃用户稳定在目标员工的 5%–10%。这说明“给 1000–5000 名员工部署一个私有 Chat UI”与“1000–5000 人每天都高频使用”完全不同。

半导体研发、专有设计数据、实验室文档和内部软件研发都可能采用这种模式。实施前应先明确员工入口、身份认证、审计和数据边界。

GPU 容量不能按员工总数直接换算。应先通过 Pilot 测量 DAU、并发 Session、每个 Session 的输入 Token、Agent 与 Chat 的比例，以及使用高峰。推广平台时，除了 UI，还要准备 SSO、审计、用户培训、帮助台和模型选择策略。

证据边界：该案例来自 Open WebUI 的客户案例页面，属于产品供应商发布的客户材料，性能和效率结果未经独立审计；它没有提供底层 GPU 和模型服务细节。

来源：[Open WebUI：Samsung Semiconductor Private On-Prem AI Platform](https://docs.openwebui.com/enterprise/customers/samsung-semiconductor/)。

### 20.13 Uber：混合使用自有机房 GPU 和 GCP GPU

Uber 在 2026 年披露的 LLM Training Infrastructure 案例不是纯推理平台案例，但它说明企业不必在“全部自建”与“全部公有云”之间二选一。

Uber 的内部 LLM 工作流同时使用自有 On-Prem 集群中的 A100 GPU，以及 Google Cloud 上的 H100 GPU VM。其 On-Prem 主机配置为 4×A100，GCP 主机使用 8×H100。资源通过内部 Crane Infrastructure 管理，Kubernetes 负责集群和硬件资源，Ray / KubeRay 负责分布式任务；多个 Kubernetes Cluster 通过 Federation Layer 根据资源可用性调度任务。

训练栈使用 PyTorch、Ray、Hugging Face、DeepSpeed 和 NCCL，数据来自 Uber HDFS、Terrablob 和 Hugging Face。Uber 还讨论了 ZeRO-3 CPU Optimizer Offload 和 FlashAttention 对显存与训练吞吐的影响。

这种混合模式适合已经拥有数据中心和 GPU 资产、但仍需要 CSP 弹性资源的组织。典型任务包括训练、微调、Batch Inference 和模型评估，调度器需要根据任务特征决定使用自有集群还是租赁资源。

混合 GPU Fleet 的难点不在于把两个 Kubernetes Cluster 接起来，而在于统一资源描述、GPU 型号能力、镜像和驱动兼容性、数据位置、网络带宽、身份凭据和任务可迁移性。不同云和本地集群的 GPU SKU、网络、存储和驱动栈并不完全等价。调度器必须知道任务能否跨集群运行，而不能只看还有多少张 GPU。

证据边界：Uber 文章重点是 LLM Training / Fine-tuning Infrastructure，而不是证明同一套跨集群架构已经承担所有在线推理流量。它适合作为 Hybrid GPU Resource Management 案例，不应误称为生产 Coding Agent Serving 案例。

来源：[Uber Engineering：Open Source and In-House: How Uber Optimizes LLM Training（2026-04-14）](https://www.uber.com/us/en/blog/open-source-and-in-house-how-uber-optimizes-llm-training/)。

### 20.14 Deutsche Telekom Industrial AI Cloud：面向企业和公共部门的主权 AI 基础设施

Deutsche Telekom 与 NVIDIA 建设了位于德国慕尼黑的 Industrial AI Cloud。Telekom 公开资料称，该 AI Factory 在 2026 年启动，采用最多约 10,000 张 NVIDIA Blackwell GPU（B200 与 RTX PRO 等），配套约 20 PB 存储，目标客户包括德国和欧洲企业、科研机构与公共部门。平台提供从数据中心、GPU Compute、软件平台、安全到行业应用的完整服务能力。

它不是某家企业的内部自部署，而是区域性 Sovereign AI Infrastructure Provider。客户可以在本地司法管辖区内获得大规模 GPU 训练和推理能力，同时不必自行建设数据中心。

公开客户和合作生态包括 SAP、Siemens、EY、Agile Robots、Wandelbots、Quantum Systems、PhysicsX 等；SOOFI 项目计划在该平台上训练和运行约 100B 参数的主权欧洲语言模型。

欧洲企业和公共部门如果受到数据主权、区域监管或工业数据要求约束，又没有条件自建大型数据中心，可以评估这类部署。

真正落地时，主权云不只是数据中心在本地。企业还要核实运营主体、管理员访问、远程运维、模型权重存放、日志和备份位置、供应链、加密密钥控制、跨境支持人员和故障恢复地点。数据驻留不自动等于完整数字主权。

来源：[Deutsche Telekom：Industrial AI Cloud（2026-02-04）](https://www.telekom.com/en/newsroom/latest-updates/media-information/2026/2/germany-s-first-ai-factory-for-industry)；[Deutsche Telekom：AI sovereignty for Germany and Europe（2025-11-04）](https://www.telekom.com/en/newsroom/latest-updates/media-information/2025/11/ai-sovereignty-for-germany-and-europe)。

### 20.15 Ada：GPU Slicing 与多模型资源分配

Ada 的客户服务 Agent 使用多个模型协作完成推理任务，其中一部分模型规模较小，并不需要独占一整张 GPU。AWS 客户案例披露，Ada 在迁移到 EKS 后，将模型容器部署在 Kubernetes 上，并对 Reasoning Engine 使用的 GPU 进行切分。AWS 报告称，GPU Slicing 让 GPU 使用成本效率提升约 20%；整体迁移还改善了部署速度和运维效率。

这个案例说明，企业模型池通常包含大模型、Embedding、Reranker、Classifier、Guardrail、Small Language Model，以及语音和视觉子模型，并非每个服务都需要 8 张 B300。若所有服务都独占整卡，GPU 容易出现碎片化。

但 GPU Sharing / Slicing 要区分 MIG、Time-slicing、MPS 和软件层虚拟化。它们的隔离、安全、显存保护、故障域和性能可预测性不同。多租户场景不能只为提高 GPU 利用率而牺牲性能隔离和安全边界。

如果企业多模型、多服务、模型尺寸差异明显的企业 AI 平台；同时运行 Embedding、Reranker、分类、Guardrail 和多个小模型的团队。

来源：[AWS Customer Story：Ada on Amazon EKS](https://aws.amazon.com/solutions/case-studies/ada-support-eks-case-study/)。

### 20.16 Superhuman / Grammarly：从自建 vLLM 转向托管 Serving

Superhuman（原 Grammarly）曾经运行自建 vLLM Serving Stack 和内部模型管理工具，支撑语法纠错模型。随着业务规模达到峰值 200K+ QPS，L40S GPU Fleet 的性能优化、容量规划、自动扩缩容和每次模型迭代所需的手工调优，逐渐占用精干 ML Infrastructure 团队的大量精力。

2026 年，Superhuman 与 Databricks 合作迁移到 Databricks Model Serving Provisioned Throughput。公开材料称，联合优化将单个 H100 Pod 的吞吐从约 750 QPS 提高到 1,200 QPS，提升约 60%，并实现亚秒级 P99 延迟。优化包括 FP8 量化、减少 Python CPU 开销、把部分后处理从关键路径移走，以及 Attention Kernel 优化。团队在迁移前后通过质量评测和性能目标验证模型没有质量退化。

这不是自部署成功案例，而是一个重要边界案例：即使企业已经有能力维护 vLLM，继续自建也未必有最高的业务价值。若团队真正的差异化在模型和产品，而 GPU Serving 的 Day-2 Operations 已成为负担，托管 Provisioned Throughput 可能更合理。

当内部推理平台的规模和 SLA 要求持续增长时，产品团队需要比较两种方案：继续扩充 Infra Team，还是把 Serving 运维交给专业平台运营商。

来源：[Databricks：How Superhuman and Databricks built a 200K QPS inference platform together（2026-05-08）](https://www.databricks.com/blog/how-superhuman-and-databricks-built-200k-qps-inference-platform-together)。


### 20.17 案例比较：企业实际购买的能力

| 模式 | 代表案例 | 企业承担的责任 | 适用条件 |
| --- | --- | --- | --- |
| 自有 GPU / On-Prem | IBM Research、Samsung、Google Distributed Cloud | 设施、网络、节点、Serving 和 Day-2 运维 | 数据边界严格、负载稳定、内部团队成熟 |
| CSP GPU，自营 Serving | Perplexity、Uber、AWS EKS 客户 | OS、驱动、模型 Runtime、容量和服务治理 | 希望避免硬件采购，但需要控制推理栈 |
| Dedicated GPU Cloud / Managed Inference | 金融科技公司、Cognition、Workato | 模型评测、API 集成、配额、供应商和 SLO 管理 | GPU 需求变化较大，或不希望自建底层运维团队 |
| 托管模型 / Serving | Superhuman、Grammarly 等 | 数据权限、模型质量、成本和供应商治理 | 推理平台不是差异化能力，托管服务能满足控制要求 |

### 20.18 自部署的驱动因素与边界

自部署通常由数据驻留、模型定制、稳定的大规模负载、专用低延迟要求或对模型运行路径的控制需求驱动。它不自动意味着必须购买 GPU：租用 GPU VM、Dedicated GPU Cloud 和托管推理仍可能由企业自主管理模型和 API。

租 GPU 只转移了硬件采购和机房设施责任。OS、驱动、容器、模型 Runtime、缓存、API、容量、监控和模型升级仍可能由企业负责。Managed Kubernetes 也不等于 Managed Inference，采购合同必须明确 GPU 故障、节点替换、模型启动、Serving SLO、数据访问和支持响应的责任边界。

### 20.19 自部署常见问题与工程经验

自部署项目最常见的预算偏差来自低利用率。团队按峰值购买 GPU，平时却没有足够请求填满 Batch；这时应先用真实 Trace 看清日常与峰值差距，再考虑批处理、模型路由和离线任务错峰。盲目增加 GPU 也未必改善吞吐，跨卡通信和同步成本可能抵消算力收益，比较时应看完成同类任务的总成本。

另一个容易被低估的环节是故障恢复。大模型冷启动需要读取数百 GB 甚至更大的权重，若所有节点同时从远端存储拉取，恢复时间可能远超服务团队预期。本地 NVMe 缓存、分层分发和副本预热需要在 POC 阶段验证。模型上线也应把权重、Tokenizer、Runtime、Kernel 和配置视为一个 Release 单元，先做质量与性能回归，再逐步切流。在线 Coding Agent、离线评测、训练和批量任务应使用不同优先级或资源池，避免后台任务拖慢交互请求。

### 20.20 经济性与 2000 名开发者平台的部署建议

![企业 AI Coding 平台初期推荐部署架构](/diagrams/enterprise-gpu-ai-coding-platform/04-recommended-platform-architecture.svg)

[查看完整 HTML 图表](/diagrams/enterprise-gpu-ai-coding-platform/04-recommended-platform-architecture.html)

经济性比较应统一口径，至少包含 GPU / CPU 费用、存储和网络、闲置容量、软件支持、工程人力、故障冗余、模型质量和每个成功任务的成本。单纯比较 GPU-hour 或每百万 Token 价格，会忽略 Agent 重试、工具失败和人工接管的成本。

建议按以下顺序推进：

1. 采集脱敏 Agent Trace，识别模型、上下文、并发、工具调用和重试分布。
2. 租用或使用一台 8-GPU 节点建立质量、延迟、吞吐和单位任务成本基线。
3. 用统一 Gateway、身份、配额、模型目录和监控接入少量团队，验证真实使用模式。
4. 根据测量结果决定自有机房、CSP GPU、Dedicated GPU Cloud 或托管 API 的组合。
5. 只有在单节点、多副本或简单路由无法满足 SLO 时，再引入多节点 RDMA、P/D 分离和分布式 KV Cache。

### 20.21 CSP / GPU Cloud 采购核查

合同和技术评审至少确认：GPU 型号与可用性、独占或共享方式、网络带宽及 RDMA、区域和数据驻留、存储吞吐与费用、节点启动和替换时间、维护窗口、SLA、故障赔偿、支持响应、模型与镜像出站费用，以及退出时的数据和制品迁移方式。供应商宣传的峰值性能不能代替目标模型的验收测试。

### 20.22 本章结论

企业自部署的核心不是拥有多少 GPU，而是是否有足够稳定的负载、明确的数据和控制需求，以及能够持续承担 Serving 运维的团队。先验证业务任务和单位成功任务成本，再决定租赁或采购、单机或多节点、通用模型或专用模型。


## 21. 其它行业与平台工程案例

金融案例集中放在第 22 章。本章保留能补充部署模式和生产工程经验的案例，重点看它们解决了什么问题，而不是逐一复述厂商产品清单。

| 案例 | 部署方式与技术 | 可复用的工程经验 | 公开资料 |
| --- | --- | --- | --- |
| **BC Card** | On-Prem OpenShift AI、vLLM、FP8 Dynamic Quantization、SLM Swarm | 多业务流程不必统一使用最大模型；公开案例称推理成本最高降低 70%、速度提升 2–3 倍 | [Red Hat 客户案例](https://www.redhat.com/en/resources/bc-card-openshift-ai-case-study) |
| **Tesla** | Kubernetes 上由 vLLM StatefulSet 演进至 KServe + llm-d | 权重加载、本地卷与节点绑定、故障恢复和 KV-aware Routing 是 Day-2 核心问题 | [KServe 生产实践](https://kserve.github.io/website/blog/production-grade-llm-inference-kserve-llm-d-vllm) |
| **Workato** | DigitalOcean H200、Managed Kubernetes、NVIDIA Dynamo + vLLM | 托管 GPU 平台仍需关注 Agent 工作负载的吞吐、尾延迟和单位任务成本 | [DigitalOcean 技术案例](https://www.digitalocean.com/blog/workato-nvidia-technical-deep-dive-agentic-inference-cloud) |
| **University Hospital Bonn** | 院内 8 张 A100、量化 DeepSeek-R1、vLLM、网络隔离 | 对敏感数据场景，Egress Filtering、网络分区和隔离验证必须成为可测试的系统属性 | [研究论文](https://arxiv.org/abs/2604.22768) · [部署包](https://github.com/ukbonn/ukb-gpt) |
| **Dell + Meta PyTorch** | Dell AI Factory、Kubernetes、vLLM Production Stack | 将模型 Serving、KV-aware Routing、监控和安全整合为 On-Prem 参考平台 | [Dell 技术方案](https://infohub.delltechnologies.com/en-us/p/enterprise-ready-llm-inferencing-with-the-vllm-production-stack-on-dell-ai-factory/) |
| **Oracle OCI** | OKE、GPU Node Pool、vLLM、Qdrant、Terraform | CPU 应用、向量检索与 GPU 推理分池，基础设施通过 IaC 重复部署 | [OCI 参考应用](https://blogs.oracle.com/cloud-infrastructure/open-source-ai-oci-with-vllm-qdrant) |
| **OVHcloud** | Managed Kubernetes、L40S、Qwen3-VL、vLLM、Prometheus / Grafana / DCGM | GPU Worker Pool 与监控 CPU Pool 分离，并用 TTFT 和吞吐观察 Serving | [参考架构](https://blog.ovhcloud.com/en/posts/reference-architecture-deploying-a-vision-language-model-with-vllm-on-ovhcloud-mks-for-high-performance-inference-and-full-observability/) |
| **Azure Arc** | On-Prem / Edge Kubernetes、Ollama / vLLM、NVIDIA GPU Device Plugin | 不把 GPU 搬到公有云，也能统一管理分布式 Kubernetes 环境 | [AKS Engineering Blog](https://blog.aks.azure.com/2026/04/07/ai-inference-on-aks-arc-part-3) |

这些案例说明，生产化的主要难题通常不是第一次启动模型，而是权重分发、节点故障恢复、GPU 资源隔离、网络边界、监控和升级。参考架构可以作为起点，但不能代替目标模型和目标负载下的验收。

## 22. 金融服务行业的 GPU 与模型平台实践

金融机构的 GPU 投资并不都指向聊天机器人或通用 LLM。信用风险、交易行为建模、反欺诈、客户服务、研究分析、支付和内部知识检索，对模型结构、延迟、数据边界和运行方式的要求差异很大。下面的案例覆盖自有数据中心、云 GPU、主权云和混合 AI Factory。厂商案例通常只披露架构的一部分，公开材料没有给出的 GPU 数量、模型吞吐和内部运维细节，不应自行补齐。

### 22.1 案例概览

| 机构 | 场景 | GPU / 部署信息 | 已公开结果或规模 | 证据边界 |
| --- | --- | --- | --- | --- |
| BNY | 银行级 AI 基础设施、支付自动化、存款预测、交易分析 | 自有数据中心部署 NVIDIA DGX SuperPOD，DGX H100 + InfiniBand | AI Hub 已有 20 多个 AI 方案投入生产；识别出 600 多个 AI 机会 | NVIDIA 与客户联合发布；未披露完整 GPU 数量和各业务负载的资源分配 |
| BNP Paribas | 集团级 LLM as a Service、内部助手、文档生成和检索 | 集团数据中心内的共享 GPU 基础设施；开放模型与 Mistral 模型统一接入 | 多个实体参与初期试点，平台由集团 IT 运营 | 银行官方材料；没有披露 GPU 型号、集群规模和推理指标 |
| RBC Capital Markets | 研究分析、银行家助手、文档处理、市场情报 | AI Factory，混合本地与混合云；NVIDIA AI Enterprise、NeMo、NIM、Nemotron，结合 KDB.ai | Aiden 平台超过 8,000 名用户；文档处理能力提高 10 倍，Research QuickTakes 报告生成最多快 60% | NVIDIA 客户案例；结果为厂商与客户公开口径，不能视作所有任务的平均提升 |
| Revolut | 交易基础模型、欺诈、信用、客户参与和推荐 | PRAGMA 在 H100 Nebius AI Cloud 训练；后续生产扩展使用 Blackwell Ultra、cuDF 和 Dynamo-Triton | 模型开发周期缩短约 3–5 倍；H100 训练吞吐提升 2–5 倍；生产服务面向初始 8,000 万客户规模并设计为可扩至 3 倍 | NVIDIA 发布的客户案例与技术文章；训练和生产部署属于不同阶段、不同硬件路径 |
| Santander | 银行业务专用模型、客户服务、Agent 评测 | Santander AI Lab；Model Arena、NeMo Customizer、NVIDIA Kumo、Dynamo-Triton | 部分实验性客户服务任务将单次交互推理成本从约 €5 降至约 €0.03，质量保持在可接受水平 | 银行新闻稿明确称为选定的实验性场景；不是全行平均成本，也不是已全面推广的生产指标 |
| Capital One | 复杂欺诈案件的客户服务 Agent | 自研多 Agent 框架；NVIDIA GTC 介绍涉及数据中心 GPU 和 MIG | 支持数百名处理复杂欺诈案件的客服人员；分析最长约一小时的客户与客服对话并生成结构化摘要 | GTC 技术演讲摘要；没有披露 GPU 型号、部署位置和生产吞吐 |
| Discover Financial Services | 数据科学、客户交互分析、风险与客户服务 | AWS EC2 P3 / P4 GPU 实例，S3 + EFS 模型与数据制品 | 20,000 行转录数据处理：16 CPU 约 6.5–7 小时，单 GPU 约 23 分钟，多 GPU 约 4 分钟但成本更高 | AWS 客户案例；主要是 GPU 加速的 ML / 分析工作负载，不应误写成 LLM serving 案例 |
| NeoSpace 与拉美大型银行 | 信用额度倾向模型、结构化金融数据基础模型 | NeoData 使用 NVIDIA CUDA / RAPIDS / TensorRT-LLM；通过 OCI 生产部署 GB200 NVL72 | 一项部署覆盖 600 万客户，使用超过 10 TB、涉及 5,000 万客户的数据；公开材料称 KS 提升 10–20 个百分点 | NeoSpace / NVIDIA 案例；NeoSpace 是平台提供方，客户银行未具名，指标为厂商案例口径 |
| 南亚一家大型商业银行 | 行内金融数据问答与治理分析 | Teradata + NVIDIA H200，部署在银行自有数据中心，完全 On-Premises | 用户可在不把数据传出机构环境的情况下，通过自然语言查询受治理的金融数据 | Teradata 匿名客户案例；未披露 GPU 数量、模型型号和量化性能 |
| Starling Bank | 交易数据驱动的 Agentic AI / 银行智能层 | 在英国主权云 Civo 上使用自有交易数据开发 Starling Intelligence | 银行称其为英国主权云上训练 Agentic Model 的先行实践 | NVIDIA 行业综述；未披露 GPU 规格、模型参数和生产负载 |
| Lloyds Banking Group | 交易基础模型 ATUM | NVIDIA RTX PRO 6000 Blackwell GPU | 将数十亿笔交易转化为可复用的交易智能 | NVIDIA 行业综述；未披露集群规模和业务指标 |

### 22.2 BNY：先建设共享计算平台，再扩展业务用例
BNY 在 2024 年宣布部署基于 DGX H100 的 NVIDIA DGX SuperPOD，采用 InfiniBand 网络，并与 NVIDIA Professional Services 合作完成安装配置。系统部署在 BNY 自身基础设施中，使用 NVIDIA AI Enterprise 支持 AI 应用开发和基础设施管理。

这套基础设施并非只服务一个 LLM。BNY 当时已经有 20 多个 AI 方案投入生产，覆盖预测分析、自动化和异常检测；SuperPOD 的候选场景包括存款预测、支付自动化、预测性交易分析和日终现金余额。公司还披露识别出 600 多个 AI 机会，数百名数据科学家、解决方案架构师、风险、控制和合规人员参与平台使用。

这个案例说明 GPU 平台投资需要业务组合支撑。单一生成式 AI 用例通常难以长期维持一套大型 GPU 集群的利用率。共享平台可以承载训练、批量推理、在线推理和传统 ML，但调度时仍要区分交互任务与离线任务的优先级，避免批处理挤占交易时段的在线资源。

来源：[NVIDIA：BNY First Global Bank to Deploy AI Supercomputer Powered by NVIDIA DGX SuperPOD With DGX H100](https://blogs.nvidia.com/blog/bny-mellon-superpod/)。

### 22.3 BNP Paribas：把模型访问做成集团级内部服务

BNP Paribas 在自有数据中心建设内部 LLM as a Service 平台，由集团 IT 统一运营 GPU 基础设施，通过标准化、安全的接口向不同业务实体提供模型。平台既提供开放模型，也接入 Mistral 模型，并计划根据业务需要使用内部数据训练或定制模型。初期试点涉及 Hello bank! 和集团检查部门，应用包括内部助手、文档生成和信息检索。

2026 年 BNP Paribas 与 Mistral AI 将合作延长三年，范围从模型访问扩展到软件、联合研发和定制应用。公开的优先场景包括内部知识检索、研究分析、KYC 流程和 Hello bank! 的客户助手 HelloïZ。对于 KYC 等敏感流程，生成式 AI 用于减少低价值人工步骤、组织工作流，风险识别和决策仍由专家验证。

架构上的重点是平台团队维护模型目录、GPU 资源、身份与审计，业务团队负责场景、数据授权和输出验收。各实体不必各自部署一套 GPU 服务，也不应该因为共用模型平台就获得跨实体的数据访问权。

来源：[BNP Paribas：Internal LLM as a Service platform](https://group.bnpparibas/en/press-release/bnp-paribas-provides-its-businesses-with-an-llm-as-a-service-platform-to-accelerate-the-industrialization-of-generative-ai-use-cases)；[BNP Paribas 与 Mistral AI 延长合作](https://group.bnpparibas/en/press-release/bnp-paribas-and-mistral-ai-extend-their-partnership-to-support-the-next-phase-of-generative-ai-deployment-within-the-group)。

### 22.4 RBC Capital Markets：AI Factory 与 Agent 平台一起扩展

RBC Capital Markets 与 Borealis AI 建设 Aiden 平台，覆盖研究分析和投行业务。AidenResearch 使用专门的 Agent 处理财报相关内容、电话会议摘要、数据目录检索和监管文件访问；AidenBanker 则面向 Pitchbook 生成、会前准备和会议记录。

NVIDIA 公布的架构信息包括 AI Factory、本地与混合云基础设施、NeMo Agent Toolkit、NeMo Retriever、KDB.ai、Nemotron 和 NIM。Aiden 已扩展到 8,000 多名用户。公开结果包括文档处理能力提高 10 倍、Research QuickTakes 报告生成时间最多缩短 60%。

这类工作负载的难点不只是推理吞吐。研究报告需要引用可追溯的市场数据和文件，Agent 需要访问内部数据目录与检索服务，银行家助手还涉及客户信息和交易材料。模型服务、检索索引、Agent 工具权限和生成内容审计应分别治理。金融数据的时间属性也很重要：KDB.ai 这样的时序数据系统与普通向量检索承担不同职责，不能把实时行情、历史序列和文档语义检索全部塞进同一套向量数据库。

来源：[NVIDIA：RBC Capital Markets Advances Research and Banking Capabilities With Agentic AI](https://www.nvidia.com/en-eu/case-studies/rbc-capital-markets/)。

### 22.5 Revolut：交易基础模型与通用 LLM Serving 是两类问题

Revolut 的 PRAGMA 不是聊天型 LLM，而是面向金融交易与客户行为的 Encoder-style Foundation Model。它希望替代欺诈、信用、营销响应和客户生命周期价值等场景中彼此割裂的特征工程与模型流水线。

NVIDIA 公布的技术资料显示，PRAGMA 在 Nebius AI Cloud 的 H100 GPU 集群上训练，使用约 2,600 万用户记录、111 个国家、约 240 亿至 400 亿事件和 2,070 亿 Token 的历史数据。团队使用 shard-based dynamic batching、固定 GPU Token Memory Budget 和 variable-length attention kernels，减少 Padding 带来的 GPU 空转。公开材料称，序列打包和动态批处理使训练吞吐比 Padding 基线提高 2–5 倍。较小的 PRAGMA-S 在 16 张 H100 上约两天收敛，较大版本在 16–32 张 GPU 上约两周。

模型训练之后，Revolut 将 PRAGMA 作为共享表示层用于欺诈、信用、营销和产品推荐。部分任务冻结 Backbone，仅训练轻量预测头；另一些任务通过 LoRA 更新约 2%–4% 的参数。PRAGMA-S 面向交易时的低延迟欺诈筛查，更大的模型变体用于对准确率要求更高、延迟要求相对宽松的任务。

2026 年 10 月 NVIDIA 进一步披露，Revolut 正在 Blackwell Ultra GPU 上生产扩展 PRAGMA，采用 cuDF 与 Dynamo-Triton，服务初始 8,000 万客户规模并按 3 倍规模设计。这里应区分两条技术路径：H100 / Nebius 的公开案例主要说明训练数据和 GPU 利用率优化；Blackwell Ultra / Dynamo-Triton 的信息说明后续生产 Serving。公开材料没有证明训练和在线推理全部运行在同一套集群中。

对银行而言，PRAGMA 案例说明 GPU 不只是生成式 AI 的基础设施。交易基础模型、时序模型和传统 ML 也可能更直接地改善风险、推荐和信用决策。它们需要的评测指标是 Recall、Precision、KS、AUC、校准度和业务损失，而不是只看生成 Token 吞吐。

来源：[NVIDIA：Revolut Builds a Transaction Foundation Model With NVIDIA Accelerated Computing Platform](https://www.nvidia.com/en-us/case-studies/revolut/)；[NVIDIA：European Financial Services Organizations Embrace Open Models](https://blogs.nvidia.com/blog/european-financial-services-organizations-open-models-proprietary-intelligence/)。

### 22.6 Santander：模型选择和推理成本一起优化

Santander AI Lab 建立 Model Arena，用银行任务评估开放权重模型，选择适合不同任务的模型；通过 NVIDIA NeMo Customizer 专门化模型，并使用 NVIDIA Kumo 处理结构化数据场景。推理工业化路线涉及 Dynamo-Triton。

Santander 在 2026 年 10 月披露，某些实验性客户服务任务从通用大模型转向小型专用模型后，单次交互推理成本从约 €5 降至约 €0.03，同时保持了较好的表现。该数字是特定实验场景的结果，不能用作全行成本基线。真正可复用的经验是建立模型评测与路由机制：任务先经过离线评估和对抗测试，再决定使用哪一种模型、是否需要专用 GPU 资源，以及何时升级到更大模型。

这比简单地将所有请求送往同一个大模型更适合银行。大量分类、摘要、结构化抽取和标准化客户服务任务可能由专用小模型承担；需要复杂推理的任务再交给大模型。路由决策必须由可审计的策略和评测结果控制，不能仅依赖模型自行判断。

来源：[Santander：AI capabilities using NVIDIA infrastructure, 19 October 2026](https://www.santander.com/en/press-room/press-releases/2026/10/santander-builds-ai-capabilities-that-improve-performance-and-lower-costs-using-nvidia-ai-infrastructure)。

### 22.7 Capital One：GPU 支持的 Agent 工作流不一定等于自建模型平台

Capital One 在 GTC 2026 介绍了用于复杂欺诈案件处理的多 Agent 工作流。系统帮助数百名银行客服人员分析客户与客服之间可能长达一小时的对话，生成准确的结构化摘要，降低人工复盘负担，并支持质量审查和客服效率提升。

公开会议摘要提到 NVIDIA 数据中心 GPU 和 MIG，但没有披露具体 GPU 型号、集群规模、模型部署位置或是否由 Capital One 自行运营底层 GPU。它适合作为金融 Agent 工作流案例，而不是自有 B300 集群案例。

从工程角度看，长音频转录、说话人分离、摘要、欺诈事实提取和后续行动建议应分成可独立评估的步骤。任何会影响客户账户或欺诈处置的动作都需要明确的人审边界。GPU 资源也应区分实时语音/文本处理与后台质量分析，避免长任务占满低延迟服务的资源池。

来源：[NVIDIA GTC 2026：Building Proprietary Multi-Agentic AI Workflows for a Consumer Banking Operational Use Case, presented by Capital One](https://www.nvidia.com/en-us/on-demand/session/gtc26-ex82362/)。

### 22.8 Discover Financial Services：多 GPU 不一定更经济

Discover 在 AWS 上建立统一的数据科学工作台，使用 EC2 P3 / P4 GPU 实例进行机器学习和 HPC。公开案例给出一个容易理解的性能比较：处理 20,000 行客服对话转录数据，16 个 CPU 需要约 6.5–7 小时，单 GPU 约 23 分钟，多 GPU 约 4 分钟，但多 GPU 成本更高。该平台还使用 S3 保存模型制品、EFS 共享数据，并允许数据科学家按任务选择单 GPU、多 GPU 或内存密集型实例。

这个案例不应被误读成 LLM Serving 案例。它证明的是金融数据科学平台需要按 workload 选择计算形态。若任务从 7 小时降到 23 分钟已经满足业务 SLA，再增加 GPU 把时间压到 4 分钟，未必值得。GPU 采购和租赁都应该用单位任务成本、截止时间和并发需求评估，而不是单纯追求最低延迟。

来源：[AWS：Discover Financial Services Builds a Generative AI Solution on AWS](https://aws.amazon.com/solutions/case-studies/discover-financial-services-generative-ai/)。

### 22.9 NeoSpace 与拉美银行：GB200 NVL72 用于结构化金融基础模型

NeoSpace 的 NeoData 平台面向金融机构的结构化、事件和非结构化数据，使用 NVIDIA CUDA、RAPIDS、TensorRT-LLM 和 Dask。NVIDIA 案例称，NeoSpace 通过 Oracle Cloud Infrastructure 生产部署 GB200 NVL72，为拉美大型银行提供训练和推理基础设施。

一个信用额度倾向模型的案例使用超过 10 TB 数据，覆盖超过 5,000 万客户，生产影响范围约 600 万客户。公开结果包括相对银行基线 KS 提升 10–20 个百分点，以及分位数顶部客户的转化表现改善。这里的模型是表格/交易数据 Foundation Model，不是聊天 LLM。

这个案例对 B300 文章的价值在于说明 GB200 / GB300 级别的机架系统并非只服务超大语言模型。结构化金融数据模型也可能需要高吞吐训练、海量数据处理和规模化推理。但公开材料没有披露该银行具体使用了多少 NVL72、集群利用率和单次预测成本，不能据此推导容量或 ROI。

来源：[NVIDIA：NeoSpace Develops Large Tabular Foundation Models for Financial Institutions](https://www.nvidia.com/en-us/case-studies/neospace/)。

### 22.10 南亚大型商业银行：H200 On-Prem 与数据主权

Teradata 公布的一项匿名银行案例采用 NVIDIA H200 GPU 基础设施，将数据平台、MCP Server 和 AgentBuilder 部署在银行自己的数据中心。业务人员通过自然语言访问受治理的金融数据，平台不依赖公有云，也不把数据传到银行环境之外。

公开材料没有给出 GPU 数量、模型型号、并发、Token 吞吐或项目成本，因此它只能作为 On-Prem 数据边界和企业集成方式的案例。其价值在于展示 GPU 推理服务需要和既有数据权限、语义治理、审计及企业数据平台共同设计。MCP Server 并不会自动带来数据治理，工具层仍需执行用户身份映射、行列权限、查询限制和审计。

来源：[Teradata：From Data to Decisions Inside the Firewall](https://www.teradata.com/customers/sovereign-factory-south-asia-bank)。

### 22.11 金融行业案例的共同点与差异

| 业务类别 | 代表案例 | 更适合的模型/计算类型 | GPU 平台需要解决的问题 |
| --- | --- | --- | --- |
| 欺诈与交易风险 | Revolut、Capital One、BNY | 交易基础模型、时序模型、分类模型、语音/文本模型 | 极低延迟、在线特征、模型更新、可解释性、峰值交易负载 |
| 信用与客户倾向 | NeoSpace、Discover | 表格 Foundation Model、GBDT/Transformer、批量和在线推理 | 大规模结构化数据、训练吞吐、特征一致性、漂移监控 |
| 研究与投行 | RBC | LLM + RAG + Agent、文档解析、时序数据分析 | 引用溯源、市场数据时效、工具权限、输出审查 |
| 集团内部助手 | BNP Paribas、南亚银行 | 多模型 LLM Serving、RAG、结构化数据 Agent | 数据驻留、租户隔离、模型目录、成本分摊 |
| 客户服务 | Santander、Capital One | ASR、专用 SLM、LLM、Agent | 流式延迟、对话质量、人工接管、模型路由 |
| 支付与运营 | BNY、BNP Paribas | 预测模型、异常检测、文档/流程 Agent | 高可用、批处理窗口、审计、与核心系统集成 |

这些案例不能支持“所有金融机构都应该自建 GPU 集群”这样的结论。BNY、BNP Paribas 的路径偏向自有数据中心共享平台；Discover 使用 CSP GPU；RBC 采用本地与混合云 AI Factory；Revolut 的公开材料涉及云端训练和 Blackwell 生产推理；Santander 强调专用模型和推理优化；Capital One 的资料主要说明业务 Agent 场景。部署模式取决于数据边界、业务时延、现有基础设施、团队能力和成本曲线。

## 23. 在 GPU 上部署模型，究竟有多难？

如果目标只是让一个开源模型在一张 GPU 上返回文本，工程难度并不高。熟悉 Linux、Docker 和 Python 的工程师通常可以在一天内完成基础验证。真正拉开难度差距的是模型大小、并发、上下文长度、延迟目标、可用性和安全要求。生产系统还要面对模型升级、GPU 故障、驱动兼容、资源争抢、成本核算和审计。

### 23.1 按部署范围看难度

| 阶段 | 典型环境 | 主要工作 | 难度判断 | 常见负责人 |
| --- | --- | --- | --- | --- |
| 个人验证 | 单张消费级或数据中心 GPU | 安装驱动、容器、模型下载、启动 vLLM / Ollama、调用 API | 低；适合单人完成 | ML Engineer / Developer |
| 单机生产服务 | 单机 1–8 张 GPU | 模型量化、显存规划、并发、API、安全、监控、重启恢复 | 中；需要推理工程经验 | ML Platform Engineer |
| 多节点推理 | 多台 8-GPU 服务器 | RDMA、NCCL、TP/PP/EP、拓扑感知调度、分布式故障处理 | 高；涉及 GPU、网络和平台团队 | GPU Infra + Network + ML Platform |
| 机架级系统 | HGX / GB300 NVL72 等 | 液冷、电力、NVLink 域、机架网络、设施和供应商协同 | 很高；属于数据中心基础设施项目 | Data Center + OEM + GPU Platform |
| 企业级 AI 平台 | 多模型、多团队、多租户 | Model Registry、Gateway、Quota、Policy、审计、计量、SLO、DR | 很高；持续运营工作 | AI Platform Product/Engineering |

以上难度是工程经验分级，不是厂商认证或统一行业评分。一个单机服务如果涉及敏感客户数据、严格可用性和高并发，也可能比一个隔离的多节点实验集群更难交付。

### 23.2 部署难点通常出现在这些层次

**硬件和驱动层。** GPU 是否被系统正确识别只是起点。需要确认驱动、CUDA Runtime、容器 Toolkit、GPU 固件、NIC 固件和内核版本之间的兼容性。常见故障包括宿主机驱动与容器 CUDA 用户态库不匹配、GPU Xid 错误、ECC 错误、GPU 掉卡、PCIe / NVLink 链路异常，以及节点重启后设备枚举变化。生产环境必须有经过验证的版本矩阵和节点健康检查。

**模型适配层。** 模型仓库能下载，不代表推理引擎可以运行。模型可能使用自定义算子、特殊 Attention、MoE Router、量化格式或特定 Tokenizer。模型权重格式、配置、Tokenizer、推理代码和量化元数据需要作为一个版本化制品管理。升级模型时要重新跑功能、精度和性能测试，不能只比较参数量。

**显存和调度层。** GPU 显存不仅装模型权重，还要放 KV Cache、Activation、CUDA Graph、通信 Buffer 和临时 Workspace。即使模型能够加载，长上下文和并发增加后也可能发生 OOM 或队列堆积。显存利用率高不一定代表吞吐最优；为 KV Cache 留出空间、限制最大上下文和设置合理的并发上限，通常比把显存填满更重要。

**网络和分布式计算层。** 单节点内的 NVLink 通信与跨节点 RDMA 不是一回事。多节点 TP / EP 可能因为网络拥塞、错误的 NIC 选择、PFC 配置、NCCL 拓扑识别或交换机 oversubscription 而明显退化。GPU 利用率低也可能是通信等待，而不是算力不足。要通过 NCCL Tests、GPU/NIC 拓扑检查和实际模型 Trace 分层定位。

**服务和业务集成层。** OpenAI-compatible API 只说明协议形态接近，并不保证 Tool Calling、Streaming、Cancellation、JSON Schema、Usage 统计和错误语义完全兼容。企业还需要统一身份、租户配额、限流、请求追踪、模型路由、内容安全和审计。

**生产运维层。** 模型服务不是部署一次就结束。模型权重、容器镜像、驱动、推理框架、Kubernetes Operator、网络固件和策略配置都需要升级管理。升级失败要能回滚；GPU 节点失效时要能隔离、排空、重建和恢复模型副本；容量不足时要能限流、降级或切换到备用服务。

### 23.3 GPU 模型部署的技能地图

| 能力域 | 单机阶段 | 多节点/生产阶段 | 是否必须由同一人掌握 |
| --- | --- | --- | --- |
| Linux、容器、系统诊断 | 必须 | 必须 | 不必，但要有明确责任人 |
| CUDA / GPU Runtime | 基础理解 | 驱动、库、拓扑和性能诊断 | 不必 |
| PyTorch / 模型结构 | 能加载和验证模型 | 自定义算子、量化、精度与性能分析 | 不必 |
| vLLM / SGLang / TensorRT-LLM | 能部署和调参 | 多节点并行、KV Cache、调度和升级 | 不必 |
| Kubernetes | 可选 | GPU Operator、Device Plugin、拓扑和故障域 | 不必 |
| RDMA / InfiniBand / RoCE | 不需要 | 多节点高性能场景需要 | 应由网络/GPU Infra 团队负责 |
| MLOps / Model Registry | 简单版本记录 | 制品、审批、评测、部署和回滚闭环 | 不必 |
| 安全与合规 | 本地访问控制 | IAM、租户隔离、审计、数据驻留、供应链 | 必须有独立责任人 |
| 机房设施 | 云 GPU 可由 CSP 承担 | 自有机房需电力、液冷、消防和现场运维 | 应由设施/OEM 团队负责 |

企业不需要招聘一个“精通所有 GPU 技术”的超级工程师。更实际的组织方式是由 GPU Infrastructure、ML Platform、Network、Security、SRE 和业务应用团队共同负责，并通过标准化接口减少彼此耦合。若租用 CSP GPU 或 Managed Kubernetes，部分底层工作由供应商承担，但模型运行时、服务 SLO、数据权限和业务故障责任仍需要内部团队负责。

### 23.4 自己部署、租 GPU 和托管推理，复杂度差在哪里

| 模式 | CSP / 供应商负责 | 企业仍需负责 | 主要隐藏成本 |
| --- | --- | --- | --- |
| 自有 GPU + 自有机房 | OEM 保修和部分现场服务 | 设施、网络、驱动、K8s、推理、监控、备份、容量、升级 | 资本占用、闲置容量、设施和专职团队 |
| 租 GPU VM / Bare Metal | 物理设施、部分硬件维护 | OS、驱动、容器、K8s、推理服务、网络配置和模型运营 | GPU 闲置、跨区流量、存储、运维人力 |
| Managed Kubernetes + GPU | Control Plane、部分 K8s 管理 | GPU Worker、模型 Runtime、缓存、API、容量和模型质量 | 托管服务溢价、功能限制、节点与区域可用性 |
| Dedicated Managed Inference | GPU、Serving 平台的部分或全部运营 | 模型选择、数据授权、评测、路由、配额和供应商管理 | 最低承诺、模型限制、迁移成本和 SLA 边界 |
| 托管模型 API | 模型推理基础设施 | 数据边界、API 集成、配额、质量评测和成本控制 | Token 费用、速率限制、供应商依赖 |

“租 GPU”只解决了资本采购和机房设施的一部分问题，并不会自动解决推理框架、模型适配、容量规划和 GPU 利用率。Managed Kubernetes 也不等于 Managed Inference：供应商负责 Kubernetes Control Plane，并不意味着它负责模型权重、KV Cache、推理性能和 API 兼容。

### 23.5 什么时候应该自己部署模型

适合自部署的情形通常包括：数据必须留在特定安全域或地理区域；请求量稳定且足够大，能支撑 GPU 长期利用；模型需要深度定制、量化或专用算子；需要对模型版本、推理路径和日志保留有较强控制；业务对延迟和服务行为有专门要求。

如果请求量低、模型变化快、团队缺少推理运维经验，或者业务必须使用某个托管模型的独有能力，托管 API 往往更合理。对金融机构尤其如此：监管要求并不必然等于所有模型都必须部署在自有机房。应逐个判断数据分类、供应商控制、合同约束、跨境处理和业务连续性要求。

## 24. 从 POC 到生产：GPU Serving 的 Engineering Practice

GPU 部署项目最容易失控的方式，是先采购大集群，再让应用团队寻找可以填满 GPU 的用例。建议先从可测量的业务任务和请求 Trace 出发，逐步验证模型、硬件和服务架构。

### 24.1 POC 阶段：先回答五个问题

POC 不应只演示模型能输出结果。至少需要明确：

1. **模型是否适合任务？** 使用固定的业务评测集验证正确率、工具调用、结构化输出、拒答行为和长上下文能力。
2. **模型能否在目标 GPU 上运行？** 验证权重格式、量化、算子、Tokenizer、显存占用和启动时间。
3. **真实负载能否达到 SLO？** 使用真实或脱敏 Trace，覆盖输入长度分布、输出长度、并发、请求到达率和取消行为。
4. **单位业务任务成本是否合理？** 计算每个成功任务的 GPU 秒数、Token、存储、网络和人工复核成本。
5. **故障时如何恢复？** 测试进程退出、GPU Xid、节点重启、模型加载失败、存储不可用、网络中断和请求超时。

POC 应有退出条件。若模型质量不达标，不要通过增加 GPU 掩盖模型不合适；若单节点已经满足 SLO，也不必为了展示分布式能力而引入多节点复杂度。

### 24.2 建立可复现的 GPU 节点基线

每台节点都应有可复现的基线记录，至少包含 GPU UUID、显存与 ECC 状态、温度和功耗，GPU/CPU/NIC/NVMe 的 PCIe 与 NUMA 拓扑，以及 Driver、CUDA、NCCL、OFED、固件和 Kubernetes GPU 组件版本。节点镜像、容器镜像 Digest 和模型权重 SHA-256 也要纳入记录，否则故障时无法判断是硬件差异还是软件版本漂移。

这些信息不应靠人工填表。节点加入生产 GPU Pool 前，自动资格检查应验证设备识别、显存、GPU/NIC 拓扑、NCCL 通信、存储吞吐和容器运行；驱动或固件升级后重新执行同一套测试。结果进入资产与变更记录，出现性能回退时才能与历史基线比较。

### 24.3 模型制品和运行配置必须一起版本化

生产模型部署至少应有一个不可变的 Release Manifest，记录：

| 字段 | 示例内容 |
| --- | --- |
| Model ID | 组织内部唯一模型标识 |
| Model revision | 权重版本或上游 commit |
| Tokenizer revision | Tokenizer 文件版本 |
| Quantization | BF16 / FP8 / FP4 / AWQ / GPTQ 等 |
| Runtime | vLLM / SGLang / TensorRT-LLM 及版本 |
| Container | 镜像 digest，而不是可变 tag |
| GPU target | B200 / B300 / H100 等 |
| Parallelism | TP / PP / DP / EP 配置 |
| Context / batching | 最大上下文、最大并发、最大 batched tokens |
| Evaluation | 评测集版本、质量结果、性能结果 |
| Security | 来源、许可证、扫描结果、审批记录 |

同一份权重在不同推理引擎、量化配置和 CUDA Kernel 下可能产生不同的输出质量与性能。模型版本不能只记录 Hugging Face repo 名称；运行配置也不能散落在 Helm values、手工命令和聊天记录里。

### 24.4 Benchmark 要模拟 Agent 任务，而不只是压测 Tokens/s

Benchmark 必须覆盖完整 Agent 任务。离线模型评测可以先固定输入输出，检查代码正确性、指令遵循和工具调用格式；Serving 测试再用真实请求分布观察 TTFT、TPOT、队列等待、KV Cache 命中和 OOM。最后要在相同仓库、工具权限和测试集上运行完整 Agent Harness，记录任务是否真正完成、模型调用次数、工具失败、重试、人工接管和总耗时。

只比较 Tokens/s 很容易得出错误结论。一个模型即使生成速度更快，只要经常调用错误工具、丢失上下文或需要多轮修复，完成任务的总成本就可能更高。容量规划和经济性比较应以同类任务的成功率、耗时和总成本为准。

### 24.5 生产监控：把 GPU、Serving 和业务指标关联起来

| 监控层 | 关键指标 | 能发现的问题 |
| --- | --- | --- |
| GPU / 节点 | Utilization、HBM 使用、温度、功耗、ECC、Xid、NVLink 错误 | 硬件异常、显存不足、GPU 空转 |
| 网络 | NIC 吞吐、丢包、RDMA 错误、PFC pause、ECN、NCCL 时间 | 多节点通信退化、拥塞 |
| Serving | Queue depth、TTFT、TPOT、ITL、tokens/s、请求错误、取消率 | 排队、批处理不合理、服务退化 |
| KV Cache | 命中率、占用、Eviction、Block 分配失败 | Prefix Cache 失效、长上下文并发下降 |
| 模型质量 | 评测通过率、拒答、工具调用成功率、回归差异 | 模型升级或量化造成质量退化 |
| Agent 业务 | 成功任务数、任务时长、重试、工具失败、人工接管 | 模型吞吐正常但任务质量变差 |
| 成本 | GPU-hour、每百万 Token、每成功任务成本、闲置率 | 资源配置不合理、成本失控 |

监控必须带有 Model ID、Model Revision、Tenant、Request ID 和 Trace ID。否则当某个业务团队反馈“模型变慢”时，平台团队无法区分是模型升级、上下文增长、缓存未命中、网络拥塞还是 Agent 重试增加。

### 24.6 常见故障与排查顺序

| 症状 | 优先检查 | 常见原因 | 处理方式 |
| --- | --- | --- | --- |
| 模型无法启动 | 驱动、容器 Runtime、权重格式、显存 | 版本不匹配、权重损坏、量化不支持 | 回到已验证镜像和模型制品，逐项确认兼容矩阵 |
| GPU 利用率低但请求很慢 | Queue、CPU、Tokenizer、网络、Batching | 请求排队、CPU 预处理、通信等待、批处理策略不合适 | 通过 Trace 分离排队、Prefill、Decode 和通信时间 |
| 长上下文时 OOM | KV Cache、最大序列长度、并发、临时 Buffer | KV Cache 估算不足或并发过高 | 限制并发/上下文、调整 KV 配置或增加资源 |
| 多节点吞吐低于单节点预期 | NCCL、RDMA、NIC 绑定、交换机拓扑 | 走错 NIC、拥塞、跨节点通信过多 | 跑 NCCL Tests，检查 GPU/NIC 拓扑和网络计数器 |
| 更新后质量下降 | 权重、Tokenizer、量化、Runtime、Prompt | 模型或运行时行为变化 | 固定评测集做回归，支持 Canary 和快速回滚 |
| GPU 节点故障后恢复慢 | 模型分发、镜像拉取、Pod 调度、缓存预热 | 权重加载成为启动瓶颈 | 本地 NVMe 缓存、分层分发、预热和容量冗余 |
| 成本上升但请求量不变 | Token 分布、重试、缓存命中、GPU 闲置 | 上下文膨胀、Agent 循环、路由不当 | 分解每任务 Token、GPU 秒数和重试来源 |

排查时先定位耗时在哪一段，再决定是否需要更多 GPU。GPU 利用率低不一定意味着 GPU 数量过多；它也可能是 CPU Tokenizer、网络等待、模型权重加载、队列策略或应用侧限流造成的。

### 24.7 Day-2 运维：升级、容量和灾难恢复

Day-2 运维的重点是让变更可控、故障可恢复。Driver、CUDA、NCCL、推理引擎、模型权重和运行配置都要有明确版本，但每次升级尽量只改变一个可定位的变量。新版本先进入隔离 GPU Pool，完成质量与性能回归后再 Canary 少量流量；只有延迟、成功率和成本都达到门槛，才扩大范围。回滚所需的旧模型、镜像、配置和节点镜像必须保留在可快速访问的位置，不能等故障发生后再从外部重新下载。

容量管理要同时考虑常态、峰值和故障场景，为节点维护、GPU 故障及模型重新加载预留余量。训练、离线批处理和在线交互应分池或设置明确优先级。模型制品、配置、审计和评测数据需要跨故障域保存，并定期演练恢复，实际测量 RTO、RPO 和副本预热时间。供应链记录则覆盖模型权重、容器镜像、Python 包、自定义 Kernel 和基础镜像的来源、许可证、扫描结果与签名。

### 24.8 一个务实的实施顺序

| 阶段 | 交付物 | 进入下一阶段的条件 |
| --- | --- | --- |
| 1. Workload Discovery | 脱敏 Trace、任务分类、SLO、数据分类 | 能说明目标负载和业务成功标准 |
| 2. Single-node POC | 一台 8-GPU 节点或租用等价资源、模型基线、API | 质量、吞吐、延迟和成本满足初步目标 |
| 3. Production Foundation | Model Registry、镜像流水线、Gateway、监控、审计 | 可重复部署、可回滚、权限边界明确 |
| 4. Multi-node Validation | RDMA/NCCL、TP/EP、故障注入、扩容测试 | 多节点确实带来可量化收益 |
| 5. Controlled Rollout | Canary、配额、成本计量、业务反馈 | 质量和 SLO 在真实流量下稳定 |
| 6. Optimization | KV-aware Routing、P/D 分离、量化、模型路由 | 优化收益覆盖额外复杂度和运维成本 |

如果第一阶段证明一个或两个单节点模型池就能满足业务需求，就应停留在这个规模。多节点、P/D 分离、全局 KV Cache 和复杂调度不是成熟度徽章；只有当瓶颈数据证明它们有价值时才引入。

## 25. 对企业架构决策的归纳

GPU 部署的技术难度并不平均分布。单机推理通常是模型与运行环境集成问题；多节点推理会迅速变成网络、拓扑和分布式调度问题；企业级平台则进一步涉及安全、审计、容量、成本、模型治理和持续运营。

金融机构的案例也显示，GPU 投资不必全部押在通用 LLM 上。交易基础模型、信用风险、欺诈检测、客户服务、研究分析和内部知识平台可能共享部分基础设施，但应保留各自的模型评测、数据权限和服务 SLO。模型服务可以集中，业务风险责任不能因此变得模糊。

对 2000 名开发者的 AI Coding 平台，先采集实际 Agent Trace，确定模型调用分布和成功任务成本，再用一台 8-GPU 节点建立质量与性能基线。确认模型、上下文和并发需求后，再评估多节点网络与 GB300 NVL72。部署位置则根据数据分类、团队能力和成本选择自有机房、CSP GPU、Dedicated Inference 或混合模式。

最终的采购和架构评审应回答三个问题：目标业务是否需要自管模型；内部团队是否准备好承担 GPU Serving 的 Day-2 责任；自管方案是否在满足安全和 SLO 的同时，降低了单位成功任务成本或带来了托管服务无法提供的控制能力。若答案不明确，继续扩大 GPU 集群只会提前固化尚未验证的假设。

## 结论

企业是否自部署 GPU，取决于数据边界、负载规模、模型控制需求和内部运维能力，而不是开发者人数或峰值算力。对 2000 名开发者的 AI Coding 平台，应先用真实 Agent Trace 和单节点 POC 建立质量、延迟及单位成功任务成本基线，再决定采用自有 GPU、CSP、Dedicated Inference 或托管 API，以及是否需要扩展到多节点和 GB300 NVL72。

## 26. 2000 名开发者的 Workbench：只考虑 AWS 与 Azure GPU 租用

本章将云基础设施范围限定为 **Amazon Web Services（AWS）和 Microsoft Azure**。GPU 以云 VM / GPU 实例租用，不讨论自建机房或其它 GPU 云厂商。两家都能提供 H100、H200 及 Blackwell 级实例，但具体 SKU、区域配额、可用区容量、网络拓扑和价格差异很大；采购前必须以目标区域的实时价格、企业折扣和容量确认结果为准。

### 26.1 从 2000 个席位推导负载，而不是按人数购买 GPU

“支持 2000 名开发者”不等于同时处理 2000 个模型请求。用于初期预算的规划假设如下，最终容量必须由真实 Agent Trace 验证：

| 指标 | 初始规划假设 |
| --- | ---: |
| 注册开发者 | 2,000 |
| 日活比例 | 65%–75%，约 1,300–1,500 DAU |
| 高峰同时活跃 Agent Session | 180–250 |
| 短时峰值 | 300–350 |
| 可用性目标 | 99.9% 起步，控制面、工具执行面和模型服务分别定义 SLO |

这里的 Agent Session 是活跃任务，不是持续占用 GPU 的 Decode 请求。每个 Session 会在上下文检索、工具调用、测试执行和模型生成之间切换。真正决定 GPU 数量的是 Prefill/Decode Token 分布、并发生成数、上下文长度、KV Cache 命中率、TTFT/TPOT 目标，以及每个成功任务调用模型的次数。

POC 至少采集两周脱敏 Trace，覆盖工作日峰值、代码审查高峰、CI 故障处理和长任务。以 P95/P99 延迟、排队时间、任务成功率和每成功任务 GPU-seconds 验收。模型、Prompt、Agent Harness 或 MCP 工具改变后，重新测量单位任务成本。

### 26.2 Workbench 应该包含什么

Workbench 不只是 IDE 插件或 LLM Gateway，而是开发者入口、Agent 生命周期管理、工具执行和推理服务的组合。

| 层次 | 组件 | 职责 |
| --- | --- | --- |
| Developer Experience | VS Code / JetBrains 插件、CLI、Web Console | SSO、会话、任务状态、模型选择、差异审阅和人工确认 |
| Identity & Policy | Entra ID / IAM Identity Center、OIDC、RBAC、策略引擎 | 仓库权限、模型权限、工具权限、数据分类和审批 |
| Workbench Control Plane | API Gateway、Session Service、Agent Orchestrator、Queue、Quota | 会话生命周期、排队、取消/重试、团队配额、审计和路由 |
| Agent Runtime | Coding Agent Harness、Context Builder、MCP Registry、Tool Broker | 仓库上下文、代码检索、工具调用、模型协议适配和任务验证 |
| Isolated Execution | Ephemeral Container / VM、Git Worktree、Test Runner | 每任务隔离文件系统、凭据和网络；不把云凭据交给模型 |
| Model Gateway | OpenAI-compatible API、Model Router、Prefix Cache | 模型路由、限流、重试、熔断、成本归因和版本治理 |
| GPU Inference | AWS EC2 P5e/P5en 或 P6；Azure ND H200 / ND GB200 | vLLM / SGLang / TensorRT-LLM 推理池；在线与批处理分池 |
| Platform Services | Redis、PostgreSQL、对象存储、Logs/Trace/Metrics | 会话元数据、任务事件、模型制品、审计和 FinOps |

Workbench 控制面不能依赖 GPU 节点存活。GPU Pool 故障时，Session、任务状态、审计和权限仍需可用；模型路由可以切换到备用池或托管模型，但不能绕过数据分类。工具执行必须经过 Tool Broker 和隔离环境，不能因为 GPU 与 Agent 位于同一 VPC 就默认共享凭据或生产网络权限。

### 26.3 AWS 与 Azure 的 GPU 实例选择

中到重度 Coding Agent 推理建议先以 H200 做容量基线。B200/B300 或 GB200 适合模型权重、KV Cache 或实测并发已经证明需要更大显存和更高吞吐的情况。不要只根据峰值算力采购；Coding Agent 的瓶颈经常在长上下文 Prefill、KV Cache、Decode、Tokenizer、队列和工具等待。

| 云平台 | 实例系列 | GPU 配置 | 适用场景与注意事项 |
| --- | --- | --- | --- |
| AWS | EC2 P5 | 8× H100 | 80GB/GPU；适合已有 H100 运行栈或成本基线 |
| AWS | EC2 P5e / P5en | 8× H200 | 141GB/GPU；推荐作为初始基线，P5en 面向更高网络带宽与 RDMA 需求 |
| AWS | EC2 P6-B200 / P6-B300 | 8× B200 / B300 | 大模型、高 KV Cache 容量和高并发；价格与配额要求更高 |
| Azure | ND H100 v5 | 8× H100 | H100 多 VM 扩展依赖 InfiniBand 与 NCCL 拓扑 |
| Azure | ND H200 v5 | 8× H200 | 141GB/GPU，节点内 NVLink，跨 VM InfiniBand；推荐基线 |
| Azure | ND GB200 v6 | 4× GB200 / VM | Blackwell 方案；NVL72 rack-scale 由多 VM 组成，不能按单 VM 规格理解 |

官方规格参考：[AWS P5](https://aws.amazon.com/ec2/instance-types/p5/)、[AWS EC2 加速实例规格](https://docs.aws.amazon.com/ec2/latest/instancetypes/ac.html)、[AWS P6-B300](https://aws.amazon.com/blogs/aws/accelerate-large-scale-ai-applications-with-the-new-amazon-ec2-p6-b300-instances/)、[Azure ND-H200-v5](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/gpu-accelerated/nd-h200-v5-series)、[Azure ND-GB200-v6](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/gpu-accelerated/nd-gb200-v6-series)。

建议优先比较 AWS P5en 与 Azure ND H200 v5，而不是直接从 B300 起步。在相同模型、量化、上下文长度和 Agent Harness 下测试每 GPU 的成功任务吞吐，再比较 P6-B300 / ND GB200 的单位任务成本。若 H200 已满足延迟和峰值容量，升级 Blackwell 只会增加成本与运行复杂度。

### 26.4 64–96 张 H200 的规划区间与月租估算

以 8-GPU H200 VM 为一个计算单元，初期预算按 **8 个节点（64 张 H200）常态容量，12 个节点（96 张 H200）扩展上限**估算。这是预算规划，不是已经验证的并发承载承诺。最终数量取决于模型、量化、TP/EP、上下文长度、Prefix Cache、Batching 和 SLO。

公开 On-Demand 价格快照（Linux，按 730 小时/月）：

| 云平台 / 实例 | 8-GPU 节点小时价 | GPU-hour | 单节点月价 | 8 节点/月 | 12 节点/月 |
| --- | ---: | ---: | ---: | ---: | ---: |
| AWS P5en.48xlarge（H200） | 约 $63.28 | 约 $7.91 | 约 $46,200 | 约 $369,600 | 约 $554,400 |
| Azure ND96isr_H200_v5 | $84.80 | $10.60 | $61,904 | $495,232 | $742,848 |

价格来自公开价格追踪及 Azure Retail Prices API 的快照，不是合同报价；区域、税、企业折扣、Savings Plans / Reservations、Spot 和容量预留会改变实际账单。参考：[AWS/Azure GPU 价格对比（2026-11-03）](https://gpuledger.dev/guides/azure-vs-aws/)、[AWS H200 价格追踪](https://vmprices.com/gpus/nvidia-h200/)、[Azure ND H200 价格记录](https://themodelpress.com/gpu-prices/azure-nd-h200-v5-on-demand)。

按 GPU 节点租赁费外加 15%–25% 的存储、网络、负载均衡、监控、控制面和日志等平台开销估算：

| 部署规模 | AWS H200 月预算 | Azure H200 月预算 | 说明 |
| --- | ---: | ---: | --- |
| 8 节点常态容量 | $425k–$462k | $569k–$619k | 64 GPU，持续在线规划基线 |
| 12 节点全部 24×7 | $637k–$693k | $854k–$929k | 96 GPU，峰值全月运行上界 |
| 8 节点常态 + 4 节点按需扩容 | $425k–$462k 起 | $569k–$619k 起 | 弹性节点按实际小时另计 |

金额为 USD，不包括税、企业支持计划、跨区域灾备、模型 API、工程人力和独立隔离执行集群。Spot 不纳入常态容量，因为交互式 Agent 服务不能把可中断实例作为唯一容量。稳定运行后再评估 1 年/3 年承诺折扣；在 POC 完成前不要对未经验证的 GPU 数量做长期承诺。

**成本风险主要来自 GPU 空转和模型/Agent 效率。** 在线交互、后台 Agent、代码索引和离线评测应分队列；在线服务使用最小常驻池，长任务使用可取消、可扩缩的弹性池；配额同时限制输入/输出 Token、并发和后台运行时间。

### 26.5 模型选择：托管前沿模型 + 自托管模型池

模型选择不应从参数量或榜单名次开始，而应从目标任务、可部署硬件和公开生产证据开始。对本方案，建议把 **Kimi K2.6 作为 H200 自托管主力候选**，把 **Kimi K3 作为 B300 / GB300 高规格升级候选**。Claude 等托管前沿模型继续承担质量基线、复杂任务和容量兜底。gpt-oss-120b 不再承担主力 Coding Agent 的定位，只作为轻量任务和成本基线。

| 模型 | 部署方式 | 建议角色 | 选择依据与边界 |
| --- | --- | --- | --- |
| Claude Sonnet 5.5 | Amazon Bedrock / Microsoft Foundry 或企业 API | 托管 Coding Agent 主力基准 | 用于建立代码质量、工具调用和任务成功率基线；同时保留托管服务作为容量和复杂任务兜底 |
| Claude Opus 5.5 | Bedrock / Foundry 或企业 API | 复杂重构、疑难 Bug、架构任务 | 按任务难度升级路由，不承接所有常规请求 |
| GPT-6.1 Sol / GPT-6 Astra | 对应企业 API / 企业模型平台 | 第二供应商、复杂推理和独立评审 | 用于供应商冗余与交叉评审；需核实实际可用模型名、区域、速率限制和企业条款 |
| **Kimi K2.6** | 自托管 H200 / B200；也可先用 Kimi API 做质量对照 | **H200 自托管主力候选** | 已有日本大学医院 8×H200 封闭网络部署案例；NVIDIA Dynamo 提供 8×H200、TP8 的可复现部署配方。适合优先进入企业私有化 POC |
| **Kimi K3** | 单节点 8×B300；更大规模可评估 GB300 | **高规格 Coding Agent 候选** | Fixstars 已公开单台 8×B300 部署案例，原生 MXFP4 权重约 1.6TB；不应将该结果外推为 8×H200 可部署，也不应把 B300 测试并发直接当作企业生产容量 |
| NVIDIA Nemotron 3 Super | NVIDIA 支持的托管服务或经验证的自托管环境 | 非中国开源模型的专项 POC | 可作为 NVIDIA 生态内的高吞吐执行模型对照；目前不把它列为已验证的 H200 Coding 主力 |
| Mistral Devstral 2 / Devstral Small 2 | 托管 API 或自托管（按具体权重和许可确认） | 专项 Coding POC | 作为非中国模型的对照组，重点验证代码修改、工具调用、长上下文和任务成功率；目前缺少与 Kimi K2.6 医院部署同等级的公开 H200 生产证据 |
| gpt-oss-120b | AWS / Azure GPU 自托管 | 轻量任务、摘要、分类、代码解释及成本基线 | 原生 MXFP4 权重可用于验证 H200 推理栈和低复杂度任务；不作为复杂多步 Coding Agent 的默认主力 |

本方案的中国模型候选只保留 Kimi，不纳入 GLM、DeepSeek、Qwen、MiniMax 或其他中国模型。文章其他章节中出现这些名称时，仅用于解释历史技术路线或引用非候选的行业案例，不构成本方案的模型推荐。

#### 公开部署案例：Kimi 已经不只是模型榜单上的候选

**北海道大学医院：8×H200、封闭网络、真实业务平台。** 2026 年 10 月公开的 LLENS 研究报告介绍了一个部署在北海道大学医院封闭网络中的本地 Agent 平台。平台运行在一台 8×NVIDIA H200 主机上，使用约 1T 参数的 Kimi K2.6，并基于 Open WebUI 重构应用层。它不是简单的聊天机器人：系统包含全文附件输入、页面图像读取、按路径访问的文档树、网络隔离 Sandbox、产物回传、自检、Subagents 和可复用流程等能力。论文报告单用户约 119 tokens/s，16 个并发请求总吞吐约 908 tokens/s；在 180 个医院文档问题上，交互式工具访问准确率为 97.2%，高于固定 Top-10 chunk 检索的 81.3%。平台自 2026 年 9 月 14 日起在医院网络运行。

这个案例与企业私有化 Coding Agent 平台最相关的地方，不只是模型，而是 **8×H200 + 私有网络 + Agent Harness + 隔离工具执行** 这一整套组合。它证明 Kimi K2.6 可以进入单节点 H200 的本地部署验证范围，也说明复杂任务的效果来自模型与工具访问方式的共同设计，不能把提升全部归因于模型本身。医院文档问答的结果也不能直接当成 Coding Benchmark，企业仍需用自己的代码仓库和任务集验证。

来源：[The LLENS Platform for On-Premises Large Language Model Agents in a Japanese University Hospital（arXiv，2026-10-23）](https://arxiv.org/abs/2610.32151)。

**NVIDIA Dynamo：H200 部署配方和 Agentic workload 数据。** NVIDIA 为 Kimi K2.6 发布了基于 Dynamo + vLLM 的部署配方。H200 路径采用每个 worker 8×H200、TP8 和原生 INT4；Agentic trace 的中位输入长度为 64K，KV Cache 命中率目标为 90%，目标交互速度约 50 output tokens/s/user。公开性能表中的 H200 Agentic 测试使用 4 个 worker replicas、48 并发请求；这意味着测试集群是 4 个 8-GPU worker，即 32 张 H200，而不是一台 8-GPU 机器承载 48 个并发用户。配方还组合了 KV-aware routing、EAGLE3 MLA speculative decoding 和 LMCache CPU KV offload。

这份配方的价值是给出可以复现的 serving 起点，而不是承诺企业一定能得到相同吞吐。它也说明 Kimi K2.6 的容量规划不能只看模型权重：64K 输入上下文、KV 命中率、缓存卸载、worker 数量和调度策略会直接影响并发能力。

来源：[NVIDIA Dynamo Kimi K2.6 Recipe](https://docs.nvidia.com/dynamo/v1.6.1/recipes/kimi-k2-6)。

**e-INFRA CZ：国家级研究计算平台的模型服务。** e-INFRA CZ 公布的运行数据称，其平台已服务超过 1,700 名用户，累计处理约 100B tokens。其模型服务包含 Kimi；公开运营文章给出的 Kimi 部署数据为 4×B300，峰值约 1,670 tokens/s，最高约 74 个并发请求。这个案例说明 Kimi 可以进入面向大量研究用户的共享推理服务，但它是 B300 平台的运行数据，不能直接套用到 H200 节点，也不能把峰值吞吐当作持续 SLO。

来源：[e-INFRA CZ：100 Billion Tokens](https://blog.e-infra.cz/blog/llm3/)。

**Fixstars：Kimi K3 的单节点 B300 部署。** Fixstars 在 Kimi K3 权重发布当天，将模型部署到单台 8×B300 节点。模型原生 MXFP4 权重约 1.6TB，无需再做一次额外量化；使用 SGLang，测试中 30–40 并发仍有可用吞吐，50 并发时则出现大量失败请求。该测试说明 Kimi K3 可以在 B300 8-GPU 节点上运行，但也揭示了启动时间、KV Cache 分配和混合注意力状态管理等实际问题。尤其不能将“模型装得下”理解为“所有上下文长度和并发都能满足”。

因此，Kimi K3 的合理定位是 B300 / GB300 高规格候选，而不是当前 H200 预算模型的默认主力。若要将 K3 纳入采购设计，应单独测量长上下文 Coding Agent workload 的 KV 容量、TTFT、TPOT、失败率和单位成功任务成本。

来源：[Fixstars：Deploying Kimi K3 on a Single Node of NVIDIA B300 x8](https://blog.us.fixstars.com/deploying-kimi-k3-on-day-0-can-a-2-8t-model-run-on-a-single-node-of-nvidia-b300-x8/)。

**GitHub Copilot：Kimi K3 已进入主流 Coding 产品，但这是托管服务。** GitHub 于 2026 年 8 月宣布 Kimi K3 在 Copilot 中可用，模型由 Fireworks AI 托管，可用于多个 IDE、CLI 和 Agent 入口。这是模型进入主流 Coding 产品链路的证据，但不是 GitHub 在自有 GPU 上部署 Kimi 的证明，也不能用来推断企业自托管成本。

来源：[GitHub Changelog：Kimi K3 is now available in GitHub Copilot](https://github.blog/changelog/2026-08-06-kimi-k3-is-now-available-in-github-copilot/)。

#### 欧洲与美国的自托管案例：真实主力模型是什么

Kimi 的 H200 / B300 部署案例提供了本方案的直接技术参照，但企业选型不能只看同一模型家族。欧洲和美国已经公开的部署案例，呈现出几条不同路线：欧洲的 Coding 自托管实验更愿意采用 GLM、DeepSeek 或 Mistral；美国公开的企业 AI 平台案例中，Llama 家族较常见，同时也能看到 NVIDIA Nemotron、Gemma 等模型承担专门任务。需要注意，公开案例数量有限，且披露程度差异很大，以下只能说明已公开案例的采用情况，不能据此推断整个欧美市场的模型份额。

**欧洲：Coding 场景中，GLM、DeepSeek 和 Mistral 都有实际采用证据。**

| 企业 / 项目 | 部署方式与模型 | 已披露的规模或结果 | 对本方案的参考价值 |
| --- | --- | --- | --- |
| Revolut | 自托管 GLM，早期使用 Gemini，随后采用 Claude Code，再转向自托管模型 | NVIDIA GTC Berlin 2026 演讲称覆盖约 2,000 名工程师；第三方整理披露 56×B200，并报告 lead time 改善约 70%、coding time 改善约 60% | 这是目前较接近大规模企业 Coding 自托管的公开案例。它说明自托管可以与 Claude 等托管模型并存，而不是必须完全替代；但 GLM 不属于本文的模型候选范围 |
| Parity Technologies | 由工程团队运行 DeepSeek V4 Flash 推理服务 | 约 25 名工程师参与，2026-08-16 至 2026-09-12 处理超过 144,000 次请求、约 12.9B tokens，GPU 计算费用约 $1,200；反馈总体可用，但部分用户认为能力只是勉强够用 | 适合作为小团队自托管的成本与体验观察，不应将其视为 2,000 人规模的生产容量证明；DeepSeek 不属于本文候选范围 |
| Abanca（西班牙） | 企业自托管 Mistral Codestral | Mistral 公布了 fully self-hosted 企业采用信息，但没有披露 GPU 数量、并发或完整成本 | 可作为银行业代码模型私有部署的采用证据，不能据此推导 H200/B300 的容量 |
| SNCF（法国） | 使用 Codestral 支持遗留 Java 系统现代化及 Agentic Workflow | 公开材料确认企业应用方向，未披露底层 GPU 集群规模和生产负载 | 说明 Coding 模型的价值不只在 IDE 补全，也可以进入大型遗留系统改造流程 |
| Capgemini | 在多个行业客户交付中使用 Mistral Coding Stack | 公开材料未给出统一模型版本、GPU 规模或单一客户的量化结果 | 属于系统集成和企业交付层面的采用证据，不能等同于某个客户已经自建大规模 GPU 集群 |

Revolut 的 2,000 名工程师案例尤其值得关注，但公开信息需要分层阅读：NVIDIA GTC 演讲是一手采用信息；56×B200、GLM-5.3、约 $0.30 / 百万 Token 及成本下降幅度等更细节数据来自第三方整理，不应把这些数字当成经过审计的企业财务数据。演讲还提到 Claude Code/Codex 继续用于较难任务，这与本文建议的“自托管主力池 + 托管前沿模型兜底”路线相符。

来源：[NVIDIA GTC Berlin：Revolut 的 AI Coding 工程实践](https://www.nvidia.com/gtc/)、[Revolut 部署细节整理](https://www.latent.space/)、[Parity Technologies：DeepSeek V4 Flash 内部使用报告](https://www.parity.io/)、[Mistral 企业客户案例](https://mistral.ai/customers)。

**英国及欧洲的非 Coding 企业 AI：Llama 也进入受监管环境。**

英国 OneAdvanced 公布了基于 AWS UK sovereign cloud 的企业 AI 方案，自托管 Llama 4 Maverick，并使用 Llama Guard 4 做安全防护。其 Agent 方案采用 Strands Agents SDK，公开材料提到 50 多个专用 Agent；RAG 数据层使用 Aurora PostgreSQL 与 pgvector，工具执行运行在 ECS。采用自托管的核心原因是数据必须留在英国的受控环境中。该案例没有披露 GPU 型号、GPU 数量、并发或模型服务成本，因此它证明的是数据驻留约束下的部署路径，而不是某种 GPU 配置的性能。

来源：[AWS：OneAdvanced customer story](https://aws.amazon.com/solutions/case-studies/)。

**美国：Llama 是公开企业方案中较常见的基础模型，其他模型通常承担专门角色。**

| 企业 / 项目 | 模型与 GPU 配置 | 工作负载 | 应如何解读 |
| --- | --- | --- | --- |
| Cisco Secure AI Factory | 每个 worker 使用 4×NVIDIA RTX PRO 6000 Blackwell；Llama 3.1 70B Instruct 承担主要 RAG 任务，Llama 3.1 8B 与 Nemotron Nano 12B 用于轻量任务，Gemma 3 4B 用于独立 AI Defense 集群中的 guardrail | 企业知识检索、轻量任务和安全防护 | 这是清晰的模型分层和资源隔离参考架构，但不是 Cisco 数千名开发者使用的 Coding Agent 生产披露 |
| First American | 40×A100，微调 Llama 3.1 8B | 房地产文档处理，目标约每日 100 万份文档；公开材料报告约 695 documents/min | 不是 Coding 案例，但说明 8B 级小模型经过领域适配后，可以承担高吞吐、边界明确的后台任务 |
| IBM Research、Red Hat 与 llm-d 技术验证 | GLM-5.2，544×H100 | 分布式推理和 Coding Agent 并发测试；公开报告最高约 3,000 个并发 Coding Agent、峰值约 6.6M output tokens/min | 这是大规模 serving 技术验证，不是某家企业已经部署 3,000 个开发者的生产平台；GLM 不属于本文候选范围 |
| NVIDIA StarCoder2 示例 | StarCoder2-7B，配合 NVIDIA NIM 与 NeMo Guardrails，可部署于 L4、L40S、A100、H100 或 H200 | 代码补全、受控代码助手、CI 依赖验证和提交追踪 | 可作为小型、范围明确的 Coding Assistant 参考实现，不应与复杂多步 Agent 的主力模型混为一谈 |

Cisco 的案例有一个值得借鉴的设计：不是让一个大模型处理所有事情，而是按任务复杂度和安全职责分配模型。70B 模型承担主要知识检索，8B 和 12B 模型处理轻量工作，独立 guardrail 模型负责安全检查。企业 Coding 平台也可以采用相同思路：复杂代码修改由主力模型处理，摘要、分类、简单解释、变更说明和部分验证任务交给小模型，但必须通过统一评测确认任务边界。

First American 的案例则说明，模型选择不能只按参数量或通用榜单排序。对于文档分类、字段抽取和固定格式转换，领域微调的小模型可能比通用大模型更容易获得稳定吞吐和成本优势。这个结论可以迁移到 Coding 平台的后台任务，但不能直接推导出 8B 模型适合复杂代码修改。

来源：[Cisco Secure AI Factory 参考架构](https://www.cisco.com/)、[First American 企业 AI 案例](https://www.nvidia.com/en-us/industries/financial-services/)、[IBM Research / Red Hat / llm-d 大规模推理验证](https://research.ibm.com/)、[NVIDIA StarCoder2 Coding Assistant](https://developer.nvidia.com/)。

**北美其他自托管案例的补充观察。** 加拿大 Wealthsimple 曾在 VPC 内使用自托管 Llama 2、Mistral 和 Whisper，以减少个人信息离开内部基础设施的风险。这是较早期的隐私优先部署案例，不能代表其当前模型版本或最新生产架构。Tinfoil 的隐私推理平台也披露过 Llama 3.3 70B 的大规模使用情况，但这属于服务商自身平台的使用数据，不等于某个终端企业在自有 GPU 上部署。两者可以作为“数据边界驱动自托管”的补充证据，不宜用于推算企业 Coding 平台容量。

来源：[Wealthsimple 工程实践](https://www.wealthsimple.com/en-ca/)、[Tinfoil Llama 部署案例](https://tinfoil.sh/)。

**这些案例对本方案意味着什么。**

第一，欧美企业并没有一个统一的“主力模型”。Coding 场景公开案例中，Revolut 和 Parity 分别采用 GLM、DeepSeek，Mistral 则有 Abanca、SNCF 等企业采用证据；通用企业 AI 和 RAG 场景中，Llama 更常出现在公开参考架构与客户案例里。不同任务、数据驻留要求、推理预算和工程团队能力，会形成不同模型组合。

第二，必须区分“企业采用模型”“企业自托管模型”和“披露了 GPU 生产规模”这三个证据等级。Mistral 客户案例证明企业采用，不代表公开了 GPU 集群；Cisco 的架构证明模型分层方式，不代表其已作为 Coding 平台服务数千名开发者；IBM/Red Hat 的 544×H100 数据是技术验证，不是客户生产容量。采购决策不能把这些不同性质的数据放在同一张性能对比表里。

第三，本文的中国模型候选约束不变：**中国模型只保留 Kimi**。因此，Revolut 的 GLM、Parity 的 DeepSeek，以及其他案例中出现的 Qwen 等模型，只作为行业部署事实，不进入本方案 POC 或推荐列表。欧美非中国模型中，Llama 可作为通用 RAG / 轻量任务基线，Mistral Devstral 作为 Coding 专项对照，NVIDIA Nemotron 作为 NVIDIA 生态专项对照；但这些模型是否适合复杂 Coding Agent，仍需使用同一套真实仓库任务验证。主力方案仍以 Kimi K2.6 的 H200 POC 为起点，Kimi K3 单独进入 B300 / GB300 高规格验证，Claude Sonnet / Opus 保留为托管质量基线和兜底。

#### 选型结论与验证顺序

基于目前能查到的公开证据，建议按以下顺序推进：

1. **H200 POC 首选 Kimi K2.6。** 以北海道大学医院的单机 8×H200 部署作为可行性参照，以 NVIDIA Dynamo 的 8×H200 TP8 配方作为推理服务起点。企业 POC 应使用真实仓库、真实工具调用和真实权限策略重新压测。
2. **B300 / GB300 POC 再评估 Kimi K3。** Fixstars 的 8×B300 案例证明单节点部署可行，但并不意味着 H200 也能按相同方式部署。K3 应作为高规格容量池的候选，不应提前纳入 H200 成本模型。
3. **Claude Sonnet / Opus 保留为质量基线和兜底。** 复杂重构、跨模块任务和高风险代码修改需要与托管前沿模型进行同任务比较。托管模型成本应按真实 Token、缓存和任务完成情况核算。
4. **Nemotron、Devstral 进入有限 POC，而不是直接进入生产架构。** 它们用于检验是否存在非中国开源替代方案，只有任务成功率、工具调用稳定性、延迟和完整成本达到门槛后才进入候选池。
5. **gpt-oss-120b 只作为轻量任务和经济性基线。** 不应仅因它较容易部署，就把它当成复杂 Coding Agent 的主力模型。

模型路由应基于任务类型、仓库语言、修改范围、上下文长度、工具调用风险、数据分类、历史成功率和预算。常规解释、摘要和分类可以路由到轻量模型；常规代码任务进入 Kimi K2.6 或托管 Sonnet；复杂重构和高风险变更升级到 Opus 或其他经过验证的前沿模型；离线索引、批量分析和后台 Agent 使用独立队列与预算。后台 Agent 可以利用交互流量的低谷，但它们仍然消耗 GPU、KV Cache 和模型 Token，必须设置优先级、并发上限、取消机制和独立配额。

模型版本以 2026 年 11 月可查到的公开信息为候选，发布节奏快，不能视为长期固定 BOM。Claude Sonnet 5.5 标准价格为每百万输入 Token $2、输出 Token $10，缓存命中价格更低。参考：[Anthropic 定价](https://platform.claude.com/docs/en/about-claude/pricing)、[Sonnet 5.5 模型说明](https://platform.claude.com/docs/en/models/sonnet-5-5/overview)、[AWS Bedrock Anthropic 模型列表](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-anthropic.html)、[Azure AI Foundry 模型目录](https://ai.azure.com/catalog/models)。

受监管环境需要分别评估 Bedrock / Foundry 的数据处理条款、区域、日志和私网能力。自托管也不自动意味着数据安全：模型日志、Prompt Trace、缓存、对象存储、快照、备份和运维人员访问都属于数据边界。

### 26.6 与 GitHub Copilot 对比：每位开发者每月 200 美元，GPU 还划算吗？

前面的 GPU 预算需要放到开发者已经能采购的产品旁边比较。对于 2000 名开发者，假设 GitHub Copilot 的**实际平均月度支出为每人 $200**（包括席位费和 AI Credits 超额用量，而不是把 $200 当作 Copilot 标价），则年度化预算为：

`2,000 × $200 = $400,000 / 月 = $4.8M / 年`

先看清 Copilot 的计费结构。按 GitHub 当前公开的组织计划，Copilot Business 为 **$19 / 席位 / 月**，每席位贡献 **1,900 GitHub AI Credits** 到组织共享池；Copilot Enterprise 为 **$39 / 席位 / 月**，贡献 **3,900 Credits**。1 Credit 对应 $0.01 的计量价值，超出共享额度后按模型实际 Token 用量计费。代码补全和 Next Edit Suggestions 不消耗 AI Credits。企业也可以采用 Copilot access 计量模式：符合条件的 GitHub Enterprise Cloud 用户没有额外席位费，但从第一次计量使用开始付费；Standalone 则为 $10 / 用户 / 月且不含使用额度。具体可用方案取决于企业许可和组织资格。

因此，Business 的 $19 是席位基础费，不是重度 Agent 使用的封顶价。假设每位开发者最终平均账单为 $200，粗略理解为席位基础费加上约 $181 的额外用量；实际发票还会受到 Enterprise 席位、共享 Credits 池、模型单价、缓存 Token、用户使用分布和组织预算策略影响。企业应从 GitHub Billing 导出至少 1–3 个月的按用户、模型和成本中心用量，计算 P50、P75、P90，而不是用少数重度用户的峰值代表全体平均。

官方计费说明：[Copilot Plans](https://docs.github.com/en/copilot/get-started/plans)、[组织和企业席位与计费周期](https://docs.github.com/en/copilot/concepts/billing-and-usage/organizations-and-enterprises/seats-and-billing-cycles)、[GitHub AI Credits 计费变化](https://github.blog/news-insights/github-copilot-is-moving-to-usage-based-billing/)。

#### 按 $200 / 开发者 / 月对照现有 H200 预算

| 方案 | 月总成本 | 每位开发者 / 月 | 相对 $400k Copilot 情景 |
| --- | ---: | ---: | --- |
| GitHub Copilot，实测均值假设 $200 | $400,000 | $200 | 比较基准 |
| AWS H200，8 节点，含 15%–25% 平台开销 | $425k–$462k | $212–$231 | 高约 6%–15.5% |
| Azure H200，8 节点，含 15%–25% 平台开销 | $569k–$619k | $285–$310 | 高约 42%–55% |
| AWS H200，12 节点，含平台开销 | $637k–$693k | $319–$347 | 高约 59%–73% |
| Azure H200，12 节点，含平台开销 | $854k–$929k | $427–$465 | 高约 114%–132% |

从这组预算看，**如果 Copilot 的真实平均成本是 $200 / 人 / 月，单纯为了省钱而租用 64–96 张 H200 并不成立**。AWS 8 节点已经略高于 $200 的外部服务预算；Azure 8 节点明显更贵。并且现有 GPU 预算尚未完整计入专职推理平台团队、模型适配和评测、Agent Harness 维护、值班、容量闲置、模型质量差异，以及部分开发者仍需调用托管前沿模型的费用。把这些补齐后，自托管的真实 TCO 只会更高。

#### GPU 自托管的直接盈亏拐点

这里直接按现有预算计算，不引入工作负载替代比例等变量。公式只有一个：

`人均月成本拐点 = GPU 平台月成本 ÷ 开发者人数`

以 2,000 名开发者、8 个 H200 节点为例：

| 云平台 | GPU 与平台月预算 | 2,000 人时的人均成本拐点 | 与 Copilot $200 / 人 / 月比较 |
| --- | ---: | ---: | --- |
| AWS，64 张 H200 | $425k–$462k | **$213–$231 / 人 / 月** | 高于 $200，尚未划算 |
| Azure，64 张 H200 | $569k–$619k | **$285–$310 / 人 / 月** | 高于 $200，尚未划算 |

因此，在 2,000 人规模下，若 Copilot 的实际人均月成本是 $200，AWS 方案至少还要降低约 6%–13% 才能达到账面持平；Azure 则需要降低约 30%–35%。这里比较的是现有 GPU 和平台预算，尚未加入额外工程人力与剩余模型 API 费用。

反过来，如果固定 Copilot 支出为 $200 / 人 / 月，计算需要多少开发者才能覆盖 GPU 平台月成本：

| 云平台 | 8 节点 GPU 平台月预算 | $200 / 人 / 月时的盈亏平衡人数 |
| --- | ---: | ---: |
| AWS，64 张 H200 | $425k–$462k | **约 2,125–2,310 人** |
| Azure，64 张 H200 | $569k–$619k | **约 2,845–3,095 人** |

如果采用 12 个节点（96 张 H200），对应的门槛进一步提高：

| 云平台 | 12 节点 GPU 平台月预算 | 2,000 人时的人均成本拐点 | $200 / 人 / 月时的盈亏平衡人数 |
| --- | ---: | ---: | ---: |
| AWS | $637k–$693k | **$319–$347** | **约 3,185–3,465 人** |
| Azure | $854k–$929k | **$427–$465** | **约 4,270–4,645 人** |

**结论：按当前估算，2,000 人、每人每月 $200 的情况下，64 张 H200 尚未达到成本拐点；AWS 要到人均约 $213–$231，或用户规模达到约 2,125–2,310 人才刚好账面持平。Azure 要到人均约 $285–$310，或用户规模达到约 2,845–3,095 人才刚好持平。** 这些是 GPU 平台预算的直接拐点，不包含额外平台团队、模型适配、值班、质量返工和托管模型回退费用；完整 TCO 的实际拐点会更高。

#### 两种产品不是完全相同的成本对象

Copilot 的账单购买的是 GitHub 托管产品能力，包括 IDE 集成、代码补全、Agent 工作流、模型访问和持续升级。租 GPU 只购买推理算力；企业仍然要建设和维护 Workbench、Agent Runtime、代码上下文、MCP / Tool Broker、隔离执行、权限控制、审计、模型路由和开发者支持。即使采用开源模型，企业也要自行承担模型质量回归、量化验证、推理引擎升级和安全运营。

另一方面，Copilot 的 $200 也不能直接代表所有企业 Agent 工作负载。它不一定覆盖企业自定义的长时运行 Agent、内部知识检索、批量代码迁移、私有 MCP 工具和独立执行环境。应先把使用场景拆成三类：标准 IDE 辅助和常规 Agent 任务；高消耗的复杂重构、长上下文和后台任务；数据不能离开企业边界或需要稳定专属吞吐的任务。第一类通常先比较 Copilot Business / Enterprise；第二类比较按量托管模型与 GPU 弹性池；第三类才有充分理由评估自托管或专属推理。

**建议的决策方式是先买服务、再验证自托管，而不是先租满 GPU。** 先对 2000 人启用 Copilot 或同类托管服务，连续记录每用户月度账单、AI Credits、模型分布、Agent 任务类型、成功率和耗时。同步挑选真实高频任务，在一台 8-GPU H200 上对照 Sonnet 等托管模型与自托管候选模型，按“成功完成的同类任务”比较成本、质量、延迟和人工返工。只有当自托管在任务质量不退化的前提下，稳定降低完整 TCO，或提供托管服务无法满足的数据驻留、治理、专属容量和供应商控制能力，才扩至 4–8 节点。

### 26.7 API 与 GPU 自托管的成本交叉点

不要先假定租 GPU 一定比模型 API 便宜。以 Sonnet 5.5 标准价为例，假设 80% 输入 Token、20% 输出 Token：

| 月度总 Token | 输入 / 输出 | 按 $2 / $10 每百万 Token 估算 |
| ---: | ---: | ---: |
| 2B | 1.6B / 0.4B | 约 $7,200 |
| 5B | 4B / 1B | 约 $18,000 |
| 10B | 8B / 2B | 约 $36,000 |
| 20B | 16B / 4B | 约 $72,000 |

这是标准价格的简单计算，未计缓存折扣、长上下文附加费、服务层级、工具费用和不同区域价格。它说明：若 2000 名开发者月度消耗在 5B–20B Token，API 账单可能仍显著低于 64–96 张 H200 全天运行的 GPU 租赁费。自托管的经济性必须建立在高 GPU 利用率、持续流量、模型适配、缓存复用和更低的单位成功任务成本上，而不是比较理论 Tokens/s。

比较公式：

`TCO = GPU VM + Storage + Network + Control Plane + Operations + Idle Capacity + Evaluation`

`Cost per Successful Task = TCO / Successful Agent Tasks`

若 API 成本明显低于 GPU 平台，且数据策略允许，保留托管模型通常更合理；若自托管是为了数据驻留、可控吞吐、稳定容量或降低供应商依赖，应把这些收益写进 ADR，而不是包装成节省成本。

### 26.8 推荐拓扑：AWS 或 Azure 单云主部署

建议选择一个主云承载 Workbench 控制面、隔离执行和主要 GPU 推理池。AWS 与 Azure 都可以做完整方案，但不建议把同一个在线模型集群跨 AWS/Azure 拉成 RDMA 集群；跨云时延、数据传输、故障域、身份体系和运维复杂度会抵消收益。

架构图：[2000 名开发者 Workbench：AWS / Azure GPU 部署架构](/diagrams/enterprise-gpu-ai-coding-platform/05-2000-developer-aws-azure-workbench.html)（[SVG](/diagrams/enterprise-gpu-ai-coding-platform/05-2000-developer-aws-azure-workbench.svg)）。

AWS 方案中，GPU Serving 使用 EC2 P5en/P6，模型制品存储在 S3，镜像与部署由 ECR/EKS 管理，托管模型可经 Bedrock 访问。Azure 方案中，GPU Serving 使用 ND H200 / ND GB200 VM，制品存储在 Blob Storage，部署由 AKS 管理，托管模型由 Microsoft Foundry 提供。统一 Model Gateway 屏蔽模型和云差异，但保留各自私网 Endpoint、身份和审计实现。

在线请求经过鉴权、策略和配额检查后进入模型池；长任务由独立队列调度；工具调用经过 Tool Broker 和隔离执行环境。模型池支持 Canary、按版本切流、快速回滚和熔断。自托管池容量不足时，只能按明确的数据策略切换到 Bedrock / Foundry，不能静默跨越数据边界。

### 26.9 实施顺序与采购门槛

| 阶段 | 建议规模 | 必须验证 |
| --- | --- | --- |
| Trace & Workload Discovery | 2000 人抽样 | DAU、Agent 并发、Token 分布、成功率、数据分类 |
| POC | 1 个 8-GPU H200 节点 | Kimi K2.6（NVIDIA Dynamo 配方起步）、Sonnet 5.5 同任务质量基准；gpt-oss-120b 作为轻量成本基线，Nemotron / Devstral 作为有限对照 |
| Pilot | 2–3 个 8-GPU 节点 | 50–100 人真实 IDE/CLI、MCP 与执行隔离 |
| Production Wave 1 | 4–6 个节点 | 逐团队放量、配额、审计、熔断、回滚与故障演练 |
| Production 2000 | 规划 8 节点，按需扩至 12 | 峰值压测、节点故障、模型切换、区域容量与 DR |

采购前必须取得 AWS 和 Azure 两边的书面报价与容量确认，覆盖目标区域 GPU SKU、On-Demand 与承诺折扣、容量预留、Spot 中断策略、网络与跨区费用、存储吞吐、私网访问、数据驻留、支持等级和配额提升周期。P6-B300 / ND GB200 尤其需要确认能否按计划获得连续多节点容量。

最终建议：先用 AWS P5en 或 Azure ND H200 的 8-GPU 节点做 POC；Workbench 控制面和工具执行面独立部署；以 Kimi K2.6 作为 H200 自托管主力候选，按 NVIDIA Dynamo 的 8×H200 TP8 配方验证吞吐、KV Cache 和并发，以 Sonnet 5.5 建立同任务质量基线；gpt-oss-120b 仅作为轻量任务成本基线，Nemotron / Devstral 只做有限对照。Kimi K3 单独列入 B300 / GB300 高规格验证，不计入 H200 主力容量假设。生产先按 4–6 节点放量，达到实测门槛后再扩至 8 节点，12 节点仅作为峰值容量预留。64–96 GPU 不是已验证结论，最终 sizing 必须由成功任务吞吐、P95 延迟和单位成功任务成本决定。