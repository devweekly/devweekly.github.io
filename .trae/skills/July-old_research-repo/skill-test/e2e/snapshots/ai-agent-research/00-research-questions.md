# Research Questions — ai-agent-research

## Archetype

AI Agent

## Top 5 Questions

### Q1: Why does the Runner own the main execution loop?
- **Why it matters**: The execution model determines whether Agents are autonomous or orchestrated.
- **Expected Evidence**: `src/agents/run.py` contains the main loop; `src/agents/agent.py` defines lifecycle hooks.
- **Hypothesis**: Runner-centric model — Agent declares capabilities, Runner drives execution.
- **Alternative**: Agent-centric model — Agent contains its own event loop and calls tools directly.

### Q2: How is Context propagated between Runner, Agent, and Tool?
- **Why it matters**: Explicit Context affects testability and multi-Agent composition.
- **Expected Evidence**: `src/agents/_run_context.py` and call chains from run.py.
- **Hypothesis**: Context is passed explicitly as a first-class object.
- **Alternative**: Context is implicit in global state or reconstructed per call.

### Q3: What is the contract between Agent and Tool?
- **Why it matters**: Tool abstraction determines extensibility and error handling.
- **Expected Evidence**: `src/agents/tool.py`, `src/agents/agent.py`, and tool tests.
- **Hypothesis**: Tools expose a schema/executor interface consumed by the Runner.
- **Alternative**: Tools are plain functions without schema validation.

### Q4: How does the framework handle failures inside the Runner loop?
- **Why it matters**: Resilience strategy separates prototype from production framework.
- **Expected Evidence**: Exception handling in `src/agents/run.py` and related tests.
- **Hypothesis**: Errors surface to the caller with context for retry or escalation.
- **Alternative**: Errors are swallowed or terminate the loop unconditionally.

### Q5: Where is planning or LLM-call orchestration implemented?
- **Why it matters**: Identifies whether the framework is thin glue or contains reasoning logic.
- **Expected Evidence**: Prompt templates, LLM client wrappers, planner modules.
- **Hypothesis**: Planning is delegated to the Agent implementation; Runner is policy-agnostic.
- **Alternative**: Runner contains prompt construction and LLM invocation logic.

## Filtered Out

- Q6: What database backend is used? — Not relevant to an AI Agent framework.
- Q7: How is SQL parsed? — Cross-archetype contamination.
