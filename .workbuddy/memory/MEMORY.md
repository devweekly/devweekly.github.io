# 项目长期记忆 — devweekly.github.io

Astro (AstroPaper) 技术博客，域名语义为「Dev Weekly」。

## 博客 post 约定

- 位置：`src/content/blog/`
- 内容 schema：`src/content.config.ts`（`pubDatetime` / `title` / `description` 必填；`tags` 默认 `["others"]`）
- 命名：周报按 `YYYYMMMD.md`（如 `2026Aug31.md`）；主题长文用 slug（如 `ai-courses.md`）
- frontmatter 固定：`author: W` / `featured: false` / `draft: false` / `description: Dev weekly`（周报）

### 两类 post 的结构

| 类型 | 结构 |
|---|---|
| 周报（weekly） | `### AI and Programming` + `### Others` 两个区块，正文条目为 `[标题](url)`，可后接简短中文说明；区块内保留 `[]()` 占位行（约 20 行/区块） |
| 主题长文 | 自由长文，分 `## N. 主题` 章节，夹叙夹议 + 真实链接；tag 用主题词（如 `ai` / `agent` / `interview`）而非 `weekly` |

### 周报填充规则（用户明确要求）

**周报只建空白骨架，不要填充内容。** 用户明确表示「去掉填充的假内容！我自己会填！」。
创建周报时只写 frontmatter + 两区块的 `[]()` 占位行，不搜网络、不编造条目。

主题长文（有明确题目时）才允许用网络搜索填充真实内容。

## 发布机制注意

Astro 是静态站，`pubDatetime` 仅是元数据，不做定时发布。真正上线由构建/部署流水线控制；
若 CI 按 push 触发，推上去即发布。需要「周几才出现」必须在部署侧加发布窗口控制。
