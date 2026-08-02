# Research Report — ai-agent-research

## Executive Summary

AI Agent framework with Runner-centric execution model. The key insight is that the Runner owns the execution loop while the Agent declares capabilities. Key architectural decisions include: Runner-centric orchestration, explicit Tool abstraction, and deferred Context propagation verification.

## Top Claims

### Claim 1: Runner owns the main execution loop

**Why it holds**:
- Evidence: `src/agents/run.py:L120`
- Coverage: Code + Test
- Quality: Verified

**Why it might be wrong**:
- Alternative explanation: Agent may contain autonomous execution logic.
- Missing evidence: complete call chain from Agent to Runner.

**Why it matters**:
Understanding the separation prevents incorrect extension of the framework.

### Claim 2: Tool execution is decoupled from Runner lifecycle

**Why it holds**:
- Evidence: `src/agents/tool.py`
- Coverage: Code
- Quality: Partially Verified

**Why it might be wrong**:
- Missing evidence: error handling path when Tool fails inside Runner.

**Why it matters**:
Decoupled tools are easier to test and integrate with external systems.

### Claim 3: Context propagation path is Unknown

**Why it holds**:
- Evidence: `src/agents/_run_context.py` exists but caller sites are not traced.
- Coverage: Code
- Quality: Unknown

**Why it might be wrong**:
- Alternative explanation: Context may be reconstructed per turn rather than passed through the stack.
- Missing evidence: complete call chain from Runner to Tool showing Context argument.

**Why it matters**:
Context propagation is a key architectural decision for testability and multi-Agent composition.

## Appendix

- **Reading Guide**: start with `src/agents/run.py`, then `src/agents/agent.py`, then `src/agents/tool.py`.
- **Open Questions**: how is Context propagated between Runner and Tool.
- **What NOT to Learn**: do not copy database optimizer patterns into this agent framework.

## Quality Gate

1. **What would invalidate this report?** Evidence that Agent.run() contains an independent main loop.
2. **What is most likely to be disagreed with?** Claim 1 may be too strong if Runner is just a thin wrapper.
3. **Is any Claim pretending to be certain when it should be Unknown?** Claim 2 is Partially Verified.
