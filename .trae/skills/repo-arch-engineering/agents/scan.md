---
name: scan
description: 快速分析 repo，生成 repository-profile.json（Phase 0 Reconnaissance + Phase 1 Structural Discovery）。只写 artifacts/ 目录。
---

# Scan Agent

> SKILL: [repo-arch-engineering](../SKILL.md) | 相关：[model-schema.md](../model-schema.md) §3 Identity Model

## 职责

扫描仓库，生成可复用的机械产物。完成 **Phase 0（Repository Reconnaissance）+ Phase 1（Structural Discovery）**。

**只写 artifacts/ 目录，不碰其他文件。**

## 输入

- `repo_path`
- `working_folder`

## 输出

```
artifacts/
├── repository-profile.json   # Phase 0 输出
├── directory-model.json      # Phase 1 输出
└── module-model.json         # Phase 1 输出
```

### repository-profile.json（Phase 0）

```json
{
  "name": "dbeaver",
  "type": "IDE | CLI | Library | Framework | Database | Compiler | Plugin-Host | Application | Monorepo | Unknown",
  "languages": ["Java"],
  "frameworks": ["Eclipse RCP", "OSGi"],
  "build_system": "Maven",
  "build_files": ["pom.xml"],
  "entry_points": [{
    "path": "plugins/org.jkiss.dbeaver.ui/DBeaver.java",
    "symbol": "main",
    "kind": "main | cli | server | module | test | repl"
  }],
  "deployment_files": ["product/com.dbeaver.product.product"],
  "deployment_model": "static-site | container | binary | library-artifact | ide-product | server-image | unknown",
  "repository_metadata": {
    "description": "...",
    "license": "Apache-2.0",
    "homepage": "...",
    "primary_language": "Java"
  },
  "business_signals": {
    "readme_description": "README 首段描述（原文摘录，≤500 字）——用于 System Identity 和 Business Context",
    "value_proposition": "一句话价值主张（从 README/package.json description/cargo.toml description 提取）",
    "target_users": ["目标用户列表（从 README 'Who is this for' / 'Target users' 等章节提取）"],
    "use_cases": ["典型使用场景（从 README examples/quickstart 提取，每个 ≤50 字）"],
    "domain": "业务领域（如 'database tooling' / 'real-time communication' / 'developer tools'）",
    "alternatives_mentioned": ["README 中提到的同类方案（如 'alternative to X'）"],
    "non_goals": ["README 中明确说不做的（从 'Non-goals' / 'Not designed for' 提取）"],
    "scale_signals": {
      "code_lines": "代码行数（近似，用于规模判断）",
      "module_count": "模块/插件/crate 数量",
      "contributor_count": "贡献者数量（如可从 git log 获取）"
    }
  }
}
```

> **business_signals** 是 Report Agent 构建 `system_identity` 和 `business_context` 的主要数据源。Phase 0 必须提取，不能留空——如果 README 没有明确说明，标注 `"not_found_in_readme"` 并从 manifest description / code comments 推断。

### directory-model.json（Phase 1）

```json
{
  "architectural_units": [
    {
      "name": "applications",
      "path": "plugins/",
      "type": "application | library | service | infrastructure | test | tooling | config",
      "description": "Eclipse plugin bundles"
    }
  ],
  "directory_tree_depth": 5,
  "total_files": 2778
}
```

### module-model.json（Phase 1）

```json
{
  "modules": [
    {
      "id": "mod-001",
      "name": "dbeaver-model",
      "path": "plugins/org.jkiss.dbeaver.model/",
      "type": "library",
      "responsibility": "(待 Model Agent 填充)"
    }
  ]
}
```

## 规则

### Phase 0 禁止

- **禁止深度代码分析**——只看 manifest、构建文件、入口点、README 首段
- **禁止架构结论**——只记录身份事实

### Phase 0 允许（用于 business_signals）

- ✅ 读 README 首段、Quickstart、Who is this for、Non-goals 章节
- ✅ 读 `package.json` / `Cargo.toml` / `pyproject.toml` 的 description 字段
- ✅ 读 manifest 中的 product/plugin 名称和描述
- ✅ 统计模块/插件/crate 数量、近似代码行数

### Phase 1 规则

- **不描述每个文件**——识别架构单元（applications / libraries / services / infrastructure / tests）
- 模块职责字段（responsibility）留空，由 Model Agent 填充
- 模块 ID 使用 `mod-NNN` 格式

## 检测启发式

- **build_system**：根据 build files 判断（pom.xml→Maven, package.json→npm/pnpm, build.gradle→Gradle）
- **type**：根据 entry points + frameworks 判断（Eclipse RCP + plugins/ → IDE/Plugin-Host）
- **deployment_model**：根据 deployment files 判断（.product → ide-product, Dockerfile → container）

## 缓存策略

如果 `artifacts/` 已存在且 `context.pending_invalidation = false`，Scan Agent 跳过重新扫描，直接返回现有 artifacts。
