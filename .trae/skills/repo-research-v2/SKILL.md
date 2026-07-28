# Repository Research Skill

Version: 2.0

---

# Mission

This skill performs deep architectural research on a software repository.

The objective is **not** to summarize code.

The objective is to reconstruct:

- how the system works,
- why it is designed this way,
- which engineering constraints shaped it,
- what architectural decisions were made,
- which ideas are reusable in other systems.

The final report should help an experienced engineer understand the repository at the level of its original maintainers.

---

# Core Principles

Every research task must follow these principles.

## Principle 1

Evidence precedes interpretation.

Never infer architectural intent before collecting evidence.

All conclusions must originate from verified repository evidence.

---

## Principle 2

Structure precedes explanation.

Repository structure must be reconstructed before attempting architectural interpretation.

Do not jump directly from source code to conclusions.

Always establish an intermediate knowledge model.

---

## Principle 3

Inference is allowed.

Fabrication is forbidden.

Reasoning is encouraged.

Inventing evidence is prohibited.

Every non-trivial statement must be traceable.

---

## Principle 4

Research favors understanding.

The goal is understanding engineering decisions.

Not producing documentation.

Not generating pretty diagrams.

Not summarizing README files.

---

## Principle 5

Reports are renderers.

All reasoning happens before report generation.

The report should never invent new conclusions.

It only organizes validated findings.

---

# Research Scope

This skill focuses on repository architecture.

Typical research targets include

- architecture

- subsystem boundaries

- dependency structure

- capability decomposition

- engineering philosophy

- design constraints

- architectural evolution

- major trade-offs

- maintainability

- extension mechanisms

- runtime model

- plugin systems

- public API design

- testing strategy

- deployment model

- configuration model

- reusable engineering ideas

---

# Out of Scope

This skill is not intended for

- security auditing

- vulnerability scanning

- style checking

- linting

- formatting

- license review

- dependency updates

- performance benchmarking

- bug fixing

- code generation

These tasks belong to specialized skills.

---

# Research Inputs

The repository may contain

- source code

- documentation

- ADRs

- RFCs

- README

- configuration

- build scripts

- tests

- git history

- package metadata

- metrics

Any subset may be available.

Research must gracefully degrade when information is missing.

---

# Research Pipeline

The pipeline consists of four stages.

Mechanical Analysis

↓

Knowledge Modeling

↓

Architectural Interpretation

↓

Narrative Rendering

Each stage has a single responsibility.

Stages must not overlap responsibilities.

---

# Stage 0

Mechanical Analysis

Purpose

Collect objective repository evidence.

Typical evidence includes

- directory structure

- dependency graph

- import graph

- package graph

- symbols

- public APIs

- git history

- documentation

- configuration

- metrics

This stage performs no architectural interpretation.

---

# Stage 1

Knowledge Modeling

Purpose

Convert mechanical evidence into a repository knowledge model.

The knowledge model describes

- capabilities

- ownership

- relationships

- evolution

This stage describes facts.

It does not explain why.

---

# Stage 2

Architectural Interpretation

Purpose

Explain engineering decisions using the knowledge model.

Typical outputs include

- constraints

- design decisions

- architectural tensions

- deliberate omissions

- leverage points

- maintainer mental model

Every interpretation must reference evidence.

---

# Stage 3

Narrative Rendering

Purpose

Generate a human-readable research report.

The renderer does not perform reasoning.

It organizes existing findings into a coherent narrative.

---

# Quality Requirements

Every research report should answer the following questions.

## System

How does the repository work?

---

## Architecture

How is the system organized?

---

## Decisions

Why were these architectural decisions made?

---

## Constraints

Which engineering constraints influenced the design?

---

## Evolution

How has the architecture evolved?

---

## Trade-offs

What was intentionally sacrificed?

---

## Mental Model

How do the maintainers mentally divide the system?

---

## Reusability

Which ideas are valuable outside this repository?

---

# Evidence Policy

Every conclusion must satisfy at least one of the following.

Derived from

- source code

- documentation

- configuration

- tests

- git history

- repository metadata

Unsupported claims must be marked as unknown.

---

# Unknown Handling

The repository may not contain enough information.

Unknowns should never be hidden.

Classify unknowns as

Need More Code

Need Documentation

Need Git History

Need External Information

Impossible To Verify

---

# Confidence

Every interpretation should include a confidence estimate.

Confidence reflects evidence quality.

Not model certainty.

Typical guidance

High

Multiple independent evidence sources.

Medium

Evidence exists but interpretation remains uncertain.

Low

Weak evidence or indirect inference.

---

# Research Philosophy

Prefer

deep understanding

over

broad coverage.

Prefer

verified conclusions

over

interesting speculation.

Prefer

engineering reasoning

over

architectural buzzwords.

Prefer

maintainer intent

over

pattern matching.

---

# Deliverables

The final output should include

Repository Overview

Repository Mental Model

Engineering Constraints

Capability Map

Architecture

Evolution

Key Decisions

Design Tensions

Architectural Leverage

Reusable Patterns

Risks

Lessons Learned

Unknowns

Evidence Quality Summary

---

# Success Criteria

A successful research report enables an experienced engineer to answer

How does this repository work?

Why is it designed this way?

What should I learn from it?

What ideas deserve reuse?

What engineering mistakes were intentionally avoided?

If those questions cannot be answered,

the research is incomplete.

---
