# Reference: Experience API, BFF, Domain Boundary, and External Integrations

This document is supporting material for the `experience-vs-domain-api` skill. It explains the architectural concepts behind the decision rules; it is not itself an execution procedure.

## 1. Experience API / BFF

The Backend-for-Frontend (BFF) pattern introduces a backend specifically tailored to a frontend interface. Microsoft describes the BFF as a layer between the frontend client and backend services that handles requirements specific to that interface. Typical reasons include tailoring responses and optimizing the backend for a particular client. BFF-specific logic should remain client-specific rather than becoming shared business logic.

Reference:
- Microsoft Azure Architecture Center — Backends for Frontends Pattern
  https://learn.microsoft.com/en-us/azure/architecture/patterns/backends-for-frontends

AWS presents a similar BFF architecture in which frontend clients invoke a BFF API to obtain UI-ready data projections.

Reference:
- AWS — Backend for Frontend Using API Gateway
  https://docs.aws.amazon.com/reference-architecture-diagrams/latest/backend-for-frontend-api-gateway/backend-for-frontend-api-gateway.html

### Implication for this architecture

```text
Angular
   |
   v
Experience API / BFF
   |
   v
Domain API
```

The Experience API is optimized for the consumer. It is not the preferred home for domain rules simply because those rules are convenient to implement in Node.js.

## 2. “Experience API” is broader than a simple proxy

MuleSoft uses the term Experience API for APIs tailored to a specific channel or consumer context. Its definition emphasizes projecting data formats, interaction timing, or protocols into a specific channel/context. Experience APIs can compose capabilities from other APIs, but the composition is oriented toward the consumer experience.

Reference:
- MuleSoft — Experience APIs ownership and governance model
  https://blogs.mulesoft.com/api-integration/strategy/experience-api-ownership/

MuleSoft also documents an API-led approach where Experience APIs sit above reusable Process/System APIs. The important idea for this skill is not that every organization must implement MuleSoft's three-tier API model, but that the Experience layer is consumer-oriented.

Reference:
- MuleSoft — 3 approaches to API consumption
  https://blogs.mulesoft.com/api-integration/strategy/api-consumption-approaches/

## 3. Domain logic and external systems

Hexagonal Architecture (Ports and Adapters) provides the strongest architectural rationale for the external-integration rule used by this skill.

AWS describes the goal as isolating business logic from infrastructure such as databases and external APIs. External communication is expressed through ports and implemented by adapters. This allows business logic to remain independent of the concrete technology used to fulfill the dependency.

Reference:
- AWS Prescriptive Guidance — Hexagonal architecture pattern
  https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/hexagonal-architecture.html

AWS further describes outbound ports for databases and APIs, with adapters implementing those ports. Replacing SQL with another datastore or replacing one external provider with another should therefore not require rewriting the business logic.

Reference:
- AWS Prescriptive Guidance — Best practices for hexagonal architectures
  https://docs.aws.amazon.com/prescriptive-guidance/latest/hexagonal-architectures/best-practices.html

## 4. Why “external data = Experience API” is not a sound rule

An external API is simply an implementation source. The correct placement depends on what the application is doing with the data.

### Business use

```text
External market/ESG/research data
            |
            v
Business interpretation
            |
            v
Investment calculation / decision
```

Here the external source supports a business capability. The Domain API should own the business-facing dependency and isolate the provider through a port/adapter boundary.

### Consumer-only use

```text
Investment Idea
      |
      +--> logo / UI metadata / presentation enrichment
      |
      v
Angular page
```

Here the integration may stay in Experience API because it exists for a particular consumer representation and carries no independent business meaning.

## 5. Business orchestration vs UI composition

A useful distinction is:

### UI composition

The purpose is to construct a representation required by a client.

```text
Domain API: idea
Domain API: author
Domain API: activity
          |
          v
Experience API: InvestmentIdeaPageDTO
```

### Business orchestration

The purpose is to execute a business use case.

```text
Investment Idea
      |
      +--> market data
      +--> valuation
      +--> risk evaluation
      +--> investment rules
      +--> score
```

The latter belongs to the business/application side, not the BFF.

## 6. DDD and business-centered decomposition

AWS's DDD guidance emphasizes decomposing systems around business logic and bounded contexts rather than purely technical concerns. The domain is treated as the core of the application, while presentation, database, and external APIs remain outside the domain model.

Reference:
- AWS Prescriptive Guidance — Hexagonal architectures overview / DDD
  https://docs.aws.amazon.com/prescriptive-guidance/latest/hexagonal-architectures/overview.html

This supports the skill's principle that the decision should be based on business responsibility rather than whether a dependency is “an API,” “a database,” or “Snowflake.”

## 7. Practical decision model

Use the following sequence:

```text
                    Capability
                        |
                        v
             Does it have business meaning?
                    /         \
                  Yes          No
                   |            |
                   v            v
              Domain API   Is it consumer-specific?
                              /        \
                            Yes         No
                             |           |
                             v           v
                       Experience    Re-evaluate
                           API
```

For external data:

```text
External source
      |
      v
What is the data used for?
      |
      +--> Business capability / decision / calculation
      |          |
      |          v
      |     Domain API boundary
      |
      +--> Consumer-specific projection / enrichment
                 |
                 v
          Experience API boundary
```

## 8. Important qualification

The terms “Experience API” and “Domain API” are architectural responsibilities, not universal industry-standard layer names with one exact implementation.

Different organizations may use:

- BFF
- Experience API
- Process API
- Application Service
- Domain Service
- Business API
- System API

with different boundaries.

Therefore, the reliable part of the design is the responsibility boundary:

> Consumer-specific concerns belong at the consumer-facing edge; business meaning and business behavior belong inside the business capability boundary.

## 9. Recommended reference set

For this skill, use these references in this order:

1. Microsoft BFF pattern — to define consumer-specific backend responsibilities.
2. AWS Hexagonal Architecture — to define business/infrastructure separation and ports/adapters.
3. AWS Hexagonal Architecture best practices — to define external API/database adapters.
4. MuleSoft Experience API references — to clarify the specific “Experience API” terminology and consumer/channel tailoring.
5. AWS DDD overview — to reinforce business-centered rather than technology-centered decomposition.
