# Hypotheses — ai-agent-research

## Hypotheses

### H1: Runner-centric execution model

- **Hypothesis**: The framework uses a Runner-centric execution model where the Runner owns the main loop and the Agent declares capabilities.
- **Prior**: 0.6 — Most lightweight agent frameworks separate orchestration from agent logic.
- **Evidence**: `src/agents/run.py:L120` main loop; `src/agents/agent.py` lifecycle methods; `tests/test_run.py`.
- **Posterior**: 0.85
- **Competing Hypothesis**: Agent-centric model where the Agent drives its own loop and calls tools directly (posterior 0.15).

### H2: Explicit Context propagation

- **Hypothesis**: Context is passed explicitly between Runner, Agent, and Tool.
- **Prior**: 0.5
- **Evidence**: `src/agents/_run_context.py` exists and is imported by run.py.
- **Posterior**: 0.70
- **Competing Hypothesis**: Context is reconstructed on each call from global or implicit state (posterior 0.30).
