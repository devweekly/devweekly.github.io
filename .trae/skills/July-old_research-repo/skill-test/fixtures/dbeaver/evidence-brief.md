# Evidence Brief — dbeaver

## Repository Identity

DBeaver is a universal database tool and SQL client built on Eclipse RCP.

## Archetype Hints

```json
{
  "archetype": "Developer Tool",
  "signals": {
    "hasPlugin": true,
    "hasSQL": true,
    "hasDB": true,
    "hasAgent": false,
    "hasLLM": false,
    "hasTool": false,
    "hasPrompt": false,
    "hasParser": true,
    "hasCodegen": false
  }
}
```

## Key Evidence

### Architecture

- Source: `plugins/org.jkiss.dbeaver.ui/plugin.xml` — Eclipse plugin extension points.
- Source: `plugins/org.jkiss.dbeaver.model/src/.../DBPDataSource.java` — Data source abstraction.
- Source: `plugins/org.jkiss.dbeaver.registry/src/.../DriverDescriptor.java` — JDBC driver registry.
- Test: `tests/org.jkiss.dbeaver.test/...` — model tests.

### Design Decisions

- Decision: Eclipse plugin architecture enables extensible database support.
- Evidence: `plugin.xml` extension points, driver registry.

### Tradeoffs

- Eclipse RCP provides rich UI framework but adds heavy dependency and startup cost.

## Summary

DBeaver is a developer tool / database IDE. It should NOT be studied as an AI Agent or LLM project.
