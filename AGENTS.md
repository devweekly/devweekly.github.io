# AGENTS.md - Dev Weekly 技术周报系统架构说明

## 项目概述

**Dev Weekly** 是一个基于 Astro 5 构建的现代化技术博客系统，专门用于发布编程技术周报。项目采用 Islands 架构，实现了高性能的静态站点生成与按需交互的完美平衡。

- **网站地址**: https://devweekly.github.io
- **作者**: SW
- **主题**: 编程、架构设计、AI/LLM、Web、产品思维、设计

## 技术栈

### 核心框架
- **Astro 5.16.2** - 静态站点生成器，支持 Islands 架构
- **React 19** - 用于交互式组件（搜索、卡片）
- **TypeScript 5.5.4** - 全栈类型安全
- **Tailwind CSS 3.4.7** - 原子化 CSS 框架

### 关键集成
- **@astrojs/react** - React 组件集成
- **@astrojs/sitemap** - 自动站点地图生成
- **@astrojs/rss** - RSS feed 支持
- **astro-mermaid** - Mermaid 图表支持

### 工具库
- **Fuse.js** - 客户端模糊搜索
- **Satori + @resvg/resvg-js** - 动态 OG 图片生成
- **remark-toc** - Markdown 目录自动生成
- **remark-collapse** - 可折叠内容块
- **github-slugger** - URL 友好的 slug 生成

### 开发工具
- **ESLint + Prettier** - 代码规范
- **Husky + lint-staged** - Git 钩子
- **Commitizen** - 规范化提交
- **Jampack** - 构建后优化

## 项目结构

```
devweekly.github.io/
├── src/
│   ├── assets/               # 静态资源（图标等）
│   │   └── socialIcons.ts
│   ├── components/           # 组件库
│   │   ├── Card.tsx          # 文章卡片（React）
│   │   ├── Search.tsx        # 搜索组件（React + Fuse.js）
│   │   ├── Datetime.tsx      # 日期时间显示
│   │   ├── Header.astro      # 导航栏
│   │   ├── Footer.astro      # 页脚
│   │   ├── Pagination.astro  # 分页
│   │   ├── Breadcrumbs.astro # 面包屑导航
│   │   ├── ShareLinks.astro  # 分享链接
│   │   ├── Socials.astro     # 社交媒体图标
│   │   ├── Tag.astro         # 标签
│   │   ├── Hr.astro          # 分隔线
│   │   └── LinkButton.astro  # 链接按钮
│   ├── layouts/              # 布局模板
│   │   ├── Layout.astro      # 基础布局（HTML 结构、meta）
│   │   ├── Main.astro        # 主页布局
│   │   ├── Posts.astro       # 文章列表布局
│   │   ├── PostDetails.astro # 文章详情布局
│   │   ├── TagPosts.astro    # 标签文章列表布局
│   │   ├── AboutLayout.astro # 关于页布局
│   │   └── NoteLayout.astro  # 笔记页布局
│   ├── pages/                # 页面路由
│   │   ├── index.astro       # 首页
│   │   ├── 404.astro         # 404 错误页
│   │   ├── search.astro      # 搜索页
│   │   ├── about.md          # 关于页
│   │   ├── note.md           # 笔记页
│   │   ├── posts/
│   │   │   ├── index.astro   # 文章列表
│   │   │   └── [slug]/
│   │   │       ├── index.astro     # 动态文章详情
│   │   │       └── index.png.ts    # 动态 OG 图片
│   │   ├── tags/
│   │   │   ├── index.astro         # 标签列表
│   │   │   └── [tag]/
│   │   │       ├── index.astro     # 标签文章列表
│   │   │       └── [page].astro    # 标签分页
│   │   ├── og.png.ts         # 全局 OG 图片
│   │   ├── robots.txt.ts     # robots.txt 生成
│   │   └── rss.xml.ts        # RSS feed 生成
│   ├── content/              # 内容集合
│   │   ├── config.ts         # 内容 schema 定义
│   │   └── blog/             # 博客文章（Markdown）
│   │       ├── 2024Jan06.md
│   │       ├── 2024Jan13.md
│   │       └── ...
│   ├── utils/                # 工具函数
│   │   ├── getSortedPosts.ts      # 文章排序与过滤
│   │   ├── getPostsByTag.ts       # 按标签过滤
│   │   ├── getPagination.ts       # 分页计算
│   │   ├── getPageNumbers.ts      # 页码生成
│   │   ├── getUniqueTags.ts       # 标签去重
│   │   ├── generateOgImages.tsx   # OG 图片生成
│   │   ├── postFilter.ts          # 文章过滤逻辑
│   │   ├── slugify.ts             # Slug 生成
│   │   └── og-templates/
│   │       ├── post.tsx           # 文章 OG 模板
│   │       └── site.tsx           # 站点 OG 模板
│   ├── styles/               # 全局样式
│   ├── config.ts             # 站点配置
│   ├── types.ts              # TypeScript 类型定义
│   └── env.d.ts              # 环境类型声明
├── public/                   # 公共静态资源
├── astro.config.ts           # Astro 配置
├── tailwind.config.cjs       # Tailwind 配置
├── tsconfig.json             # TypeScript 配置
└── package.json              # 项目依赖
```

## 核心架构

### 1. Islands 架构

Astro 采用 Islands 架构，实现了最优性能：

- **静态优先**: 大部分内容生成为静态 HTML
- **按需交互**: 仅在需要时加载 JavaScript
- **组件隔离**: 每个交互组件独立加载

**交互式组件**（使用 React）:
- `Search.tsx` - 搜索功能
- `Card.tsx` - 文章卡片（支持视图过渡）
- `Datetime.tsx` - 日期时间显示

**静态组件**（使用 Astro）:
- 所有布局和其他组件

### 2. 内容管理系统

#### 内容 Schema (src/content/config.ts)

```typescript
const blog = defineCollection({
  type: "content",
  schema: {
    author: string        // 作者（默认: SITE.author）
    pubDatetime: date     // 发布时间（必需）
    modDatetime: date     // 修改时间（可选）
    title: string         // 标题（必需）
    featured: boolean     // 是否精选（可选）
    draft: boolean        // 是否草稿（可选）
    tags: array          // 标签（默认: ["others"]）
    ogImage: image/string // OG 图片（可选，≥1200x630）
    description: string   // 描述（必需）
    canonicalURL: string  // 规范 URL（可选）
  }
})
```

#### 内容特性

- **基于文件系统**: 所有文章存储在 `src/content/blog/`
- **Markdown 格式**: 支持 YAML frontmatter + Markdown 正文
- **类型验证**: 使用 Zod schema 进行运行时验证
- **草稿系统**: `draft: true` 的文章不会发布
- **定时发布**: 支持未来日期的文章（15分钟容差）
- **标签分类**: 支持多标签
- **精选文章**: `featured: true` 可高亮显示

### 3. 路由系统

#### 文件系统路由

Astro 自动根据文件结构生成路由：

```
/ ──────────────────────────> index.astro
/posts ─────────────────────> posts/index.astro
/posts/2024Jan06 ───────────> posts/[slug]/index.astro
/tags ──────────────────────> tags/index.astro
/tags/web ──────────────────> tags/[tag]/index.astro
/tags/web/2 ────────────────> tags/[tag]/[page].astro
/search ────────────────────> search.astro
/about ─────────────────────> about.md
/note ──────────────────────> note.md
```

#### 动态路由

- `[slug]` - 文章 slug（从文件名生成）
- `[tag]` - 标签名称
- `[page]` - 分页页码

### 4. 搜索功能

#### 实现方式 (src/components/Search.tsx)

- **客户端搜索**: 使用 Fuse.js 实现模糊搜索
- **搜索范围**: 文章标题和描述
- **URL 同步**: 搜索词存储在 URL 参数 `?q=`
- **实时反馈**: 即时显示搜索结果
- **配置**:
  - 最小搜索字符: 2
  - 模糊匹配阈值: 0.5
  - 搜索键: title, description

### 5. OG 图片生成

#### 技术实现 (src/utils/generateOgImages.tsx)

1. **React 组件** → 使用 Satori 转为 **SVG**
2. **SVG** → 使用 @resvg/resvg-js 转为 **PNG**
3. **动态生成**: 每篇文章自动生成专属 OG 图片

#### 模板

- `og-templates/site.tsx` - 站点默认 OG 图片
- `og-templates/post.tsx` - 文章 OG 图片模板

### 6. RSS Feed

自动生成 RSS feed (`/rss.xml`)，包含：
- 最近发布的文章
- 完整内容或摘要
- 文章元数据

### 7. 主题系统

- **明暗模式**: 支持自动切换
- **代码高亮**: one-dark-pro 主题
- **Mermaid 图表**: forest 主题
- **图标集**: logos + iconoir

## 配置文件

### 站点配置 (src/config.ts)

```typescript
export const SITE = {
  website: "https://devweekly.github.io",
  author: "SW",
  desc: "A weekly technical blog...",
  title: "Dev Weekly - SW编程技术周报",
  ogImage: "astropaper-og.jpg",
  lightAndDarkMode: true,
  postPerPage: 5,                    // 每页显示 5 篇文章
  scheduledPostMargin: 15 * 60 * 1000 // 定时发布容差 15 分钟
}

export const LOCALE = {
  lang: "en",
  langTag: ["en-EN"]
}

export const SOCIALS = [
  {
    name: "Github",
    href: "https://github.com/devweekly/devweekly.github.io",
    active: true
  }
]
```

### Astro 配置 (astro.config.ts)

- **集成**: Tailwind, React, Mermaid, Sitemap
- **Markdown**:
  - remark-toc: 自动目录
  - remark-collapse: 可折叠内容
  - Shiki 代码高亮
- **样式策略**: `scopedStyleStrategy: "where"`

## 工具函数

### 文章处理

| 函数 | 功能 | 路径 |
|------|------|------|
| `getSortedPosts()` | 获取已排序的文章列表（过滤草稿和未来文章） | utils/getSortedPosts.ts |
| `getPostsByTag()` | 根据标签过滤文章 | utils/getPostsByTag.ts |
| `getUniqueTags()` | 获取所有唯一标签 | utils/getUniqueTags.ts |
| `postFilter()` | 文章过滤逻辑 | utils/postFilter.ts |
| `slugify()` | 生成 URL 友好的 slug | utils/slugify.ts |

### 分页

| 函数 | 功能 | 路径 |
|------|------|------|
| `getPagination()` | 计算分页数据 | utils/getPagination.ts |
| `getPageNumbers()` | 生成页码数组 | utils/getPageNumbers.ts |

### 图片生成

| 函数 | 功能 | 路径 |
|------|------|------|
| `generateOgImages()` | 生成 OG 图片 | utils/generateOgImages.tsx |

## 开发工作流

### 本地开发

```bash
# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev

# 类型检查
pnpm astro check

# 代码格式化
pnpm format
```

### 构建部署

```bash
# 构建生产版本
pnpm build

# 预览构建结果
pnpm preview
```

构建流程：
1. Astro 构建静态站点 → `dist/`
2. Jampack 优化（图片压缩、资源优化）

### 代码规范

- **Prettier**: 自动格式化
- **ESLint**: 代码检查
- **lint-staged**: Git 提交前自动格式化
- **Commitizen**: 规范化 commit 消息

## 性能优化

### 构建时优化
- 静态站点生成（SSG）
- 图片优化和压缩
- CSS 和 JS 最小化
- Jampack 后处理优化

### 运行时优化
- Islands 架构（最小 JS 传输）
- 视图过渡动画（View Transitions API）
- 图片懒加载
- 作用域样式（避免全局污染）

### SEO 优化
- 自动 sitemap
- RSS feed
- OpenGraph 图片
- robots.txt
- 结构化数据
- 响应式设计

## 扩展指南

### 添加新文章

1. 在 `src/content/blog/` 创建 Markdown 文件
2. 添加 frontmatter:

```markdown
---
title: "文章标题"
description: "文章描述"
pubDatetime: 2024-01-31T10:00:00Z
tags: ["web", "typescript"]
---

文章正文...
```

3. 文章自动出现在列表中

### 添加新页面

1. 在 `src/pages/` 创建 `.astro` 或 `.md` 文件
2. 选择合适的布局
3. 路由自动生成

### 自定义组件

1. React 组件 → `src/components/*.tsx`
2. Astro 组件 → `src/components/*.astro`
3. 在页面中导入使用

### 修改主题

1. 编辑 `src/config.ts` - 站点配置
2. 编辑 `tailwind.config.cjs` - 样式配置
3. 编辑 `astro.config.ts` - Mermaid 主题等

## 常见问题

### Q: 如何创建草稿？
A: 在文章 frontmatter 中添加 `draft: true`

### Q: 如何定时发布？
A: 设置 `pubDatetime` 为未来时间（15分钟容差）

### Q: 如何自定义 OG 图片？
A: 在 frontmatter 中指定 `ogImage: "path/to/image.jpg"`

### Q: 如何添加新的社交链接？
A: 编辑 `src/config.ts` 中的 `SOCIALS` 数组

### Q: 搜索功能如何工作？
A: 客户端使用 Fuse.js 实时搜索，无需后端

## 依赖管理

- **包管理器**: pnpm 10.24.0
- **Node 版本**: 建议使用 LTS 版本
- **更新依赖**: 定期运行 `pnpm update`

## License

MIT License

## 贡献指南

1. Fork 项目
2. 创建特性分支
3. 提交规范化 commit（使用 Commitizen）
4. 推送到分支
5. 创建 Pull Request

---

**最后更新**: 2026-01-31
**维护者**: SW
**GitHub**: https://github.com/devweekly/devweekly.github.io
