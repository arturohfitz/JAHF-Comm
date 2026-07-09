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

The objective of Step 6 is advisory AI classification. `packages/ai` provides a structured classifier with an OpenAI implementation and a development mock fallback when `OPENAI_API_KEY` is absent. Classifier output is stored in `AIClassification`, creates timeline and notification records, and leaves CRM state unchanged unless a user manually applies a suggestion from `/inbox`.

The classifier receives compact conversation context and returns intent, urgency, confidence, stage suggestions, summary, recommended action, concern flags, sentiment, and notification guidance. It must not create or modify sales, payments, warranty, support tickets, contact stages, or conversation stages automatically.

Test commands:

- `pnpm ai:test`: runs a classifier check with demo context. Uses mock if no API key is configured.
- `pnpm webhook:simulate`: sends inbound messages that trigger classification, including price, support, payment, angry configuration, and duplicate-message cases.

Production follow-up: move classification to a BullMQ worker so webhook acknowledgement remains fast under real traffic.

The objective of Step 7 is that async worker move. `POST /api/webhooks/evolution` saves the inbound message and enqueues `CLASSIFY_CONVERSATION_MESSAGE` into the `ai-classification` BullMQ queue. `apps/worker` consumes jobs from Redis, loads tenant-scoped context, runs `packages/ai`, and writes `AIClassification`, `CustomerEvent`, optional `Notification`, and `AuditLog`.

Local run order:

1. Open Docker Desktop.
2. Run `docker compose up -d`.
3. Run `pnpm dev`.
4. Run `pnpm worker:dev` in a second terminal.
5. Run `pnpm webhook:simulate`.
6. Use `pnpm queue:test` to enqueue/check a demo classification job.

The worker is idempotent by `messageId`: if an `AIClassification` already exists for the message, it skips creating duplicate classifications, events, and notifications. Jobs use stable ids (`ai-classify:{tenantId}:{messageId}`), three attempts, exponential backoff, and bounded retention.

Production follow-up: add queue dashboards, dead-letter review, observability, stricter provider signature validation, and horizontal worker scaling.

The objective of Step 8 is preparing real Evolution API reception without sending WhatsApp messages or automating replies. `WhatsAppAccount` now stores explicit `instanceName` and `providerInstanceId` values, and `WebhookLog` records inbound webhook diagnostics with `RECEIVED`, `PROCESSED`, `DUPLICATE`, `FAILED`, and `UNAUTHORIZED` states.

The inbound flow is:

1. Evolution API posts to `/api/webhooks/evolution`.
2. The webhook validates `x-webhook-secret`.
3. A safe `WebhookLog` is created or updated.
4. The app resolves `WhatsAppAccount` by Evolution instance.
5. New inbound messages create or update tenant-scoped contacts, conversations, messages, events, notifications, and audit logs.
6. New messages enqueue BullMQ AI classification jobs.
7. `apps/worker` processes AI suggestions.
8. `/inbox` shows the message and classification state.

Step 8 also adds:

- `/settings/whatsapp` to view and edit demo WhatsApp account configuration.
- `/settings/webhooks` to inspect recent webhook logs and raw payloads safely.
- `docs/evolution-api.md` with local and production webhook instructions for `https://comms.jahfconnect.com/api/webhooks/evolution`.
- `pnpm webhook:simulate` coverage for valid, duplicate, unauthorized, unknown-instance, and inbox-message cases.

Still pending before production WhatsApp usage:

- Configure a real Evolution instance outside Git.
- Store production secrets in the deployment environment.
- Add provider signature validation if available.
- Add outbound sending, delivery status, retries, and operator controls.

The objective of Step 9 is replacing the temporary demo session before publishing `comms.jahfconnect.com`. The web app now uses real email/password login, password hashes, database-backed `AuthSession` rows, and HTTP-only session cookies. The authenticated user's active tenant is resolved from `Membership`.

Protected routes:

- `/dashboard`
- `/inbox`
- `/contacts`
- `/sales`
- `/payments`
- `/support`
- `/reports`
- `/settings`
- `/settings/whatsapp`
- `/settings/webhooks`

Permission baseline:

- `OWNER` and `ADMIN` can manage settings.
- `OWNER`, `ADMIN`, and `AGENT` can perform inbox actions.
- `VIEWER` remains read-only for current views.

Local seed credentials come from `DEMO_ADMIN_EMAIL` and `DEMO_ADMIN_PASSWORD`. The local default password must be changed before any production deployment. Evolution webhooks continue to use `x-webhook-secret` and do not depend on browser login.

## Phase 5: Operations

- Add production deployment configuration.
- Add observability, job monitoring, and error reporting.
- Add backup and data retention policies.
- Add tenant export and deletion workflows.
