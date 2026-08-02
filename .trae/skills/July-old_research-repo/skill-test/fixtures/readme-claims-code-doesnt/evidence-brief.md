# Evidence Brief — readme-claims-code-doesnt

## Repository Identity

A fictional project where README claims features that do not exist in code.

## Archetype Hints

```json
{
  "archetype": "Library/SDK",
  "signals": {
    "hasMain": true,
    "hasExports": true
  }
}
```

## Key Evidence

### Documentation

- README.md line 10: "Supports distributed transactions across multiple nodes."

### Implementation

- No source files contain "transaction", "distributed", "commit", "rollback", or "xa".
- No tests for distributed transactions.

## Summary

README makes a claim not supported by code or tests. The Skill should flag this as Documentation Only / unverified.
