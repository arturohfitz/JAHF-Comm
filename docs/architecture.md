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

The Step 2 database model reinforces this by making business records tenant scoped and by using composite relations such as `[tenantId, contactId]`, `[tenantId, conversationId]`, and `[tenantId, whatsappAccountId]`. This keeps contacts, conversations, messages, sales, payments, support tickets, AI classifications, notifications, customer timeline events, and audit logs attached to the same tenant boundary.

## Data Model

- `Tenant`: company using JAHF Comm.
- `User` and `Membership`: global user identity plus tenant membership and role (`OWNER`, `ADMIN`, `AGENT`, `VIEWER`).
- `WhatsAppAccount`: tenant-owned WhatsApp number or instance. It stores provider identity and connection status only; provider-specific integration logic remains outside the business model.
- `Contact`: customer or prospect with normalized phone number, optional email, and current CRM stage.
- `Conversation` and `Message`: tenant-scoped WhatsApp conversation records with assigned user, message direction, message type, provider message id, and optional raw provider payload.
- `CustomerEvent`: customer timeline for status changes, sales, payments, support events, AI notes, and internal notes.
- `Sale` and `Payment`: source-of-truth commercial records. AI can suggest actions, but it must not invent these rows.
- `SupportTicket`: support, configuration, and maintenance work with status and urgency.
- `AIClassification`: advisory AI output with detected intent, urgency, confidence, summary, recommended action, and raw result JSON.
- `Notification`: internal alerts assigned optionally to a user.
- `AuditLog`: important changes with actor, action, entity, before/after JSON, and timestamp.

## Boundaries

WhatsApp provider adapters should parse and normalize provider payloads, then hand off to application services. They should not contain CRM, support, payment, or reporting business logic.

AI classification should run separately from webhook ingestion. AI output is advisory only and must be stored as suggestions, not as invented source-of-truth sales, warranty, support, or payment records.

Critical status changes must be paired with audit log records that include tenant, actor, entity, action, and change metadata.

## Evolution Webhook Ingestion

Step 5 adds an inbound-only Evolution-style webhook at `POST /api/webhooks/evolution`. The endpoint validates `x-webhook-secret`, parses JSON, normalizes the provider payload through `packages/whatsapp`, resolves the tenant-owned `WhatsAppAccount`, and writes source-of-truth inbound data to PostgreSQL.

The reusable WhatsApp adapter lives under `packages/whatsapp/src/providers/evolution.ts`. It extracts the provider message id, sender phone, target phone or instance id, contact name, message text, message type, timestamp, and raw payload. Phone numbers are normalized into `+` plus digits, while provider-specific payload shape stays outside CRM code.

The webhook uses existing database fields. `WhatsAppAccount.providerAccountId` identifies the Evolution instance, and `Message.providerMessageId` prevents duplicate inbound messages per tenant. No schema migration is required for this step.

For each non-duplicate inbound message, the app creates or updates a tenant-scoped `Contact`, creates or reuses an open `Conversation`, creates an inbound `Message`, updates `Conversation.lastMessageAt`, creates a timeline `CustomerEvent`, creates an internal `Notification`, and records an `AuditLog` for message creation. AI classification and real message sending remain separate future workflows.

Local testing is done with:

```bash
pnpm webhook:simulate
```

The simulator posts four local Evolution-style payloads to the webhook: a new price inquiry, an existing support contact, an existing pending-payment contact, and a duplicate provider message id.

## Demo Session

The current web app uses a temporary development-only session helper that always resolves the `jahf-demo` tenant and the demo admin user created by the Prisma seed. This is not production authentication. Real login, tenant selection, authorization, and session management should replace it before any production workflow is enabled.
