# Pi Agent 指南

本文件为 Pi 编码助手提供项目特定的指令、命令和代码规范。

## 常用命令

- **开发服务器**: `pnpm dev`
- **构建项目**: `pnpm build`
- **预览构建**: `pnpm preview`
- **同步类型**: `pnpm sync`
- **代码格式化**: `pnpm format`
- **代码检查**: `pnpm lint`
- **类型检查**: `pnpm astro check`
- **Git 提交**: `pnpm cz`

## 技术栈

- **框架**: Astro 5.17.2
- **UI 库**: React 19 (Islands 架构)
- **语言**: TypeScript 5.9.3 (严格模式)
- **样式**: Tailwind CSS 3.4.19
- **包管理**: pnpm v10.24.0

## 代码风格与规范

### TypeScript 与 组件
- **严格模式**: 所有代码必须符合 `tsconfig.json` 的严格模式。
- **路径别名**: 优先使用 `@components/*`, `@utils/*`, `@layouts/*` 等别名。
- **命名**: 
  - 组件使用 PascalCase (如 `Header.astro`, `Card.tsx`)。
  - 工具函数使用 camelCase (如 `slugify.ts`)。
  - 接口 Props 统一命名为 `Props` 并导出。

### 样式 (Tailwind CSS)
- 优先使用 Tailwind 类名。
- 在 `.astro` 或 `.tsx` 文件中，如需编写复杂样式，在 `<style>` 块中使用 `@apply`。
- 确保兼容暗黑模式 (`class="dark"`)。

### 内容管理
- 博客文章位于 `src/content/blog/`。
- 文件名建议格式: `YYYYMonDD.md` (例如 `2025Dec15.md`)。
- 必须包含完整的 YAML frontmatter (包含 `title`, `pubDatetime`, `description`)。

## Pi 助手特定指令

1. **自动维护**: 每次修改配置或重大结构时，必须参考 `AGENTS.md` 中的 `Mandatory Self-Maintenance Protocol`。
2. **工具使用**: 
   - 使用 `read` 查看文件内容。
   - 使用 `bash` 执行命令。
   - 使用 `edit` 进行精确修改。
   - 使用 `write` 创建新文件。
3. **验证**: 在完成任务前，运行 `pnpm format:check` 和 `pnpm lint` 确保代码质量。
4. **路径**: 始终使用绝对路径或基于当前工作目录的准确路径。

---
*更多详细规则请参考 `AGENTS.md`。*
