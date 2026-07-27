# Behavior Ontology — ai-agent-research

## Entities

- **Runner**: Orchestrates the execution loop; owns policy and lifecycle.
- **Agent**: Declares capabilities, instructions, and tools.
- **Tool**: Executable capability invoked by the Runner on behalf of the Agent.
- **Context**: Shared state passed through the execution loop.

## Relations

- Runner **executes** Agent.
- Runner **calls** Tool.
- Agent **declares** Tool.
- Tool **returns** result to Runner.
- Runner **updates** Context.
