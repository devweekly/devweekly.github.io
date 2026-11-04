# Personal Agent Learning

面向个人本机 Agent 的本地学习账本。它通过 **common-agent-lib 的 Copilot / CodeBuddy Runtime 和 Agent Tracing package** 接入现有 Agent，不自己重新实现 SDK lifecycle、timeout、abort、session recovery 或 SQLite trace recorder。

它完成四件事：

1. 从现有 Copilot / CodeBuddy 应用的 Runtime callback 接收事件；默认只记录事件元数据，不保存完整 Prompt、回答、推理内容、工具参数或工具结果。
2. 通过 `feedback`、`outcome` 命令记录用户明确纠正、偏好声明和最终结果。
3. 每日使用 Copilot 或 CodeBuddy 之一运行 Reflector，生成带 Evidence IDs 和 Scope 的待审核偏好候选。
4. 只有明确执行 `review accept` 后才更新版本化 Profile；`compile` 把 Profile 生成为可由 Agent 加载的 Markdown 文件。

**这不是一个自动注入到所有 Copilot CLI / CodeBuddy CLI 进程的全局 Hook。** 要观察现有应用，必须在它们调用 shared runtime 的位置传入本项目提供的 callback。否则脚本只能分析通过这些 callback 送来的事件，以及手工录入的反馈。

## 依赖与版本

本项目优先复用 `saga/common-agent-lib`，不复制其中的 Runtime / Tracing 实现：

| 作用 | 本工具依赖 | SDK 版本和来源 |
|---|---|---|
| Copilot Runtime | `@saga/copilot-agent-runtime@0.1.0` | 内部依赖 `@github/copilot-sdk ^1.0.15`；本工具固定 `@github/copilot-sdk 1.0.17`，与 `agentic-data-architect/package-lock.json` 一致 |
| CodeBuddy Runtime | `@saga/codebuddy-agent-runtime@0.1.0` | 内部精确依赖 `@tencent-ai/agent-sdk 0.3.276`，与 common-agent-lib 的验证基线一致 |
| Trace / SQLite | `@saga/agent-tracing@0.1.0` | 由 `@saga/agent-contracts@0.1.0` 提供 Trace Event / Usage Schema |
| Contracts | `@saga/agent-contracts@0.1.0` | provider-neutral contracts |

本工具不直接调用 `@tencent-ai/agent-sdk`；CodeBuddy SDK 的导入、异步 query stream、timeout、interrupt、session ID 和 usage 统一由 `@saga/codebuddy-agent-runtime` 负责。Copilot 也通过 `@saga/copilot-agent-runtime` 处理 Session / Turn / cancel / usage；本工具仅直接导入 `CopilotClient`，用于配置 `mode: "empty"` 的无工具 Reflector Client。

这里刻意以 common-agent-lib 的 CodeBuddy Runtime 0.3.276 为基线。agentic-data-architect 当前 lockfile 的 SDK 版本是 0.3.274；它的调用方式是应用自己直接使用 `query()`，并拥有自己的工具授权、workspace 限制和 Investigation 业务状态。本工具使用 common-agent-lib 的已封装 `query()` Runtime，因此跟随其已经探测过的 0.3.276，不把 0.3.274 和 0.3.276 混成一个“兼容版本”。

CodeBuddy SDK 的 `query()` 是异步消息流。common-agent-lib 已处理初始化 timeout、迭代读取 cancellation、late query handle interruption、Session ID、usage 和 Structured Output。Reflector 只使用无普通工具的结构化输出调用。Copilot Reflector 使用 `mode: "empty"`，并在 Session 层显式设置 `availableTools: []`、`tools: []`；Permission callback 也会 fail-closed 拒绝任何意外的工具请求。它只负责反思，不具备文件、Shell 或 MCP 工具面。

## 安装

要求 Node.js >=22.13，因为 shared tracing package 使用 Node 内置的 `node:sqlite`。

建议将两个仓库放在同一个父目录：

```text
workspace/
  devweekly/
  common-agent-lib/
```

在本目录先执行：

```bash
npm run setup:shared
npm run build
npm test
```

默认假设两个仓库并列：

```text
workspace/
  devweekly/
  common-agent-lib/
```

如目录不同，可指定 common-agent-lib 的绝对路径：

```bash
COMMON_AGENT_LIB_DIR=/absolute/path/to/common-agent-lib npm run setup:shared
```

`setup:shared` 会检查四个 `@saga/*` package 的名称与版本，检查两个底层 SDK 的兼容性基线，安装并构建 common-agent-lib，然后在安装本工具时临时把 `@saga/*` 依赖解析到本机 checkout。它不会把绝对路径写入提交的 `package.json`，也不会生成依赖机器路径的 lockfile。CodeBuddy SDK 不再由本工具重复声明，避免与 shared Runtime 的 0.3.276 产生双重版本来源。

## 初始化和基本命令

```bash
npm run dev -- init
npm run dev -- report --days 7
```

默认数据目录是 `~/.agent-learning`，可以通过 `PERSONAL_AGENT_LEARNING_HOME` 修改。初始化后：

```text
~/.agent-learning/
  config.json
  events/
    YYYY/MM/DD/<session-hash>.jsonl  # 已脱敏的 append-only 事件镜像
  agent-traces.sqlite       # @saga/agent-tracing 的本地事件账本
  learning.sqlite           # 用户反馈、候选、审核历史和 Profile 版本
  profile/
    profile.json
    AGENT-PREFERENCES.md
```

Trace Store 中的事件会同时追加镜像到 `events/YYYY/MM/DD/<session-hash>.jsonl`，便于人工检查、归档和重放；SQLite 用于索引和分析。两个 SQLite 文件及 JSONL 均在本机创建，目录权限为 0700，文件权限尽可能设为 0600。Trace 数据和偏好学习业务状态分开保存。

## 接入现有 Copilot / CodeBuddy 应用

### Copilot SDK

现有应用已经使用 `CopilotAgentRuntime` 时，只需在原来的 `runTurn` handlers 中增加 `onEvent`。不要重新创建第二套 Client / Session，也不要把已有 permission callback 换成学习工具的策略：

```ts
import { CopilotAgentRuntime } from '@saga/copilot-agent-runtime';
import { openPersonalAgentLearning } from './src/integration.js';

// 应用原有的 runtime、sessionConfig、permission policy 保持不变。
const observer = await openPersonalAgentLearning();
const context = observer.createContext({
  provider: 'copilot',
  agentId: 'coding-agent',
  model: selectedModel,
  sessionId: session.sessionId,
  turnId,
  project: 'my-repository',
  taskType: 'code_change',
});
const preferences = observer.resolvePreferences(context, currentExplicitOverrides);
const observerHandlers = observer.copilotHandlers(context);

try {
  const result = await runtime.runTurn({
    turnId,
    lockKey: session.sessionId,
    session,
    prompt: preferences.instructions + '\n\n' + prompt,
    timeoutMs: 300_000,
    handlers: {
      onDelta: existingOnDelta,
      onEvent: (event) => {
        existingOnEvent?.(event);
        observerHandlers.onEvent(event);
      },
    },
  });
  observer.recordTurnResult(context, result);
} finally {
  await observer.flush();
  await observer.close();
}
```

如果应用已经有自己的 `handlers.onEvent`，要组合两个 callback，不要覆盖原有业务事件处理。

### CodeBuddy SDK

使用 common-agent-lib 的 `CodeBuddyAgentRuntime.run()` 时传递 callback：

```ts
import { CodeBuddyAgentRuntime } from '@saga/codebuddy-agent-runtime';
import { openPersonalAgentLearning } from './src/integration.js';

const observer = await openPersonalAgentLearning();
const context = observer.createContext({
  provider: 'codebuddy',
  agentId: 'coding-agent',
  model,
  project: 'my-repository',
  taskType: 'code_change',
});
const preferences = observer.resolvePreferences(context, currentExplicitOverrides);
const observerHandlers = observer.codeBuddyHandlers(context);

try {
  const result = await runtime.run({
    prompt: preferences.instructions + '\n\n' + prompt,
    model,
    cwd: process.cwd(),
    timeoutMs: 300_000,
    onEvent: (event) => {
      existingOnEvent?.(event);
      observerHandlers.onEvent(event);
    },
    onSessionId: observerHandlers.onSessionId,
  });
  observer.recordTurnResult(context, result);
} finally {
  await observer.flush();
  await observer.close();
}
```

如果现有应用直接使用 SDK 的 `query()`，不要为了采集日志再包一层新 Agent。可以在原有 `for await (const message of q)` 循环里调用 `observer.captureCodeBuddyEvent(context, message)`；原来的 tool policy、MCP、workspace 和 session 逻辑保持应用所有。

### 记录显式反馈

Agent 本身无法可靠判断“用户沉默就是满意”。当用户明确纠正、比较候选、接受或撤销结果时，应从 UI 或业务服务直接调用反馈 API，或用 CLI 录入：

```bash
npm run dev -- feedback --kind correction \\
  --provider copilot --agent coding-agent --project repo-a \\
  --task code_change --session SESSION_ID \\
  --text "代码修改后先跑 targeted tests，再跑 build；不要只给我修改建议。"

npm run dev -- outcome --status reworked \\
  --provider copilot --agent coding-agent --session SESSION_ID \\
  --text "结果遗漏了测试，要求重新执行。"
```

反馈文本只在用户明确输入 `feedback --text` 或调用 `observer.recordFeedback(context, 'correction', text)` 时保存；保存前会移除常见 Secret / Bearer Token。 每日 Reflector 会把这些已脱敏的显式反馈文本和不含正文的运行元数据发送给你指定的 Copilot 或 CodeBuddy 模型进行分析；如果你要求分析完全离线，必须使用本地模型/本地执行环境，不能把“本地 SQLite”误认为“分析过程不会出网”。任务结果可以调用 `observer.recordOutcome(context, 'reworked', note)`；偏好投放通过 `observer.resolvePreferences(context, overrides)` 自动记录 Profile 版本和实际使用的 Preference IDs。完整 Prompt、Assistant response、Reasoning、工具参数和工具结果都不由 Observer 保存。

## 每日归纳、审核和生效

```bash
# 用 CodeBuddy Reflector 分析最近 7 天
npm run dev -- reflect --provider codebuddy --days 7

# 或使用 Copilot Reflector
npm run dev -- reflect --provider copilot --days 7

# 查看候选
npm run dev -- review list

# 只接受有充分证据、范围明确的候选
npm run dev -- review accept CANDIDATE_ID

# 拒绝候选，保留审核记录
npm run dev -- review reject CANDIDATE_ID --note "这是当前项目临时要求，不是长期偏好"

# 生成 Profile 和 Markdown，交给现有 Agent 加载
npm run dev -- compile
npm run dev -- report --days 30
```

Reflector 不直接修改长期偏好。它只能提交 candidate；接受之后才产生新 Profile version。拒绝和修改理由也会进入本地审核历史。

生成的 `AGENT-PREFERENCES.md` 应由宿主 Agent 在 Prompt / Context 组装阶段按 User / Agent / Project Scope 读取。不要让脚本自动覆盖 `AGENTS.md`、Skill、Hook、Permission 或项目配置；确定性执行规则应该由宿主应用和测试维护。

## 每日运行

macOS 可以用 launchd。将 `launchd/io.saga.personal-agent-learning.reflect.plist.example` 复制到 `~/Library/LaunchAgents/`，修改其中的工作目录、Node 路径和模型环境变量，再加载：

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/io.saga.personal-agent-learning.reflect.plist
```

每日任务只生成 Review Queue，不自动接受候选。也可以把命令放到自己的 cron / scheduler 中。没有新增事件时 Reflector 会直接退出，不产生无意义的 LLM 调用。

## 常用选项

```bash
npm run dev -- help
npm run dev -- feedback --help
npm run dev -- reflect --provider codebuddy --days 3
npm run dev -- review list
```

## 验证边界

- Trace 是运行时观察数据，不是安全授权记录或业务审计系统。
- Observer callback 不应阻塞 Agent 的权限握手和 turn completion；写入失败会在 Observer 内累计错误并在 `flush()` 后报告。
- 推理内容不会被写入 Trace。
- 工具参数只记录字段名和长度，不记录值；工具结果只记录长度、错误状态和耗时。
- SDK 的 Token / Cost 只采用 Provider 上报的数值，不按字符数推算；Context occupancy 不与本轮消耗相加。
- 反馈文本可能包含内部信息；它只在用户明确提供时采集，仍会经过 Secret 脱敏。
- Profile 是版本化候选，不会自行改写宿主系统 Prompt、Skill、Harness 或权限。
