# Evidence Brief — openai-agents (Mutated)

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
- Source: `src/agents/tool.py` — Tool definitions and execution.
- Source: `src/agents/_run_context.py` — Context propagation.
- Test: `tests/test_agent.py` — verifies agent execution loop.

> ⚠️ The `src/agents/run.py` Runner evidence has been intentionally removed for mutation testing.

### Design Decisions

- No verified Runner-centric decision evidence available.

### Tradeoffs

- No verified tradeoff evidence available after removing Runner evidence.

## Summary

OpenAI Agents SDK is an AI Agent framework, but the Runner evidence has been removed. A correct Skill must not claim Runner-centric model as verified.
