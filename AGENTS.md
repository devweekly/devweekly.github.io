# AGENTS.md - Dev Weekly Development Guide

> **CRITICAL INSTRUCTION**: This document is designed to be self-maintaining. When making changes to the project, you MUST consider whether AGENTS.md needs updating. If you detect changes to `package.json`, `tsconfig.json`, directory structure, or any other configuration mentioned in this document, invoke `@agents-maintainer` to update the relevant sections. Always check the Maintenance Log at the end of this file before and after making updates.

## Quick Commands Reference

**Package Manager**: `pnpm` (v10.24.0 required)

```bash
# Development
pnpm dev              # Start dev server (http://localhost:4321)
pnpm build            # Build for production (outputs to dist/)
pnpm preview          # Preview production build locally
pnpm sync             # Sync Astro content collections

# Code Quality
pnpm lint             # Run ESLint on all files
pnpm format           # Format all files with Prettier
pnpm format:check     # Check formatting without modifying files

# Git workflow (Husky + lint-staged configured)
git add .
pnpm cz               # Commitizen for conventional commits
```

**Note**: This project has no test framework configured. Add Vitest or Playwright if testing is needed.

---

## Code Style Guidelines

### TypeScript Configuration
- **Strict mode enabled** (extends `astro/tsconfigs/strict`)
- **Path aliases** (configured in `tsconfig.json`):
  - `@components/*` → `src/components/*`
  - `@utils/*` → `src/utils/*`
  - `@layouts/*` → `src/layouts/*`
  - `@config` → `src/config.ts`
  - `@assets/*` → `src/assets/*`

### Import Order Convention
1. External libraries (`react`, `astro:content`)
2. Type imports (`import type { ... }`)
3. Internal aliases (`@components/*`, `@utils/*`)
4. Relative imports (for same-directory files only)

### Formatting (Prettier)
```json
{
  "semi": true,
  "tabWidth": 2,
  "printWidth": 80,
  "singleQuote": false,
  "trailingComma": "es5",
  "arrowParens": "avoid"
}
```

### ESLint Rules
- Extends: `eslint:recommended`, `plugin:astro/recommended`
- TypeScript parser for `.ts/.tsx` files
- Astro parser for `.astro` files

### Naming Conventions
- **Components**: PascalCase (`Card.tsx`, `Header.astro`)
- **Utilities**: camelCase (`getSortedPosts.ts`, `slugify.ts`)
- **Types/Interfaces**: PascalCase with descriptive names
- **Constants**: UPPER_SNAKE_CASE for true constants
- **Props interfaces**: Named `Props` (exported from component file)

### Component Patterns

**React Components (.tsx)**:
```typescript
import type { CollectionEntry } from "astro:content";

export interface Props {
  href?: string;
  frontmatter: CollectionEntry<"blog">["data"];
  secHeading?: boolean;
}

export default function Card({ href, frontmatter, secHeading = true }: Props) {
  // Component logic
}
```

**Astro Components (.astro)**:
```astro
---
import { SITE } from "@config";

export interface Props {
  activeNav?: "posts" | "tags" | "about" | "note" | "search";
}

const { activeNav } = Astro.props;
---

<!-- Template -->

<style>
  /* Scoped styles with @apply directive */
  .nav-container {
    @apply mx-auto flex max-w-3xl flex-col items-center;
  }
</style>
```

### Error Handling
- Use early returns for guard clauses
- Prefer explicit error handling over try-catch where possible
- For Astro content collections, always handle undefined cases gracefully

### Styling Conventions
- **Tailwind CSS** for all styling
- Use `@apply` in `<style>` blocks for complex reusable classes
- Custom CSS properties for theming (`--skin-*` variables)
- Dark mode supported via `class="dark"` on html element

---

## Project Architecture

### Tech Stack
- **Framework**: Astro 5.17.1 (Static Site Generation)
- **UI Components**: React 19 (islands architecture)
- **Language**: TypeScript 5.5.4 (strict mode)
- **Styling**: Tailwind CSS 3.4.7
- **Content**: Markdown with YAML frontmatter

### Project Structure
```
src/
├── components/           # UI components (.astro/.tsx)
│   ├── Card.tsx         # React: Article cards
│   ├── Search.tsx       # React: Fuse.js search
│   ├── Header.astro     # Astro: Navigation
│   └── Footer.astro     # Astro: Site footer
├── layouts/             # Page layouts
│   ├── Layout.astro     # Base layout (HTML, meta)
│   ├── Posts.astro      # Article list layout
│   └── PostDetails.astro # Article detail layout
├── pages/               # File-based routing
│   ├── index.astro      # Homepage
│   ├── posts/           # Article routes
│   ├── tags/            # Tag pages
│   └── rss.xml.ts       # RSS feed endpoint
├── content/blog/        # Markdown articles
├── utils/               # Helper functions
└── config.ts            # Site configuration
```

### Content Schema (Zod-validated)
```yaml
---
author: string           # Default: SITE.author
pubDatetime: date        # Required: Publish date
modDatetime: date        # Optional: Modified date
title: string           # Required
featured: boolean       # Optional: Highlight post
draft: boolean          # Optional: Exclude from build
tags: string[]          # Default: ["others"]
description: string     # Required: Summary
ogImage: string         # Optional: ≥1200x630
---
```

### Key Utilities
- `getSortedPosts()` - Filter and sort articles by date
- `postFilter()` - Exclude drafts and future posts
- `getUniqueTags()` - Extract all tags from posts
- `slugify()` - Generate URL-friendly slugs

### Build Pipeline
1. Astro SSG generates static HTML
2. Jampack optimizes images and assets
3. Output to `dist/` directory
4. Deployed to GitHub Pages via GitHub Actions

### Pre-commit Hooks
Husky + lint-staged automatically runs:
```bash
prettier --write --plugin=prettier-plugin-astro
```

On files: `*.{js,jsx,ts,tsx,md,mdx,json,astro}`

---

## Common Tasks

### Adding a New Component
1. Create file in `src/components/`
2. Use appropriate extension (`.astro` for static, `.tsx` for interactive)
3. Export interface `Props` for type safety
4. Import via alias: `import Component from "@components/Component"`

### Adding a New Article
1. Create `.md` file in `src/content/blog/`
2. Use naming: `YYYYMonDD.md` (e.g., `2025Dec15.md`)
3. Add required frontmatter
4. Run `pnpm sync` to update types

### Adding a New Page
1. Create `.astro` or `.md` file in `src/pages/`
2. Use appropriate layout from `src/layouts/`
3. Route auto-generated from file path

### Debugging Build Issues
```bash
pnpm astro check      # TypeScript type checking
pnpm lint             # ESLint errors
pnpm format:check     # Formatting issues
```

---

## External Resources

- **Astro Docs**: https://docs.astro.build
- **Tailwind Docs**: https://tailwindcss.com/docs
- **Site URL**: https://devweekly.github.io

---

## Self-Maintenance

This document is designed to be self-maintaining through automated agents.

### How to Update This Document

When project changes occur, invoke the documentation maintainer agent:

```
@agents-maintainer analyze recent changes and update AGENTS.md accordingly
```

### Auto-Update Triggers

The following changes should prompt an AGENTS.md update:

| Change Type | Affected Sections |
|------------|-------------------|
| `package.json` modified | Quick Commands, Tech Stack |
| `tsconfig.json` modified | TypeScript Configuration |
| New npm scripts added | Quick Commands |
| New dependencies added | Tech Stack |
| Directory structure changed | Project Structure |
| New conventions established | Code Style Guidelines |
| Build pipeline modified | Build Pipeline |
| External resources changed | External Resources |

### Update Guidelines

When updating AGENTS.md:

1. **Analyze** - Read relevant config files (`package.json`, `tsconfig.json`, etc.)
2. **Identify** - Find which sections need updates
3. **Preserve** - Maintain existing formatting and structure
4. **Document** - Add entry to Maintenance Log with date
5. **Verify** - Ensure changes are accurate and complete

### Maintenance Log

| Date | Change | Updated By |
|------|--------|------------|
| 2026-02-08 | Added Self-Maintenance section | @agents-maintainer |
