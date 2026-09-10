# Skill: Experience API vs Domain API Decision

## Purpose

Determine whether a capability, integration, orchestration, transformation, or business logic belongs in:

* **Experience API** — Node.js / BFF layer
* **Domain API** — Java / business capability layer

The primary architectural principle is:

> Experience API owns consumer experience. Domain API owns business meaning and business decisions.

Do not classify based on programming language, data source technology, database type, or whether the source is internal/external.

---

## Architecture Context

Assume the default architecture is:

```text
Angular / Other Consumer
        │
        ▼
Experience API
Node.js / BFF
        │
        ▼
Domain API
Java
        │
        ├── PostgreSQL / DB
        ├── Snowflake
        └── External Business Data Sources
```

The exact technologies may differ, but the responsibility boundary remains the same.

---

# Core Decision Rule

For every proposed capability, ask:

> **Does this capability exist because of a particular consumer experience, or because the business domain needs the capability?**

### Experience API

Use Experience API when the capability primarily exists to serve a specific consumer experience.

Typical responsibilities:

* BFF
* API composition
* Consumer-specific aggregation
* Consumer-specific DTO shaping
* UI-oriented formatting
* Pagination / filtering required specifically by the UI
* Combining several Domain APIs for one screen
* Consumer-specific orchestration
* Mapping domain responses into screen/view models
* Hiding backend API complexity from a consumer

### Domain API

Use Domain API when the capability represents business meaning or business behavior.

Typical responsibilities:

* Business rules
* Business calculations
* Domain decisions
* Business validation
* Investment rules
* Business workflows
* Business-level orchestration
* Business entities and aggregates
* Business data retrieval
* Integration with data sources required by business capabilities
* Normalizing external business data into domain concepts
* Combining multiple data sources to produce business information

---

# Primary Decision Tree

For each proposed implementation:

```text
                         New capability
                              │
                              ▼
               Is it business-domain behavior?
                       /              \
                     Yes               No
                      │                 │
                      ▼                 ▼
                 Domain API       Is it consumer-specific?
                                      /        \
                                    Yes         No
                                     │           │
                                     ▼           ▼
                              Experience API   Re-evaluate
```

A capability is considered business-domain behavior if it affects:

* business rules
* business decisions
* business calculations
* business state
* business workflows
* business entities
* business-level validation
* business interpretation of external data

---

# Strong Signals for Domain API

Put the capability in Domain API when one or more of these are true:

1. It implements a business rule.

2. It performs a business calculation.

3. It makes a business decision.

4. It changes business state.

5. It validates business invariants.

6. It interprets external data according to business meaning.

7. It combines data sources to create a business concept.

8. Another consumer could reasonably need the same capability.

9. The capability would still exist if Angular were replaced.

10. The capability could be reused by:

* another frontend
* mobile application
* batch process
* scheduled job
* AI agent
* another internal service

11. Removing the frontend would not remove the business requirement.

12. The logic needs domain-level automated tests.

---

# Strong Signals for Experience API

Put the capability in Experience API when one or more of these are true:

1. It exists only for a particular consumer.

2. It combines several Domain APIs to build a screen/view.

3. It transforms domain data into a UI-specific DTO.

4. It performs presentation-oriented formatting.

5. It handles UI-specific pagination or filtering.

6. It creates a view model.

7. Different consumers would reasonably need different representations.

8. Removing the consumer would make the capability unnecessary.

9. The logic has no independent business meaning.

---

# External Data Source Decision

Do NOT use this rule:

```text
External API → Experience API
Database → Domain API
Snowflake → Domain API
```

This is incorrect.

Instead ask:

> **Why does the application need this external data?**

## Case 1 — External data is part of business capability

Example:

```text
Investment Idea
      │
      ├── Market Data
      ├── ESG Data
      └── Research Data
             │
             ▼
       Investment Score
```

If external data participates in:

* investment calculations
* investment scoring
* risk analysis
* valuation
* investment rules
* investment thesis
* business decisions

then the integration belongs in:

```text
Domain API
```

The Domain API should expose a business-oriented abstraction rather than leaking the external provider directly.

Example:

```java
interface MarketDataProvider {
    MarketData getMarketData(SecurityId securityId);
}
```

The implementation may use:

```text
ExternalMarketDataProvider
SnowflakeMarketDataProvider
CachedMarketDataProvider
```

The domain should depend on the business concept, not the provider's API.

---

# External Data Case 2 — UI-only enrichment

Example:

```text
Investment Idea
      │
      ├── Idea data
      ├── Author
      └── Company Logo
```

If the external data is only required to improve a particular UI:

```text
Domain API → Investment Idea
                    │
Experience API ─────┼──→ Logo API
                    │
                    ▼
              Angular View
```

then it may belong in:

```text
Experience API
```

because the external integration has no independent business meaning.

---

# External Data Case 3 — Pure passthrough

If the application simply exposes an external capability without adding domain behavior:

```text
Angular
   │
   ▼
Experience API
   │
   ▼
External API
```

Experience API may own the integration.

Example:

```text
GET /market-data/search
```

if it is simply a consumer-facing search endpoint and does not participate in Investment Idea business logic.

However, if the same market data becomes part of:

```text
calculateInvestmentScore()
```

the integration should move behind Domain API.

---

# The "Second Consumer" Test

Ask:

> If a second consumer appears tomorrow, should it be able to reuse this capability?

Examples:

```text
Angular
Mobile
AI Agent
Batch Job
Internal Portal
```

If yes:

```text
Domain API
```

If no, and the capability is tightly coupled to one consumer:

```text
Experience API
```

This is one of the strongest practical tests.

---

# The "Remove Angular" Test

Ask:

> If Angular disappeared tomorrow, would this logic still be required by the business?

### Yes

Likely:

```text
Domain API
```

### No

Likely:

```text
Experience API
```

Example:

```text
calculateInvestmentRisk()
```

Angular-independent:

```text
Domain API
```

Example:

```text
combineIdeaHeaderAndRecentActivitiesForIdeaPage()
```

Angular-specific:

```text
Experience API
```

---

# The "Business Vocabulary" Test

If the operation naturally uses business vocabulary, it is probably Domain API.

Examples:

```text
evaluateInvestmentIdea()
calculateRiskScore()
validateInvestmentThesis()
calculatePortfolioExposure()
determineInvestmentRating()
approveInvestmentIdea()
```

These belong in Domain API.

If the operation naturally uses presentation vocabulary, it is probably Experience API.

Examples:

```text
buildIdeaPage()
formatIdeaResponse()
combineDashboardWidgets()
buildMobileView()
```

These belong in Experience API.

---

# The "Business Meaning" Test for Data

Do not ask:

> Where is the data stored?

Ask:

> Who gives the data its business meaning?

For example:

```text
Snowflake
    ↓
Revenue
    ↓
Domain interpretation
    ↓
RevenueGrowth
    ↓
InvestmentIdea
```

The raw data may live in Snowflake, but its business interpretation belongs to Domain API.

Therefore:

```text
Snowflake
    ↓
Domain API
    ↓
Business Concept
```

is appropriate.

---

# API Composition Rule

Experience API is allowed to compose multiple Domain APIs.

Example:

```text
GET /investment-idea/123/page
```

Experience API:

```text
Idea API
   +
Research API
   +
Activity API
   +
User API
        │
        ▼
InvestmentIdeaPageDTO
```

This is valid because the composition is consumer-oriented.

However, this is NOT valid:

```text
Experience API
    │
    ├── calculate valuation
    ├── calculate risk
    ├── apply investment rules
    ├── determine rating
    └── call ESG provider
```

This means business logic has leaked into Experience API.

Move those capabilities into Domain API.

---

# Business Orchestration vs UI Orchestration

This distinction is critical.

## UI orchestration

```text
Get idea
Get author
Get activities
Get comments
Combine response
```

→ Experience API

## Business orchestration

```text
Get investment idea
Get market data
Calculate valuation
Evaluate risk
Apply investment rules
Generate investment score
Persist result
```

→ Domain API

The number of downstream calls does not determine the layer.

The **purpose of the orchestration** determines the layer.

---

# Anti-Patterns

## Anti-pattern 1: Smart BFF

Avoid:

```text
Experience API
    ├── business rules
    ├── investment calculations
    ├── external integrations
    ├── domain validation
    └── DB queries
```

This turns the BFF into a second business layer.

---

## Anti-pattern 2: Fat Domain API as Generic Gateway

Avoid blindly putting everything into Domain API:

```text
Domain API
    ├── UI formatting
    ├── screen-specific composition
    ├── Angular DTOs
    └── presentation logic
```

Domain API should not become a generic backend-for-frontend.

---

## Anti-pattern 3: Data-source-driven architecture

Do not classify based on:

```text
REST → Experience
JDBC → Domain
Snowflake → Domain
GraphQL → Experience
```

The same data source may legitimately be consumed by either layer.

Classification must be based on **business responsibility**.

---

# Investment Idea Reference Model

For an Investment Idea system:

```text
Angular
      │
      ▼
Experience API
      │
      ├── Build Investment Idea page
      ├── Compose dashboard
      ├── UI DTO
      └── Consumer-specific filtering
      │
      ▼
Domain API
      │
      ├── Investment Idea
      ├── Investment Thesis
      ├── Valuation
      ├── Risk
      ├── ESG interpretation
      ├── Market data interpretation
      ├── Investment rules
      └── Investment scoring
      │
      ├──────────────┬───────────────┐
      ▼              ▼               ▼
 PostgreSQL       Snowflake      External APIs
```

The external API location is determined by whether the data is:

```text
business capability
        ↓
Domain API
```

or:

```text
consumer-specific enrichment
        ↓
Experience API
```

---

# Required Decision Output

When reviewing a proposed capability, produce this format:

```text
Decision: Experience API | Domain API

Confidence: High | Medium | Low

Reason:
<one concise explanation>

Business responsibility:
<what business responsibility exists, if any>

Consumer dependency:
<whether it is consumer-specific>

External integration:
<where the integration should live, if applicable>

Boundary:
<what should remain in the other layer>
```

Example:

```text
Decision: Domain API

Confidence: High

Reason:
Market data is used to calculate the investment idea's valuation
and investment score, so the integration is part of the business
capability rather than UI composition.

Business responsibility:
Valuation and investment scoring.

Consumer dependency:
None. The capability remains necessary if Angular is replaced.

External integration:
Domain API through a MarketDataProvider abstraction.

Boundary:
Experience API may compose the resulting investment score into
a screen-specific response, but must not perform the calculation.
```

---

# Tie-Breaker Rules

When the decision is ambiguous, apply these rules in order:

1. **Business rule beats UI requirement.**
   → Domain API

2. **Business calculation beats presentation transformation.**
   → Domain API

3. **Business data interpretation beats raw data retrieval.**
   → Domain API

4. **Reusable business capability beats consumer-specific implementation.**
   → Domain API

5. **Consumer-specific composition beats generic aggregation.**
   → Experience API

6. **UI formatting beats domain transformation.**
   → Experience API

7. **Do not move logic to Experience API merely because the data comes from an external system.**

8. **Do not move everything to Domain API merely because it is technically reusable.**
   Reusability alone is insufficient; the capability must have domain meaning.

---

# Final Principle

Use this sentence as the architectural rule:

> **Experience API answers "How should this consumer receive the information?" Domain API answers "What does the business need to know or do?"**

Therefore:

```text
Consumer-specific
        ↓
Experience API

Business-specific
        ↓
Domain API
```

And for integrations:

```text
External data needed to perform business capability
        ↓
Domain API

External data needed only to construct a consumer experience
        ↓
Experience API
```
