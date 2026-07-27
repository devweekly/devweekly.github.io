# Evidence Brief — openai-agents

## Repository Identity

OpenAI Agents SDK is a lightweight framework for building agentic applications.

## Archetype Hints

```json
{
  "archetype": "AI Agent",
  "signals": {
    "hasAgent": true,
    "hasLLM": true,
    "hasTool": true,
    "hasPrompt": true,
    "hasParser": false,
    "hasCodegen": false,
    "hasSQL": false,
    "hasDB": false,
    "hasPlugin": false
  }
}
```

## Key Evidence

### Architecture

- Source: `src/agents/agent.py` — Agent class with lifecycle methods.
- Source: `src/agents/run.py` — Runner orchestrates execution.
- Source: `src/agents/tool.py` — Tool definitions and execution.
- Source: `src/agents/_run_context.py` — Context propagation.
- Test: `tests/test_agent.py` — verifies agent execution loop.

### Design Decisions

- Decision: Runner-centric execution model. The Runner owns the loop, not the Agent.
- Evidence: `src/agents/run.py:L120` main loop, `tests/test_run.py`.

### Tradeoffs

- Runner-centric simplifies single-agent execution but may complicate multi-agent choreography.

## Summary

This is an AI Agent framework. Questions should focus on agent lifecycle, runner, tools, context, and planning.
