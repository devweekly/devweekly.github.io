# Dev Weekly - 技术博客系统

## 项目简介

这是一个基于 **Astro 5** 构建的现代化技术博客系统，用于发布编程技术周报。

- **网站**: https://devweekly.github.io
- **作者**: SW
- **主题**: 编程、架构设计、AI/LLM、Web开发、产品思维

## 核心架构

### Islands 架构
- 大部分内容生成静态 HTML
- 交互组件（搜索、卡片）使用 React + TypeScript
- 按需加载 JavaScript，优化性能

### 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | Astro 5.16.2, React 19 |
| 语言 | TypeScript 5.5.4 |
| 样式 | Tailwind CSS 3.4.7 |
| 搜索 | Fuse.js (客户端模糊搜索) |
| 图表 | Mermaid |
| 构建 | Vite |

## 项目结构

```
src/
├── components/          # 组件（.astro 和 .tsx）
│   ├── Search.tsx      # 搜索组件（React + Fuse.js）
│   ├── Card.tsx        # 文章卡片
│   └── ...
├── layouts/            # 布局模板
├── pages/              # 页面路由
│   ├── index.astro     # 首页
│   ├── posts/          # 文章列表和详情
│   ├── tags/           # 标签页
│   └── ...
├── content/blog/       # 博客文章（Markdown）
└── utils/              # 工具函数
```

## 内容管理

### 文章格式

文章存储在 `src/content/blog/`，使用 Markdown 格式，带 YAML frontmatter：

```yaml
---
title: "文章标题"
description: "文章描述"
pubDatetime: 2024-01-31T10:00:00Z
tags: ["web", "typescript"]
draft: false          # 草稿不会被发布
featured: true        # 精选文章
---
```

### 内容 Schema

在 `src/content/config.ts` 中定义，使用 Zod 验证。

## 关键功能

### 1. 搜索
- 客户端实现，使用 Fuse.js
- 搜索标题和描述
- URL 参数同步 `?q=`

### 2. OG 图片
- 自动生成 OpenGraph 图片
- 使用 Satori + @resvg/resvg-js
- 每篇文章有专属 OG 图片

### 3. RSS Feed
- 自动生成 `/rss.xml`
- 包含最近发布的文章

### 4. 标签系统
- 多标签支持
- 标签页面自动生成
- `/tags/[tag]` 路由

## 开发命令

```bash
# 安装依赖
pnpm install

# 开发服务器
pnpm dev

# 构建
pnpm build

# 预览
pnpm preview

# 格式化
pnpm format
```

## 配置

### 站点配置 (`src/config.ts`)

```typescript
SITE: {
  website: "https://devweekly.github.io"
  author: "SW"
  title: "Dev Weekly - SW编程技术周报"
  postPerPage: 5
  scheduledPostMargin: 15min  // 定时发布容差
}
```

### Tailwind 配置

在 `tailwind.config.cjs` 中定义主题、颜色、字体等。

## 添加新文章

1. 在 `src/content/blog/` 创建 `.md` 文件
2. 添加 frontmatter（标题、描述、日期、标签）
3. 写文章正文（Markdown）
4. 文章自动出现在列表中

## 注意事项

- 文章 `pubDatetime` 支持未来时间（15分钟容差）
- `draft: true` 的文章不会发布
- OG 图片建议尺寸 ≥1200x630
- 使用 `pnpm` 作为包管理器
- 提交前会自动运行 lint-staged 格式化代码

## 性能优化

- 静态站点生成（SSG）
- Islands 架构（最小 JS 传输）
- 视图过渡动画
- 图片懒加载
- Jampack 构建后优化

## SEO

- 自动 sitemap 生成
- OpenGraph 图片
- robots.txt
- RSS feed
- 结构化数据
