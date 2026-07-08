# Development Plan

## Phase 1: Technical Foundation

- Create the pnpm workspace.
- Add the Next.js web app.
- Add worker, database, shared, AI, and WhatsApp packages.
- Add local PostgreSQL and Redis with Docker Compose.
- Add strict TypeScript, linting, and build scripts.
- Add Prisma schema foundations for tenant-scoped data.

## Phase 2: Core App Shell

- Add authentication and tenant selection.
- Add tenant-scoped authorization helpers.
- Add application layout, navigation, and protected routes.
- Add audit logging utilities for critical state changes.

## Phase 3: Conversation and CRM Model

- Add conversation, contact, message, and CRM status workflows.
- Add support tracking views.
- Add payments tracking views.
- Add reports based on source-of-truth database records.

## Phase 4: Provider and AI Integrations

- Add WhatsApp provider adapters behind the `packages/whatsapp` boundary.
- Add webhook ingestion separated from business workflows.
- Add AI classification behind the `packages/ai` boundary.
- Store AI output as suggestions that users can accept, reject, or ignore.

## Phase 5: Operations

- Add production deployment configuration.
- Add observability, job monitoring, and error reporting.
- Add backup and data retention policies.
- Add tenant export and deletion workflows.
