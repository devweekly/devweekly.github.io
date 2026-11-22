# ADR-0002: SQLite First, PostgreSQL-ready Boundary and Object Storage

- Status: Accepted
- Date: 2026-11-22

## Context

The prototype needs low operational overhead for local development, a later PostgreSQL path, and object storage for non-structured files.

## Decision

Use Node's built-in node:sqlite for the prototype and keep database access on the server. Keep SQL and query access out of the React client. Domain-facing REST routes are independent of the SQLite file and form the migration seam for a later PostgreSQL repository/driver.

Use an ObjectStore interface for binary objects. LocalObjectStore is the default. S3ObjectStore is selected by environment configuration and uses AWS SDK credentials from the runtime environment.

## Consequences

- Node.js 22.13 or later is required.
- PostgreSQL is a planned adapter, not currently implemented.
- S3 objects are not public. A future download API must authorize the Work Item before returning the object or a short-lived presigned URL.
- Production deployment must add schema migrations, backup/recovery, concurrency control, authentication and secret management.
