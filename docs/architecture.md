# Architecture

JAHF Comm is organized as a pnpm workspace with deployable apps under `apps` and reusable packages under `packages`.

## Applications

- `apps/web`: Next.js App Router web application.
- `apps/worker`: Background worker package prepared for BullMQ and Redis.

## Packages

- `packages/db`: Prisma schema and database client entry point.
- `packages/shared`: Shared TypeScript constants and primitives.
- `packages/ai`: Boundary package for future AI classification and summarization code.
- `packages/whatsapp`: Boundary package for future WhatsApp provider adapters.

## Tenancy

Tenant isolation is a primary invariant. Tenant-owned tables include `tenantId`, and business queries must scope reads and writes by `tenantId`. Cross-tenant reports or operations should be explicit administrative workflows with separate authorization.

## Boundaries

WhatsApp provider adapters should parse and normalize provider payloads, then hand off to application services. They should not contain CRM, support, payment, or reporting business logic.

AI classification should run separately from webhook ingestion. AI output is advisory only and must be stored as suggestions, not as invented source-of-truth sales, warranty, support, or payment records.

Critical status changes must be paired with audit log records that include tenant, actor, entity, action, and change metadata.
