# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

This is a weekly technical blog built with Astro (v5+), featuring bilingual content (English/Chinese) focused on programming, architecture, AI/LLM, web development, and product design. The site is deployed to GitHub Pages and uses content collections for blog post management.

## Common Commands

### Development
- `pnpm dev` or `pnpm start` - Start development server
- `pnpm build` - Build for production (includes jampack optimization)
- `pnpm preview` - Preview production build locally
- `pnpm sync` - Sync Astro content collections

### Code Quality
- `pnpm lint` - Run ESLint
- `pnpm format` - Format code with Prettier
- `pnpm format:check` - Check code formatting without modifying

### Committing
- `pnpm cz` - Use Commitizen for conventional commits
- Pre-commit hook automatically runs `lint-staged` to format staged files

## Project Architecture

### Content Management System
The project uses Astro's Content Collections for type-safe content management:

- **Blog Schema** (`src/content/config.ts`): Defines frontmatter structure
  - Required: `title`, `description`, `pubDatetime`, `author`
  - Optional: `modDatetime`, `draft`, `featured`, `tags`, `ogImage`, `canonicalURL`
  - Posts are markdown files in `src/content/blog/`
  - Scheduled posts with `scheduledPostMargin` (15 minutes) in config

- **Post Filtering Logic** (`src/utils/postFilter.ts`): 
  - Filters out drafts in production
  - Respects scheduled post timing with margin
  - In dev mode, all posts are visible

- **Post Sorting** (`src/utils/getSortedPosts.ts`):
  - Sorts by `modDatetime` if present, otherwise `pubDatetime`
  - Newest posts first

### Routing Structure
Astro uses file-based routing with dynamic routes:

- `/` - Homepage with recent posts
- `/posts/` - All posts listing with pagination
- `/posts/[slug]/` - Individual post or paginated posts list
- `/tags/` - All tags listing
- `/tags/[tag]/[page]` - Posts filtered by tag with pagination
- `/search` - Client-side search powered by Fuse.js
- `/about` and `/note` - Static markdown pages

### Path Aliases
TypeScript path aliases configured in `tsconfig.json`:
- `@config` → `src/config.ts`
- `@assets/*` → `src/assets/*`
- `@components/*` → `src/components/*`
- `@content/*` → `src/content/*`
- `@layouts/*` → `src/layouts/*`
- `@pages/*` → `src/pages/*`
- `@styles/*` → `src/styles/*`
- `@utils/*` → `src/utils/*`

Always use these aliases in imports rather than relative paths.

### Component Architecture

**Layouts**:
- `Layout.astro` - Base layout with SEO meta tags, analytics (Google Analytics, Clarity)
- `Main.astro` - Main content wrapper
- `PostDetails.astro` - Individual blog post layout with sharing, breadcrumbs
- `Posts.astro` - Post listing with pagination
- Other specialized layouts: `AboutLayout`, `NoteLayout`, `TagPosts`

**Components**:
- React components (`.tsx`): `Card`, `Datetime`, `Search` (using Fuse.js)
- Astro components (`.astro`): `Header`, `Footer`, `Breadcrumbs`, `Pagination`, `Socials`, `Tag`

### Utility Functions
Key utilities in `src/utils/`:
- `getSortedPosts.ts` - Filter and sort posts by date
- `postFilter.ts` - Filter draft/scheduled posts
- `getPostsByTag.ts` - Filter posts by tag
- `getUniqueTags.ts` - Extract unique tags from posts
- `getPagination.ts` - Calculate pagination for post lists
- `generateOgImages.tsx` - Generate Open Graph images using Satori
- `slugify.ts` - URL-safe slug generation

### Styling
- **TailwindCSS** with custom configuration (`tailwind.config.cjs`)
- **Typography plugin** for prose styling
- **Theme system**: Light/dark mode support via `toggle-theme.js`
- Base styles in `src/styles/base.css`

### Markdown Processing
Remark plugins configured in `astro.config.ts`:
- `remark-toc` - Generate table of contents
- `remark-collapse` - Collapsible sections
- `astro-mermaid` - Mermaid diagram support with iconoir/logos icon packs
- Syntax highlighting: Shiki with "one-dark-pro" theme

### Integrations
- `@astrojs/react` - React component support
- `@astrojs/tailwind` - TailwindCSS
- `@astrojs/sitemap` - Automatic sitemap generation
- `astro-mermaid` - Diagram rendering

### Configuration
Central configuration in `src/config.ts`:
- `SITE` - Website metadata (title, author, description, URL)
- `LOCALE` - Language settings
- `SOCIALS` - Social media links

### Build & Deployment
- **Build process**: `astro build` followed by `jampack` optimization
- **Deployment**: GitHub Actions workflow (`.github/workflows/astro.yml`)
  - Triggers on push to `main`, daily at midnight (cron), or manual dispatch
  - Uses `withastro/action@v2` for build
  - Deploys to GitHub Pages
- **Package Manager**: pnpm (v10.24.0)

### Adding New Blog Posts
1. Create a new `.md` file in `src/content/blog/`
2. Add required frontmatter (see schema in `src/content/config.ts`)
3. Write content in Markdown
4. Set `draft: false` when ready to publish
5. Optionally set `featured: true` for homepage feature

### Search Functionality
Client-side search using Fuse.js:
- Searches post titles, descriptions, and content
- Implementation in `src/components/Search.tsx`
- Accessed via `/search` route
