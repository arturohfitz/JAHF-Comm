# JAHF Comm

JAHF Comm is a multi-tenant SaaS foundation for WhatsApp conversation management, CRM statuses, AI-assisted classification, support tracking, payments tracking, and reports.

This version is still an early technical foundation. It includes local CRM views, demo data, inbound Evolution webhook preparation, safe webhook logs, and background AI classification scaffolding. It does not send real WhatsApp messages, automate replies, or require real OpenAI calls.

## Stack

- TypeScript
- Next.js App Router
- Tailwind CSS
- shadcn/ui-compatible component structure
- PostgreSQL
- Prisma
- Redis
- BullMQ
- pnpm workspaces
- Docker Compose for local services

## Environments

- `docker-compose.yml` is for local development. It starts PostgreSQL and Redis on local ports so the web app and worker can run from pnpm.
- `docker-compose.production.yml` is for production-style deployment. It builds the web and worker containers, keeps PostgreSQL and Redis on persistent Docker volumes, and reads secrets from `.env.production`.
- `.env.example` is safe local reference material.
- `.env.production.example` is the production reference template. Copy it on the server and fill real values there; never commit `.env.production`.

## Workspace

```text
apps/web          Next.js App Router application
apps/worker       BullMQ-ready worker package
packages/db       Prisma schema and client access
packages/shared   Shared TypeScript primitives
packages/ai       AI boundary placeholder package
packages/whatsapp WhatsApp provider boundary placeholder package
docs              Architecture and planning notes
```

## Local Development

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Copy environment values:

   ```bash
   cp .env.example .env
   ```

   For local login, the seed reads:

   ```bash
   DEMO_ADMIN_EMAIL="admin@jahfcomm.local"
   DEMO_ADMIN_PASSWORD="change-this-password"
   ```

   Change the demo password before any production deployment. Passwords are stored as hashes, never as plain text.

3. Start local infrastructure:

   ```bash
   docker compose up -d
   ```

4. Generate Prisma client:

   ```bash
   pnpm db:generate
   ```

5. Run the web app:

   ```bash
   pnpm dev
   ```

6. Run the background worker when testing async AI classification:

   ```bash
   pnpm worker:dev
   ```

## Production Preparation

Production deployment is documented in [docs/deployment.md](docs/deployment.md). The expected public domain is:

```text
https://comms.jahfconnect.com
```

Before starting production containers, configure real environment variables outside Git:

```bash
cp .env.production.example .env.production
NODE_ENV=production pnpm production:check
```

After building and starting services, run migrations and create the first owner account:

```bash
pnpm production:migrate
pnpm production:seed-admin
```

The production admin script requires `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_TENANT_NAME`, and `ADMIN_TENANT_SLUG`. It hashes the password and does not print secrets.

## Root Scripts

- `pnpm dev` starts the web app.
- `pnpm build` builds all packages.
- `pnpm lint` lints all packages.
- `pnpm typecheck` type-checks all packages.
- `pnpm db:generate` generates the Prisma client.
- `pnpm db:migrate` runs local Prisma migrations.
- `pnpm db:studio` opens Prisma Studio.
- `pnpm webhook:simulate` posts local Evolution-style webhook test cases.
- `pnpm worker:dev` starts the local BullMQ worker.
- `pnpm queue:test` enqueues/checks a demo AI classification job.
- `pnpm production:check` validates required production environment variables.
- `pnpm production:migrate` runs Prisma migrations for deployment.
- `pnpm production:seed-admin` creates or updates the first production owner account.
- `pnpm production:build` builds all workspace packages for production.

## Authentication

The web app uses an HTTP-only session cookie backed by the `AuthSession` table. The cookie stores only a random session token; PostgreSQL stores a secret-keyed hash of that token. In production, `SESSION_SECRET` is required. The active tenant is resolved from the authenticated user's first `Membership`.

Protected web routes redirect unauthenticated users to `/login`. Settings routes require `OWNER` or `ADMIN`; inbox actions allow `OWNER`, `ADMIN`, and `AGENT`. The Evolution webhook remains separate from browser sessions and uses `x-webhook-secret`.

## Healthcheck

The web app exposes a production-safe health endpoint:

```text
GET /api/health
```

It checks PostgreSQL and Redis connectivity and returns `200` only when both are reachable. It does not expose secrets.
