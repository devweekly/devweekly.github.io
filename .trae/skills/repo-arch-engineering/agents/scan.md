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
  }
}
```

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

- **禁止深度代码分析**——只看 manifest、构建文件、入口点
- **禁止架构结论**——只记录身份事实

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
