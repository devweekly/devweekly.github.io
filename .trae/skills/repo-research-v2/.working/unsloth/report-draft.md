# Unsloth 架构报告：单仓库双许可的多产品启动时序架构

## 1 执行摘要

**定位**：Unsloth 是单仓库双许可的 AI Infrastructure——Apache-2.0 开源加速核心（`unsloth/`）与 AGPL 商业 Studio 平台（backend+frontend+Tauri）同仓共存。

**3 核心发现**：
1. 启动时序被架构化：全模块惰性导入（`__getattr__`）将"版本激活先于重型 ML 依赖"从工程约定升级为代码层约束 [→ §2]
2. 许可/进程/依赖三类边界均显式编码于代码与 CI，而非依赖约定 [→ §3]
3. 外部依赖治理走本地化路径（stub 注入 + 假跑测试），换取边缘平台与性能承诺，但代价持续累积 [→ §9]

**中心假设**：以进程内版本激活 + 惰性导入的启动时序约束，在单仓双许可多产品架构中以最低运维成本同时保证版本兼容、许可边界与跨硬件可测试性，而非依赖环境隔离。

---

## 2 Runtime

> Evidence Strength 标注：**Confidence（High/Medium/Low）/ Evidence Count**

| # | 关键发现 | Confidence |
|---|---------|-----------|
| R1 | **进程启动即一次版本决策**：任何子进程（如 `core.training.worker`）拉起时，`core/__init__.py` 的 `__getattr__` 惰性导入强制版本激活先于 torch/transformers 被传递依赖拉起的 import 完成 | High / 2 |
| R2 | **生命周期归属**：训练子进程是独立进程，库版本状态由激活时序决定（非持久化、非共享状态），状态归 core 包初始化序列所有 | Medium / 2 |
| R3 | **导出生命周期终止**：模型导出先写临时目录（tempfile）再 shutil 原子搬运，进程崩溃时不暴露中间态，保证文件系统一致性 [→ §5.3] | High / 1 |
| R4 | **降级路径**：边缘平台（Windows/ROCm）由 `_torchao_stub.py` 打桩 RCCL/quantizers 符号兜底；无 GPU 环境以 CUDA spoof 假跑通过 | High / 2 |
| R5 | **可观察性缺口**：假跑测试的"通过"与实际 GPU 同步时序/显存语义脱钩，性能回归可能在无 GPU CI 中长期不被发现 [→ §9.5] | Medium / 2 |

> 注：未发现独立的缓存层、并发控制或请求级数据流文档，运行时结论主要来自启动时序约束与导出原子性证据。

---

## 3 Architecture

| # | 关键发现 | Confidence |
|---|---------|-----------|
| A1 | **三层复合体**（维护者心智模型）：核心加速库（`unsloth/`，Apache-2.0 引流产品核心）→ 商业 Studio（backend+frontend+Tauri，AGPL 保护）→ 基础设施层（scripts + CI 承载安全审计与多平台分发） | High / 1 |
| A2 | **依赖方向**：Studio backend 复用 core 库，多产品共享依赖体系与原子版本同步；版本号由 setuptools-scm 从 git tag 派生，发布即 tag（tag-driven） | High / 1 |
| A3 | **许可边界**：pyproject 声明 Apache-2.0 而源码普遍 AGPL-3.0-only，studio 为商业代码——边界由源码头粒度声明，跨模块引用即破坏边界合法性 [→ §4 D1] | High / 2 |
| A4 | **进程边界**：惰性导入（`__getattr__`）作为架构约束，等价于"依赖隔离不靠环境、靠 import 时序"，任何 eager import 泄漏都会失效 [→ §4 D2] | High / 1 |
| A5 | **依赖边界**：'不安装即扫描' CI 审计（`scan_packages.py` + `scan_npm_packages.py`）在安装前对 PyPI/npm 依赖做内容级检查，Python+JS 双生态覆盖 [→ §4 D3] | High / 1 |

> 未发现的架构事实：模块/边界/数据流/状态/扩展点/演化条目均为空，`history` 覆盖率为 0——本报告不讨论演化史。交叉引用：[→ §4 D1-D2] [→ §7 B1/B2]

---

## 4 Key Decisions

### D1: 核心库与商业组件许可分层（单仓库双许可）
**选择**：同一仓库内 Apache-2.0（core）与 AGPL-3.0-only/商业（studio）以源码头粒度共存，pyproject 声明 Apache-2.0
**拒绝**：全部 Apache-2.0 开源；拆分为两个独立仓库/发行包；全部闭源
**理由**：全开源暴露 studio 商业护城河（导出/训练闭环/前端）；拆仓破坏多产品共享依赖体系与原子版本同步并丢失统一 CI 双生态审计；全闭源失去核心库的流量入口与模型生态闭环引流价值
**证据**：`pyproject.toml`（Apache-2.0 声明）、源码头（AGPL-3.0-only）、ev-msa17hqb002 / ev-msa17hqb003

### D2: 训练子进程采用'进程内版本激活'而非环境隔离
**选择**：`core/__init__.py` 通过 `__getattr__` 全模块惰性导入，强制版本切换先于重型 ML 依赖初始化
**拒绝**：独立 venv/conda 隔离；运行时 import hook（`sys.meta_path`）；调用时动态重载版本
**理由**：Studio 是桌面应用，无法为用户机器预置多套环境；import hook 无法保证先于传递依赖拉起生效；动态重载在重型库加载后失败
**证据**：`core/__init__.py`、ev-msa17hqb008

### D3: 供应链安全采用'不安装即扫描'的 CI 审计流水线
**选择**：`scripts/scan_packages.py` + `scan_npm_packages.py` 在 `security-audit.yml` 中下载解压依赖归档做内容级检查
**拒绝**：安装后运行期防护（sandbox/monitor）；仅 lockfile 严格钉住版本
**理由**：安装后防护对已投毒包为时已晚；纯钉版本只防漂移、不防已发布恶意包的内容投毒，需要内容级主动防御
**证据**：`scripts/scan_packages.py`、`security-audit.yml`（[→ §5.2 该决策的削弱结论]）

### D4: 边缘平台不兼容采用'本地 stub 注入'而非修复上游
**选择**：`_torchao_stub.py` 对 torchao 缺失的 RCCL 后端（`torch._C._distributed_c10d`）与 `transformers.quantizers` 传递依赖打桩
**拒绝**：提交上游修复；放弃边缘平台；平台条件依赖（pyproject markers）
**理由**：上游修复周期不可控；放弃平台违背 Windows+ROCm 双线目标；markers 只控安装时机，无法解决 torchao 无条件 import 崩溃（不调用也 import 失败）
**证据**：`_torchao_stub.py`、ev-msa17hqb009（[→ §5.4 相关削弱结论]）

---

## 5 模型质疑（综合结论）

### 5.1 被质疑的结论：'进程内版本激活'替代环境隔离
**结果**：survived
**证据**：ev-msa17hqb008（`__getattr__` 惰性导入）。假设翻转测试：改为每环境隔离将破坏单仓多产品共享统一启动入口并引入多套环境复制成本；惰性导入虽依赖工程纪律，但有 `__getattr__` 架构约束兜底，维持原设计。

### 5.2 被质疑的结论：'不安装即扫描'的 CI 审计流水线足以保障供应链安全
**结果**：weakened
**证据**：`scan_packages.py` + `security-audit.yml`。边界测试：内容级扫描无法捕获仅在安装期（setup.py 钩子/编译期代码生成）触发的恶意行为，且解压归档目录结构与真实安装布局未必一致——扫描通过不等价于安装后安全（assumption `survived: false` 一致）。[→ §4 D3]

### 5.3 被质疑的结论：模型导出原子性（tempfile+shutil 搬运）
**结果**：survived
**证据**：导出路径实现。移除测试：改为直接写目标路径则进程崩溃将留下可被当作完整模型加载的中间态；原子搬运是低成本高收益约束，维持不变。

### 5.4 被质疑的结论：CUDA 性能路径与无 GPU/多硬件环境的测试矩阵
**结果**：weakened
**证据**：R2-Q1 + ev-msa17hqb009。时间测试：打桩层让 CI 在无 GPU 环境"通过"，但真实 GPU 同步时序与显存语义被静默绕过——测试通过时间与实际硬件运行时间脱钩（assumption `survived: false` 一致）。[→ §2 R5] [→ §9.5]

---

## 6 维护者手册

**How to Extend**
- 新增模块必须遵循惰性导入纪律，否则版本激活时序失效（任何 eager import 泄漏即违约）[→ §3 A4]
- 新增商业组件需源码头 AGPL 标注 + pyproject 声明 + CI 双生态审计四方一致 [→ §3 A3]
- 新增依赖需同步维护符号改写 + fake-run 双层矩阵

**How to Debug**
- 版本切换晚于重型 ML 依赖 → 检查是否存在 eager import 泄漏（绕过 `__getattr__` 纪律）
- Windows/ROCm 启动崩溃 → 核对 `_torchao_stub.py` 符号是否随上游漂移
- 兼容性回归 → 分别定位符号 grep 层（全版本矩阵）与 fake-run 层（latest/main）各自的覆盖盲区

**How to Migrate**
- 扩展 Python 上界 → 走 3.14 预适配路径，注意 3.9 语法下界约束与 Windows/ROCm/NVIDIA 矩阵组合爆炸
- 迁移新硬件平台 → 从 stub 注入 + CUDA spoof 测试开始，而非等待上游

**How to Remove**
- 移除 stub 需先修复上游（上游修复周期不可控，存在窗口期）
- 移除惰性导入约束即放弃版本激活时序保证，需整体替换为环境隔离方案

---

## 7 Architecture Risk Analysis（Blast Radius）

| 修改点 | 影响范围 | 风险 |
|--------|---------|------|
| `core/__init__.py` 惰性导入（版本激活枢纽） | 所有子进程启动时序（worker 必须先于 torch/transformers 完成版本切换）；重型依赖 import 顺序；任何新增模块必须守纪律 | **Critical** |
| 单仓双许可边界 | 打包器/贡献者/CI 许可识别；studio 护城河（export/web UI/训练闭环）不被开源路径泄漏；任何跨模块引用破坏边界合法性 | **Critical** |
| `_torchao_stub.py` 边缘平台 stub | Windows+ROCm 官方支持承诺；上游漂移后符号同步；markers 无法兜底的 import 期副作用 | **Critical** |
| 双层兼容测试（符号钉住 + fake-run） | transformers/TRL/PEFT/vLLM/bitandbytes 全版本矩阵；latest/main 与稳定回归的盲区；源码字符串改写层 | **High** |
| 供应链审计流水线 | Python+JS 双生态内容级审计；依赖投毒前置防御窗口；CI 编排与每次发布开销 | **High** |
| 模型导出原子路径 | 导出中间态不暴露；失败时文件系统一致性；多产品共仓导出职责边界 | **High** |
| 多产品打包发布（pyproject + setuptools-scm tag） | core/CLI/Studio/脚本四类产物生命周期；版本派生与原子同步；pyproject 声明与 AGPL 源码合规一致性 | **High** |
| Python 版本区间（3.9 - <3.15） | CI 测试矩阵；多平台叠加的组合复杂度；3.9 语法下界约束 | Medium |
| `unsloth-cli.py` starter 脚本 | 自有模型生态接入入口；模型+框架闭环杠杆点；对 `unsloth/` 前缀仓库的深度绑定 | Medium |

---

## 8 Change Difficulty

| 修改 | 难度 | 理由 |
|------|------|------|
| 修改版本激活时序/惰性导入约束 | **High** | 所有子进程启动时序的枢纽；正确性依赖全局纪律而非局部测试，回归难以隔离 |
| 调整许可边界（搬迁/新增组件/打包声明） | **High** | 源码头识别、pyproject、CI 双生态审计、法律合规四方一致；跨模块引用须逐点核验 |
| 更新 `_torchao_stub.py` 适配新上游 | Medium | 需持续追踪 `torch._C._distributed_c10d`/`transformers.quantizers` 符号漂移；无 markers 兜底，漏打桩即崩溃 |
| 维护符号改写 + fake-run 矩阵 | Medium | 多版本矩阵随上游高频漂移持续膨胀；两层各有盲区，需同时维护 |
| 扩展 Python 支持范围 | Medium | 3.9 下界约束语法、3.14 预适配、与多硬件矩阵叠加成组合爆炸 |
| 修改模型导出流程 | Medium | 必须保持先写后搬的中间态隔离，任何破坏原子性的改动都会暴露中间态 |
| 变更供应链扫描流水线 | Medium | 需双生态覆盖且与 lockfile checksum 防线并行、不破坏 CI 时长预算 |
| 调整打包发布流程（tag/版本派生） | Low | setuptools-scm 自动派生，改动集中在 CI 编排，不触及核心逻辑 |
| 修改 `unsloth-cli.py` 入口脚本 | Low | 独立一键式入口，职责单一，耦合低 |

---

## 9 Design Smells

| Smell | 类型 | 证据 |
|-------|------|------|
| 全模块惰性导入（`__getattr__`）作为**架构纪律**而非强制机制——纪律靠约定维持，单点违约即全局失效 | deliberate | ev-msa17hqb008 |
| 边缘平台不兼容采用本地 stub 长期维护而非修复上游 | deliberate | ev-msa17hqb009 |
| 单仓双许可共存，增加贡献者/打包器认知负担 | deliberate | ev-msa17hqb002 / ev-msa17hqb003 |
| README 不承载实质信息，只作品牌与流量入口（docs 外移 unsloth.ai/docs） | deliberate | ev-msa17hqb001 |
| fake-run 在 CPU 张量假跑下通过，真实 GPU 语义（同步时序/显存）被静默绕过 | **tech_debt** | R2-Q1 + ev-msa17hqb009 |

> 前四项为维护者主动接受的权衡（换来双许可商业结构、边缘平台支持、低维护 README）；最后一项是累积性技术债——"CI 通过"与"真实硬件正确"之间存在当前抽象层无法覆盖的间隙。[→ §5.4]

---

## 10 Unresolved Questions

**领域缺口：testing 覆盖 0/3（0%），history 0/0（无定义）**

| 缺口 | 缺什么证据 | 对结论的影响 | 下一步调查 |
|------|-----------|-------------|-----------|
| 双层兼容测试的真实执行行为 | 未见测试矩阵的运行结果、符号改写层与实际 API 漂移的对应记录、fake-run 的失败样本 | §8"符号改写+fake-run"难度评估与 §7 High 级风险均基于代码存在而非实测表现，可能高估或低估回归防护能力 | 运行/观察 CI 测试矩阵，检查符号 grep 是否覆盖真实崩溃路径，收集 fake-run 在 latest/main 上的实际失败率 |
| 多层打桩（CUDA spoof/能力门控/stub）与真实硬件语义的一致性 | 无 GPU 与真实 GPU（NVIDIA/ROCm）跑同一测试的对比结果；显存/同步时序类测试是否在 CI 存在 | §5.4 的 weakened 结论与 §9.5 tech_debt 目前只有"绕过"这一方向性证据，缺乏量化（多少测试被绕过、绕过多久未被发现） | 建立 GPU runner 对同一测试集的基线对比，为打桩覆盖度建立显式清单 |
| 供应链审计的有效性 | 扫描对已知恶意包/历史投毒样本的检出率；安装期钩子行为的测试用例 | §5.2 weakened 结论成立但未量化"内容级扫描"与"安装期行为"之间的差距 | 构造安装期恶意样例验证扫描盲区，评估是否需补充安装沙箱层 |
| 平台与版本组合矩阵的实测覆盖 | Windows/ROCm/Linux/NVIDIA × Python 3.9-3.14 组合的实际 CI 覆盖矩阵 | Python 版本区间（Medium 风险）与 Windows/ROCm 承诺（Critical）的兑现程度无法核验 | 导出 CI 矩阵覆盖明细，识别未测试的组合交叠点 |

> 完整性声明：本报告结论的 Evidence Count 来自代码存在性证据（`core/__init__.py`、`_torchao_stub.py`、`scan_packages.py` 等）与标记 evidence id；testing 领域全部问题未回答，相关章节（§5.4、§7 High 级、§8 Medium 级）的置信度应据此打折。