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

## Authentication

Step 9 replaces the development-only demo session with real credentials and database-backed web sessions. JAHF Comm uses a small first-party session layer instead of OAuth at this stage: `/login` verifies the user's password hash, creates an `AuthSession` row, and sets an HTTP-only cookie containing only a random session token. The database stores a secret-keyed hash of that token and an expiration timestamp. `SESSION_SECRET` is required in production.

Passwords are hashed with Node `scrypt` through `packages/shared/passwords`. `User.passwordHash` never stores plain text. `User.emailVerifiedAt` and `User.lastLoginAt` prepare the model for production account lifecycle work.

The active tenant is resolved from `Membership`. For this stage, if a user has access to one or more tenants, the first membership is used automatically; a tenant selector can be added later. Protected app routes redirect unauthenticated requests to `/login`.

Role boundaries:

- `OWNER` and `ADMIN`: settings and inbox operations.
- `AGENT`: inbox operations.
- `VIEWER`: read-only access to reporting and current read pages.

The Evolution webhook is intentionally separate from browser sessions. `POST /api/webhooks/evolution` continues to authenticate with `x-webhook-secret`, not a user session.

## Data Model

- `Tenant`: company using JAHF Comm.
- `User`, `AuthSession`, and `Membership`: global user identity, credential/session state, tenant membership, and role (`OWNER`, `ADMIN`, `AGENT`, `VIEWER`).
- `WhatsAppAccount`: tenant-owned WhatsApp number or instance. It stores provider identity, `instanceName`, `providerInstanceId`, phone, display name, and connection status only; provider-specific integration logic remains outside the business model.
- `Contact`: customer or prospect with normalized phone number, optional email, and current CRM stage.
- `Conversation` and `Message`: tenant-scoped WhatsApp conversation records with assigned user, message direction, message type, provider message id, and optional raw provider payload.
- `CustomerEvent`: customer timeline for status changes, sales, payments, support events, AI notes, and internal notes.
- `Sale` and `Payment`: source-of-truth commercial records. AI can suggest actions, but it must not invent these rows.
- `SupportTicket`: support, configuration, and maintenance work with status and urgency.
- `AIClassification`: advisory AI output with detected intent, urgency, confidence, summary, recommended action, and raw result JSON.
- `Notification`: internal alerts assigned optionally to a user.
- `AuditLog`: important changes with actor, action, entity, before/after JSON, and timestamp.
- `WebhookLog`: safe diagnostic log for inbound provider webhooks. It records provider, instance, message id, status, HTTP status, optional error, raw payload, and optional tenant/account links. It never stores webhook secrets.

## Boundaries

WhatsApp provider adapters should parse and normalize provider payloads, then hand off to application services. They should not contain CRM, support, payment, or reporting business logic.

AI classification should run separately from webhook ingestion. AI output is advisory only and must be stored as suggestions, not as invented source-of-truth sales, warranty, support, or payment records.

Critical status changes must be paired with audit log records that include tenant, actor, entity, action, and change metadata.

## AI Conversation Classification

Step 6 adds a reusable classifier in `packages/ai`. The classifier receives compact tenant-scoped context: tenant id, contact, conversation, last 20 messages, contact sales, payments, open support tickets, current contact stage, and current conversation stage.

The classifier returns a structured object with intent, urgency, confidence, stage suggestions, summary for the agent, recommended action, human-review flag, payment/support/configuration concern flags, sentiment, and optional notification copy. OpenAI calls use Structured Outputs with a JSON Schema. `OPENAI_MODEL` controls the model, with a single default in `packages/ai`; `OPENAI_API_KEY` is never logged or committed.

If `OPENAI_API_KEY` is missing in development, JAHF Comm uses a controlled mock classifier. The mock is recorded in `AIClassification.rawResult.metadata.mode`, so tests and logs can distinguish it from real OpenAI classification without adding mock wording to the agent-facing UI.

The Evolution webhook enqueues classification after saving an inbound message. The flow is `webhook -> BullMQ ai-classification queue -> apps/worker -> AIClassification`. The worker stores the result in `AIClassification`, creates a `CustomerEvent` of type `AI_CLASSIFIED`, optionally creates a `Notification`, and records an `AuditLog`. It does not automatically change `ContactStage`, `ConversationStage`, sales, payments, warranty, or support data. `/inbox` shows pending classification while the worker has not processed the message, then shows suggestions and lets the user manually apply suggested stages; those user-applied changes create the same audit trail as manual changes, with metadata pointing back to the AI classification.

BullMQ uses Redis through `REDIS_URL`. Queue constants and helpers live in `packages/shared/src/queues.ts` so the web app and worker do not duplicate Redis configuration.

Local classifier testing:

```bash
pnpm ai:test
```

Webhook simulation with AI:

```bash
pnpm webhook:simulate
```

Local async worker flow:

```bash
docker compose up -d
pnpm dev
pnpm worker:dev
pnpm webhook:simulate
pnpm queue:test
```

## Evolution Webhook Ingestion

Step 8 prepares real inbound Evolution API reception at `POST /api/webhooks/evolution`. The endpoint validates `x-webhook-secret`, records a `WebhookLog`, parses JSON, normalizes the provider payload through `packages/whatsapp`, resolves the tenant-owned `WhatsAppAccount` by `instanceName`, `providerInstanceId`, or legacy `providerAccountId`, and writes source-of-truth inbound data to PostgreSQL.

The reusable WhatsApp adapter lives under `packages/whatsapp/src/providers/evolution.ts`. It extracts the provider message id, sender phone, target phone or instance id, contact name, message text, message type, timestamp, and raw payload. Phone numbers are normalized into `+` plus digits, while provider-specific payload shape stays outside CRM code.

`Message.providerMessageId` prevents duplicate inbound messages per tenant. Duplicate events update `WebhookLog` to `DUPLICATE` and do not enqueue AI. Unauthorized events are logged as `UNAUTHORIZED`. Unknown explicit instances are logged as `FAILED`; the development demo fallback only applies when the payload does not include an instance and `EVOLUTION_ALLOW_DEMO_FALLBACK=true`.

For each non-duplicate inbound message, the app creates or updates a tenant-scoped `Contact`, creates or reuses an open `Conversation`, creates an inbound `Message`, updates `Conversation.lastMessageAt`, creates a timeline `CustomerEvent`, creates an internal `Notification`, and records an `AuditLog` for message creation. Then it enqueues AI classification in BullMQ; `apps/worker` consumes the job and writes `AIClassification`.

The production flow is:

```text
Evolution API real
-> public webhook
-> WebhookLog
-> Contact / Conversation / Message
-> BullMQ
-> apps/worker AI
-> Inbox
```

Configuration and diagnostics:

- `/settings/whatsapp`: shows and edits tenant actual WhatsApp accounts. Updates create `AuditLog`.
- `/settings/webhooks`: shows recent `WebhookLog` records and safe formatted payloads without headers or secrets.
- `docs/evolution-api.md`: documents environment variables, local and production webhook URLs, required header, instance matching, and simulator usage.

Local testing is done with:

```bash
pnpm webhook:simulate
```

The simulator posts local Evolution-style payloads for a valid message, duplicate message, invalid secret, unknown instance, and a valid inbox message.

## Production Runtime

Step 10 prepares the production runtime without deploying to the server from this workspace. The production shape is four services:

- `web`: Next.js App Router app on port `3000`.
- `worker`: BullMQ worker for queued AI classification jobs.
- `postgres`: PostgreSQL with persistent volume storage.
- `redis`: Redis with persistent queue storage.

Production Docker images are defined by `Dockerfile.web` and `Dockerfile.worker`. `docker-compose.production.yml` wires the services together and reads secrets from `.env.production`, which must stay outside Git. `scripts/validate-production-env.mjs` verifies required production variables before deployment, and `packages/db/scripts/create-admin.ts` creates the first owner account from environment variables after migrations.

The production health endpoint is `GET /api/health`. It checks PostgreSQL and Redis and returns `503` if either dependency is unreachable. It does not expose secrets.
