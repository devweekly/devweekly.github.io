---
author: W
featured: false
draft: false
description: Pi-mono Pi Coding Agent 研究 - 探索 AI 编程助手的架构设计与实现
pubDatetime: 2026-02-28T10:00:00Z
title: pi-mono pi coding agent 研究
tags:
  - AI
  - coding-agent
  - architecture
---

## pi-mono pi coding agent 研究

###

###

[pi-mono-agent](https://github.com/saga/pi-mono-agent) **\***

https://github.com/qualisero/awesome-pi-agent

https://github.com/badlogic/pi-skills

https://github.com/Dicklesworthstone/pi_agent_rust \*\*

https://buildwithpi.com/

https://github.com/nicobailon/pi-messenger Multi-agent communication extension for pi coding agent

https://github.com/disler/pi-vs-claude-code Comparison between open source PI agent and closed source Claude Code agent 还有一些extension

https://github.com/can1357/oh-my-pi AI Coding agent for the terminal — hash-anchored edits, optimized tool harness, LSP, Python, browser, subagents

https://github.com/jayminwest/overstory Multi-agent orchestration for AI coding agents — pluggable runtime adapters for Claude Code, Pi, and more

https://github.com/tmustier/pi-for-excel Experimental Excel sidebar agent add-in

https://github.com/nicobailon/pi-mcp-adapter

https://github.com/nicobailon/pi-web-access

https://github.com/hjanuschka/shitty-extensions

    memory-mode.ts - Save instructions to AGENTS.md
    plan-mode.ts - Read-only exploration mode

https://github.com/nicobailon/pi-interactive-shell

https://github.com/mitsuhiko/agent-stuff

https://github.com/tmustier/pi-extensions

https://instagit.com/badlogic/pi-mono/how-to-create-custom-extensions-for-pi-coding-agent/

https://github.com/joelhans/bmo-agent/ A self-improving AI coding agent that runs in your terminal. bmo uses LLM-powered tool execution to complete tasks, and autonomously builds new tools and skills when it encounters limitations. It features multi-provider LLM routing, sandboxed tool execution, session persistence with cost tracking, and a self-improvement loop driven by reflections and periodic maintenance.

https://github.com/nicobailon/pi-interview-tool Interactive form tool for pi-agent to gather user responses with keyboard navigation, themes, and image attachments

https://github.com/yukukotani/pi-voice Headless voice interface for the Pi Coding Agent

https://github.com/nicobailon/pi-rewind-hook

https://github.com/mikeyobrien/rho An AI agent that stays running, remembers across sessions, and checks in on its own. macOS, Linux, Android. Built on Pi.

https://github.com/tmustier/pi-agent-teams An experimental Pi extension that brings Claude Code agent teams to Pi. Spawn teammates, share a task list, and coordinate work across multiple Pi sessions.

https://github.com/jademind/pi-statusbar A macOS status bar application for Pi with a local daemon for process discovery, telemetry aggregation, and one-click session jump/focus.

https://github.com/nicobailon/pi-review-loop

https://github.com/marcusschiesser/edge-pi \*\*\* Edge-Pi is a lightweight, Vercel AI SDK based coding agent library.

https://github.com/telagod/oh-pi

https://github.com/svkozak/pi-acp pi-acp communicates ACP JSON-RPC 2.0 over stdio to an ACP client (e.g. Zed editor) and spawns pi --mode rpc, bridging requests/events between the two.

https://github.com/dungle-scrubs/tallow Tallow is a terminal coding agent that starts minimal and scales up. Install only the extensions, themes, and agents your project needs, or enable everything. It drops into existing Claude Code projects via .claude/ bridging, so nothing breaks when you switch. Ships with 51 extensions, 34 themes, and 10 specialized agents.

https://github.com/bradAGI/awesome-cli-coding-agents

https://github.com/arosstale/pi-builder

https://github.com/nicobailon/pi-subagents Pi extension for async subagent delegation with truncation, artifacts, and session sharing

https://github.com/dannote/dot-pi

https://github.com/joelreymont/pz Minimal pi coding-agent re-implementation in **Zig**

https://github.com/philipp-spiess/modern

https://github.com/pi0/pi-vscode Minimal VS Code extension for PI Coding Agent.

https://github.com/messense/pi-parallel-agents

```typescript
// pi-parallel-agents/parallel-agents.ts
pi.registerTool({
    name: "parallel",
    label: "Parallel Agents",
    description: [
      "Run agents in parallel with different models.",
```

https://github.com/jo-inc/pi-reflect Self-improving behavioral files for pi coding agents. Analyzes session transcripts for correction patterns and makes surgical edits to prevent recurrence.

```typescript
	pi.on("session_start", async (_event, ctx) => {
		modelRegistryRef = ctx.modelRegistry;
	});
	pi.registerCommand("reflect", {
		description: "Reflect on recent sessions and improve a behavioral markdown file",
		handler: async (args, ctx) => {
			modelRegistryRef = ctx.modelRegistry;
			const targetPath = args?.trim();
```

https://github.com/nicobailon/pi-model-switch A Pi coding agent extension that gives the agent the ability to list, search, and switch models on its own. With this extension, you can tell the agent things like "switch to a cheaper model" or "use Claude for this task" and it will handle the model change itself, without you needing to use /model or keyboard shortcuts.

https://github.com/vamsi/pi Port of pi-mono to Python; AI agent toolkit: coding agent CLI, unified LLM API, TUI & web UI libraries, Slack bot, vLLM pod.

https://github.com/offline-ant/pi-tmux

https://github.com/butttons/pi-kit session-recall / brief

```typescript
  pi.registerTool({
    name: "recall_session",
    label: "Recall Session",
    description:
      "Load a past session's conversation by filename. Use after /recall provides the session index.",
    parameters: Type.Object({
      sessionFile: Type.String({
        description: "The session .jsonl filename from the index",
      }),
```

https://github.com/jo-inc/pi-mem Pi coding agent extension for plain-Markdown memory system

https://github.com/nicobailon/pi-foreground-chains A skill for Pi coding agent that orchestrates multi-agent workflows with full user visibility. Each step runs in an observable overlay where the user watches and can intervene.

https://github.com/coctostan/pi-superteam Pi coding agent extension: TDD/ATDD enforcement, specialized agent dispatch, iterative review cycles, context-aware rules

https://github.com/ghoseb/pi-askuserquestion

https://github.com/kcosr/pi-extensions

https://github.com/nicobailon/pi-skill-palette

https://github.com/default-anton/pi-librarian GitHub research subagent package for pi coding agent

https://github.com/mjakl/pi-subagent A lightweight subagent extension for the pi coding agent

https://github.com/cv/pi-action GitHub Action to invoke the PI coding agent on issues and PRs via comment triggers

https://github.com/PSPDFKit-labs/pi-skills

https://github.com/l3wi/agents-workflow A multi-agent orchestration system for Pi Coding Agent that enables parallel feature development through coordinated worktrees and spawned worker agents.

```typescript
/skill:plan - Unified planning: PRD → Spec → Tasks
/skill:feature - Implement with TDD in worktree
/skill:review-codebase - Periodic quality checks and optimization opportunities
```

https://github.com/Huvinesh-Rajendran-12/pi-agent-core A stateful LLM agent framework for Python with tool execution, event streaming, steering/follow-up message queuing, and proxy transport. 不是pi-mono的port，参考了思想。

https://github.com/rytswd/pi-agent-extensions

https://github.com/hjanuschka/pi-qmd QMD (Quick Markdown Search) extension for pi coding agent - on-device knowledge base search with BM25, vector search, and LLM reranking. Note: QMD requires Bun runtime

https://github.com/tomsej/pi-ext

https://github.com/jademind/pi-telemetry \*\*

https://github.com/HazAT/pi-config

https://github.com/kngzzz/pi-programmatic-agents

https://github.com/Graffioh/pi-super-curl

https://github.com/ferologics/pi-extensions

https://github.com/dnouri/ai-config

https://github.com/coctostan/pi-agent-browser

https://github.com/Cygnusfear/pi-stuff

https://github.com/zach-source/pi-agent-extensions

https://github.com/default-anton/pi-subdir-context

https://github.com/sudosubin/pi-frontier

https://github.com/netandreus/pi-cursor-provider

https://github.com/aniketmaurya/pi-agent Python port of Pi.dev \*\*\*

https://github.com/hintjen/pi-extensions Pi coding agent extensions — /prune, /explore, and more

https://github.com/openxjarvis/pi-mono-python Python port of pi-mono: fully-aligned coding agent with TUI, ai, agent, and coding-agent packages \*\*\*

https://github.com/witt3rd/pipy Python ports of pi-mono packages - LLM streaming, agent framework, TUI components, and coding assistant

https://github.com/witt3rd/pipy-agent Agent framework with tool execution, built on pipy-ai. Python port inspired by Mario Zechner's pi-mono/agent. \*\*\*

https://github.com/w-winter/dot314 Extensions, skills, prompts, and themes for Pi coding agent. There is an emphasis here on making Pi and RepoPrompt co-operate well.

https://pi-for-excel.vercel.app/

https://lazypi.org/videos.html

https://github.com/JoviDeCroock/pi-setup

https://github.com/ruizrica/agent-pi

https://github.com/tintinweb/pi-subagents

https://github.com/jbexta/AgentPilot

https://github.com/tintinweb/pi-supervisor

https://github.com/telagod/pi-agent-colony

https://github.com/nicobailon/pi-intercom

https://github.com/xiaotonng/pikiclaw

https://github.com/aliou/pi-harness

https://github.com/pithings/pi-vscode

https://github.com/nicobailon/pi-boomerang

https://github.com/ogulcancelik/pi-extensions

https://github.com/HenryLach/taskplane

https://github.com/rawwerks/ypi

https://github.com/stablyai/orca

https://github.com/tmdgusya/roach-pi

https://github.com/vaslabs/pi-web-agent

https://github.com/minghinmatthewlam/pi-gui

https://github.com/HazAT/pi-interactive-subagents

https://github.com/injaneity/pi-computer-use
