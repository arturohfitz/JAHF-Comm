# Development Plan

## Phase 1: Technical Foundation

- Create the pnpm workspace.
- Add the Next.js web app.
- Add worker, database, shared, AI, and WhatsApp packages.
- Add local PostgreSQL and Redis with Docker Compose.
- Add strict TypeScript, linting, and build scripts.
- Add Prisma schema foundations for tenant-scoped data.

## Phase 2: Core App Shell

- Complete the multi-tenant CRM database model for WhatsApp accounts, contacts, conversations, messages, customer events, sales, payments, support tickets, AI classifications, notifications, memberships, and audit logs.
- Add demo seed data for local development.
- Add authentication and tenant selection.
- Add tenant-scoped authorization helpers.
- Add application layout, navigation, and protected routes.
- Add audit logging utilities for critical state changes.

The objective of Step 2 is database design only. It prepares the tenant-safe data foundation for later app workflows without implementing real WhatsApp providers, real OpenAI calls, or full login.

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

The objective of Step 5 is inbound webhook ingestion only. Evolution-style payloads are normalized by `packages/whatsapp`, accepted by `POST /api/webhooks/evolution`, stored as inbound messages, and surfaced in `/inbox`. The simulator runs with `pnpm webhook:simulate` and covers a new contact, existing support contact, pending-payment contact, and duplicate message id.

Still pending before real WhatsApp use:

- Configure a real Evolution or Meta provider account per tenant.
- Replace the development webhook secret with managed environment secrets.
- Add provider signature verification if the provider supports it.
- Add delivery status handling, outbound sending, retries, and queue processing.
- Add AI classification as a separate post-ingestion workflow, not inside webhook parsing.

## Phase 5: Operations

- Add production deployment configuration.
- Add observability, job monitoring, and error reporting.
- Add backup and data retention policies.
- Add tenant export and deletion workflows.
