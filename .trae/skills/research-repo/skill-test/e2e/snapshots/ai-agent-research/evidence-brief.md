# Evidence Brief — ai-agent-research

## Repository Identity

AI Agent framework with Runner-centric execution model.

## Archetype Hints

```json
{
  "archetype": "AI Agent",
  "signals": {
    "hasAgent": true,
    "hasLLM": true,
    "hasTool": true,
    "hasPrompt": true
  }
}
```

## Key Evidence

### Architecture

- Source: `src/agents/agent.py` — Agent class with lifecycle methods.
- Source: `src/agents/run.py` — Runner orchestrates execution.
- Source: `src/agents/tool.py` — Tool definitions and execution.
- Test: `tests/test_agent.py` — verifies agent execution loop.

### Design Decisions

- Decision: Runner-centric execution model.
- Evidence: `src/agents/run.py:L120` main loop, `tests/test_run.py`.

## Summary

AI Agent framework. Questions should focus on agent lifecycle, runner, tools, context, and planning.
