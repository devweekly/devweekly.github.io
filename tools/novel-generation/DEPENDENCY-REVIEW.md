# 依赖审计：手写实现与 npm 包的替换边界

范围是 `tools/novel-generation` 的全部源码、`web/src` 前端与 `scripts/`，不涉及仓库根的 Astro 站点。问题是两个：哪些地方在用偏少的代码解决 npm 上已有成熟方案的问题；哪些已声明的依赖根本没有被使用。

证据来源分两类。包版本、发布日期和依赖体积直接取自 npm registry（2026-11-07 抓取）；运行时行为（如 `node:sqlite` 的实验警告）在本地 Node v24.14.1 实测。网络检索接口当天不可用，`node:sqlite` 的官方稳定性状态未能从文档侧交叉核验，相关结论以本地实测为准。

## 结论总表

| 对象 | 现状 | 判断 |
| --- | --- | --- |
| `model-json.ts` JSON 修复（`repairJsonText` / `quoteBareKeys`） | 手写约 40 行 | 建议换成 `jsonrepair`；`extractJsonText` 保留 |
| `node:sqlite` + `retryBusy` + `Atomics.wait`忙等 | 内置实验 API | 暂不换 `better-sqlite3`，理由见下 |
| `cli.ts` 参数解析（755 行文件内手写 `arg()` / `valuesAfter()`） | 手写 | 暂不换 `cac` / `commander`，收益不抵风险 |
| `web/src/Workbench.tsx` 的 `Badge` / `Divider` / `Input` / `Timeline` | antd 导入但未使用 | 直接删除 |
| `library.ts` 简版 BM25 + 中文 bigram | 手写，带取舍注释 | 保留，不引 jieba 类分词库 |
| `story-state-graph.ts`、`workflow.ts` 的 `mergeBy`、web 的 `api()` 包装 | 手写领域逻辑或十余行小函数 | 保留，不引 lodash 等通用库 |

`package.json` 里声明的运行时依赖（`@tencent-ai/agent-sdk`、`zod`、`express`、`react`、`react-dom`、`antd`、`@ant-design/icons`）与开发依赖（`typescript`、`tsx`、`vite`、`@vitejs/plugin-react`、`@types/*`）逐个核对过，全部在用，无僵尸依赖。

## 建议引入：jsonrepair 替换手写 JSON 修复

`src/model-json.ts` 目前承担两件事。`extractJsonText` 从模型输出的围栏和说明文字里截出第一个完整 JSON 对象，这个位置感知逻辑任何现有包都不直接提供，需要保留。`repairJsonText` 和 `quoteBareKeys` 处理另一类问题：字符串里的裸换行与控制字符、尾逗号、未加引号的 JS 风格键名。这就是 `jsonrepair` 的正面战场。

`jsonrepair`（josdejong）最新版 3.15.0，2026-07-03 发布，零依赖。它覆盖的畸形输入远多于手写版：单引号字符串、`None`/`NaN`、注释、对象键缺失引号、截断输出等。手写版目前只修三种模式，模型输出的畸形每超出一种，就要往这两个函数里加正则；而正则修复本身有误伤面——`quoteBareKeys` 对整个文本做替换，字符串值里长得像 `{, abc:` 的内容也会被改写。

替换方式是保守的：`parseJsonObject` 的 fallback 从 `JSON.parse(quoteBareKeys(repairJsonText(text)))` 改成 `JSON.parse(jsonrepair(text))`，`extractJsonText` 原样保留，`story-analysis.ts` 里那层「解析失败后让同一个模型只修结构不改内容」的重试也保留——静态修复包和模型级修复是互补的，前者快且确定性，后者能处理语义层的损坏。需要同步调整 `test/model-json.test.ts` 中针对修复函数的断言；`jsonrepair` 的行为差异要在测试里对齐，尤其是它对「模型输出后缀解释文字」的处理需要实测确认（`extractJsonText` 先截断的对象不受影响）。

代价只有一个新增依赖，约几十 KB、无传递依赖。这是本次审计里唯一明确值得动手的一条。（补记：报告完成后当日上午，`package.json` 已由并行会话加入 `jsonrepair@^3.15.0` 并完成安装，实施进行中。）

## 暂不更换：node:sqlite 与忙等重试

`src/database.ts` 用 `node:sqlite` 的 `DatabaseSync`，配合 `PRAGMA busy_timeout=5000` 和一个手写 `retryBusy`（最多 40 次、每次用 `Atomics.wait` 同步让出 250ms）。换 `better-sqlite3`（当前 13.0.3，2026-08-05 发布，engines 要求 Node ≥22）的收益是成熟的原生 `busy_timeout` 与事务 API，以及远离实验 API 的稳定性声明。

不建议现在换的理由是代价结构。`better-sqlite3` 带 `node-addon-api` 原生编译，项目的 prebuild 覆盖不到的环境要在安装时编译；这个项目整体取向是零原生依赖、本地开箱即用，一次 native build 违背这个前提。而且实测看，当前的并发痛点不在驱动层：分析分片的写入竞争已经被 `busy_timeout` 加上外层重试兜住，真正的开销是每个函数各自 `open/close` 数据库的往返模式，这换成 `better-sqlite3` 也不会自动变好。

权限衡的判断依据很具体：当分析任务的并发分片数或写冲突频率上升到重试日志里可见时，再评估迁移；届时迁移点集中在 `openKnowledgeDatabase` / `transaction` 两个出口，改动面可控。另外 `node:sqlite` 在 Node v24.14.1 上仍打 `ExperimentalWarning`，其稳定化版本未能从在线文档确认——若 Node 后续版本宣告稳定，这条评估的紧迫性会进一步下降。

## 暂不更换：CLI 参数解析

`src/cli.ts` 有 22 个子命令、755 行，参数读取靠 `arg()`（按 argv 下标找值）与 `valuesAfter()`。`cac`（7.1.0）或 `commander`（15.0.0）确实能替掉这两个人十行的函数和 `usage()` 的手写帮助文本。

问题是重写面。每个命令里的校验逻辑（`--timeout-ms` 的区间检查、错误文案引用常量等）和命令主体纠缠在同一层，迁移等于重排 755 行的骨架；参数解析出错时的行为差异（值以 `--` 开头被跳过、未知参数静默忽略）还会改变现有使用习惯。这些函数在本周期没有制造过缺陷，替换属于「未来演进可能需要的抽象」，与项目「不引入缺乏实际需求依据的间接层」的约定相抵触。保留现状；如果子命令数量继续增长，优先把 `usage()` 和命令路由剥离成独立结构，而不是引入框架。

## 建议清理：未使用的 antd 导入

`web/src/Workbench.tsx` 第二行的 antd 导入里，`Badge`、`Divider`、`Input`、`Timeline` 四个组件没有被使用。构建时会被 tree-shake 掉，不影响产物体积，但属于纯粹的代码噪音，还会误导下一个读者以为界面上有 Timeline。`CharactersPanel.tsx` 与 `main.tsx` 里的别名导入（`App as AntApp` 等）核对过，均在用。删除这四个名字即可，无行为影响。

## 有意手写、不该替换的部分

这些点容易被 WebSearch 出的「最佳实践」误伤，明确记录不动的理由。

`src/library.ts` 的检索是简化版 BM25，配合中文 bigram 分词和停用词表，索引用 mtime 缓存。中文分词库（jieba 系）会显著增加安装体积与首载时间，而这个语料库的用户只有本项目的查询拼装场景，词面覆盖需求有限。`briefTerms` 附近已有注释说明这个取舍，与实现一致。

`src/story-state-graph.ts` 的图谱构建只以显式 ID 和字段引用为连接键，注释里写明「deliberately performs no fuzzy entity resolution」。模糊实体解析库（去重、相似名合并）在这里是负资产：错误合并直接污染 Story State，而保持未解析歧义可见是当前架构的有意选择。

`workflow.ts` 的 `mergeBy`（约十行按 key 合并新旧列表）、web 端的 `api()` fetch 包装（四行）都在「引库比写库更重」的尺寸上。`randomUUID`、`node:crypto` 的哈希用法已是正确的平台能力调用，不存在第三方替代问题。

## 验证记录

本报告只做审计，未改动任何运行时行为；修复仅限一处：报告完成后的验证中发现另一并行会话对 `src/workflow.ts` 的编辑残留了一个游离的 `try {` 片段（语法错误），已恢复为原 try 块。同一会话另外在途的改动（`cli.ts` 风格命令引入 `runAgentText` 但缺 import、相关 2 个测试断言 failure）不在本报告范围内，交付时尚未收口。审计过程中核对的事实：`npm run typecheck`、`npm run build`（vite 产物约 916KB，chunkSize 警告为既有状态）、`npm test`（139/139）在报告撰写时点全部通过。清单中「建议引入 jsonrepair」一条由并行会话实施，验收应按上文保守替换方案核对 `test/model-json.test.ts` 与替换后的行为差异。
