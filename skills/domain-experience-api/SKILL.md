---
name: experience-vs-domain-api
version: 1.0.0
description: Decide whether a capability, orchestration, transformation, validation, or external-data integration belongs in the Experience API (BFF) or Domain API. Use when designing APIs, services, integrations, or reviewing architecture boundaries.
---

# Experience API vs Domain API

## Goal

Keep the boundary between the consumer-facing Experience API and the business-facing Domain API explicit.

Use this rule first:

> **Experience API owns consumer-specific delivery. Domain API owns business capability and business meaning.**

Do not decide from technology choice, database choice, or whether a source is internal/external.

## Default architecture

```text
Angular / other consumer
        |
        v
Experience API (Node.js / BFF)
        |
        v
Domain API (Java)
        |
        +--> PostgreSQL / other DB
        +--> Snowflake
        +--> external business systems
```

The technologies are examples, not part of the rule.

## When to use this skill

Apply this skill when a request involves any of the following:

- Where an endpoint/service/use case should live.
- Whether logic belongs in Node.js or Java.
- Whether an external API should be called by Experience API or Domain API.
- Whether an API composition is UI composition or business orchestration.
- Whether business logic is leaking into a BFF.
- Whether the Domain API has become a generic UI gateway.

## Decision procedure

For each capability, perform these checks in order.

### 1. Identify the responsibility

Describe the capability in one sentence without mentioning the implementation technology.

Examples:

- `calculateInvestmentRisk`
- `determineInvestmentRating`
- `buildInvestmentIdeaPage`
- `combineIdeaAndRecentActivities`

If the responsibility cannot be stated clearly, split the capability before deciding.

### 2. Ask whether it has business meaning

Choose **Domain API** when the capability does any of these:

- applies a business rule;
- performs a business calculation;
- makes a business decision;
- changes or validates business state;
- interprets source data into a business concept;
- coordinates a business workflow;
- combines sources to produce a business-level result;
- represents a reusable business capability.

Examples:

```text
calculateInvestmentRisk()
determineInvestmentRating()
validateInvestmentThesis()
calculatePortfolioExposure()
```

### 3. Ask whether it is consumer-specific

Choose **Experience API** when the capability exists primarily to serve a particular consumer experience:

- compose several backend responses for a screen;
- create a consumer-specific DTO/view model;
- adapt API shape for Angular/mobile/web;
- apply presentation-specific formatting;
- apply consumer-specific pagination/filtering;
- hide backend call structure from a consumer.

Examples:

```text
buildInvestmentIdeaPage()
combineIdeaAndRecentActivities()
mapIdeaToAngularViewModel()
```

### 4. Apply the removal test

Ask:

> If Angular and its page disappeared, would the capability still be required by the business?

- **Yes** -> Domain API is the default.
- **No** -> Experience API is the default.

This is a heuristic, not an absolute rule.

### 5. Apply the second-consumer test

Ask:

> Would another consumer reasonably need the same business capability?

Examples of another consumer:

- mobile app;
- another frontend;
- batch process;
- scheduled job;
- AI agent;
- another internal service.

If yes, that is evidence for Domain API **only when the capability has business meaning**. Reuse by itself does not make something Domain API.

### 6. Decide where external integrations belong

Never use:

```text
External API -> Experience API
Database -> Domain API
Snowflake -> Domain API
```

Instead ask what role the external data plays.

#### A. Business dependency -> Domain API

If source data is needed to perform or support a business capability:

```text
Investment Idea
    |
    +--> Market Data
    +--> ESG Data
    +--> Research Data
    |
    v
Investment decision / calculation
```

The business-facing integration belongs behind the Domain API boundary.

Prefer a business-oriented port/abstraction such as:

```java
interface MarketDataProvider {
    MarketData getMarketData(SecurityId id);
}
```

The concrete adapter may call Snowflake, REST, vendor SDKs, or another system.

The important rule is:

> **The business capability depends on a business abstraction, not on a vendor-specific API contract.**

#### B. Consumer-only enrichment -> Experience API

If data is only needed to construct a particular consumer response and has no independent business meaning, Experience API may own the integration.

Example:

```text
Domain API -> Investment Idea
Experience API -> company logo service
Experience API -> Angular view
```

#### C. Pure consumer-facing pass-through -> Experience API may own it

If the Experience API simply exposes an external capability for a consumer and adds no business rule or domain interpretation, keeping the integration in Experience API can be appropriate.

Example:

```text
Angular -> Experience API -> external search API
```

Do not move such a capability to Domain API merely because the external system is technically reusable.

## Orchestration rule

The number of downstream calls does not determine the layer.

### UI orchestration -> Experience API

```text
Get idea
Get author
Get activities
Combine into page response
```

### Business orchestration -> Domain API

```text
Get investment idea
Get market data
Calculate valuation
Evaluate risk
Apply investment rules
Persist result
```

Use the purpose of the orchestration, not its implementation shape.

## Layering rule for implementation

A Domain API may contain infrastructure adapters for databases and external systems, but the business/application code should not be tightly coupled to provider-specific protocols.

Conceptually:

```text
Domain/Application use case
        |
        v
Business port / abstraction
        |
        v
Adapter
        |
        +--> Snowflake
        +--> PostgreSQL
        +--> External REST API
        +--> Vendor SDK
```

Do not interpret “Domain API owns the integration” as “the domain model directly knows HTTP/JDBC/vendor SDK details.”

## Anti-patterns

### Smart BFF

Do not put the following in Experience API when they are business capabilities:

```text
business rules
investment calculations
business validation
investment scoring
business decisions
business workflows
```

A BFF should not become a second business layer.

### Generic gateway disguised as Domain API

Do not put these into Domain API merely because it is the lower layer:

```text
Angular-specific DTOs
screen composition
presentation formatting
page-specific view models
```

### Data-source-driven placement

Do not classify using:

```text
REST -> Experience
JDBC -> Domain
Snowflake -> Domain
GraphQL -> Experience
```

The same source can be valid in either layer depending on responsibility.

## Decision matrix

| Question | Experience API | Domain API |
|---|---|---|
| Business rule? | No | Yes |
| Business calculation? | No | Yes |
| Business decision? | No | Yes |
| Business state/invariant? | No | Yes |
| Business interpretation of source data? | No | Yes |
| Business workflow/orchestration? | No | Yes |
| Screen/page composition? | Yes | No |
| Consumer-specific DTO? | Yes | No |
| UI formatting? | Yes | No |
| Consumer-specific pagination/filtering? | Yes | No |
| External source needed for business capability? | Usually no | Yes |
| External source used only for UI enrichment? | Yes | Usually no |
| Pure external pass-through for one consumer? | Often | Not required |

## Important nuance

“Domain API” is a service boundary, not automatically the same thing as the innermost domain model.

A practical Domain API service can contain:

```text
API adapter
Application/use-case orchestration
Domain model and business rules
Outbound ports
Infrastructure adapters
```

The business rule is still separated from the technical integration mechanism.

## Required review output

When this skill is used for a design or code review, return only the significant boundary decisions using:

```text
Decision: Experience API | Domain API
Confidence: High | Medium | Low

Reason:
<one concise explanation>

Business responsibility:
<business responsibility, or None>

Consumer dependency:
<consumer-specific or consumer-independent>

External integration:
<where it should live and why, if applicable>

Boundary:
<what must remain in the other layer>
```

For multiple capabilities, repeat the block once per capability.

## Final rule

> **Experience API answers: “How should this consumer receive the capability?”**
>
> **Domain API answers: “What does the business need to know or do?”**

When uncertain, prefer the smallest clear boundary. Do not invent a new layer unless the architecture actually requires one.
