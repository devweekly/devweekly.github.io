# Workbench Pipeline 状态与恢复约定

## 目标

Pipeline 状态必须能解释三个事实：任务是否真的在执行、当前 World 是否被占用、用户现在可以执行什么操作。UI 展示、API 决策和持久化状态不能各自维护一套互相矛盾的判断。

## 状态所有权

- **Story Execution** 是长篇/批量章节的业务任务，持久化在 `.output/<world>/workbench/story-executions/<id>.json`。
- **Workbench Run** 是单次章节执行记录，持久化在 Workbench run store；Story Execution 的 `currentRunId` 指向当前章节。
- **Knowledge Build** 是可重试的资料准备任务，持久化在 `.output/<world>/workbench/knowledge-build.json`。
- **进程内 worker/controller** 只代表当前 Node 进程中真实存在的执行器，不能当作持久化事实。服务重启后必须重新建立，不能假设旧 worker 仍然存在。

## Story Execution 状态

Story Execution 状态转换：

- `queued → running`：worker 获得 World 执行权。
- `running → paused`：用户暂停或服务重启；保留当前章节检查点。
- `running → cancelled`：用户取消，终止子进程组并回滚未提交章节状态。
- `running → failed`：章节门禁、模型、终审或状态提交失败。
- `running → completed`：故事自然收束。
- `running → stalled`：连续推进无法产生有效进展。
- `paused/failed/stalled → queued`：从最近有效检查点恢复。
- `queued/paused → cancelled`：取消任务或清理没有活动 worker 的孤儿记录。



`queued/running/paused` 是阻塞 World 写入的状态；`failed/stalled` 可恢复但不应永久持有写锁；`completed/cancelled` 是终态。服务重启时将残留 `queued/running` 转为 `paused`，保留 `currentRunId` 供恢复逻辑对账。

取消不是只写一个布尔标志。活动 worker 必须持有 AbortController；章节子进程以独立进程组启动，取消时终止进程组。子进程退出后，未通过终审/状态提交的当前章节恢复 Story State 快照，再将 Story Execution 写为 `cancelled`。已经提交的章节检查点不回滚。

## Knowledge Build 状态与检查点

`queued/running` 是活动状态；`interrupted` 表示进程重启导致中断，可继续；`cancelled` 是用户主动取消；`failed/partial` 表示步骤执行结果。重试时保留已持久化为 `completed/skipped` 的步骤，只重跑 `running/failed` 和尚未执行的步骤。取消当前步骤会终止子进程，保留此前完成步骤。

## World 写锁

- 写锁由服务端执行器/预约集合和串行队列共同实现。
- 磁盘上的 `queued/running` 不能直接当成活动 worker；启动恢复必须先对账。
- 暂停任务仍占用故事写入权，必须明确恢复或取消；失败/停滞任务不应形成永久锁。
- 知识构建与章节 Story State 使用不同数据库时可并行，但同一个 Knowledge Build 不允许并发启动两份。
- UI 的 disabled、任务卡片和操作按钮必须从同一条任务记录派生。

## 重启验收

1. 章节子进程运行中强制终止服务；重启后 Run 标记失败并回滚当前章节快照，Story Execution 变为 paused。
2. paused 任务在任意 history scope 下都可见；恢复后从已提交检查点继续，取消后立即释放 World 写锁。
3. 活动 worker 存在时点击取消，会终止章节子进程；API 返回取消请求已接收，轮询最终得到 cancelled。
4. Knowledge Build 在任一步骤中重启，已完成步骤保留；重新启动跳过成功步骤，只重试中断步骤及后续步骤。
5. Knowledge Build 运行中点击取消，终止当前 CLI 子进程，状态最终为 cancelled；已完成步骤保留。
6. 对账所有页面按钮状态、API 状态、磁盘状态和活动 worker；不存在 UI 显示可执行但 API 409，或显示执行中但无 worker 的情况。
