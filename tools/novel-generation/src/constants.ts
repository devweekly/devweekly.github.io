/**
 * 策略常量的唯一来源。改动这里的任何值都会改变系统行为，因此每条都写明
 * 「取值依据 / 影响范围 / 改动后果」。改动后必须重跑：
 *   npm run build && node --import tsx --test test/*.test.ts
 *
 * 刻意不收进来的数字（提成常量只会制造噪音，没有信息增量）：
 *   - 数组索引、0/1/2、-1、100（百分比换算）等结构性数字
 *   - HTTP 状态码（202/400/403/404）与 express 错误分支
 *   - SQL 里的字段序号、哈希截取长度、时间戳格式化基数
 *   - world-analysis.ts 的 ANALYSIS_ROLES 行号区间与卷号：那是《从姑获鸟开始》
 *     的语料锚点，属于数据而非策略，换书时应整体替换该数组
 *   - web 端的栅格 span、字号、间距：纯视觉，见 web/src/style.css
 */

// ── 模型调用与超时（单位 ms） ──────────────────────────────────────
/** 单次 Agent 调用默认超时。全书分析一批约 14k 字，实测 P95 < 60s，留 3 倍余量。
 *  影响 analyze-story / analyze-arcs / analyze-profiles / 语义证据核验。
 *  过小会让长批次被 interrupt 后计入 failed，且不会写入成功缓存。 */
export const DEFAULT_AGENT_TIMEOUT_MS = 180_000;

/** CLI 允许的超时区间。低于 5s 连模型目录都读不完；高于 10min 会长时间占住终端。 */
export const MIN_AGENT_TIMEOUT_MS = 5_000;
export const MAX_AGENT_TIMEOUT_MS = 600_000;

/** 写作、长章节、回归的超时下限。长文本生成 30s 起才有完整输出。 */
export const MIN_WRITE_TIMEOUT_MS = 30_000;

/** check-runtime / analyze-world 的默认超时。只读目录 + 一次极短调用，无需 3 分钟。 */
export const DEFAULT_PROBE_TIMEOUT_MS = 90_000;

/** Knowledge Build 子进程无 stdout/stderr 活动的最长间隔；长任务可持续运行，但必须持续有可观测进展。 */
export const KNOWLEDGE_BUILD_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
/** CLI 等待新宇宙最低知识准备的总时限；单个构建步骤另有无输出心跳超时。 */
export const KNOWLEDGE_BUILD_WAIT_TIMEOUT_MS = 30 * 60 * 1000;
/** CLI 读取知识构建状态文件的轮询间隔。 */
export const KNOWLEDGE_BUILD_POLL_INTERVAL_MS = 1_000;
/** 取消或心跳超时后，给子进程组的优雅退出时间。 */
export const CHILD_PROCESS_KILL_GRACE_MS = 5_000;

/** 回归对照默认超时。一次要写两版正文并让另一个模型评审，比单批分析更久。 */
export const DEFAULT_REGRESSION_TIMEOUT_MS = 240_000;

// ── 篇幅与场景 ────────────────────────────────────────────────────
/** 章节目标篇幅（汉字）。下限保证有完整场景，上限防止单次输出超出模型上下文。
 *  regress 的 --max-words=0 表示「与原章同长」，是独立语义，不是合法写作值。 */
export const DEFAULT_MAX_WORDS = 3_000;
export const MIN_MAX_WORDS = 300;
export const MAX_MAX_WORDS = 20_000;

/** write-long 场景数。与 chapter-review 的 scenes schema 共用上限，
 *  避免终审给出流水线无法定位的场景号。 */
export const DEFAULT_SCENES = 8;
export const MIN_SCENES = 2;
export const MAX_SCENES = 20;

// ── 全书分析批次与快照 ────────────────────────────────────────────
/** 每批装箱的原文字符数。决定 753 章切成约 196 批，且进入缓存指纹；
 *  改动会让全部批次缓存失效并重新调用模型（约 196 次）。 */
export const ANALYSIS_BATCH_CHARS = 14_000;

/** 单个分析项合并时保留的最大章节来源引用数。跨卷人物可命中上百章，
 *  不设上限会把 story_analysis 快照撑到数 MB。 */
export const MAX_ITEM_SOURCE_REFS = 24;

/** 图谱节点、边与故事核心聚合保留的最大来源引用数。比单项宽松，
 *  因为节点会跨批合并多个引用集合。 */
export const MAX_GRAPH_SOURCE_REFS = 48;

/** 语义证据核验每批送检的结论段数。8 段约 2–3k 字，给输出 JSON 留出余量。 */
export const EVIDENCE_CLAIMS_PER_BATCH = 8;

/** 分析结构版本。ADR-0002：v6 引入故事核心、MacGuffin、关系动态与主线/支线分类。
 *  低于它的快照一律不得注入写作上下文。提升版本必须同时更换缓存指纹与 v6 Prompt，
 *  否则旧批次缓存会被当成新版本结果复用。 */
export const ANALYSIS_VERSION = 6;

// ── 写作上下文注入（只承载可选参考，硬事实由 writing-brief 负责） ───
/** 注入上下文的字符预算。超出会截断并标注，不影响正文正确性。 */
export const WRITING_CONTEXT_BUDGET = 6_000;

/** 单个分析项渲染进上下文的字符上限，防止一条超长小传吃掉整个预算。 */
export const CONTEXT_ITEM_RENDER_LIMIT = 1_400;

/** 各分组注入条数上限。人物/关系略多，MacGuffin/伏笔略少；总量另受预算二次约束。 */
export const CONTEXT_LIMIT_CHARACTERS = 5;
export const CONTEXT_LIMIT_RELATIONS = 6;
export const CONTEXT_LIMIT_PLOT_THREADS = 5;
export const CONTEXT_LIMIT_MAC_GUFFINS = 4;
export const CONTEXT_LIMIT_FORESHADOWINGS = 5;
export const CONTEXT_LIMIT_DEVELOPMENTS = 5;

/** 图谱相关节点数与一跳边数上限。 */
export const CONTEXT_LIMIT_GRAPH_NODES = 8;
export const CONTEXT_LIMIT_GRAPH_EDGES = 16;

/** 单个分析项「参考来源范围」提示里最多展示几条，超出只显示总数。 */
export const CONTEXT_SOURCE_HINT_LIMIT = 5;

// ── 检索与列表 ────────────────────────────────────────────────────
/** 知识库列表默认/最大条数。CLI story-kb 用于人工抽查，2000 足以覆盖全书伏笔。 */
export const KB_DEFAULT_LIMIT = 50;
export const KB_MAX_LIMIT = 2_000;

/** 伏笔查询的默认条数。伏笔数量约为人物的 3 倍，默认值相应放宽。 */
export const KB_FORESHADOWING_DEFAULT_LIMIT = 100;

/** 人物列表 API 默认/最大返回条数。当前全书 544 人、全量约 324KB，
 *  1000 足够且无需分页；5000 防止 ?limit 被滥用拖垮响应。
 *  修复前的 200 是硬编码截断，会静默丢掉 344 人并把加载条数当成总数显示。 */
export const CHARACTER_LIST_DEFAULT_LIMIT = 1_000;
export const CHARACTER_LIST_MAX_LIMIT = 5_000;

/** workbench 请求体上限。API 只接收 brief / model / 审批意见，2MB 远大于实际需要。 */
export const WORKBENCH_BODY_LIMIT = "2mb";

/** 仪表盘展示的近期运行与候选版本条数上限。纯展示，不影响数据落盘。 */
export const DASHBOARD_RECENT_RUNS_LIMIT = 12;
export const DASHBOARD_PLAN_VERSIONS_LIMIT = 20;

/** 检索片段默认条数与 CLI 校验边界。 */
export const DEFAULT_SEARCH_LIMIT = 8;
export const MAX_SEARCH_LIMIT = 30;
/** 逐片段抽取（analyze）的默认/最大条数。全量 2594 片段默认只跑 20 条做试跑。 */
export const DEFAULT_ANALYZE_LIMIT = 20;
export const MAX_ANALYZE_LIMIT = 100;

/** write / write-long 注入的检索片段条数与上限。长章节逐场检索，单场上限更小。 */
export const WRITE_RETRIEVAL_LIMIT = 6;
export const MAX_WRITE_RETRIEVAL_LIMIT = 20;
export const WRITE_LONG_RETRIEVAL_LIMIT = 4;
export const MAX_WRITE_LONG_RETRIEVAL_LIMIT = 12;

/** 组装检索查询时取用的状态人物数与续写起点截取长度。
 *  防止把整份 story-state 塞进 prompt，同时保留足够的接续线索。 */
export const QUERY_CONTEXT_CHARACTERS = 12;
export const QUERY_SOURCE_TAIL_CHARS = 1_500;

// ── 推理档案（token） ─────────────────────────────────────────────
/** thinking 预算默认/下限/上限。8192 足够规划类任务；
 *  下限防止配置过小导致思考被截断，上限对齐 SDK 允许量级。 */
export const DEFAULT_THINKING_BUDGET_TOKENS = 8_192;
export const MIN_THINKING_BUDGET_TOKENS = 1_024;
export const MAX_THINKING_BUDGET_TOKENS = 65_536;

// ── analyze-world 文件交接协议的成果校验 ──────────────────────────
/** 每份 Agent 成稿的最低字数与证据行号数。PROTOCOL.md 要求 900–1800 字、
 *  至少 8 处 L####；修复前 collect 校验用的是 600 字 / 6 处，与生成要求矛盾，
 *  会让不合格成稿通过。已统一到协议口径。 */
export const AGENT_REPORT_MIN_CHARS = 900;
export const AGENT_REPORT_MAX_CHARS = 1_800;
export const AGENT_REPORT_MIN_REFERENCES = 8;

/** 成稿至少要有几个二级标题。低于此值说明角色只交了一段流水账。 */
export const AGENT_REPORT_MIN_SECTIONS = 3;

// ── 章节终审 ──────────────────────────────────────────────────────
/** 单章最多报几条必改项。超过会让自动修复轮次失控，审查模型也倾向凑数。 */
export const MAX_REVIEW_ISSUES = 3;

/** 证据定位串的最大长度（字符）。只用于定位、不要求逐字命中；
 *  修复前 schema 允许 40 字而 prompt 写「不超过 15 字」，两处约束不一致。 */
export const REVIEW_EVIDENCE_MAX_CHARS = 15;

// ── 铁律检查 ─────────────────────────────────────────────────────
/** 铁律命中证据展示的最大长度（字符）。只用于定位，不必逐字命中。 */
export const IRON_LAW_EVIDENCE_MAX_CHARS = 30;

/** 单次铁律检查最多报几条命中，避免输出爆炸。 */
export const IRON_LAW_MAX_HITS = 6;

// ── 生成调用 ─────────────────────────────────────────────────────
/** generateStory 单次调用默认超时。生成整章比分析更久，给 2 分钟。 */
export const GENERATION_DEFAULT_TIMEOUT_MS = 120_000;

// ── 分析调用 ─────────────────────────────────────────────────────
/** 全书分析单批默认超时。单批约 14k 字，60s 足够。 */
export const ANALYSIS_DEFAULT_TIMEOUT_MS = 60_000;

// ── 人物画像与长章节 ─────────────────────────────────────────────
/** 人物画像合并分析单次调用默认超时。 */
export const PROFILE_ANALYSIS_DEFAULT_TIMEOUT_MS = 150_000;

/** 长章节/工作流组装检索查询时截取原文尾部的长度。 */
export const LONG_CHAPTER_SOURCE_TAIL_CHARS = 2_400;

// ── 行文切片与索引 ──────────────────────────────────────────────
/** 单个检索切片的最大字符数。切片过大会稀释检索精度，过小会打断句子。 */
export const LIBRARY_CHUNK_MAX_CHARS = 1_200;

/** 相邻切片重叠的字符数：保证句子跨切片时，检索仍能看到完整上下文。 */
export const LIBRARY_CHUNK_OVERLAP_CHARS = 160;

/** 逐章合并切片时，与已累积文本最多比对多少字符找重叠。约两段长度。 */
export const ANALYSIS_DEDUPE_MAX_OVERLAP_CHARS = 260;

/** 认定「真的重叠」的最短字符数，避免把巧合的开头误判成重复并误删。 */
export const ANALYSIS_DEDUPE_MIN_OVERLAP_CHARS = 24;

/** groupAnalysisUnits 入参下限：防止把全书塞进一批导致单批不可控。 */
export const MIN_ANALYSIS_BATCH_CHARS = 2_000;

// ── 人物画像的输入采样与输出上限 ────────────────────────────────
/** 性格类原始观察的采样上限。主角动辄上百条，模型会被截断。 */
export const PROFILE_SAMPLE_PERSONALITY = 24;

/** 其余观察维度（欲望/矛盾/走向）的采样上限。比性格少一档即可。 */
export const PROFILE_SAMPLE_DEFAULT = 16;

/** 画像输出各字段的条数上限，与提示词里的「3–5 条 / 3–6 条」对应。 */
export const PROFILE_OUTPUT_STAGES_LIMIT = 6;
export const PROFILE_OUTPUT_TRAITS_LIMIT = 8;
export const PROFILE_OUTPUT_CONTRADICTIONS_LIMIT = 8;
export const PROFILE_OUTPUT_ARC_LIMIT = 6;

// ── 长篇主线的规模上限 ─────────────────────────────────────────
/** 重大剧情节点与长期剧情线最多各保留几条。超过说明抓不住主线。 */
export const STORY_PLAN_MAX_ITEMS = 30;

// ── 世界局势（章节前轻量推演）的输入预算 ───────────────────────
/** 整份局势输入的字符预算。只服务本章规划，不能挤占正文上下文。 */
export const WORLD_SITUATION_MAX_CHARS = 5_200;

/** 参与局势推演的相关人物上限。多了就是全场模拟，违背 ADR-0003。 */
export const WORLD_SITUATION_CHARACTER_LIMIT = 8;

/** 任务没点名人物时，按最近更新保留的主角团规模。 */
export const WORLD_SITUATION_FALLBACK_CHARACTERS = 5;

/** 参与推演的相关剧情线上限。 */
export const WORLD_SITUATION_THREAD_LIMIT = 6;

/** 任务没点名剧情线时，按时间顺序保留的活跃线数作为最临近的上下文。 */
export const WORLD_SITUATION_FALLBACK_THREADS = 4;

/** 参与推演的相关事件上限。 */
export const WORLD_SITUATION_EVENT_LIMIT = 8;

/** 没有命中相关事件时，按时间顺序保底的近期事件数。 */
export const WORLD_SITUATION_FALLBACK_EVENTS = 5;

/** 人物快照里各字段进入局势输入的条数上限；默认 4，字段特异处单独放宽。 */
export const WORLD_SITUATION_FIELD_DEFAULT_LIMIT = 4;
export const WORLD_SITUATION_FIELD_KNOWLEDGE_LIMIT = 6;
export const WORLD_SITUATION_FIELD_RELATIONS_LIMIT = 5;
export const WORLD_SITUATION_FIELD_CONTRADICTIONS_LIMIT = 3;

/** 相关性打分的启发式权重：整名命中远强于词面重合。 */
export const WORLD_SITUATION_NAME_HIT_SCORE = 24;
export const WORLD_SITUATION_PARTICIPANT_BONUS = 28;
export const WORLD_SITUATION_THREAD_LINK_BONUS = 18;
export const WORLD_SITUATION_ACTIVE_THREAD_BONUS = 2;

// ── 写作事实包（writing-brief）的查询与呈现预算 ────────────────
/** 事实包总字符预算。硬事实优先于正文创作空间，但也不能无限大。 */
export const WRITING_BRIEF_MAX_CHARS = 3_000;

/** 事实包从知识库捞取候选时的查询条数。先宽后精，避免漏掉相关项。 */
export const WRITING_BRIEF_QUERY_LIMIT_CHARACTERS = 400;
export const WRITING_BRIEF_QUERY_LIMIT_THREADS = 400;
export const WRITING_BRIEF_QUERY_LIMIT_FORESHADOWINGS = 600;

/** 默认注入条数：与上一轮推荐的 writing-brief 取值一致。 */
export const WRITING_BRIEF_DEFAULT_CHARACTERS = 4;
export const WRITING_BRIEF_DEFAULT_THREADS = 4;
export const WRITING_BRIEF_DEFAULT_FORESHADOWINGS = 5;
export const WRITING_BRIEF_DEFAULT_BEATS = 3;

/** 相关性打分的启发式权重与状态加成。 */
export const WRITING_BRIEF_NAME_HIT_SCORE = 24;
export const WRITING_BRIEF_ACTIVE_THREAD_BONUS = 3;
export const WRITING_BRIEF_SUSPENDED_THREAD_BONUS = 1;
export const WRITING_BRIEF_EXPLICIT_CLUE_BONUS = 2;

/** 条目内字段截取长度：长摘要多留一点，定位性内容点到即止。 */
export const WRITING_BRIEF_CLIP_LONG_CHARS = 110;
export const WRITING_BRIEF_CLIP_MEDIUM_CHARS = 90;
export const WRITING_BRIEF_CLIP_SHORT_CHARS = 60;
/** 情节线「未解问题」最多展示几条。 */
export const WRITING_BRIEF_UNRESOLVED_LIMIT = 2;
/** 人物别名最多展示几个。 */
export const WRITING_BRIEF_ALIAS_LIMIT = 3;

// ── 节奏与句法闸门 ─────────────────────────────────────────────
/** 句子长度分档（汉字数）：短句 / 长句 / 超长句的统计口径，三处共用。 */
export const RHYTHM_SHORT_SENTENCE_CHARS = 10;
export const RHYTHM_LONG_SENTENCE_CHARS = 31;
export const RHYTHM_VERY_LONG_SENTENCE_CHARS = 60;

/** 加权节奏偏差超过该值才触发修订，不为几个百分点反复改稿。 */
export const RHYTHM_REPAIR_THRESHOLD = 0.12;

/** 修订时把短句合并成的目标长句区间（字）。 */
export const RHYTHM_REPAIR_LONG_MIN_CHARS = 31;
export const RHYTHM_REPAIR_LONG_MAX_CHARS = 55;

/** 修订后总字数允许的变化幅度。 */
export const RHYTHM_WORD_COUNT_TOLERANCE = 0.1;

// ── 连通性自检 ─────────────────────────────────────────────────
/** 自检输出里正文预览的最大字符数。 */
export const PROBE_TEXT_PREVIEW_CHARS = 40;

/** 最小连通请求耗时超过该值就提示长文任务会明显偏慢。 */
export const PROBE_SLOW_REQUEST_THRESHOLD_MS = 30_000;

// ── Agent 调用心跳 ─────────────────────────────────────────────
/** 调用超过该时长才打印心跳，避免短调用刷屏。 */
export const HEARTBEAT_AFTER_MS = 60_000;

/** 心跳打印间隔：够看清进度，又不会淹没真正的错误输出。 */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/** 回归盲写时给写作模型的前文上限。再多会挤占输出窗口。 */
export const REGRESSION_CONTEXT_TAIL_CHARS = 4_000;

// ── 检索查询拼装 ────────────────────────────────────────────────
/** 全书分析定向查询最多带入几位状态人物。比写作查询略宽，分析不进正文。 */
export const STORY_ANALYSIS_QUERY_CHARACTERS = 16;

// ── Workbench 本地服务 ─────────────────────────────────────────
/** 默认监听端口。选 4173 避开 Vite 5173 与常见开发端口。 */
export const WORKBENCH_DEFAULT_PORT = 4173;

/** 端口合法性边界，即 16 位无符号整数的上限。 */
export const WORKBENCH_MAX_PORT = 65_535;

// ── 日志与诊断截断 ─────────────────────────────────────────────
/** 失败日志里单条错误信息最多保留的字符数，只用于定住问题，排版不失控。 */
export const LOG_ERROR_PREVIEW_CHARS = 400;

/** 错误汇总里最多列出几个已失败批次，其余用省略号概括。 */
export const LOG_FAILURE_REPORT_LIMIT = 5;

/** 事件去重关键串里摘要的最大字符数：够区分同一章内不同的连续事件即可。 */
export const BEAT_DEDUPE_KEY_CHARS = 40;

// ── 人物画像 CLI 与回归前文 ─────────────────────────────────────
/** analyze-profiles 默认处理的相关人物数。全书合并时通常低于此数。 */
export const PROFILE_DEFAULT_TOP = 24;

/** regress 默认给盲写模型的前文行数与合法区间。 */
export const DEFAULT_CONTEXT_LINES = 90;
export const MIN_CONTEXT_LINES = 10;
export const MAX_CONTEXT_LINES = 400;

// ── 长章节逐场写作 ─────────────────────────────────────────────
/** 已累积前文作为「本场前情」注入时的字符上限。 */
export const ACCUMULATED_CONTEXT_TAIL_CHARS = 7_200;

/** 单场局势输入的字符预算。逐场都要重新拼，必须比整章预算紧。 */
export const SCENE_SITUATION_BUDGET_CHARS = 2_600;

// ── 分析参考检索（story-analysis-context）的相关性打分 ───────────
/** 分析条目的整名命中权重与别名命中权重。整名命中说明本章大体上在写它。 */
export const CONTEXT_NAME_HIT_SCORE = 24;
export const CONTEXT_ALIAS_HIT_SCORE = 16;

// ── 终审证据定位与展示截断 ─────────────────────────────────────
/** 终审证据去掉省略号后，用它前缀做模糊定位的最短片段。 */
export const EVIDENCE_PROBE_PREFIX_CHARS = 8;

/** 校验报告里最多列出几个越界行号，其余省略。 */
export const INVALID_REF_REPORT_LIMIT = 5;

/** 人物画像提示里最多展示几个别名，超出不加。 */
export const PROFILE_PROMPT_ALIAS_LIMIT = 6;

// ── 知识库默认查询条数（database 层）─────────────────────────────
/** 逐批人物观察默认返回条数。观察量大，调用方通常显式传 --top。 */
export const OBSERVATIONS_DEFAULT_LIMIT = 30;

/** 章级事件默认返回条数：导出与常规检查都够用。 */
export const BEATS_DEFAULT_LIMIT = 200;

// ── SQLite 并发忙等 ────────────────────────────────────────────
/** 写锁冲突时单次让出的毫秒数与最大重试次数。分析分片并发写库时兜底。 */
export const SQLITE_BUSY_WAIT_MS = 250;
export const SQLITE_BUSY_RETRY_ATTEMPTS = 40;

// ── 目录对齐（chapter catalog 匹配） ────────────────────────────
/** 目录按行顺序匹配时允许跳过的条目数。跳太远通常意味着标题对错了章。 */
export const CATALOG_SCAN_WINDOW = 40;
