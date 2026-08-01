## 1 执行摘要
**仓库类型**：Library。
**中心假设**：该系统是围绕本地优先 AI 训练/推理工作流构建的商业开源 monorepo：核心库被刻意拆分为相互隔离的子系统（训练/推理/工具循环/导出/历史），所有外部依赖（HF 数据集、DataDesigner、llama-server、前后端依赖树）均通过显式边界与安全策略隔离。。
**覆盖维度**：暂无。
**关键决策**：CLI 入口保持极薄委托 / 预安装安全扫描：下载归档而非安装后审查 / 核心模块强制延迟导入。


## 2 Runtime
- 当前证据不足以完整描述运行时。建议补充入口文件和主循环分析。


## 3 Architecture


## 4 Key Decisions
### D1: CLI 入口保持极薄委托
**选择**：CLI 仅调用独立包 unsloth_cli 的 app 对象 | **拒绝**：将 CLI 命令逻辑内联进主库入口, 直接复用库 API 暴露全部命令
**理由**：CLI 与核心耦合会阻碍独立分发与替换，且扩大公共 API 表面积
**证据**：待补充

### D2: 预安装安全扫描：下载归档而非安装后审查
**选择**：下载 PyPI/npm 归档并静态审查内容 | **拒绝**：在隔离沙箱中安装后运行测试, 仅依赖官方包签名/哈希校验
**理由**：安装即执行已暴露投毒风险，签名校验不覆盖包内容
**证据**：待补充

### D3: 核心模块强制延迟导入
**选择**：通过 __getattr__ 按需加载重依赖 | **拒绝**：模块顶层直接 import torch/transformers, 运行时动态 sys.path 注入
**理由**：顶层导入拖慢启动并污染训练子进程隔离边界
**证据**：待补充



## 5 模型质疑
### RAG 流量 trust_env=False 的安全动机
**结果**：survived | **方法**：移除测试
**证据**：移除 AST 测试后新增 httpx 调用不会触发失败；但 bootstrap 密码暴露测试证明历史确有真实泄露风险
**备注**：安全动机有独立历史测试佐证；代价是阻断合法企业代理，属有意取舍

### 预安装扫描 = 防供应链投毒
**结果**：survived | **方法**：假设翻转
**证据**：无许可证/合规审查证据；下载归档而非安装即审查、且 npm 侧同构镜像，投毒防御解释更一致
**备注**：翻转假设（合规审计）得不到证据支持

### 延迟导入仅为启动性能
**结果**：weakened | **方法**：时间测试
**证据**：证据同时声明'训练子进程在版本激活前不加载'，说明还有进程隔离/依赖容错动机，性能单一解释不完整
**备注**：双重动机（性能 + 子进程隔离），'仅性能'假设被削弱但决策本身成立



## 6 维护者手册
- **How to Extend**：统一路径策略（utils.paths）；统一 context length 辅助函数；CLI 与核心解耦
- **How to Debug**：从 核心模块 的边界日志入手。
- **How to Migrate**：关注 多平台差异适配（Windows-ROCm 等小众组合）, 多格式导出是一等特性。
- **How to Remove**：检查 所有本地模型流量必须与开发者环境代理隔离, 预安装扫描用于防御供应链投毒 的耦合范围。

## 7 Architecture Risk Analysis（Blast Radius）
| 修改点 | 影响范围 | 风险等级 |
| --- | --- | --- |
| tool_loop_controller | GGUF 与 safetensors 两条工具循环, 工具调用调度与 SSE 流解析 | High |
| utils.paths | 数据集解析, HF 集成, recipe 目录约束 | Medium |
| core/export | 多格式导出, 跨进程预览传输 | Medium |


## 8 Change Difficulty
| 修改 | 难度 | 理由 |
| --- | --- | --- |
| 新增第三条工具循环 backend | High | 必须满足共享状态契约 + SSE 协议边界 + 离线可测性三重约束 |
| 修改 studio.db schema | Medium | SQLite/线程/并发正确性有测试锁定，需同步迁移并维护 _reset_studio_db 夹具 |
| 调整导出格式集合 | Low | core/export 是独立子系统，tempfile+glob 隔离性好，不触及其他模块 |


## 9 Design Smells
- **跨生态重复实现的供应链扫描器（PyPI + npm 双份）**（deliberate）：将同一供应链扫描能力镜像到 npm 侧并读取 package-lock
- **__getattr__ 魔术方法实现延迟导入**（deliberate）：核心模块通过 __getattr__ 强制延迟导入，使训练子进程在版本激活前不加载重依赖
- **为单一小众平台引入专用 shim**（deliberate）：存在为 Windows-ROCm 平台的专用 shim：桩掉 torchao 规避崩溃


## 10 Unresolved Questions
- **runtime**（覆盖率 0%）：证据不足，建议补充 runtime 相关源码或测试。
- **architecture**（覆盖率 0%）：证据不足，建议补充 architecture 相关源码或测试。
- **design_decisions**（覆盖率 0%）：证据不足，建议补充 design_decisions 相关源码或测试。
- **testing**（覆盖率 0%）：证据不足，建议补充 testing 相关源码或测试。
- **deployment**（覆盖率 0%）：证据不足，建议补充 deployment 相关源码或测试。
- **history**（覆盖率 0%）：证据不足，建议补充 history 相关源码或测试。

