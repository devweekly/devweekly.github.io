# Claude 助手指南

## 常用命令

- **启动开发服务器**: `pnpm dev` (运行在 http://localhost:4321)
- **构建生产版本**: `pnpm build` (输出到 `dist/` 目录)
- **预览生产构建**: `pnpm preview`
- **同步内容集合**: `pnpm sync`
- **代码格式化**: `pnpm format` (使用 Prettier)
- **代码检查**: `pnpm lint` (使用 ESLint)
- **Git 提交**: `pnpm cz` (使用 Commitizen)

## 技术栈

- **框架**: Astro 5.17.2
- **UI 库**: React 19 (Islands 架构)
- **语言**: TypeScript 5.9.3 (严格模式)
- **样式**: Tailwind CSS 3.4.19
- **内容管理**: Markdown + YAML Frontmatter

## 项目结构

- `src/components/`: UI 组件 (.astro/.tsx)
- `src/layouts/`: 页面布局
- `src/pages/`: 页面路由 (文件系统路由)
- `src/content/`: 内容集合 (博客文章等)
- `src/utils/`: 工具函数
- `src/config.ts`: 站点配置

## 代码风格与规范

### TypeScript
- 启用严格模式 (`strict: true`)
- 使用路径别名 (如 `@components/*`, `@utils/*`)
- 优先使用接口 (`interface`) 定义 Props

### 命名规范
- **组件**: PascalCase (如 `Card.tsx`, `Header.astro`)
- **工具函数**: camelCase (如 `getSortedPosts.ts`)
- **常量**: UPPER_SNAKE_CASE
- **类型/接口**: PascalCase

### 样式规范
- 使用 **Tailwind CSS** 进行样式开发
- 复杂样式在 `<style>` 块中使用 `@apply`
- 支持暗黑模式 (`class="dark"`)

### 错误处理
- 使用卫语句 (Guard Clauses) 提前返回
- 优先显式处理错误
