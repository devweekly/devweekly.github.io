# `~/.workbuddy` 目录分析报告

> 生成时间：2026-08-09 07:25 · 分析对象：`/Users/ /.workbuddy`
> 总占用：**666 MB** · 22 个子目录 + 21 个顶层文件

---

## 一、目录定位

`~/.workbuddy` 是 WorkBuddy 的**全局用户数据根目录**（跨所有项目共享）。它包含身份记忆、全局配置、运行时数据库、工具链、技能与插件缓存。**注意：它不存放项目工作区本身**——工作区在 `~/WorkBuddy/` 下（见第四节）。

---

## 二、内容分类（按功能）

### 1. 身份与记忆层
| 条目 | 说明 |
|---|---|
| `SOUL.md` | 助手人格/行为准则 |
| `IDENTITY.md` | 代理身份（名字 WorkBuddy） |
| `USER.md` | 用户档案（SW，偏好高效务实） |
| `memory/` | 跨会话记忆（长期记忆落盘，8 KB） |

### 2. 配置层
| 条目 | 大小 | 说明 |
|---|---|---|
| `settings.json` | 4 KB | 沙箱白名单、启用插件、Claw 渠道（微信/企微） |
| `models.json` | 4 KB | 模型配置（含 **DeepSeek API Key 明文**，见警示） |
| `mcp.json` | 4 KB | 用户 MCP 服务器（playwright） |
| `mcp-approvals.json` | 4 KB | MCP 审批记录 |
| `.mcp.json` | — | 连接代理（connector-proxy，聚合 agent-mail/playwright） |
| `connectors/` + `connectors-marketplace/` | 52 KB + 25 MB | 连接器配置与市场缓存 |
| `.connectors-marketplace.meta.json` | — | 市场元数据校验（etag/sha256） |
| `ioa-im-override.json` | — | 是否允许非腾讯 IM |

### 3. 运行时与数据库（最大头）
| 条目 | 大小 | 说明 |
|---|---|---|
| `app/` | **119 MB** | 应用运行时缓存 |
| `sessions/` | 12 KB | 会话状态 |
| `projects/` | 18 MB | 项目索引/元数据 |
| `logs/` | 62 MB | 运行日志 |
| `traces/` | 84 MB | 调用链追踪 |
| `tasks/` | 300 KB | 后台任务状态 |
| `plans/` | 空 | 计划草稿（暂空） |
| `workspace/` | 空 | 工作区软链（暂空） |
| `workbuddy.db` (+`-wal`/`-shm`) | 128 KB+ | **主 SQLite 数据库**（自动化、记忆检索等） |
| `edge-sync-mapping.db` (+`-wal`/`-shm`) | 4 KB+ | 边缘同步映射库 |
| `.workbuddy-sqlite-migrations/` | — | DB 迁移脚本（baseline） |
| `last-launch.json` / `user-state.json` / `workspace-state.json` | — | 启动版本、使用统计、引导状态 |

### 4. 工具与运行时环境
| 条目 | 大小 | 说明 |
|---|---|---|
| `binaries/` | **257 MB（全目录最大）** | 隔离的 Python 3.13 / Node 22 运行时 + venv |
| `shell-snapshots/` | 5.7 MB | Shell 环境快照 |

> `binaries/` 占全盘 38%，是隔离执行环境（Python/Node 预装），不建议手动删改。

### 5. 技能与插件
| 条目 | 大小 | 说明 |
|---|---|---|
| `skills/` | 48 KB | 用户级 skill（当前仅 `aihot`） |
| `plugins/` | 90 MB | 插件缓存（weixinpay / tencent-docs / tencent-pptx） |
| `plugin-marketplace-state-new/` | 8 KB | 插件市场状态 |
| `connectors-marketplace/` | 25 MB | 连接器市场缓存 |

### 6. 缓存与业务数据
| 条目 | 大小 | 说明 |
|---|---|---|
| `blobs/` | 756 KB | 二进制大对象 |
| `clipboard-images/` | 516 KB | 剪贴板图片 |
| `file-history/` | 2.4 MB | 文件历史版本 |
| `artifact-index/` | 528 KB | 产物索引 |
| `local_storage/` | 484 KB | 本地 KV 存储 |
| `audit-log/` | 268 KB | 审计日志 |
| `usage-log.json` | — | skill/MCP 使用统计（agent-browser、ardot 等） |
| `tencent-docs-engine.port` / `desktop_conversation_migrated` / `install-timing-reported` | — | 端口/迁移/安装计时标记 |

### 7. 杂项
- `.DS_Store`：macOS 目录元数据

---

## 三、关键发现 / 警示

- **⚠️ API Key 明文存储**：`models.json` 中 `deepseek-v4-flash` 的 `apiKey`（`sk-`）以**明文**保存。该文件在 `~/.workbuddy` 内、权限 `644`，同机其他用户可读。若机器有多用户或会上传备份，建议收紧权限或迁移到密钥管理。
- `binaries/`(257M) + `app/`(119M) + `plugins/`(90M) 三者占 **70%** 空间，属正常隔离运行时，无需清理。
- `logs/`(62M) + `traces/`(84M) 持续增长，长期可清理旧日志释放空间（非紧急）。

---

## 四、除 `~/.workbuddy` 外的相关文件

WorkBuddy 的数据分散在多处，完整清单：

| 位置 | 大小 | 内容 |
|---|---|---|
| `/Applications/WorkBuddy.app` | **902 MB** | 应用本体（含内置 skill、可执行文件） |
| `~/WorkBuddy/` | 0B（含子目录） | **项目工作区**（如 `2026-08-09-07-17-31/`、历史会话目录、`Claw/`） |
| `~/Library/Application Support/com.workbuddy.workbuddy/` | 12 KB | 系统级应用支持数据（Documents 等） |
| `~/Library/Application Support/@genie/workbuddy-desktop/` | 0B | 桌面端辅助数据（暂空） |
| `~/Library/Logs/WorkBuddy/` | **16 MB** | 系统日志（`main.log`/`renderer.log` 等） |
| `~/Library/Caches/com.workbuddy.workbuddy/` | 160 KB | 系统缓存（`Cache.db`） |

**小结**：`~/.workbuddy` 是"用户数据中枢"，`/Applications/WorkBuddy.app` 是"程序本体"，`~/WorkBuddy/` 是"项目工作区"，`~/Library/...` 三处是"macOS 系统级配套"。四者共同构成 WorkBuddy 在本机的全部足迹。

---

## 五、是否可清理（建议）

| 目标 | 风险 | 建议 |
|---|---|---|
| `logs/`、`traces/` 旧文件 | 低 | 可定期清理（保留近期即可） |
| `binaries/`、`app/`、`plugins/` | 高 | 勿动，删了要重装/重下 |
| `workbuddy.db` 系列 | 高 | 勿删，含自动化与记忆 |
| `models.json` | 中 | 仅改 Key，勿删结构 |
| `memory/`、`SOUL.md` 等 | 高 | 记忆与人格，勿删 |

---

## 六、数据库结构解析：`workbuddy.db` 与 `edge-sync-mapping.db`

两个库均为 **SQLite**，且都开启了 **WAL 模式**（目录下各自的 `-wal`/`-shm` 文件即证据，支持并发读写、崩溃可恢复）。所有时间字段统一为 **Unix 时间戳（毫秒，INTEGER）**。

### 6.1 `workbuddy.db`（主业务库，128 KB）

共 **9 张表**，分三类：**迁移元数据 / 自动化 / 会话**。

#### (1) 迁移跟踪表
| 表 | 作用 |
|---|---|
| `__workbuddy_drizzle_migrations` | Drizzle ORM 的迁移登记（hash + created_at）。当前仅 1 条基线记录 `070b39ee…`，created_at=1782445443000 |
| `migration_meta` | 11 条键值对，记录"旧版 → 新版"数据迁移状态。见 6.3 维护机制 |

#### (2) 自动化（Automation）相关 —— 4 张
| 表 | 主键 | 关键字段 | 当前行数 |
|---|---|---|---|
| `automations` | `id` | name, prompt, status, **schedule_type**(`recurring`/`once`), **rrule**, scheduled_at, valid_from/until, model_id, skills_json, push_to_wechat/wecom_bot, expert_id, connector_ids_json, owner_user_id, deleted_at | 0 |
| `automation_runtime_state` | `automation_id` | last_run_at, last_error, running(0/1), running_conversation_id, metadata_json | 0 |
| `automation_runs` | `thread_id` | automation_id, status, thread_title, runs_json, result_success, metadata_json | 0 |
| `automation_delivery_outbox` | `id` | dedupe_key, channel(`wechatmp`), payload_json, **status**, attempt_count/max_attempts(5), next_run_at, lease_owner/lease_expire_at, last_error_code, finished_at | 0 |

> 这是一个**可靠投递队列**：自动化结果经 `delivery_outbox` 推送微信/企微，带 `lease` 租约 + 最多 5 次重试 + 去重键，确保不丢不重。当前四表均为空（尚未创建任何自动化）。

#### (3) 会话与用量 —— 3 张
| 表 | 主键 | 关键字段 | 当前行数 |
|---|---|---|---|
| `sessions` | `id` | cwd, user_id, title, custom_title, **status**(`Pending`/`working`/`completed`), mode(`craft`/`plan`/`ask`), model, expert_id, project_id, is_background_automation, timestamps | 6 |
| `session_usage` | `session_id` | used, size, **credit_json**（额度/用量） | 6 |
| `workspaces` | `path` | last_opened_at | 2 |

> `sessions` 样本：6 个会话，cwd 指向 `code-repos/*` 与 `~/WorkBuddy/*`，model 均为 `hy3`，当前 `5943ff74…` 状态 `working`（即本会话）。`workspaces` 仅记录 2 个真实代码仓（未含 `~/WorkBuddy` 本身）。

### 6.2 `edge-sync-mapping.db`（跨端同步映射库，4 KB）

共 **3 张表**，全部服务于"本地 ↔ 云端（腾讯云 COS / SMH 智能媒资）"的同步映射。

| 表 | 主键 | 字段 | 作用 | 当前行数 |
|---|---|---|---|---|
| `edge_sync_mapping` | `session_id` | conversation_id, **msg_channel**(如 `convmsg:<userId>`), created_at | 会话 ↔ 云端会话的 ID 映射，是跨端续聊的索引 | 6 |
| `edge_sync_image_mapping` | `blob_id` | cos_uri, session_id, created_at | 本地图片 blob → 腾讯云 COS URI 的映射 | 0 |
| `edge_sync_artifact_cache` | `file_path` | mtime_ms, size, **file_hash**, download_url, **smh_path**, content_type, **expires_at**, uploaded_at | 产物文件在 SMH 的缓存条目，带 TTL（`expires_at`） | 0 |

> `edge_sync_mapping` 的 6 行与 `workbuddy.db.sessions` 的 6 个会话一一对应（同 session_id），说明同步映射在会话创建时即写入。`image_mapping`/`artifact_cache` 暂空，因尚无图片上传或产物缓存。

### 6.3 维护机制（怎么维护的）

**① Schema 迁移（Drizzle ORM）**
- 基线脚本：`~/.workbuddy/.workbuddy-sqlite-migrations/0000_workbuddy_sqlite_baseline.sql`
- 每次启动应用会用 Drizzle 比对迁移 hash，自动执行未应用的增量迁移；已执行的 hash 写入 `__workbuddy_drizzle_migrations`。**不要手动改表结构**，否则 hash 失配导致迁移失败。

**② 旧版数据迁移（一次性）**
- `migration_meta` 的 11 条记录，是首次启动从旧路径 `~/Library/Application Support/WorkBuddy/` 迁移到 `~/.workbuddy` 的账本。本机全部为 `status:"skipped"`（全新安装、旧数据不存在），涉及：automations、plans、todos、brain、media-index、localstorage、claw-settings、mcp-oauth、history、session-model-patch、compact。

**③ 运行时写入**
- `sessions`/`session_usage`：每次新会话/消息由应用层 upsert。
- `edge_sync_mapping`：会话/云端会话建立时由同步服务写入。
- `edge_sync_artifact_cache`：带 `expires_at` TTL，由缓存清理逻辑定期淘汰过期条目。
- `automation_*`：由自动化调度器在创建/触发/投递时维护。

**④ 防损坏**
- WAL 模式 + `-wal`/`-shm` 影子文件，保证写入原子性与并发安全；异常退出后下次打开自动 checkpoint 恢复。

**维护建议**
- 勿用 `rm` 直接删 `.db`/`.db-wal`/`.db-shm`（三者必须配套），否则数据库可能损坏或丢最近写入。
- 想备份：复制整个 `~/.workbuddy` 或在应用关闭时复制这三个文件组合。
- 想瘦身：`automation_delivery_outbox` 中 `status=finished` 且 `finished_at` 较早的条目可由应用层清理；`edge_sync_artifact_cache` 靠 TTL 自然过期。

---

## 七、记忆与身份文件设计（SOUL / IDENTITY / USER / memory）

本章结合"设计规格 + 本机实测"两段证据，说明这些文件如何分层、如何被及时更新。

### 7.1 设计总览：三层记忆 + 身份层

| 层 | 落盘位置 | 作用域 | 读写 | 容量限制 |
|---|---|---|---|---|
| L1 云端记忆 | 不落本地，会话开始**注入 prompt** | 跨项目（服务端托管） | 只读（本地） | 服务端生成 |
| L2 用户级本地记忆 | `~/.workbuddy/memory/<uid>_memory.md` | 所有项目 | 读写 | 4000 字符/次 |
| L3 工作区记忆 | `<ws>/.workbuddy/memory/YYYY-MM-DD.md` + `MEMORY.md` | 当前项目 | 读写 | 3000 字符/次 |
| 身份层 | `~/.workbuddy/SOUL.md` · `IDENTITY.md` · `USER.md` | 全局人格 | 读写 | 无硬限 |

> 设计意图：**云端管"你是谁/长期画像"，用户级管"跨项目习惯"，工作区级管"本项目约定"，身份层管"助手人格"**。四者互不替代，互补。

### 7.2 身份文件（SOUL / IDENTITY / USER）设计

三个纯 Markdown 文件，bootstrap 时由模板种子化（本机实测行数：SOUL 43 / IDENTITY 21 / USER 21）：

- **`SOUL.md`** — 助手人格与行为准则（"你是谁"）：核心真理、边界、语气、连续性。改它会改变助手本质，**改了必须告知用户**。
- **`IDENTITY.md`** — 代理身份记录（名字 WorkBuddy、emoji、vibe）。
- **`USER.md`** — 用户档案（姓名、沟通偏好"高效务实"）。

更新方式：仅在内容确实需要变化时用 Edit 原地改写；属低频、人工触发的"人格演进"。

### 7.3 记忆文件实测落地（磁盘证据）

本机 `~/.workbuddy/memory/` 实际内容：
```
memory/
├── cee138e7-09d4-4034-a4b7-693a32c1ffe2_memory.md      # 当前版本
└── cee138e7-09d4-4034-a4b7-693a32c1ffe2_memory.md.bak  # 覆盖前自动备份
```
> 该 `uid` 与 `settings.json` 的 `legacyOwnerUid`、所有 `sessions.user_id` 完全一致 → **记忆按用户 UUID 隔离，多用户安全**。

文件内部格式（实测）：
```markdown
# User Memory Profile
> Last updated: 2026-08-08T23:24:47.791Z
> Version: 0
## Memory Block
（人类可读的长期记忆正文）
---
<!-- RAW_JSON_START
{ "uid": "...", "memoryBlock": "", "updatedAt": "..." }
RAW_JSON_END -->
```
- **`Memory Block`**：给人看的记忆正文；**`RAW_JSON`**：机器解析用（含 uid / memoryBlock / 时间戳），便于程序读写。
- **`.bak`**：每次覆盖前自动保留上一版 → 可回滚，防误写。
- 当前 `memoryBlock` 为空（全新，尚未积累长期记忆）。
- 工作区记忆目录 `<ws>/.workbuddy/memory/` **本机尚未创建**（首次实质性工作后由代理按需建目录并写 `YYYY-MM-DD.md`）。

### 7.4 如何"及时更新"

| 触发时机 | 写入目标 | 动作 |
|---|---|---|
| 用户**显式**要求"长期记住某事" | L2（用户级）或 L3（项目级） | Edit 原地更新 |
| 每次**实质性工作**完成（建站/修 bug/写报告等） | L3 当日日志 `YYYY-MM-DD.md` | **追加**（append-only，绝不覆盖） |
| 发现**跨项目习惯/偏好** | L2 `~/.workbuddy/MEMORY.md` | 更新 |
| 发现**项目约定** | L3 `MEMORY.md` | 更新（蒸馏自每日日志） |
| L3 日志超 30 天 | L3 `MEMORY.md` | 按主题蒸馏、删旧日志 |

**时效保证（关键设计）**：记忆写入被规定为 **agent 循环最后一步**——在"生成最终文本回复之前"、于工具调用阶段完成。即更新是**即时、同步**的，不延迟到后台，也不会因会话结束而丢失。

**安全机制**：
- L3 每日日志**只追加不覆盖**；
- L2 覆盖前生成 `.bak` 快照；
- 云端 L1 由服务端自动从对话历史摘要生成，每次会话开始重新注入，天然"自我更新"。

### 7.5 实测与文档规格的差异

| 文档规格（系统约定） | 本机实测 |
|---|---|
| L2 路径 `~/.workbuddy/MEMORY.md` | 实际为 `~/.workbuddy/memory/<uid>_memory.md`（按用户分文件 + 版本号 + `.bak`） |
| L1 云端记忆"只读、服务端托管" | 本地无对应文件，确实只在 prompt 中以 `<memory>` 块注入 |
| L3 每日日志"追加" | 目录尚未生成（尚未发生需落盘的工作） |

> 差异说明：实现已演进——L2 从单一 `MEMORY.md` 升级为"按 uid 隔离 + 版本化 + 备份"，更适多用户与防误写。

### 7.6 维护建议

- **改 SOUL/IDENTITY/USER**：谨慎，属人格级变更，改后告知用户。
- **L1 云端记忆**：本地不可直接编辑，依赖服务端；如要纠正画像，应在对话中显式陈述事实让服务端学习。
- **L2 `.bak`**：误写后可据此回滚，勿删。
- **L3 日志**：定期（>30 天）蒸馏进 `MEMORY.md` 并删旧文件，避免无限膨胀。
- **隐私**：`memory/` 含长期记忆，随 `~/.workbuddy` 备份/同步时会一并外传，敏感信息勿写入。

---

## 八、Skill 全量清单与分析

对四个来源目录（`~/.workbuddy/skills` 用户级、`/<ws>/.workbuddy/skills` 项目级、`/Applications/.../builtin-skills` 内置、`~/.workbuddy/plugins/cache/.../skills` 插件缓存）递归扫描所有 `SKILL.md`，共 **25 个 skill**。

### 8.1 来源分布

| 来源 | 数量 | skill 列表 |
|---|---|---|
| 用户级 `~/.workbuddy/skills/` | 1 | aihot |
| 项目级 `<ws>/.workbuddy/skills/` | 0 | （空） |
| 内置 `builtin-skills/` | 18 | ardot-design-core / -router / -ui-design / -poster / -slides / -to-code、wb-finance-skill、westock-data、westock-tool、neodata-financial-search、tencent-local-office-edit、tencent-docs-routing、buddy-multimodal-generation、geo-map-compliance-guard、cloudstudio-deploy、expert-manager、skill-creator、marketplace-skill-installer |
| 插件缓存 `plugins/cache/` | 6 | tencent-docs、tencent-saas-docs、tencent-pptx、weixinpay-register、weixinpay-pay、weixinpay-feedback |
| **合计** | **25** | |

### 8.2 按功能分类清单

#### A. 设计类（Ardot 画布，均为内置）
| skill | 体积 | 说明 |
|---|---|---|
| `ardot-design-core` | 139 KB | 所有 Ardot 设计任务的**基础工作流与硬规则**总入口 |
| `ardot-design-router` | 3.6 KB | **调度器**：设计模式但交付物类型未定时分发到具体 skill |
| `ardot-ui-design` | 37 KB | UI/界面设计（网页、仪表盘、落地页等） |
| `ardot-poster` | 23 KB | 海报/传单/横幅/活动海报 |
| `ardot-slides` | 25 KB | 幻灯片/PPT 视觉设计（非 .pptx 文件） |
| `ardot-design-to-code` | 61 KB | 设计转前端代码 / 从网站提取设计系统 |

#### B. 金融类（4 个，均为内置）
| skill | 体积 | 说明 |
|---|---|---|
| `wb-finance-skill` | 331 KB | 金融场景**总入口**（优先级高于其余金融 skill） |
| `westock-data` | **4638 KB** | 金融市场结构化数据查询权威入口（行情/财报/研报/宏观…） |
| `westock-tool` | 3199 KB | 选股/选基工具（条件/策略/标签/排行批量筛选） |
| `neodata-financial-search` | 41 KB | NeoData 自然语言金融数据搜索 |

#### C. 文档 / Office 类（5 个）
| skill | 来源 | 体积 | 说明 |
|---|---|---|---|
| `tencent-docs-routing` | 内置 | 12 KB | 处理**本地** Office/WPS 前的路由分发 |
| `tencent-local-office-edit` | 内置 | 39 KB | 本地 Office/WPS 实时读写（editor_sdk，所见即所得） |
| `tencent-docs` | 插件 | 144 KB | 腾讯文档**个人版**（docs.qq.com） |
| `tencent-saas-docs` | 插件 | 90 KB | 腾讯文档**企业版**（saas.docs.qq.com） |
| `tencent-pptx` | 插件 | 141 KB | 生成专业 PowerPoint `.pptx` |

#### D. 多模态生成（内置）
| skill | 体积 | 说明 |
|---|---|---|
| `buddy-multimodal-generation` | 49 KB | 文/图生 3D 模型 + 基于模板的图片视频特效（video-fx） |

#### E. 地图合规（内置）
| skill | 体积 | 说明 |
|---|---|---|
| `geo-map-compliance-guard` | 8.6 KB | 任何地图生成/可视化/路径/位置服务**强制触发**中国地图合规校验 |

#### F. 部署 / 发布（内置）
| skill | 体积 | 说明 |
|---|---|---|
| `cloudstudio-deploy` | 22 KB | 将本地构建目录（dist/ 等）部署到 CloudStudio 沙箱 |

#### G. 专家 / 技能管理（3 个，均为内置）
| skill | 体积 | 说明 |
|---|---|---|
| `expert-manager` | 95 KB | 专家包全生命周期（转化/修改/合规/审查） |
| `skill-creator` | 42 KB | 创建/更新有效 skill 的指南 |
| `marketplace-skill-installer` | 4.8 KB | 从推荐市场一句话搜索并安装 skill |

#### H. 资讯（用户级）
| skill | 体积 | 说明 |
|---|---|---|
| `aihot` | 26 KB | 查询中文 AI 资讯/精选/热点/日报（aihot.virxact.com） |

#### I. 微信支付（3 个，均为插件）
| skill | 体积 | 说明 |
|---|---|---|
| `weixinpay-register` | 8.6 KB | 开通/绑定微信 AI 支付或 AI 专属卡、查状态 |
| `weixinpay-pay` | 12 KB | 「重新支付」：取消后同订单再付一次 |
| `weixinpay-feedback` | 7.5 KB | 支付/开通异常时引导问题反馈 |

### 8.3 体积与加载优先级

- **最大**：`westock-data`(4.6 MB)、`westock-tool`(3.2 MB) —— 因内含大量 references/数据字典。
- **最小**：`ardot-design-router`(3.6 KB)、`marketplace-skill-installer`(4.8 KB) —— 纯调度/入口型 skill。
- **加载优先级（同名校验）**：用户级 > 项目级 > 内置 > 插件缓存。当前无重名，互不冲突。
- **触发方式**：多为"关键词/意图触发"——用户表述命中 `description` 中的触发词时由代理加载；`ardot-design-router`/`tencent-docs-routing` 属**路由型**，先被调用来再分发到具体 skill。

### 8.4 观察小结

1. 25 个 skill 中 **18 个内置（72%）**，用户仅装 1 个（`aihot`），项目级暂未使用 → 当前个性化程度低。
2. 设计（Ardot 6 个）与金融（4 个）是两大主力方向；文档类横跨"本地 edit"与"云端腾讯文档"两套体系。
3. 微信支付 3 件套以**插件**形式随 `settings.json` 的 `enabledPlugins` 启用，独立于内置体系。
4. `skill-creator` + `marketplace-skill-installer` + `expert-manager` 构成"技能自举"闭环：可自创、自装、自管专家。
