/**
 * 前端展示常量的唯一来源。改动这里的值只影响 UI 呈现，不改变后端数据。
 * 每条都写明取值依据；纯视觉的栅格 span、字号、间距见 style.css，不收进这里。
 */

// ── 自动刷新 ─────────────────────────────────────────────────────
/** 工作台仪表盘轮询间隔。5s 足以反映运行状态，再短只会制造无意义请求。 */
export const DASHBOARD_POLL_INTERVAL_MS = 5_000;

// ── 列表/预览截断 ────────────────────────────────────────────────
/** 仪表盘「最近运行」展示条数，与后端 DASHBOARD_RECENT_RUNS_LIMIT 对齐。 */
export const RECENT_RUNS_DISPLAY_LIMIT = 6;

/** 人物别名标签默认折叠后的展示上限，超出提供「展开全部」。 */
export const ALIAS_PREVIEW_LIMIT = 24;

/** Ant Design Badge 的 overflowCount，人物总数远低于此值时不会显示「9999+」。 */
export const BADGE_OVERFLOW_COUNT = 9_999;

/** shortRole 截取人物定位短语的最大长度，避免标签撑破布局。 */
export const SHORT_ROLE_MAX_LENGTH = 12;

// ── 头像尺寸 ─────────────────────────────────────────────────────
export const AVATAR_SIZE_LIST = 36;
export const AVATAR_SIZE_DETAIL = 56;
