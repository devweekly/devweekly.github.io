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

| 层次 | 典型产品 | 关键区别 |
| --- | --- | --- |
| GPU | NVIDIA B300 / B200 | 单颗加速器；关注显存、带宽和计算精度 |
| GPU 服务器 | HGX B300 | 8-GPU NVLink/NVSwitch 节点 |
| 机架级系统 | GB300 NVL72 | 72-GPU scale-up 域，涉及液冷和机架供电 |
| 多机架集群 | 多个 HGX 节点或 NVL72 | 通过 RDMA Fabric 扩展，需处理拓扑和故障域 |
| GPU 服务器平台 | HGX B300 | 8 张 SXM GPU、NVLink/NVSwitch 和主机平台 | 单节点 GPU 通信、CPU/PCIe 拓扑、节点功耗 |
| 机架级系统 | GB300 NVL72 | 72 张 Blackwell Ultra GPU、36 颗 Grace CPU 和 NVLink Switch | 72-GPU scale-up 域、液冷、机架供电和集群网络 |
| 多机架集群 | 多个 HGX 节点或多个 NVL72 | 多个节点/机架通过外部网络互联 | RDMA Fabric、拓扑感知调度、故障域和扩展成本 |

### 1.1 HGX B300：适合从 8-GPU 节点构建集群

NVIDIA 的 HGX B300 参考架构包含 8 张 Blackwell Ultra GPU。官方参考架构列出的关键规格包括：

| 指标 | HGX B300 |
| --- | --- |
| GPU | 8×B300，单卡 288 GB HBM3e |
| 总显存 | 约 2.30 TB |
| 单 GPU HBM 带宽 | 最高 8 TB/s |
| GPU 互联 | 第五代 NVLink + NVSwitch，最高 1.8 TB/s/GPU（双向口径） |
| 网络 | 最高 8×800 Gb/s ConnectX-8，依 OEM 配置 |

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

| 格式 | 用途与限制 |
| --- | --- |
| BF16 / FP16 | 精度基线；显存占用较高 |
| FP8 | 高性能推理；需确认模型和引擎支持 |
| FP4 / NVFP4 | Blackwell 高压缩推理；必须验证量化误差和 Kernel |
| INT8 / INT4 | 依模型量化方案而定，不能只看位宽判断质量 |

| 并行方式 | 何时使用 | 主要代价 |
| --- | --- | --- |
| TP | 单层计算或权重需要多 GPU | GPU 间频繁通信 |
| PP | 模型层需跨设备拆分 | Pipeline Bubble 和阶段传输 |
| DP | 增加独立模型副本和吞吐 | 额外权重显存 |
| EP | 分布式部署 MoE Experts | Token Dispatch / Combine 通信 |
| Context / Sequence Parallelism | 超长上下文，且模型/引擎支持 | 实现和调度复杂 |

| 框架 | 主要定位 | 评估重点 |
| --- | --- | --- |
| vLLM | 通用 LLM serving，OpenAI-compatible API 和批处理能力 | 目标模型、Blackwell Kernel、FP8/FP4、MoE、KV Cache 和多节点支持 |
| SGLang | 高性能结构化生成与 LLM serving | 目标模型实现、Radix/Prefix Cache、调度、MoE 和工具调用 |
| TensorRT-LLM | NVIDIA 推理优化技术栈 | Blackwell 支持矩阵、构建流程、量化、MoE、部署复杂度和升级成本 |

截至本文日期，NVIDIA GPU Operator 官方文档显示当前 patch release 为 v26.7.2；但这不代表所有 B300 OEM 服务器、操作系统、驱动和推理框架组合都已经过生产验证。vLLM、SGLang 和 TensorRT-LLM 的能力应按具体 release、模型实现和部署配置逐项确认。

建议采用一个主推理引擎和一个候选引擎，不要一开始同时运营三套生产系统。可以让 vLLM 作为首个基线，再用同样模型和请求 Trace 对比 SGLang；若 NVIDIA 优化路径带来明确收益，再评估 TensorRT-LLM。不同框架之间的性能数字只有在模型、精度、上下文、并发、硬件和 SLO 相同的情况下才有比较价值。

### 5.1 实操：在 AWS EC2 上用 vLLM 部署 NVIDIA Nemotron

前面的章节解释了 GPU、推理框架和服务层分别负责什么，但企业团队真正开始做这件事时，通常面对的是一组具体问题：AWS 控制台里应该选哪台机器？驱动要不要自己装？模型从哪里下载？vLLM 是装在宿主机还是容器里？启动后怎样确认 GPU 确实在工作？应用又应该通过什么地址调用？

下面给出一条可以从空白 AWS 账号环境走到可调用模型 API 的路径。示例选用 NVIDIA Nemotron 3 Nano 30B A3B FP8，通过 vLLM 部署在一台 EC2 GPU 实例上。它是一个用于验证部署链路的起点，不代表它一定是企业 Coding Agent 的最佳模型；模型质量仍要用企业自己的代码任务评测。

这里先把边界说清楚：NVIDIA 提供的是 Nemotron 模型权重、模型实现和部署配方；AWS 提供 EC2、网络、存储、身份和监控；vLLM 负责把模型加载到 GPU，并提供 OpenAI-compatible API。三者不是一个产品，也不是安装一个 NVIDIA 驱动就完成了模型部署。本文使用的是开源权重加 vLLM 的路径，不是 NVIDIA NIM。若企业选择 NIM，容器、授权和服务管理方式会有所不同。

#### 第一步：先选一条能跑通的 AWS 路径

不要一开始就创建 EKS，也不要一开始就申请数十台 GPU。先用一台 EC2 验证模型能否加载、API 是否可用、质量是否满足要求，再决定是否需要 Kubernetes 和多节点集群。

本例的 POC 选择 `p5.4xlarge`，它提供一张 NVIDIA H100、80 GB HBM3 显存、16 vCPU 和 256 GiB 主机内存。Nemotron 3 Nano 30B A3B FP8 的模型卡给出了 vLLM 单卡启动方式，适合用单 GPU 验证模型下载、加载和 API 调用。这个实例没有跨节点 GPUDirect RDMA 能力，但单卡 POC 不需要它。若后续要测试 8-GPU 单节点并行，可升级到 `p5en.48xlarge`，它提供 8 张 H200、总计 1,128 GB HBM3e；若目标是 Blackwell，则评估 AWS 当前提供的 P6-B200 或 P6-B300。具体实例能否在目标 Region 创建，还取决于该 Region 的供给和账户 On-Demand vCPU/GPU 配额，不能只看产品页面。

| 阶段 | AWS 实例起点 | GPU 配置 | 目的 |
| --- | --- | --- | --- |
| 单模型 POC | `p5.4xlarge` | 1×H100，80 GB | 跑通模型下载、vLLM、API 和基本评测 |
| 多 GPU 单节点验证 | `p5en.48xlarge` | 8×H200，1,128 GB 合计 | 测试 TP、并发、KV Cache 和吞吐 |
| Blackwell 验证 | `p6-b200.48xlarge` / `p6-b300.48xlarge` | 8×B200 / 8×B300 | 验证 Blackwell Kernel、FP8/FP4 和更大模型 |

在 AWS Console 中，先进入 EC2，确认目标 Region，再检查 Service Quotas 中对应 P 实例族的 vCPU 配额。若配额不足，先提交提升申请；不要等到自动化部署时才发现 `InsufficientInstanceCapacity` 或 `VcpuLimitExceeded`。POC 可以按 On-Demand 计费，避免 Spot 中断干扰初始验证。只有在工作负载、可中断性和成本模型明确后，再评估 Savings Plans、Capacity Reservation 或 Spot。

AMI 选择建议使用 AWS Deep Learning AMI（GPU 版）或经团队验证的 NVIDIA GPU 基础 AMI。重点是确认 AMI 对目标实例的 GPU 型号、Linux Kernel 和 NVIDIA Driver 有支持；不要在一台已经有驱动的机器上照抄网上命令，再叠加安装另一套驱动。宿主机负责提供内核驱动，vLLM 容器负责提供匹配的 CUDA 用户态库和 Python 依赖，两者需要兼容，但不是把完整 CUDA Toolkit 装进宿主机的同义词。

#### 第二步：准备 VPC、权限和存储

GPU 推理节点不应该直接暴露在公网。建议把 EC2 放在私有子网，应用通过内部 Model Gateway 或内部负载均衡访问；运维通过 AWS Systems Manager Session Manager 登录，不开放公网 SSH。Security Group 只允许来自 Model Gateway 所在 Security Group 的业务端口，例如 TCP 8000。不要为了测试方便把 `0.0.0.0/0` 加到 8000 端口。

实例需要一个 IAM Instance Profile。最小权限通常包括：通过 Systems Manager 管理实例、从指定 S3 Bucket 读取模型制品、向指定 CloudWatch Log Group 写入日志和指标。不要把 AWS Access Key 写入 User Data、Dockerfile 或 Git 仓库。若模型从 Hugging Face 下载，Hugging Face Token 应通过 Secrets Manager 或受控的参数/密钥注入方式提供；下载完成后，不要把 Token 烘焙进镜像。

模型文件需要有明确的落盘位置。POC 可以使用加密 EBS 卷保存模型和缓存；如果企业已经建立模型制品流程，建议由受控流水线从模型仓库下载、校验并复制到 S3，再由实例从 S3 获取经过批准的固定版本。实例本地 NVMe 适合做高速缓存，但实例停止、终止或替换时可能丢失，不能作为唯一模型存档。需要为模型目录预留足够空间，不能只按权重文件大小估算，还要考虑容器镜像、缓存、临时文件和日志。

如果实例位于私有子网，还要提前设计出站访问：拉取容器镜像需要访问容器 Registry，下载模型需要访问 Hugging Face 或内部模型仓库，安装包需要访问软件源。企业环境通常通过 NAT Gateway、代理或内部镜像解决。生产环境更适合把经过扫描的 vLLM 镜像同步到 ECR，把模型制品存到受控 S3 Bucket，并通过 VPC Endpoint 访问 AWS 服务，避免每次启动都依赖公共互联网。

#### 第三步：启动 EC2 并验收 GPU

创建实例时，选择刚才确认过的 AMI 和 `p5.4xlarge`，放入私有子网，挂载加密 EBS，绑定 IAM Instance Profile 和受限 Security Group。POC 阶段可以先用一台机器，不需要 EKS、FSx for Lustre 或跨节点 EFA 配置。

实例启动后，通过 Session Manager 进入主机，先检查系统是否识别 GPU：

```bash
nvidia-smi
nvidia-smi --query-gpu=name,memory.total,driver_version,pci.bus_id --format=csv
uname -r
```

预期至少能看到一张 H100、约 80 GB GPU 显存和驱动版本。如果 `nvidia-smi` 不存在，或无法与 NVIDIA Driver 通信，先解决 AMI/驱动问题，不要继续启动 vLLM。此时还可以检查 Docker 和 NVIDIA Container Toolkit：

```bash
docker run --rm --gpus all nvidia/cuda:12.8.1-base-ubuntu22.04 nvidia-smi
```

上面的 CUDA 镜像标签只是示例，实际使用时应选与宿主机驱动兼容、并经过团队验证的镜像。容器内能够执行 `nvidia-smi`，才说明 Docker 已经拿到 GPU 设备。若宿主机能看到 GPU、容器看不到，排查 Container Toolkit 和 Docker runtime；若宿主机都看不到，排查 AMI、驱动、实例状态和 AWS 实例健康情况。不要通过反复重装 CUDA 来掩盖底层驱动问题。

#### 第四步：确定模型版本并下载权重

本例使用的模型 ID 为 `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-FP8`。

模型权重、模型配置、Tokenizer、模型卡和 License 必须作为一个版本整体管理。部署前由模型治理或开源合规流程确认 NVIDIA Nemotron Open Model License 是否满足企业使用场景，并记录 Hugging Face 仓库的 revision/commit、文件校验值、下载时间和审批记录。不要在生产启动脚本里直接引用一个会变化的 `main` 分支作为唯一版本标识。

在实例上创建模型目录，然后使用 Hugging Face CLI 下载。以下示例假设 Token 已通过安全方式注入当前 Shell 环境：

```bash
export MODEL_ID="nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-FP8"
export MODEL_DIR="/opt/models/nemotron-3-nano-30b-a3b-fp8"

sudo mkdir -p "$MODEL_DIR"
sudo chown "$USER":"$USER" /opt/models

python3 -m pip install --user -U huggingface_hub
hf auth login --token "$HF_TOKEN"
hf download "$MODEL_ID" --revision "$MODEL_REVISION" --local-dir "$MODEL_DIR"

du -sh "$MODEL_DIR"
find "$MODEL_DIR" -maxdepth 1 -type f | head
```

如果企业不允许实例直接访问 Hugging Face，应在受控的模型制品流水线中下载，再执行安全扫描、License 审核和 SHA-256 校验，最后同步到 S3。推理节点只读取已批准的 S3 制品，不自行访问外部模型仓库。模型下载失败时，先检查 License 是否需要接受、Token 是否有权限、出站网络和磁盘空间；不要把 Token 直接放进命令行历史或日志。

#### 第五步：用固定版本的 vLLM 容器启动模型

为了避免宿主机 Python 环境、CUDA Python 包和不同项目依赖互相污染，本例把 vLLM 放在容器中。生产环境必须固定 vLLM 镜像版本，进一步记录镜像 Digest；不能在部署脚本中长期使用 `latest`。下面以 vLLM 官方容器 `vllm/vllm-openai:v0.31.0` 展示启动方式。该版本号是示例基线，实际发布前仍需针对所选模型、H100 驱动和 CUDA 组合跑兼容性测试。

Nemotron 3 Nano FP8 的模型配方还需要模型提供的 `nano_v3_reasoning_parser.py`，以及对应的 FP8 MoE 环境变量。先下载并固定 Parser 文件：

```bash
sudo mkdir -p /opt/nemotron
cd /opt/nemotron

curl -fL \
  "https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-FP8/resolve/main/nano_v3_reasoning_parser.py" \
  -o nano_v3_reasoning_parser.py

sha256sum nano_v3_reasoning_parser.py
```

生产部署应把 Parser 文件纳入与模型相同的制品审批和版本锁定流程，不要每次容器启动时在线下载。随后拉取容器镜像并启动：

```bash
export VLLM_IMAGE="vllm/vllm-openai:v0.31.0"
export MODEL_DIR="/opt/models/nemotron-3-nano-30b-a3b-fp8"

docker pull "$VLLM_IMAGE"

docker run -d \
  --name nemotron-nano \
  --restart unless-stopped \
  --gpus '"device=0"' \
  --ipc=host \
  --shm-size=16g \
  -p 8000:8000 \
  -v "$MODEL_DIR:/models/nemotron:ro" \
  -v /opt/nemotron/nano_v3_reasoning_parser.py:/opt/nemotron/nano_v3_reasoning_parser.py:ro \
  -e VLLM_USE_FLASHINFER_MOE_FP8=1 \
  "$VLLM_IMAGE" \
  serve /models/nemotron \
    --served-model-name nemotron-nano \
    --host 0.0.0.0 \
    --port 8000 \
    --tensor-parallel-size 1 \
    --max-model-len 32768 \
    --max-num-seqs 8 \
    --gpu-memory-utilization 0.90 \
    --kv-cache-dtype fp8 \
    --trust-remote-code \
    --enable-auto-tool-choice \
    --tool-call-parser qwen3_coder \
    --reasoning-parser-plugin /opt/nemotron/nano_v3_reasoning_parser.py \
    --reasoning-parser nano_v3
```

这里有几个参数需要理解。`--tensor-parallel-size 1` 表示这个 POC 只使用一张 GPU；它不是生产集群的最终并行配置。`--max-model-len 32768` 把初始上下文上限设为 32K，目的是先在目标实例上得到可控的显存基线，不是说模型只支持 32K。模型卡给出了更长上下文的示例，但把上限直接提高到 256K 或 1M，会增加 KV Cache 占用并压低可用并发，必须按真实上下文分布逐步提高。`--max-num-seqs 8` 是并发序列上限的初始值，不是每秒请求数；提高它之前要先观察 KV Cache 和延迟。`--gpu-memory-utilization` 控制 vLLM 使用显存的目标比例，不能把它理解为给模型预留了固定的 10% 安全空间。

`--enable-auto-tool-choice` 和 `--tool-call-parser` 让服务能够按 Nemotron 配方解析工具调用；`--reasoning-parser` 用于解析模型的 reasoning 输出。企业如果只需要普通文本生成，可以先移除 Tool Calling 相关参数做最小验证，再逐项打开功能。工具调用解析成功也不意味着工具本身已经安全：实际执行仍应经过企业 Agent Runtime、Tool Broker、授权和审计层，不能让模型服务容器直接持有数据库或生产系统凭据。

初次启动需要加载模型，耗时取决于权重大小、磁盘吞吐、缓存和容器启动情况。通过以下命令观察启动日志和 GPU：

```bash
docker logs -f nemotron-nano
nvidia-smi -l 2
```

日志中应能看到模型加载、权重分片、KV Cache 初始化和 API Server 启动。若出现 CUDA out of memory，先确认是否有其他进程占用 GPU，再降低 `--max-model-len` 或 `--max-num-seqs`，并检查模型精度与实例显存是否匹配。若出现不支持的模型架构、Kernel 或参数错误，不要随意删除启动参数；先核对模型卡要求的 vLLM 版本、容器 CUDA 版本和该 GPU 架构的 Kernel 支持。

#### 第六步：验证服务，而不是只看容器处于 Running

容器状态为 Running 不代表模型已经可以服务。先检查模型列表：

```bash
curl -fsS http://localhost:8000/v1/models
```

再发起一次 Chat Completions 请求：

```bash
curl -N http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "nemotron-nano",
    "messages": [
      {
        "role": "user",
        "content": "用 Python 写一个函数，判断给定字符串是否为回文，并给出两个单元测试。"
      }
    ],
    "max_tokens": 512,
    "temperature": 0.6
  }'
```

如果接口返回模型生成内容，说明基本推理链路已打通。还应分别测试流式响应、长 Prompt、并发请求、工具调用和取消请求。对于 Coding 场景，至少准备一组真实仓库任务，检查代码是否能运行、测试是否通过、工具调用 JSON 是否符合 Schema，以及模型是否正确处理较长的代码上下文。不要用一条“Hello World”请求就宣布 POC 成功。

如果通过 SSM 做端口转发，可以在本地终端运行：

```bash
aws ssm start-session \
  --target i-xxxxxxxxxxxxxxxxx \
  --document-name AWS-StartPortForwardingSession \
  --parameters '{"portNumber":["8000"],"localPortNumber":["8000"]}'
```

随后本地访问 `http://localhost:8000`。生产环境不应依赖端口转发；应用应通过私有网络访问 Model Gateway，再由 Gateway 调用 vLLM。vLLM 的 OpenAI-compatible API 本身不等于企业 API Gateway，也不自动提供企业所需的用户认证、租户配额、请求审计、数据分类和模型路由。

#### 第七步：把 API 接到企业应用

不要让 IDE、Coding Agent 或业务服务直接连接每台 GPU 实例。应在 vLLM 前面部署 Model Gateway，统一处理身份验证、租户配额、请求大小限制、模型 Allowlist、超时、重试、限流、审计和模型版本切换。Gateway 后端可以是一个或多个 vLLM Endpoint。

应用侧只需配置稳定的 Gateway Base URL（例如 `https://model-gateway.corp.example/v1`）、模型名 `nemotron-nano`，以及由企业身份或 Secret 系统提供的 Gateway Token。

客户端示例：

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://model-gateway.corp.example/v1",
    api_key="YOUR_GATEWAY_TOKEN",
)

response = client.chat.completions.create(
    model="nemotron-nano",
    messages=[
        {"role": "user", "content": "Explain this Python function."}
    ],
    max_tokens=512,
)

print(response.choices[0].message.content)
```

这里的 API Key 是 Gateway 凭据，不应直接复用 Hugging Face Token 或 AWS 凭据。Gateway 记录请求 ID、用户/租户、模型版本、输入输出 Token、延迟和结果状态；日志中对 Prompt、代码片段和工具参数按数据分类进行脱敏或禁止记录。GPU 节点只接受 Gateway 所在安全组的请求，应用层不应知道 EC2 实例地址。

#### 第八步：增加监控、容量控制和故障处理

最小可用的生产监控至少要覆盖三层。EC2 层观察 GPU 利用率、显存、温度、功耗、ECC/Xid 错误、CPU、内存、磁盘和网络；vLLM 层观察请求数、队列等待、TTFT、TPOT、Token 吞吐、KV Cache 使用率、运行中序列和请求失败；业务层观察每个 Agent 任务的完成率、重试率、工具调用成功率、人工返工率和单位成功任务成本。只看 GPU Utilization 无法判断模型服务是否健康：GPU 利用率低可能是请求不足，也可能是请求卡在网络、调度或模型加载阶段。

POC 阶段可以先采集 vLLM 暴露的 Prometheus Metrics，并由 CloudWatch Agent 或 Prometheus/Grafana 收集主机和服务指标。日志统一进入 CloudWatch Logs，保留模型版本、容器镜像 Digest 和部署配置版本。告警应覆盖模型 API 不可用、P95 延迟越界、请求队列持续增长、KV Cache 接近耗尽、GPU Xid/ECC 错误和磁盘空间不足。

容量测试要固定模型版本、精度、上下文长度、输入/输出 Token 分布和并发阶梯。先跑单请求基线，再逐步增加并发，记录 TTFT、TPOT、总吞吐、P95/P99 和错误率。随后改变 Prompt 长度和输出长度，观察 KV Cache 如何影响并发。最终得到的是“在某个 SLO 下每个实例可以稳定处理多少请求/Token”，而不是一个脱离上下文的峰值 Tokens/s。

生产环境还需要定义实例故障时的行为。单台 EC2 不是高可用架构；实例停止、底层硬件维护或模型进程崩溃时，Endpoint 就会中断。至少要部署两个独立实例或两个可用区的服务副本，由内部负载均衡或 Gateway 做健康检查和流量摘除。模型启动时间较长，不能把自动扩容等同于请求到来后再启动 GPU；应保留热容量，按队列长度、KV Cache、请求延迟和 GPU 使用情况扩缩容。模型制品和容器镜像应预先缓存，减少冷启动时间。

#### 第九步：何时从 EC2 单机转到 EKS

单台 EC2 的目标是证明模型和推理引擎可用；当团队开始管理多个模型副本、多个 GPU 节点、滚动升级、自动扩缩容、服务发现和统一监控时，再考虑 EKS。EKS 并不会自动让模型更快，也不会替企业解决模型并行和 GPU 拓扑问题，它主要提供容器编排和服务生命周期管理。

转到 EKS 时，建议使用 AWS EKS-optimized accelerated NVIDIA AMI，避免在每个 Node 上手工安装一套不同的驱动。创建 GPU Node Group 或 Karpenter NodePool，按 GPU 型号打 Node Label，并通过 Taint/Toleration 将推理 Pod 限定到正确的 GPU 节点。Deployment 中通过 `resources.limits.nvidia.com/gpu` 申请 GPU；同一个模型副本需要 8 张 GPU 时，应确保 Pod 获得完整的 8-GPU 节点资源，并设置 `--tensor-parallel-size 8`，而不是把一个 TP8 副本随意拆到 8 台单 GPU EC2 上。

一个简化的 Deployment 片段如下。镜像、模型路径、Secret 名称和资源规格需要按实际环境替换：

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nemotron-nano
spec:
  replicas: 1
  selector:
    matchLabels:
      app: nemotron-nano
  template:
    metadata:
      labels:
        app: nemotron-nano
    spec:
      containers:
        - name: vllm
          image: vllm/vllm-openai:v0.31.0
          args:
            - serve
            - /models/nemotron
            - --served-model-name
            - nemotron-nano
            - --host
            - 0.0.0.0
            - --port
            - "8000"
            - --tensor-parallel-size
            - "1"
            - --max-model-len
            - "32768"
          ports:
            - name: http
              containerPort: 8000
          resources:
            limits:
              nvidia.com/gpu: "1"
          readinessProbe:
            httpGet:
              path: /health
              port: 8000
            initialDelaySeconds: 120
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /health
              port: 8000
            initialDelaySeconds: 180
            periodSeconds: 20
```

这个片段展示的是单 GPU Pod 的资源声明，不是完整生产清单。生产环境还需要模型卷挂载、Secret、Service、PodDisruptionBudget、拓扑分布、资源配额、NetworkPolicy、日志和指标采集。模型加载时间可能远超普通 Web 服务，Probe 的初始延迟和超时必须按真实启动时间设置；不能因为模型下载慢就让 Kubernetes 不断重启 Pod。对于 TP8，资源请求、节点选择和调度策略都必须保证单节点 8 张 GPU 一起分配。

AWS 官方 EKS 推理文档已经给出从 S3 模型制品、vLLM Deployment、Service 到 Prometheus/Grafana 的完整部署路径。企业可以在单机 POC 验证完成后，沿着这条路径把模型服务迁移到 EKS，而不是第一天就引入 Kubernetes 的全部复杂度。

#### 第十步：上线前的验收门槛

一个模型服务只有同时通过功能、性能、安全和运维验收，才应该接入真实开发者流量。

| 验收项 | 最低门槛 |
| --- | --- |
| 模型制品 | 版本、许可、来源、Parser 和校验值可追溯 |
| GPU 运行环境 | 宿主机与容器均能识别 GPU，驱动兼容 |
| 推理与质量 | Streaming、Tool Calling、取消请求及真实仓库任务通过 |
| 性能 | 目标并发下 TTFT、TPOT、P95/P99 和 KV Cache 达标 |
| 安全与运维 | 私网、鉴权、Secret、审计、告警、回滚和故障演练通过 |
| 成本 | 能计算每个成功任务成本，并与托管 API 比较 |
这条路径的关键结果不是“在 AWS 上成功运行了一个 Docker 容器”，而是得到一份可重复的部署基线：AWS Region 和实例规格、AMI、驱动版本、容器镜像 Digest、vLLM 版本、模型 revision、Parser 版本、启动参数、质量报告、性能报告和成本数据。后续从一台 EC2 扩到 EKS 或 8-GPU 节点时，团队才能判断变化来自模型、硬件、框架还是调度层。

部署时应以对应版本的官方资料为准，尤其不要把不同 vLLM release 的启动参数混用：

- [AWS EC2 Accelerated Computing 实例规格](https://aws.amazon.com/ec2/instance-types/accelerated-computing/)：P5/P5en/P6 的 GPU、显存、网络和实例存储规格。
- [AWS EKS-optimized accelerated AMI](https://docs.aws.amazon.com/eks/latest/userguide/ml-eks-optimized-ami.html)：EKS GPU 节点预装的 NVIDIA Driver、Container Toolkit 和相关组件。
- [AWS EKS：Load and Serve Models](https://docs.aws.amazon.com/eks/latest/userguide/ml-inference-load-serve-model.html)：从模型制品到 vLLM Deployment、Service 和监控的端到端流程。
- [NVIDIA Nemotron 3 Nano 30B A3B FP8 模型卡](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-FP8)：模型许可、权重、vLLM 启动参数和 reasoning/tool parser。
- [AWS Deep Learning Containers：vLLM on EC2](https://aws.github.io/deep-learning-containers/vllm/deployment/ec2/)：使用 AWS 容器镜像在 EC2 上启动 vLLM 的示例。


### 5.2 第二个模型：在同一平台增加 Kimi K2.6

如果企业已经按照上一节部署了 Nemotron，接下来要增加 Kimi，正确做法是再建设一个独立的 Kimi Model Pool，而不是把 Kimi 的权重复制到 Nemotron 容器里，再通过一个模型名切换。两种模型可以共用模型网关、身份认证、审计、监控平台和客户端协议，但推理进程、GPU 资源、模型制品、启动参数和容量指标必须分别管理。

本节选用 Moonshot AI 的开源 Kimi K2.6。它是 Kimi K2 系列的多模态 Agent 模型，包含文本、图像和视频输入能力，支持工具调用和 thinking 模式。模型是 MoE 架构，总参数约 1T，每个 Token 激活约 32B，包含 384 个专家，每个 Token 选择其中 8 个专家，最大上下文为 256K。这里的 32B 是每个 Token 参与计算的参数量，不是需要加载到 GPU 的全部权重大小。模型部署时仍要容纳完整专家权重，并为激活、通信缓冲区和 KV Cache 留出显存。vLLM Recipes 给出的 K2.6 INT4 权重文件约 595 GB，最低显存需求约 714 GB；NVFP4 变体的最低显存需求约 600 GB。因此它不可能像前面的 Nemotron Nano 一样放进一张 80 GB H100。<https://github.com/vllm-project/recipes/blob/main/models/moonshotai/Kimi-K2.6.yaml>

#### 第一步：决定部署开源权重，还是调用 Kimi 托管 API

先确认企业说的“部署 Kimi”具体指什么。Moonshot 提供托管 API，企业可以不采购 GPU，直接通过网络调用；也可以下载开放权重，在自己的 AWS 账号和 VPC 中运行。两条路径的架构、成本和数据边界完全不同。

本节讨论的是自托管开源权重。生产决策前应确认模型仓库、模型变体和 License，明确是使用 [Moonshot 发布的 Kimi K2.6](https://huggingface.co/moonshotai/Kimi-K2.6) INT4 权重，还是 [NVIDIA 发布的 Kimi K2.6 NVFP4](https://huggingface.co/nvidia/Kimi-K2.6-NVFP4) 量化权重。后者是针对 NVIDIA Blackwell 优化的制品，不是把前者的模型 ID 改一下就能得到的文件。模型、Tokenizer、Processor、Chat Template、量化配置和 vLLM 版本应作为一个不可随意拆分的部署版本记录。

#### 第二步：按 Kimi 的完整权重规模选择 GPU

Kimi K2.6 的第一个现实约束是显存。MoE 每次只计算部分专家，但模型服务启动时仍需要把所有专家权重放到 GPU 或经过验证的分层存储中。若显存不够，就需要量化、跨 GPU 切分，或采用经过验证的 CPU KV/权重卸载方案；这些选择会影响性能和运行复杂度。

对 AWS 而言，可以先看两条实际可执行的路径：

| 路径 | AWS 实例 | 模型制品 | GPU 资源 | 适用场景 |
| --- | --- | --- | --- | --- |
| Hopper 路径 | p5en.48xlarge | moonshotai/Kimi-K2.6 INT4 | 8×H200，合计约 1,128 GB HBM3e | 使用 Moonshot 开源模型权重，建立通用 Kimi 服务 |
| Blackwell 路径 | p6-b300.48xlarge | nvidia/Kimi-K2.6-NVFP4 | 8×B300，合计约 2,144 GB HBM3e | 使用 NVIDIA NVFP4 量化制品，验证 Blackwell 优化路径 |

vLLM Recipes 当前列出的 K2.6 部署验证包括 8×H200 的 INT4 路径，以及 4×B300 的 NVFP4 路径。AWS 的 p6-b300.48xlarge 是 8-GPU 实例，而上游配方的 B300 示例使用 TP4；不能因此认为 AWS 会按 4 张 GPU 的价格出租半台实例。POC 时应把整台实例的成本算进去，并先验证本机 GPU 拓扑、vLLM 对 GPU 分组的支持和实际利用率。不要为了让剩余 GPU 看起来没有浪费，就未经隔离测试把另一模型塞进同一台机器。

p5en.48xlarge 提供 8 张 H200、1,128 GB HBM3e 和 3,200 Gbps EFA；p6-b300.48xlarge 提供 8 张 B300、约 2.1 TB GPU 显存和 6.4 Tbps EFA。多节点部署时，EFA、GPUDirect RDMA 和节点间网络延迟会直接影响专家并行和张量并行的通信成本。AWS 实例规格与可用 Region 会变化，创建前应检查目标 Region 的实例供给和 GPU 配额。<https://aws.amazon.com/ec2/instance-types/accelerated-computing/> <https://docs.aws.amazon.com/ec2/latest/instancetypes/ac.html>

#### 第三步：建立独立的 Kimi GPU Node Pool

不要把 Kimi 与 Nemotron 放在同一组可任意调度的 GPU 节点上。Nemotron Nano 的 POC 可以使用单卡实例；Kimi K2.6 则需要 8×H200 或经过验证的 B300 多 GPU 配置。两者的显存需求、启动时间、并行策略和请求负载差异很大。如果共享同一节点池，Kimi 的大权重加载可能占满显存，影响 Nemotron 的稳定性；Kubernetes 也可能因为 GPU 数量不足而无法调度整个 Kimi Pod。

建议为两种模型分别定义 Node Group 或 Karpenter NodePool，例如：

- gpu-nemotron-h100：承载 Nemotron Nano 等单 GPU 或较小规模模型。
- gpu-kimi-h200：承载 Kimi K2.6 INT4，使用完整 8-GPU H200 节点。
- gpu-kimi-b300：承载 Kimi K2.6 NVFP4，使用 B300 节点和相应的 vLLM/Kernel 配置。

为节点添加 GPU 型号、显存容量和架构标签，并使用 Taint/Toleration 防止普通工作负载进入。Kimi 的 TP8 副本需要调度到同一台具有 8 张 GPU 的节点，不能把 8 张 GPU 分散在 8 台单卡 EC2 上，再期望 vLLM 自动获得与单机 NVSwitch 相同的通信性能。跨节点时必须显式配置分布式通信、EFA、NCCL 和节点角色。

#### 第四步：准备 Kimi 模型制品和运行环境

Kimi 的模型制品比 Nemotron 多出一层多模态处理要求。除模型权重和 Tokenizer 外，还需要确认 Processor、图像/视频预处理配置和对应 Chat Template。即使企业第一阶段只做 Coding，也要明确是否加载视觉 Encoder；纯文本部署可以评估 vLLM 配方中的 --language-model-only，以避免加载暂时用不到的视觉组件并释放显存。以后要接收截图、架构图或视频时，再部署完整多模态服务，不能只在 API Gateway 上打开一个 image_url 字段就认为模型已经支持图像。

下载模型时，建议通过模型制品流水线完成，而不是在生产 GPU 节点启动时直接访问 Hugging Face：

~~~bash
export MODEL_ID="moonshotai/Kimi-K2.6"
export MODEL_REVISION="<approved-commit-sha>"
export MODEL_DIR="/opt/models/kimi-k2.6"

hf download "$MODEL_ID" --local-dir "$MODEL_DIR"
du -sh "$MODEL_DIR"
~~~

如果选择 Blackwell NVFP4 制品，则模型 ID 改为：

~~~bash
export MODEL_ID="nvidia/Kimi-K2.6-NVFP4"
export MODEL_REVISION="<approved-commit-sha>"
export MODEL_DIR="/opt/models/kimi-k2.6-nvfp4"

hf download "$MODEL_ID" --local-dir "$MODEL_DIR"
du -sh "$MODEL_DIR"
~~~

这两段是两种互斥的模型制品路径，不要把两个目录混用。实际下载应锁定 Hugging Face revision，并保存文件校验值、License 审核、模型卡、Tokenizer/Processor 文件和来源记录。对于生产环境，先把制品复制到受控 S3 Bucket，再由推理节点通过 IAM Role 读取。模型目录需要放在足够大的本地 NVMe 或高吞吐共享存储上；不能只按压缩包大小估算空间，还要预留解压、缓存和临时文件空间。

#### 第五步：部署 H200 版本的 Kimi K2.6 INT4

如果企业目前主要使用 H100/H200，先从 H200 INT4 路径开始评估。AWS p5en.48xlarge 有 8 张 H200，vLLM Recipes 将 Kimi K2.6 INT4 列为 8×H200 已验证配置。与前面 Nemotron 的单 GPU docker run 不同，这里要把整台机器的 8 张 GPU 分配给同一个模型副本，并设置 Tensor Parallel Size 为 8。

先确认节点上有 8 张 GPU：

~~~bash
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv
~~~

然后启动 vLLM。vLLM Recipes 将 Kimi K2.6 的最低版本列为 0.25.0；这只是模型支持基线，不代表每个优化 Kernel 在该版本都可用。下面以 0.31.0 作为命令示例，生产发布必须固定经过测试的 vLLM 镜像 Digest，并根据上游 Kimi K2.6 recipe 校准启动参数，不要把它当成所有 vLLM 版本都通用的命令：

~~~bash
docker run -d \
  --name kimi-k26 \
  --restart unless-stopped \
  --gpus all \
  --ipc=host \
  --network host \
  -v /opt/models/kimi-k2.6:/models/kimi:ro \
  vllm/vllm-openai:v0.31.0 \
  serve /models/kimi \
    --served-model-name kimi-k2.6 \
    --host 0.0.0.0 \
    --port 8001 \
    --tensor-parallel-size 8 \
    --trust-remote-code \
    --tool-call-parser kimi_k2 \
    --enable-auto-tool-choice \
    --reasoning-parser kimi_k2
~~~

这里的 --tensor-parallel-size 8 表示一个 Kimi 副本跨当前节点的 8 张 GPU 切分权重和计算。它与 Nemotron 的 --tensor-parallel-size 1 有本质区别。Kimi 的 MoE 专家分布还可以使用 Expert Parallelism（EP），在更高并发下配合 Data Parallelism（DP）提高吞吐；这不是简单把 TP 数值调大。vLLM 对 Kimi 的部署配方还提供 DP+EP、TP+PP 等方案，具体选择要结合节点数量、GPU 互联和真实请求分布做 Benchmark。<https://docs.vllm.ai/projects/recipes/en/stable/moonshotai/Kimi-K2.html>

上面的启动模板只展示服务进程和关键 Kimi 参数。生产发布前要核对所选 INT4 权重格式是否与目标 vLLM 版本和 Kernel 匹配，并从对应的 Kimi K2.6 Recipe 补齐量化、KV Cache、上下文长度、批处理和并行配置。不要因为容器能够启动，就跳过权重加载完整性、工具调用和长上下文测试。

#### 第六步：部署 B300 NVFP4 版本

如果企业已经有 Blackwell 节点，可以评估 NVIDIA 发布的 nvidia/Kimi-K2.6-NVFP4。这是专门量化的模型制品，配合 Blackwell 的 FP4 Kernel。vLLM Recipes 给出了 B300 TP4 的验证命令，其中包括 FlashInfer AllReduce Backend、FP8 KV Cache、Tokenspeed MLA Attention 和 EAGLE3 speculative decoding。它依赖特定的 vLLM、FlashInfer、Kernel 和 GPU 架构组合，不能把这些参数复制到 H200 上。

核心启动参数如下，完整配置以 [vLLM Kimi-K2.6 Recipe](https://github.com/vllm-project/recipes/blob/main/models/moonshotai/Kimi-K2.6.yaml) 为准：

~~~bash
export VLLM_FLASHINFER_ALLREDUCE_BACKEND=trtllm

vllm serve nvidia/Kimi-K2.6-NVFP4 \
  --tensor-parallel-size 4 \
  --trust-remote-code \
  --kv-cache-dtype fp8 \
  --block-size 64 \
  --gpu-memory-utilization 0.90 \
  --attention-backend TOKENSPEED_MLA \
  --attention-config '{"use_prefill_query_quantization":true}' \
  --compilation-config '{"cudagraph_mode":"FULL_AND_PIECEWISE","custom_ops":["all"]}' \
  --max-cudagraph-capture-size 2048 \
  --speculative-config '{"method":"eagle3","model":"lightseekorg/kimi-k2.6-eagle3-mla","num_speculative_tokens":4}'
~~~

这条命令是上游 B300 配方中的优化路径，不是通用 Kimi 启动命令。EAGLE3 需要额外的 Draft Model 制品；如果第一阶段只是验证模型能否稳定提供 API，可以先关闭 speculative decoding，跑通基线后再单独比较它对 TPOT 和吞吐的改善。类似地，CPU KV Offload、DCP 和不同 AllReduce Backend 都应作为单独实验项，不要第一次启动就全部打开，否则发生问题时很难判断是模型、量化还是 Kernel 配置导致的。

#### 第七步：验证 Kimi 特有的协议和多模态行为

Kimi 也可以通过 vLLM 的 OpenAI-compatible API 调用，但“API 地址兼容”不意味着与 Nemotron 使用相同的 Tool Parser、Reasoning Parser 或 Chat Template。Kimi K2.6 的工具调用解析器是 kimi_k2，Reasoning Parser 也是 kimi_k2。如果沿用 Nemotron 的 qwen3_coder Parser，可能出现工具调用格式无法正确解析、工具参数被当作普通文本，或者 Agent Runtime 看不到预期的工具调用事件。

首先验证服务和模型名：

~~~bash
curl -fsS http://localhost:8001/v1/models
~~~

再验证普通文本生成：

~~~bash
curl -N http://localhost:8001/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "kimi-k2.6",
    "messages": [
      {"role": "user", "content": "Review this Python function and identify potential bugs."}
    ],
    "max_tokens": 1024
  }'
~~~

然后单独测试 Tool Calling、Thinking、Streaming、取消请求和多轮对话。对于多模态能力，还要测试图像输入、视频帧输入、超大图像、图像预处理缓存和多模态请求的 Token/显存消耗。若企业当前只做 Coding，可以先将文本能力作为上线范围，把图像和视频能力留在后续验收，不要因为模型支持多模态就默认所有客户端都需要开放这些输入。

#### 第八步：把 Nemotron 和 Kimi 接到同一个 Model Gateway

到这一步，企业已经有两个独立的推理 Endpoint：

| 模型 | 内部 Endpoint | GPU 资源池 |
| --- | --- | --- |
| Nemotron Nano | `http://nemotron-service:8000/v1` | H100 单卡 |
| Kimi K2.6 | `http://kimi-service:8001/v1` | H200 / B300 多 GPU |

Gateway 对客户端提供统一入口，例如 https://model-gateway.corp.example/v1。

但 Gateway 内部必须维护 Model Registry，记录模型名称、真实 Endpoint、模型版本、上下文上限、输入模态、工具调用能力、Reasoning 行为、资源池、SLO、数据分类和授权范围。不要让客户端传入任意 Hugging Face 模型 ID，也不要让模型自行决定调用哪个内部 Endpoint。

路由可以根据任务类型、质量评测、延迟、成本和容量选择模型。例如，普通代码解释可以先走成本较低、延迟较短的 Nemotron；复杂跨文件分析、需要长上下文或更强 Agent 能力的任务可以选择 Kimi。这个策略必须来自企业自己的 Benchmark，而不是因为模型名称或参数量就预设 Kimi 一定更好。Kimi 的多模态请求还应有单独的路由条件，避免图像请求被发送到只配置了文本模型的 Endpoint。

Gateway 还要统一处理租户配额、请求超时、重试、熔断、模型降级、日志脱敏和审计。降级只能转到经过质量验证且允许处理相同数据分类的模型；不能因为 Kimi 服务不可用，就把受限数据自动发给外部托管 API。工具调用则应由 Agent Runtime 统一执行，不应让不同模型的工具协议差异直接渗透到业务系统。

#### 第九步：为 Kimi 单独做容量测试和故障演练

不能把 Nemotron 的 Benchmark 结果用于推算 Kimi 的实例数量。Kimi 的 MoE 专家分布、All-to-All 通信、上下文长度和 KV Cache 占用，会让吞吐与延迟对并行策略更敏感。相同的请求数，在不同输入长度、输出长度和专家路由分布下，GPU 通信与显存压力可能完全不同。

至少应比较 TP、DP+EP、上下文长度和并发阶梯。对 Kimi 的 Coding 场景，建议记录 TTFT、TPOT、P95/P99、输入/输出 Token 吞吐、GPU 显存、KV Cache、专家通信开销和每个成功任务的成本。多模态场景还要把图像/视频预处理耗时、Encoder 显存和输入尺寸纳入测试。

Kimi 的单副本往往占用一整台多 GPU 节点，故障域也比单卡 Nemotron 大。生产环境至少需要考虑另一台独立 GPU 节点上的备用副本、模型权重预热、健康检查、流量摘除和版本回滚。若预算暂时只允许一台 Kimi GPU 节点，应明确标注为非高可用服务，设置维护窗口和请求降级策略，不要在架构图上把一个 Pod 画成高可用集群。

#### 第十步：上线前检查两个模型的隔离和治理

两个模型共用 Gateway 不等于可以共用所有运行配置。模型升级应独立进行：先部署新版本 Kimi Endpoint，运行离线评测和 Shadow Traffic，再对小比例请求 Canary；通过后切换 Registry 指向，保留旧版本用于快速回滚。Nemotron 的升级不应触发 Kimi 重启，反之亦然。

| 对比项 | Nemotron Nano | Kimi K2.6 |
| --- | --- | --- |
| 模型规模 | 30B A3B FP8 | 1T 总参数 MoE，需加载完整专家权重 |
| 起步资源 | 1×H100 POC | 8×H200 INT4，或验证过的 B300 NVFP4 |
| 推理配置 | TP1，Nemotron Parser | TP/PP/EP 按拓扑选择，使用 kimi_k2 Parser |
| 容量瓶颈 | 单卡显存和 KV Cache | 专家通信、KV Cache 和多 GPU 利用率 |
| 多模态 | 取决于具体型号 | 支持图像和视频输入 |
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


## 18. 业界真实案例：企业为什么自部署 GPU 推理，以及生产环境究竟怎么做

前面几章讨论的是平台组件和部署方法。本章转向已经公开的企业实践，重点看四件事：企业为什么选择自管推理；租用云 GPU 是否仍算自部署；生产系统怎样组合 GPU、Kubernetes、推理引擎、缓存和调度；以及上线后暴露了哪些问题。

案例按控制边界分为三类：企业自有或自控推理平台；租 CSP / GPU Cloud 资源但自行运营推理服务；把推理基础设施交给专业平台运营商。第三类不是严格意义上的企业自部署，但对判断自建平台是否值得非常重要。厂商公开的性能和成本数字均保留其原始口径，不视为独立审计结果；公开资料没有披露的架构细节不会自行补齐。

### 18.1 自部署的定义：GPU 所有权与运营责任

自部署（self-hosted / self-managed inference）的关键不是 GPU 的产权，而是企业是否控制模型服务的数据面和运行边界。

| 模式 | GPU 资产归属 | 谁运营推理引擎与调度 | 数据和模型控制 | 是否属于企业自部署 |
| --- | --- | --- | --- | --- |
| 企业自购 GPU、机房自建 | 企业 | 企业 | 企业 | 是，典型 On-Prem |
| 企业租用 AWS EC2 GPU，在自己的 VPC / EKS 运行 vLLM | CSP | 企业 | 企业控制主要服务边界 | 是，Cloud Self-Hosted |
| 企业租用 CoreWeave / Lambda / Nebius 专属 GPU 集群，自行部署 K8s 和推理栈 | GPU Cloud | 企业或双方分工 | 取决于租户隔离、网络、运维权限和合同 | 可以是，需核实责任边界 |
| 企业租 Dedicated Endpoint，自己控制模型配置、容量和流量，但不管理节点和推理引擎 | CSP / GPU Cloud | 服务商 | 企业有一定模型和端点控制权 | 不是严格自部署，是 Dedicated Managed Inference |
| Together AI / Fireworks / Bedrock / Vertex 等托管模型 API | 服务商 | 服务商 | 主要由 API 合同、区域和保留策略约束 | 否，Managed API |

企业在自己的 AWS Account 中创建 EKS、P4d/P5 GPU 节点、FSx for Lustre、VPC、IAM 和 ALB，把模型权重放进自己的存储，由自己运营 vLLM，即使没有购买 A100，也属于 Cloud Self-Hosted。反过来，服务商使用开源权重并不代表客户自部署；如果服务商管理节点、驱动、推理引擎和调度，客户只是调用 API，那么仍然是托管推理。

### 18.2 IBM Research + Red Hat：544 张 H100 服务数千个 Coding Agent

这是与本文目标最直接相关的公开案例之一。IBM Research 在 2026 年 9 月发布基于 llm-d 的部署报告：IBM Research、Red Hat 团队使用 544 张 NVIDIA H100 部署 GLM-5.2（约 753B 总参数、约 39B 激活参数的 MoE 模型），面向内部关键业务负载，并用 Agentic Benchmark 验证数千个并发 Coding Agent 的服务能力。IBM 报告称，峰值输出吞吐超过每分钟 660 万 Token，测试中最高支持 3,000 个并发 Coding Agent 且没有发生请求抢占。按其采用的当期云 GPU 租赁价格估算，单位 Token 成本约为商业闭源 API 的 1/5 到 1/10。这个 5–10 倍是 IBM 对特定模型、流量、租赁价格和 API 对比口径的测算，不是任何企业都能复制的固定成本优势。

这项工作的价值不只是部署了 544 张 GPU，更在于它公开了对 Agentic Workload 的分析。团队基于 219 个真实 Claude Code Session 的数据，观察到典型请求的输入远大于输出：中位数约 195K 输入 Token，而输出约 317 Token；96% 的主 Agent 请求至少复用了前一个请求 90% 的输入内容。子 Agent 还会在没有预告的情况下并发启动，形成瞬时流量尖峰。这意味着 Coding Agent 的推理负载与普通聊天机器人不同：主要成本可能是重复读取上下文，而不是生成回答。

系统组合包括：llm-d 做 Kubernetes-native 分布式推理编排；GLM-5.2 MoE 采用 Wide Expert Parallelism + Data Parallel Attention；Prefill 与 Decode 拆分为独立资源池；NIXL 在两组之间传输 KV Cache；Prefix-aware Routing 把请求路由到已经持有相关前缀缓存的 Worker；GPU KV Cache、CPU DRAM 分层缓存和 Peer-to-Peer KV Cache Sharing；Multi-Token Prediction 提升高并发 Decode 吞吐。

公开的测试数据很有价值：精确 Prefix Matching 相比近似路由，在 CyberGym 测试中带来 79% 更高吞吐和 67% 更低 TTFT；完整系统把输入 Token 中约 85.2% 从缓存提供，未命中后需要重新 Prefill 的部分降到 14.8%。NIXL 在测试期间完成约 620 万次 KV Cache Transfer，平均每次约 2.71 GiB，Fleet P90 吞吐约 580 Gb/s，未观察到传输失败。

这类平台主要面向大规模内部 Coding Agent、长上下文多轮 Agent 平台、已经拥有 H100 GPU Fleet 并希望提高其价值的组织。

从 IBM 的数据里能看出，不能用普通 Chat Completion 的 QPS / Tokens per Second 模型估算 Coding Agent。要从 Agent Trace 得到输入长度、上下文重复率、子 Agent 并发、Prefill / Decode 比例和缓存命中率。对这类负载，路由是否命中 Prefix Cache、KV Cache 是否能跨 Worker 复用，可能比单 GPU 理论峰值算力更重要。

这组数字不能直接外推：544 张 H100 是特定模型和负载的规模，不是 1000 名开发者的参考采购量。3000 并发是报告中的 benchmark / 内部负载结果，也不能直接等同于 3000 名同时活跃开发人员。必须用自己的 Agent Harness 和 Trace 重测。

来源：[IBM Research：How llm-d makes the most of the hardware you already have（2026-09-08）](https://research.ibm.com/blog/running-open-models-on-h100-gpus-with-llmd)；[llm-d](https://llm-d.ai/)。

### 18.3 Shopify：将高 Token 消耗子任务交给自托管 Specialist Model

Shopify 在 2026 年 10 月公开了 Sidekick 的 Task Expert 实践。它不是把一个开源模型直接替换所有闭源模型，而是采用分层 Agent 架构：Frontier Model 负责与商家交互、规划和决定调用什么工具；上下文很重、任务边界清晰的子任务交给 Shopify 自己 Post-train 并托管的开源模型。

一个具体例子是 GraphQL Subagent。商家询问哪些商品库存不足时，子 Agent 要读取 Shopify API Schema、搜索文档、编写并执行 GraphQL Query，再返回结果。该任务的输入 Token 约为输出 Token 的 40 倍。若一直使用按 Token 计费的 Frontier API，重复读取 Schema 和文档会造成较高成本。

Shopify 基于 NVIDIA Nemotron 3.5 Lightning 做任务后训练。该 MoE 模型总参数约 30B，每 Token 激活约 3B。Shopify 报告称，经过六轮持续改进和约 61,000 条修复样本后，模型在其 GraphQL 任务 Judge 上达到 74.5 分，高于 Frontier Model 的 73 分；生产流量回放中，中位数完整响应时间为 0.87 秒，而 Frontier API 为 6.50 秒；最慢 1% 请求也快约 8 倍。该 Specialist Model 的服务成本比 Frontier Model 低约 90%。Shopify 还表示，跨其 Post-trained Models，自托管服务成本比 Frontier API 低约 90%–98%。

Shopify 的流程比单纯替换模型更有参考价值：先定义业务任务的质量 Rubric，建立 Frontier Agent 的质量基线；再选择开源模型，在真实 Subagent、真实工具和同一套 Judge 中评估；从一开始就用 AIPerf 回放生产 Trace，输入内容使用合成文本，避免在性能测试中暴露客户数据；对 Batch Workload 比较 vLLM、SGLang 和 TensorRT-LLM；每晚把生产失败案例转化为训练数据，通过 Judge、Critic 和模拟商家回放持续修复模型。

Shopify 还披露，使用 NVIDIA Megatron Bridge 在 Nebius 上进行跨节点后训练；同一个 FP8 后训练任务中，8 张 B300 相比 8 张 H200 快 1.86 倍，GPU-hours 减少 46%。这是训练效率对比，不应误读成推理吞吐提升。

这种拆分方式适合大型 SaaS、企业内部 Agent、具有稳定且重复的业务子任务、输入上下文显著大于输出的工作负载。

Shopify 这次实践的重点是，自部署收益不一定来自把主模型全部换成开源模型。更稳妥的做法是把任务拆开：复杂规划继续使用 Frontier Model；Schema 查询、分类、抽取、固定工具调用等可评测子任务交给 Specialist Model。通过任务级评测、后训练和生产数据闭环，降低成本并减少单一供应商依赖。

需要具备的前提是，Shopify 有明确业务任务、生产数据和专门评测体系。没有可靠 Ground Truth、Judge 校准和失败样本治理时，单纯 Fine-tune 不会自动得到同样收益。

来源：[Shopify Engineering：How Shopify turns open models into task experts（2026-10-21）](https://shopify.engineering/open-model-task-experts)。

### 18.4 Perplexity：租用 AWS A100 / H100 并自营推理 API

Perplexity 的 pplx-api 是“租用 CSP GPU 仍然属于自部署”的典型案例。NVIDIA 客户案例披露，Perplexity 最初将 pplx-api 部署在 AWS EC2 P4d 实例上，每台 P4d 配备 8 张 A100 GPU；推理服务使用 TensorRT-LLM，并通过 AWS 与 Kubernetes 的集成扩展到数百张 GPU。模型服务面向外部开发者，支持多个开源模型。

NVIDIA 案例给出的结果包括：相对其他部署平台，pplx-api 延迟最高可降低约 3.1 倍、首 Token 延迟最高可降低约 4.3 倍；切换外部推理 API 调用到 pplx-api 后，报告成本降低约 4 倍、每年节省约 60 万美元。后续在 AWS P5 H100 + FP8 配置下，相同配置比较 A100，延迟减半、吞吐提升约 200%。这些是 Perplexity / NVIDIA 公布的特定比较结果，不代表 H100 对任何模型都能得到相同提升。

架构特点：GPU 资源租自 AWS EC2，不需要自己建设机房；模型服务和 API 产品由 Perplexity 自己运营；TensorRT-LLM 用于推理优化；Kubernetes 负责大规模部署和弹性扩展；通过小型 Classifier Model 把不同请求路由到不同 GPU Pod / 模型。

这种模式主要面向对外提供模型 API 的 AI 产品公司、需要高并发和稳定 SLA 的 SaaS、希望控制模型和推理优化而不愿自己建数据中心的团队。

对资源规划更有用的结论是，企业自部署的合理起点可以是租 CSP GPU，而不是先采购硬件。用租赁资源验证模型、服务架构、流量和单位成本，证明稳定需求后再决定长期 Reserved Capacity、Dedicated Cluster 或自购。

来源：[NVIDIA Customer Story：Perplexity](https://www.nvidia.com/en-us/case-studies/perplexity/)；[NVIDIA：Fast, Low-Cost Inference Offers Key to Profitable AI](https://blogs.nvidia.com/blog/ai-inference-platform/)。

### 18.5 Netflix：将 LLM Serving 接入现有模型平台

Netflix 在 2026 年公开了内部 Model Scoring Service（MSS）承载 LLM 的实践。它没有把 LLM Serving 当成完全独立的新平台，而是把模型推理集成到已有 JVM Serving Layer 和 MSS 中。

已有 JVM Serving Layer 继续负责路由、Feature Retrieval、Candidate Generation、Post-processing 和 Logging。较小模型可以在 CPU 进程内运行；较大的 GPU 推理请求委托给 MSS。MSS 由 NVIDIA Triton 管理模型加载、Batching、GPU 调度和多框架 Serving，vLLM 负责实际 LLM Inference。系统同时提供内部 gRPC、KServe HTTP / gRPC 以及 OpenAI-compatible HTTP 接口。

Netflix 公开的生产问题尤其有价值。Triton 的 vLLM Backend 与特定 vLLM API Surface 编译绑定，版本不匹配可能导致 Backend 完全无法加载，因此团队在构建服务镜像时固定兼容版本，并禁止模型作者在 Packaging 阶段自行覆盖 vLLM 版本。Triton 的 vLLM Backend 只需 JSON 配置模型权重和 Tokenizer，运行时动态生成 I/O Tensor Spec，降低模型制品与 Frontend 升级的耦合；需要自定义 Preprocess / Postprocess 或非标准执行流程的模型，则保留 Python Backend 作为 Escape Hatch。

模型冷启动也被纳入平台设计：从 S3 或 Hugging Face 在启动时下载大型模型太慢，Netflix 在模型发布时就把权重物化到 Amazon FSx，启动时优先从高性能文件系统读取。部署层由 Java Control Plane 负责版本、健康检查、Autoscaling 和 Multi-region Rollout；模型接口稳定时采用 Red-Black 部署，接口发生破坏性变化时采用 Versioned Deployment，让新旧模型版本并行存在，代价是升级期间暂时增加 GPU 成本。

可观测性方面，Triton 内置的 Metrics Bridge 只暴露了 40 多项 vLLM Metrics 中的 9 项，遗漏 Token Throughput、KV Cache Utilization 和 Prefix Cache Hit Rate 等关键指标。Netflix 因此增加轻量 Metrics Proxy，把 Triton HTTP Metrics 与 vLLM Prometheus MultiProcessCollector 的数据合并到统一 /metrics Endpoint。Constrained Decoding 的初始 Python 实现还受到 GIL 限制：Logits Processor 在 CPU 侧逐请求串行执行，Batch 越大尾延迟越差；团队迁移到 vLLM V1 的 Batch-level Processor，并把热点逻辑改为 C++，同时处理 Chunked Prefill 和 KV Cache Preemption 后 Token History 改变导致的状态机恢复问题。另一个 API 契约问题是 response_format 在某条集成路径中被接受却被丢弃，可能导致 JSON 约束没有真正生效。

如果企业已经有成熟的 Model Serving、MLOps 或 Feature Serving 平台，可以把 LLM Serving 接入现有控制面，避免再维护一套孤立系统。

Netflix 暴露出的工程问题是，LLM 不一定要成为全新的平台孤岛。可以复用已有 Serving、Logging、Routing、KServe 和模型生命周期管理能力，只把 GPU Runtime 和 LLM 特有的 KV Cache / Decoding 能力作为专门扩展。API 兼容性必须做端到端契约测试，不能只检查 Gateway 返回 200。

来源：[Netflix TechBlog：In-House LLM Serving at Netflix（2026-07-17）](https://netflixtechblog.com/in-house-llm-serving-at-netflix-a5a8e799ea2c)；[InfoQ 对 Netflix 技术分享的整理（2026-07-27）](https://www.infoq.com/news/2026/07/netflix-llm-platform/)。

### 18.6 Observe.AI：EKS 上的成本优化与启动链路

Observe.AI 为 Contact Center Quality Assurance 提供 GenAI Moments，使用 LLM 分析客户与客服的对话。它在 AWS 上使用 EKS 运营 GPU 推理。业务增长时，系统遇到两个问题：GPU 推理成本较高，以及流量突增时新 GPU 节点和模型启动太慢。

AWS 客户案例披露，模型从原先约 12–15 分钟的启动时间降到约 100 秒，LLM 每百万 Token 成本降低 40% 以上，整体基础设施成本也降低 40% 以上。

关键优化并不是换一个更大的 GPU，而是改造模型冷启动和弹性扩容链路：原先新节点需要把模型权重从 S3 下载到本地磁盘，再加载到 GPU；团队引入 Run:ai Model Streamer，让模型权重可以从 S3 直接流入 GPU Memory。原先新节点启动时还要下载大型 Inference Container；团队改用 Bottlerocket AMI，并通过 EBS Snapshot 预置推理镜像，结合 EBS Fast Snapshot Restore 加速节点准备。扩缩容原先主要参考 CloudWatch Metrics；团队改为直接读取 SQS Queue 中的任务需求，让扩容依据更接近真正的待处理工作量。

这类优化适合业务负载有明显峰谷、使用异步队列、模型较大且 GPU 节点需要动态扩容的企业，例如客服质检、批量文档处理、离线代码分析和后台 Agent。

Observe.AI 的实践说明，GPU Auto Scaling 不只是增加 Kubernetes Pod 副本。节点启动、镜像拉取、权重下载、模型加载、CUDA Graph 初始化和健康检查都可能耗时。必须把从发现需求到模型真正 Ready 的完整时间作为容量指标。

来源：[AWS Customer Story：Observe.AI cuts AI inference costs by over 40%](https://aws.amazon.com/solutions/case-studies/observeai-case-study/)。

### 18.7 AWS EKS + vLLM：客户在自己的 AWS Account 中运营模型服务

AWS 在 2025 年发布的参考架构展示了企业在自己 AWS Account 中部署 vLLM 的完整路径。架构使用 EKS、EC2 P4d（每台 8×A100）、EFA、FSx for Lustre、AWS Deep Learning Container、LeaderWorkerSet 和 ALB。

模型权重存放在 FSx for Lustre；vLLM Pod 通过 Tensor Parallelism / Pipeline Parallelism 使用多 GPU，跨节点场景通过 EFA 提供高性能网络；ALB 对外暴露统一 API。AWS Deep Learning Container 提供经过预配置和测试的推理环境，降低 CUDA、NCCL、驱动和 EFA 依赖的安装工作。

这不是特定企业的生产客户案例，而是 AWS 给自管 ML 用户的工程参考实现。它说明 CSP 可以托管 Kubernetes Control Plane 和提供 GPU 实例，但客户仍然自己管理模型权重、推理容器、模型配置和业务 API。

这套方案适合：已经使用 AWS、希望在现有 VPC / IAM / KMS / EKS 治理体系内运行模型服务的企业。

落地前还要确认：参考架构中的 P4d、FSx、EFA 和 LeaderWorkerSet 只是可运行起点，不等于生产平台已经完成。企业仍需补充私有模型仓库、镜像扫描、模型制品签名、身份认证、租户隔离、限流、审计、故障切换、容量配额和成本归属。多节点推理还需要独立验证 EFA / NCCL 拓扑和实际网络吞吐。

来源：[AWS Architecture Blog：Deploy LLMs on Amazon EKS using vLLM Deep Learning Containers（2025-08-14）](https://aws.amazon.com/blogs/architecture/deploy-llms-on-amazon-eks-using-vllm-deep-learning-containers)；[AWS EKS Load & Serve Models](https://docs.aws.amazon.com/eks/latest/userguide/ml-inference-load-serve-model.html)。

### 18.8 Cognition / Devin：在 CoreWeave 租用 GPU 并按 Agent 负载扩容

Cognition 公开表示，其在 CoreWeave 上运行 Devin 的训练、强化学习和生产推理，从桥接容量扩展到数千张 GPU，历时不到九个月。2026 年 CoreWeave 公告还提到，Cognition 与 CoreWeave 部署了 Vera Rubin NVL72，并由 Cognition 工程师执行客户侧推理基准；针对 SWE-2 Agentic Coding Workload，公开数据称相较 GB200 NVL72，Token Throughput 最高提升约 4.8 倍。

专业 GPU Cloud 提供的不只是按小时出租 GPU，还可能包括新一代硬件供给、机架级系统、网络和现场工程支持。对 Agentic Coding，长上下文、高并发、连续多步推理使 GPU 资源成为产品交付能力的一部分。

公开资料没有完整披露 Devin 的生产推理集群具体软件栈、每个模型的 GPU 分配、实际利用率和完整成本，因此不能把它写成 CoreWeave 上某个可直接复制的 vLLM 部署方案。

这套模式面向 AI Native 产品公司和 Agent SaaS，尤其适合模型能力与推理吞吐直接影响收入、又需要快速获得大规模 GPU 的团队。

落到实施阶段，专业 GPU Cloud 可以把机房、GPU 服务器、网络和部分集群运营交给供应商，但企业仍要管理模型服务、Agent 调度、请求优先级、KV Cache、模型升级、容量预测和业务 SLO。合同必须明确 GPU 代际、节点拓扑、网络带宽、故障替换、维护窗口、可用性、数据位置、网络隔离、预留容量和扩容交付时间。

来源：[CoreWeave：Cognition at Production Scale](https://investors.coreweave.com/news/news-details/2026/CoreWeave-Delivers-NVIDIA-Vera-Rubin-NVL72-Performance-at-Production-Scale-Starting-With-Cognition/default.aspx)。

### 18.9 Together AI + IBM Cloud + NVIDIA：专属 B300 集群的运营分工

2026 年 8 月，IBM 宣布与 Together AI 达成多年期、约 2.4 亿美元的合作，在 IBM Cloud 上部署大规模 NVIDIA HGX B300 集群，采用 NVIDIA Spectrum-X Ethernet。IBM 提供 Cloud Infrastructure，NVIDIA 提供 GPU 和网络技术，Together AI 负责 Inference Platform。Together AI 在 2026 年 10 月介绍了该集群的企业推理用途。

这是一个清楚的职责分工案例：GPU 服务器、机房、电力、网络和云基础设施由 IBM 提供；GPU 与网络平台由 NVIDIA 提供；模型运行、Serving Engine、模型适配和 Token 服务由 Together AI 运营；企业客户通过 Together AI 的服务消费推理能力。

它不是每个企业在自己的账户中自建推理集群，而是专业推理服务商租用 / 采购 CSP 的 Dedicated GPU Capacity，再运营推理服务。对企业用户而言，这是介于公有 API 和完全自部署之间的方案。

如果企业希望使用开源模型，但没有足够的 GPU Infra 团队，可以考虑这种模式。专属容量、相对稳定的价格和服务 SLA，可以减少自行维护驱动、Kubernetes、NCCL 与推理引擎的工作。

上线前，采购合同要把 Dedicated GPU 拆成可验证内容：是否独占物理 GPU、是否独占节点、网络是否独占、模型权重是否可自定义、服务商能否访问请求内容、模型更新和回滚由谁执行、容量扩容是否有保证、故障期间是否有替代资源。专属容量不等于数据主权，也不等于企业拥有完整运行控制权。

来源：[Together AI：Expanding our enterprise inference capacity with IBM Cloud and NVIDIA（2026-10-06）](https://www.together.ai/blog/expanding-our-enterprise-inference-capacity-with-ibm-cloud-and-nvidia)；[IBM 新闻稿（2026-08-11）](https://www.prnewswire.com/news-releases/ibm-and-together-ai-sign-multi-year-agreement-to-scale-open-source-ai-inference-with-nvidia-ai-infrastructure-on-ibm-cloud-302847748.html)。

### 18.10 全球金融科技公司 + Together Dedicated Model Inference：56 张 B200 承载 Coding Agent 生产流量

Together AI 在 2026 年 9 月公开了一个匿名全球金融科技客户案例。客户用 GLM-5.2 运行内部 Coding Assistant，工作负载具有明显的工作时间峰值、低平均生成速率、长上下文和突发并发特征。它不是企业自己管理物理 GPU 和推理引擎，而是使用 Together 的 Dedicated Model Inference（DMI）；但客户工程团队拥有 Endpoint 配置、扩缩容、模型升级和蓝绿测试控制权。

公开的生产配置包括：GLM-5.2 在 56 张 B200 上运行，14 个 Replica、每个 Replica 4 张 B200，Context Length 为 256K。客户优先考虑并发容量，而不是单 Replica 的最大吞吐。

这个案例公开了真实的故障分析过程：客户把模型部署从较多小 Replica 调整为较少大 Replica，GPU 总数不变，但 Prefill 容量和 KV Cache Headroom 的比例发生变化。调整后几天内，Prefill 接近 100% 容量，请求开始排队 1–3 分钟，Decode Throughput 降到约 5 Token/s。Metrics API 分析一条持续 192 秒的慢请求后发现，它不是自己的计算量过大，而是排在其他请求形成的约 2.3M Token Pending Prefill 队列后面。团队发现默认 Cache-aware-by-hash 路由不适合当前会话分布，恢复经过调优的 Cache-session-aware Routing，并调整 Max In-flight per Worker 后，当天完成配置修复且没有停机。

流量分布也很重要：客户报告的 Input Sequence Length p50 / p90 / p95 约为 81K / 163K / 178K Token，RPS p50 / p90 / p95 约为 3 / 6 / 7。它是低 RPS、超长输入、峰值并发显著的负载，不应该按普通聊天服务的平均 RPS 估算。

客户还评估过 1M Context，但发现上下文长度翻倍会压缩并发容量，因此选择 256K / 512K 的工作区间。模型从 GLM-5.1 升级 GLM-5.2 时，在同一账户和 Endpoint Pattern 下完成切换，并通过自助控制面进行配置调整和蓝绿测试。

这类部署面向拥有大量开发人员、Coding Agent 使用高峰集中在工作时间的金融科技公司、银行、证券和保险机构。平台团队可以统一管理容量和模型发布节奏。

GPU 总数相同，服务能力也可能相差很大。Replica 数量、每个 Replica 的 GPU 数、Prefill / Decode 资源比例、Context Length、KV Cache 和 Router 策略都会改变有效并发。模型配置变更必须作为容量变更进行压测和灰度，不能当成普通参数调整。

**部署边界：** 这是 Dedicated Managed Inference，不是客户自己维护 GPU Driver / K8s / vLLM 的完整自部署。它展示了企业希望获得的运维自主权，也提醒我们：即使购买了专属 GPU 容量，若没有可操作的 Metrics API 和 Endpoint Configuration API，平台团队仍会成为所有扩容和故障排查的瓶颈。

来源：[Together AI：How a global fintech scaled coding agent traffic with Dedicated Model Inference（2026-09-18）](https://www.together.ai/blog/global-fintech-scales-coding-agent-traffic-with-dedicated-model-inference)。

### 18.11 Uber：混合使用自有机房 GPU 和 GCP GPU

Uber 在 2026 年披露的 LLM Training Infrastructure 案例不是纯推理平台案例，但它说明企业不必在“全部自建”与“全部公有云”之间二选一。

Uber 的内部 LLM 工作流同时使用自有 On-Prem 集群中的 A100 GPU，以及 Google Cloud 上的 H100 GPU VM。其 On-Prem 主机配置为 4×A100，GCP 主机使用 8×H100。资源通过内部 Crane Infrastructure 管理，Kubernetes 负责集群和硬件资源，Ray / KubeRay 负责分布式任务；多个 Kubernetes Cluster 通过 Federation Layer 根据资源可用性调度任务。

训练栈使用 PyTorch、Ray、Hugging Face、DeepSpeed 和 NCCL，数据来自 Uber HDFS、Terrablob 和 Hugging Face。Uber 还讨论了 ZeRO-3 CPU Optimizer Offload 和 FlashAttention 对显存与训练吞吐的影响。

这种混合模式适合已经拥有数据中心和 GPU 资产、但仍需要 CSP 弹性资源的组织。典型任务包括训练、微调、Batch Inference 和模型评估，调度器需要根据任务特征决定使用自有集群还是租赁资源。

混合 GPU Fleet 的难点不在于把两个 Kubernetes Cluster 接起来，而在于统一资源描述、GPU 型号能力、镜像和驱动兼容性、数据位置、网络带宽、身份凭据和任务可迁移性。不同云和本地集群的 GPU SKU、网络、存储和驱动栈并不完全等价。调度器必须知道任务能否跨集群运行，而不能只看还有多少张 GPU。

证据边界：Uber 文章重点是 LLM Training / Fine-tuning Infrastructure，而不是证明同一套跨集群架构已经承担所有在线推理流量。它适合作为 Hybrid GPU Resource Management 案例，不应误称为生产 Coding Agent Serving 案例。

来源：[Uber Engineering：Open Source and In-House: How Uber Optimizes LLM Training（2026-04-14）](https://www.uber.com/us/en/blog/open-source-and-in-house-how-uber-optimizes-llm-training/)。

### 18.12 Superhuman / Grammarly：从自建 vLLM 转向托管 Serving

Superhuman（原 Grammarly）曾经运行自建 vLLM Serving Stack 和内部模型管理工具，支撑语法纠错模型。随着业务规模达到峰值 200K+ QPS，L40S GPU Fleet 的性能优化、容量规划、自动扩缩容和每次模型迭代所需的手工调优，逐渐占用精干 ML Infrastructure 团队的大量精力。

2026 年，Superhuman 与 Databricks 合作迁移到 Databricks Model Serving Provisioned Throughput。公开材料称，联合优化将单个 H100 Pod 的吞吐从约 750 QPS 提高到 1,200 QPS，提升约 60%，并实现亚秒级 P99 延迟。优化包括 FP8 量化、减少 Python CPU 开销、把部分后处理从关键路径移走，以及 Attention Kernel 优化。团队在迁移前后通过质量评测和性能目标验证模型没有质量退化。

这不是自部署成功案例，而是一个重要边界案例：即使企业已经有能力维护 vLLM，继续自建也未必有最高的业务价值。若团队真正的差异化在模型和产品，而 GPU Serving 的 Day-2 Operations 已成为负担，托管 Provisioned Throughput 可能更合理。

当内部推理平台的规模和 SLA 要求持续增长时，产品团队需要比较两种方案：继续扩充 Infra Team，还是把 Serving 运维交给专业平台运营商。

来源：[Databricks：How Superhuman and Databricks built a 200K QPS inference platform together（2026-05-08）](https://www.databricks.com/blog/how-superhuman-and-databricks-built-200k-qps-inference-platform-together)。


### 18.13 案例比较：企业实际购买的能力

| 模式 | 代表案例 | 企业承担的责任 | 适用条件 |
| --- | --- | --- | --- |
| 自有 GPU / On-Prem | IBM Research、Samsung、Google Distributed Cloud | 设施、网络、节点、Serving 和 Day-2 运维 | 数据边界严格、负载稳定、内部团队成熟 |
| CSP GPU，自营 Serving | Perplexity、Uber、AWS EKS 客户 | OS、驱动、模型 Runtime、容量和服务治理 | 希望避免硬件采购，但需要控制推理栈 |
| Dedicated GPU Cloud / Managed Inference | 金融科技公司、Cognition、Workato | 模型评测、API 集成、配额、供应商和 SLO 管理 | GPU 需求变化较大，或不希望自建底层运维团队 |
| 托管模型 / Serving | Superhuman、Grammarly 等 | 数据权限、模型质量、成本和供应商治理 | 推理平台不是差异化能力，托管服务能满足控制要求 |

### 18.14 自部署的驱动因素与边界

自部署通常由数据驻留、模型定制、稳定的大规模负载、专用低延迟要求或对模型运行路径的控制需求驱动。它不自动意味着必须购买 GPU：租用 GPU VM、Dedicated GPU Cloud 和托管推理仍可能由企业自主管理模型和 API。

租 GPU 只转移了硬件采购和机房设施责任。OS、驱动、容器、模型 Runtime、缓存、API、容量、监控和模型升级仍可能由企业负责。Managed Kubernetes 也不等于 Managed Inference，采购合同必须明确 GPU 故障、节点替换、模型启动、Serving SLO、数据访问和支持响应的责任边界。

### 18.15 自部署常见问题与工程经验

自部署项目最常见的预算偏差来自低利用率。团队按峰值购买 GPU，平时却没有足够请求填满 Batch；这时应先用真实 Trace 看清日常与峰值差距，再考虑批处理、模型路由和离线任务错峰。盲目增加 GPU 也未必改善吞吐，跨卡通信和同步成本可能抵消算力收益，比较时应看完成同类任务的总成本。

另一个容易被低估的环节是故障恢复。大模型冷启动需要读取数百 GB 甚至更大的权重，若所有节点同时从远端存储拉取，恢复时间可能远超服务团队预期。本地 NVMe 缓存、分层分发和副本预热需要在 POC 阶段验证。模型上线也应把权重、Tokenizer、Runtime、Kernel 和配置视为一个 Release 单元，先做质量与性能回归，再逐步切流。在线 Coding Agent、离线评测、训练和批量任务应使用不同优先级或资源池，避免后台任务拖慢交互请求。

### 18.16 经济性与 2000 名开发者平台的部署建议

![企业 AI Coding 平台初期推荐部署架构](/diagrams/enterprise-gpu-ai-coding-platform/04-recommended-platform-architecture.svg)

[查看完整 HTML 图表](/diagrams/enterprise-gpu-ai-coding-platform/04-recommended-platform-architecture.html)

经济性比较应统一口径，至少包含 GPU / CPU 费用、存储和网络、闲置容量、软件支持、工程人力、故障冗余、模型质量和每个成功任务的成本。单纯比较 GPU-hour 或每百万 Token 价格，会忽略 Agent 重试、工具失败和人工接管的成本。

建议按以下顺序推进：

1. 采集脱敏 Agent Trace，识别模型、上下文、并发、工具调用和重试分布。
2. 租用或使用一台 8-GPU 节点建立质量、延迟、吞吐和单位任务成本基线。
3. 用统一 Gateway、身份、配额、模型目录和监控接入少量团队，验证真实使用模式。
4. 根据测量结果决定自有机房、CSP GPU、Dedicated GPU Cloud 或托管 API 的组合。
5. 只有在单节点、多副本或简单路由无法满足 SLO 时，再引入多节点 RDMA、P/D 分离和分布式 KV Cache。

### 18.17 CSP / GPU Cloud 采购核查

合同和技术评审至少确认：GPU 型号与可用性、独占或共享方式、网络带宽及 RDMA、区域和数据驻留、存储吞吐与费用、节点启动和替换时间、维护窗口、SLA、故障赔偿、支持响应、模型与镜像出站费用，以及退出时的数据和制品迁移方式。供应商宣传的峰值性能不能代替目标模型的验收测试。

### 18.18 本章结论

企业自部署的核心不是拥有多少 GPU，而是是否有足够稳定的负载、明确的数据和控制需求，以及能够持续承担 Serving 运维的团队。先验证业务任务和单位成功任务成本，再决定租赁或采购、单机或多节点、通用模型或专用模型。


## 19. 从 POC 到生产：GPU Serving 的工程门槛

POC 的目标不是证明模型能启动，而是确认它在目标 Agent Harness、真实权限和请求分布下能稳定完成任务。至少验证模型质量、GPU 适配、SLO、单位成功任务成本和故障恢复。质量不达标不能靠增加 GPU 补救；单节点满足 SLO 时，也没有必要为了展示分布式能力而引入多节点。

生产发布需要把模型权重、Tokenizer、量化格式、推理引擎、容器 Digest、GPU 型号、并行参数、上下文与批处理配置、评测结果和供应链审批记录固化为不可变 Release Manifest。模型仓库名称或容器 tag 不足以复现部署。

节点加入 GPU Pool 前，应自动检查 GPU/NIC 拓扑、显存与 ECC、NCCL 通信、存储吞吐和容器运行。Driver、CUDA、NCCL、固件或推理引擎升级后，执行同一套基线测试。模型升级先进入隔离池，完成质量和性能回归后再 Canary；旧权重、镜像和配置必须保留，以支持快速回滚。

Benchmark 分三层：固定评测集检查代码正确性、工具调用和结构化输出；Serving 压测测量 TTFT、TPOT、排队、KV Cache 和 OOM；完整 Agent Harness 则在相同仓库、工具权限和任务集下记录成功率、重试、人工接管、总耗时及每个成功任务的成本。单独比较 Tokens/s 会掩盖工具调用失败和多轮返工。

生产监控至少关联 GPU/节点、网络、Serving、KV Cache、模型质量、Agent 业务和成本指标，并携带 Model ID、Revision、Tenant、Request ID 与 Trace ID。常见故障先按链路定位：模型启动失败查版本和制品；GPU 利用率低但延迟高查队列、CPU Tokenizer 与通信；长上下文 OOM 查 KV Cache 和并发；多节点退化查 NCCL、RDMA 和 GPU/NIC 亲和性；成本上升则拆解上下文增长、缓存命中、重试和闲置 GPU。

实施顺序应是 Workload Discovery、单节点 POC、生产基础能力（Registry、Gateway、监控、审计和回滚）、多节点验证、受控放量，最后才考虑 KV-aware Routing、Prefill/Decode 分离等优化。只有测量证明收益超过新增复杂度时，才引入这些机制。

## 20. 对企业架构决策的归纳

GPU 部署的技术难度并不平均分布。单机推理通常是模型与运行环境集成问题；多节点推理会迅速变成网络、拓扑和分布式调度问题；企业级平台则进一步涉及安全、审计、容量、成本、模型治理和持续运营。

金融机构的案例也显示，GPU 投资不必全部押在通用 LLM 上。交易基础模型、信用风险、欺诈检测、客户服务、研究分析和内部知识平台可能共享部分基础设施，但应保留各自的模型评测、数据权限和服务 SLO。模型服务可以集中，业务风险责任不能因此变得模糊。

对 2000 名开发者的 AI Coding 平台，先采集实际 Agent Trace，确定模型调用分布和成功任务成本，再用一台 8-GPU 节点建立质量与性能基线。确认模型、上下文和并发需求后，再评估多节点网络与 GB300 NVL72。部署位置则根据数据分类、团队能力和成本选择自有机房、CSP GPU、Dedicated Inference 或混合模式。

最终的采购和架构评审应回答三个问题：目标业务是否需要自管模型；内部团队是否准备好承担 GPU Serving 的 Day-2 责任；自管方案是否在满足安全和 SLO 的同时，降低了单位成功任务成本或带来了托管服务无法提供的控制能力。若答案不明确，继续扩大 GPU 集群只会提前固化尚未验证的假设。

## 21. 2000 名开发者的 Workbench：只考虑 AWS 与 Azure GPU 租用

本章将云基础设施范围限定为 **Amazon Web Services（AWS）和 Microsoft Azure**。GPU 以云 VM / GPU 实例租用，不讨论自建机房或其它 GPU 云厂商。两家都能提供 H100、H200 及 Blackwell 级实例，但具体 SKU、区域配额、可用区容量、网络拓扑和价格差异很大；采购前必须以目标区域的实时价格、企业折扣和容量确认结果为准。

### 21.1 从 2000 个席位推导负载，而不是按人数购买 GPU

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

### 21.2 Workbench 应该包含什么

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

### 21.3 AWS 与 Azure 的 GPU 实例选择

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

### 21.4 64–96 张 H200 的规划区间与月租估算

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

### 21.5 模型选择：托管前沿模型 + 自托管模型池

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

| 案例 | 部署与用途 |
| --- | --- |
| IBM Research / Red Hat | 544×H100、GLM-5.2；用于分布式推理和 Coding Agent 并发验证，不代表企业 3,000 名开发者的生产部署 |
| NVIDIA StarCoder2 | 7B 模型配合 NIM / NeMo Guardrails，适合代码补全和范围明确的轻量助手，不等同复杂 Agent 主力模型 |

这些案例共同说明，Coding 平台可以按任务复杂度分层：主力模型处理复杂修改，小模型承担摘要、分类和简单解释；是否拆分应由同一套任务评测和成本数据决定。

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

### 21.6 与 GitHub Copilot 对比：每位开发者每月 200 美元，GPU 还划算吗？

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

### 21.8 推荐拓扑：AWS 或 Azure 单云主部署

建议选择一个主云承载 Workbench 控制面、隔离执行和主要 GPU 推理池。AWS 与 Azure 都可以做完整方案，但不建议把同一个在线模型集群跨 AWS/Azure 拉成 RDMA 集群；跨云时延、数据传输、故障域、身份体系和运维复杂度会抵消收益。

架构图：[2000 名开发者 Workbench：AWS / Azure GPU 部署架构](/diagrams/enterprise-gpu-ai-coding-platform/05-2000-developer-aws-azure-workbench.html)（[SVG](/diagrams/enterprise-gpu-ai-coding-platform/05-2000-developer-aws-azure-workbench.svg)）。

AWS 方案中，GPU Serving 使用 EC2 P5en/P6，模型制品存储在 S3，镜像与部署由 ECR/EKS 管理，托管模型可经 Bedrock 访问。Azure 方案中，GPU Serving 使用 ND H200 / ND GB200 VM，制品存储在 Blob Storage，部署由 AKS 管理，托管模型由 Microsoft Foundry 提供。统一 Model Gateway 屏蔽模型和云差异，但保留各自私网 Endpoint、身份和审计实现。

在线请求经过鉴权、策略和配额检查后进入模型池；长任务由独立队列调度；工具调用经过 Tool Broker 和隔离执行环境。模型池支持 Canary、按版本切流、快速回滚和熔断。自托管池容量不足时，只能按明确的数据策略切换到 Bedrock / Foundry，不能静默跨越数据边界。

### 21.9 实施顺序与采购门槛

| 阶段 | 建议规模 | 必须验证 |
| --- | --- | --- |
| Trace & Workload Discovery | 2000 人抽样 | DAU、Agent 并发、Token 分布、成功率、数据分类 |
| POC | 1 个 8-GPU H200 节点 | Kimi K2.6（NVIDIA Dynamo 配方起步）、Sonnet 5.5 同任务质量基准；gpt-oss-120b 作为轻量成本基线，Nemotron / Devstral 作为有限对照 |
| Pilot | 2–3 个 8-GPU 节点 | 50–100 人真实 IDE/CLI、MCP 与执行隔离 |
| Production Wave 1 | 4–6 个节点 | 逐团队放量、配额、审计、熔断、回滚与故障演练 |
| Production 2000 | 规划 8 节点，按需扩至 12 | 峰值压测、节点故障、模型切换、区域容量与 DR |

采购前必须取得 AWS 和 Azure 两边的书面报价与容量确认，覆盖目标区域 GPU SKU、On-Demand 与承诺折扣、容量预留、Spot 中断策略、网络与跨区费用、存储吞吐、私网访问、数据驻留、支持等级和配额提升周期。P6-B300 / ND GB200 尤其需要确认能否按计划获得连续多节点容量。

最终建议：先用 AWS P5en 或 Azure ND H200 的 8-GPU 节点做 POC；Workbench 控制面和工具执行面独立部署；以 Kimi K2.6 作为 H200 自托管主力候选，按 NVIDIA Dynamo 的 8×H200 TP8 配方验证吞吐、KV Cache 和并发，以 Sonnet 5.5 建立同任务质量基线；gpt-oss-120b 仅作为轻量任务成本基线，Nemotron / Devstral 只做有限对照。Kimi K3 单独列入 B300 / GB300 高规格验证，不计入 H200 主力容量假设。生产先按 4–6 节点放量，达到实测门槛后再扩至 8 节点，12 节点仅作为峰值容量预留。64–96 GPU 不是已验证结论，最终 sizing 必须由成功任务吞吐、P95 延迟和单位成功任务成本决定。

## 结论

企业是否自部署 GPU，取决于数据边界、负载规模、模型控制需求和内部运维能力，而不是开发者人数或峰值算力。对 2000 名开发者的 AI Coding 平台，应先用真实 Agent Trace 和单节点 POC 建立质量、延迟及单位成功任务成本基线，再决定采用自有 GPU、CSP、Dedicated Inference 或托管 API，以及是否需要扩展到多节点和 GB300 NVL72。
