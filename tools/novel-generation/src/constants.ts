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
