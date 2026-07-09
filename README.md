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
