# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Dev Weekly is a technical blog system built with Astro 5 and deployed to GitHub Pages at https://devweekly.github.io. It uses the Islands architecture pattern with static HTML generation and selective React hydration for interactive components.

## Development Commands

```bash
# Development
pnpm dev              # Start development server
pnpm start            # Alias for pnpm dev

# Build & Preview
pnpm build            # Production build (runs astro build + jampack optimization)
pnpm preview          # Preview production build locally

# Code Quality
pnpm lint             # Run ESLint
pnpm format           # Auto-format code with Prettier
pnpm format:check     # Check formatting without making changes

# Git Workflow
pnpm cz               # Commitizen for conventional commits
```

**Note:** This project does not have a test suite configured.

## High-Level Architecture

### Islands Architecture
- Static HTML generation for most content
- Interactive components (Search, Card) use React + TypeScript
- Minimal JavaScript shipped to client (only for interactive islands)

### Content Layer
- Blog posts stored as Markdown files in `src/content/blog/`
- Frontmatter schema validated with Zod (defined in `src/content/config.ts`)
- Content collection API from Astro

### Build Pipeline
1. Astro builds static HTML pages
2. Jampack optimizes the `dist/` folder (images, CSS, JS compression)
3. Sitemap and RSS feed generation
4. OG image generation using Satori

### TypeScript Path Aliases
```typescript
@assets/*      → src/assets/*
@config        → src/config.ts
@components/*  → src/components/*
@content/*     → src/content/*
@layouts/*     → src/layouts/*
@pages/*       → src/pages/*
@styles/*      → src/styles/*
@utils/*       → src/utils/*
```

## Critical Implementation Details

### RSS Feed Rendering in Astro 5

**IMPORTANT:** In Astro 5, content collection entries don't include raw Markdown in `post.body`. To render blog content for RSS feeds, you must use the `render()` function with `experimental_AstroContainer`:

```typescript
// src/pages/rss.xml.ts
import { getCollection, render } from "astro:content";
import rss from "@astrojs/rss";
import sanitizeHtml from "sanitize-html";

export async function GET() {
  const posts = await getCollection("blog");

  const items = await Promise.all(
    posts.map(async post => {
      const { Content } = await render(post);
      const html = await renderContentToHtml(Content);

      return {
        link: `posts/${post.slug}/`,
        title: post.data.title,
        description: post.data.description,
        pubDate: new Date(post.data.pubDatetime),
        content: sanitizeHtml(html),
      };
    })
  );

  return rss({ title, description, site, items });
}

// Use AstroContainer to render component to HTML
async function renderContentToHtml(Component: any): Promise<string> {
  const { experimental_AstroContainer } = await import("astro/container");
  const container = await experimental_AstroContainer.create();
  return await container.renderToString(Component);
}
```

**Common mistake:** Trying to access `post.body` directly will result in RSS feeds with only titles/descriptions but no content.

### Content Publishing Rules

- **Scheduled Posts:** Articles with future `pubDatetime` are published with a 15-minute tolerance (configured in `src/config.ts`)
- **Draft Articles:** Posts with `draft: true` in frontmatter will not be published

### Site Configuration

Main configuration in `src/config.ts`:
```typescript
SITE: {
  website: "https://devweekly.github.io"
  author: "SW"
  title: "Dev Weekly - SW编程技术周报"
  postPerPage: 5
  scheduledPostMargin: 15 * 60 * 1000  // 15 minutes in ms
}
```

## Technology Stack

- **Astro 5.17.1** - Static site generator with Islands architecture
- **React 19** - Interactive UI components
- **TypeScript** - Type-safe development
- **Tailwind CSS 3.4.7** - Utility-first CSS framework
- **Fuse.js** - Client-side fuzzy search
- **Mermaid** - Diagram rendering in markdown
- **Jampack** - Post-build optimization
- **Satori** - Dynamic OG image generation

## Git Workflow

- **Husky** runs pre-commit hooks
- **lint-staged** auto-formats staged files before commit
- **Commitizen** enforces conventional commit messages
- Use `pnpm cz` instead of `git commit` for properly formatted commits

## Self-Maintenance Rule

After any large refactor, architectural change, or multi-file modification:
- Append a short "Lessons Learned" entry below
- Focus on mistakes, constraints, or things to avoid next time
- Keep it concise (under 6 bullet points), also log datetime

---

## Lessons Learned

<!-- Future entries go here -->
