---
name: security-review
description: Review a proposed solution for security risks across trust boundaries, identity, authorization, data handling, application behavior and operational controls.
---

# Security Review

Use this Skill to identify and communicate security risks in a proposed architecture, implementation or change.

## Working method

1. Establish the system boundary, assets, actors, data classifications, entry points and trust boundaries.
2. Trace authentication separately from authorization. Identify identities, delegation, service-to-service trust, privilege elevation and lifecycle controls.
3. Review access control for least privilege, resource-level enforcement, tenant isolation, separation of duties and failure-safe defaults.
4. Examine input and output handling, injection paths, deserialization, file uploads, secrets, cryptography, dependency and supply-chain exposure.
5. Follow sensitive data through collection, processing, logs, telemetry, storage, backup, export, retention and deletion.
6. Assess network exposure, API abuse, rate limits, replay, SSRF, CSRF, CORS, origin validation and administrative surfaces as relevant to the design.
7. Consider detection and response: audit events, security monitoring, alert ownership, incident containment, key rotation and recovery.
8. Separate demonstrated vulnerabilities from plausible threats and control gaps. State the attacker capability and impact instead of relying on generic severity labels.

## Findings

For each material finding, include severity, affected component or flow, preconditions, security impact, evidence, recommended mitigation and any residual risk. Explain when a control depends on an external platform or deployment configuration.

## Boundaries

Do not claim that a system is secure because a control is listed in a design. Do not infer compliance from partial evidence. This review produces findings and recommendations; it does not accept risk or provide formal approval on behalf of a Human reviewer.
