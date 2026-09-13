---
name: agent-reliability-review
version: 1.0.0
description: 审查 Agent 特有的可靠性问题：semantic failure、retrieval failure、memory 损坏、重试与幂等、graceful degradation、灰度故障与语义健康。传统可用性之外还要问「系统正常返回但业务结果已经不可靠」的场景。用于 Agent 可靠性评审、故障演练设计、降级策略评审、Agent Health 指标设计。触发词：Agent 可靠性、reliability、semantic failure、graceful degradation、gray failure、幂等、retry、降级、灰度故障、agent health、语义健康。
---

# Agent Reliability Review

## Goal

把 Agent 的可靠性从「服务是否在线」扩展到**业务结果是否仍然可靠**。

核心原则：

> **Agent Reliability ≠ Infrastructure Availability。**
>
> 基础设施全绿、服务正常返回，业务结果仍可能是错的：检索失败导致编造、记忆污染继续执行、
> 重试导致重复交易、降级后仍在越权。

## 何时用 / 不适用

| 用 | 不用 |
| --- | --- |
| Agent 可靠性评审与故障演练设计 | 通用系统高可用设计（传统手段已足够） |
| 降级、熔断、重试策略评审 | 安全控制评审（用 `agent-security-threat-review`） |
| Agent Health / 语义健康指标设计 | 逐条评分与整改（用 `agent-well-architected-assessment`） |
| 灰度故障（gray failure）复盘 | Runtime 治理能力判断（用 `agent-runtime-boundary-review`） |

## 输入

| 输入 | 必需 | 说明 |
| --- | --- | --- |
| Run 生命周期状态机描述 | ✅ | 含 checkpoint / resume 语义 |
| 依赖清单（Model、Tool、Retrieval、外部 API、人工） | ✅ | 逐项定义失败语义 |
| 失败与重试策略 | ✅ | 用于幂等与补偿判断 |
| 故障演练记录 | 建议 | 无记录时相关条目最高只能判 🟡 Partial |
| 近失与事故记录 | 可选 | 校准阈值 |

## 八个必须回答的问题

每个问题都必须有**可判定的答案**，不能回答「有机制处理」。

```text
1. Retrieval failed        → Agent 是否胡编？（有没有「无证据即拒答」）
2. Memory corrupted        → 是否继续执行？（有没有完整性校验与隔离）
3. Tool timeout            → 是否重复执行？（幂等与补偿是否成立）
4. Model degraded          → 是否进入错误循环？（有没有循环检测与预算熔断）
5. Context too large       → 是否截断关键事实？（裁剪策略是否确定性）
6. Data stale              → 是否明确拒绝？（新鲜度判定是否存在）
7. Policy service unavailable      → 是否 fail closed？
8. Approval service unavailable    → 是否继续执行？
```

第 7 与第 8 问的正确答案都是**停止（DENY）**。任何 fail-open 的设计必须给出补偿控制与残余风险接受人，否则判 Gap。

## 五类语义失败模式

| 模式 | 表现 | 必备控制 | 判据 |
| --- | --- | --- | --- |
| **Groundedness failure** | 检索为空或低相关，仍给出确定结论 | 无证据即拒答或降级为「证据不足」 | 有拒绝样本 + 阈值定义 |
| **Semantic drift** | 多轮后偏离原始目标 | Goal 一致性检查 + 预算熔断 | 有轨迹级评估与告警 |
| **State inconsistency** | 业务状态被 Agent 改写或与实际不符 | 状态由确定性状态机持有 | Agent 无法改写业务状态 |
| **Loop / 浪费** | 重复调用、错误循环消耗预算 | 六维执行预算 + 循环检测 | 超限即阻断，不依赖模型自觉 |
| **Silent degradation** | 降级后仍返回结果但不告知 | 降级必须显式暴露（结果标注 + 告警） | 降级状态可被调用方识别 |

## 状态与恢复（Q061–Q063）

| 检查 | 判据 | 不达标形态 |
| --- | --- | --- |
| Run 生命周期 | 状态持久化、可枚举、重启后从中断点继续 | 状态只存内存 |
| 七项执行语义 | checkpoint / pause / resume / retry / timeout / cancel / recovery 齐备且演练过 | 只支持其中部分 |
| 长时间等待 | 等待人工 / 外部事件 / Tool 时有统一恢复点与超时兜底，等待不占执行资源 | 恢复出错或不恢复 |
| 多 Agent 协作失败 | 部分成功与冲突有补偿、回滚或人工裁决路径与责任人 | 只写「重新执行」 |

## 失败策略（Q064–Q067）

| 检查 | 判据 | 反模式 |
| --- | --- | --- |
| per 依赖类别定义策略 | Model / Tool / Retrieval / External API 各有 retry / fallback / degrade / abort | 统一「失败即重试」 |
| 失败分类驱动处置 | 分类基于可判定条件（错误类型 + 副作用性质） | 全部自动重试或全部转人工 |
| 幂等 | 幂等键可验证，有重复请求被吞并的证据，重试不产生重复交易 | 靠「不会重试」 |
| 部分成功 | 有对账、补偿与状态收敛路径 | 无补偿 |

## 执行预算（Q068–Q069）

六维预算必须**落在运行时**，不是文档：时间、iteration、tool calls、context、tokens、成本。

判据：per Agent 与 per Run 有上限值；超限即阻断；预算耗尽的行为（停止 / 降级 / 转人工）可复现且不依赖运行时状态。

## 语义健康与可观测（Q085–Q089）

| 检查 | 判据 |
| --- | --- |
| Run 可重建 | 输入、决策、工具调用、授权结果、输出可还原，抽查可复现 |
| Trace 关联 | 可关联 Agent / Model / Prompt / Skill / Tool / Knowledge / Policy / Identity 与结果 |
| 异常检测 | hallucination、policy violation、tool misuse、data leakage、drift、abnormal pattern 六类可检测且有处置闭环 |
| SLO 触发动作 | 质量、风险、成本、延迟、可靠性五类阈值与动作绑定（降级、限流、停机、通知） |
| 语义健康状态 | Agent Health 独立于 Infra Health，可表达 DEGRADED / BLOCKED 而不是只有 UP / DOWN |

> 关键区分：**基础设施健康 ≠ Agent 健康**。Agent 健康必须由业务结果、轨迹质量与策略一致性定义。

## 故障演练（Q070）

| 要求 | 判据 |
| --- | --- |
| 覆盖六类依赖 | Model、Tool、Network、Data、Runtime、Human |
| 有脚本与结论 | 演练可重复执行，有结论与失败项 |
| 有整改闭环 | 失败项进 backlog，有 owner 与到期日 |
| 含灰度故障 | 系统健康但业务结果异常的场景必须被演练 |

## 输出模板

```text
Agent Reliability Review — <Agent / 平台名>

八问回答
| # | 场景 | 当前行为 | 是否可判定 | 判定 |
| 1 | Retrieval failed | 无证据即拒答 | 是 | Pass |
| 7 | Policy 服务不可用 | fail-open | — | GAP（须 fail-closed） |

语义失败模式      <五类：控制 / 落点 / 证据>
状态与恢复        <生命周期 / 七项语义 / 长时间等待 / 多 Agent 冲突>
失败策略          <per 依赖：retry / fallback / degrade / abort>
执行预算          <六维上限值 / 落点 / 超限行为>
语义健康          <Agent Health 指标 / DEGRADED·BLOCKED 表达 / SLO 动作>
演练              <六类依赖覆盖 / 脚本 / 结论 / 未闭环项>

未闭环项与阻断范围： <项 → owner → 到期日 → 期间不允许做什么>
```

## 反模式总表

| 反模式 | 为什么错 | 正确做法 |
| --- | --- | --- |
| 用可用性代替可靠性 | 服务在线不代表结果正确 | 引入语义失败模式与 Agent Health |
| 降级后静默返回 | 调用方无法区分好坏结果 | 降级必须显式暴露 |
| 依赖不可用时 fail-open | 依赖故障即等于控制失效 | 高风险一律 DENY |
| 预算只写在文档 | 无法强制 | 落在运行时并阻断 |
| 幂等靠约定 | 网络与超时必然重试 | 幂等键 + 对账 |
| 只演练服务不可用 | 漏掉 gray failure 这一类真实故障 | 增加「健康但结果错」的演练 |
| 把所有异常都转人工 | 人工成为瓶颈，最终被绕过 | 分类处置，只有需要权威判断的才转人 |

## 与其他 skill 的衔接

- 前置：`enterprise-agent-architecture-review`（确认业务结果与边界）
- 并行：`agent-governance-and-control-design`（fail-closed 与预算的策略口径）、`agent-runtime-boundary-review`（失败语义是否由 Runtime 保证）
- 后续：`agent-well-architected-assessment`（把结论落成评分与整改）

## 数据来源与锚点

| 锚点 | 位置 |
| --- | --- |
| 正文 120 问 G 节（Q061–Q070）、I 节（Q081–Q090） | `temp/agent研究checklist.md` 第一章 |
| RT07–RT14（Execution Budget / Runtime Resource Policy） | 同文件 附录 D（P14 段）与 附录 C.58 |
| P09 FSI Resilience Delta、gray failure、backup / retention | 同文件 附录 D 与 附录 C.46–C.50 |
| Invariant：语义健康（Agent Health ≠ Infra Health） | 同文件 第二章 |
| 语义健康与持续红队 | `temp/agent研究.md` §13 |
| 可观测与评估的完整论证 | `temp/agent研究.md` §12 |
