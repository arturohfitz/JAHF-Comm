# Deployment

This guide prepares JAHF Comm for production on an Ubuntu VPS using Docker or EasyPanel.

Production domain planned for this project:

```text
https://comms.jahfconnect.com
```

## Architecture

Production runs four services:

- `web`: Next.js app on internal port `3000`.
- `worker`: BullMQ worker for AI classification jobs.
- `postgres`: PostgreSQL with a persistent volume.
- `redis`: Redis with append-only persistence.

EasyPanel or an external Nginx proxy should handle public domain routing and SSL termination. The app container should not store secrets in the image; all secrets come from environment variables.

## Environment

Copy the example on the server:

```bash
cp .env.production.example .env.production
```

Set real values for at least:

```bash
APP_URL="https://comms.jahfconnect.com"
NODE_ENV="production"
DATABASE_URL="postgresql://..."
REDIS_URL="redis://..."
SESSION_SECRET="long-random-secret"
WEBHOOK_SECRET="long-random-webhook-secret"
EVOLUTION_ALLOW_DEMO_FALLBACK="false"
```

Never commit these files or values:

- `.env`
- `.env.production`
- API keys
- Database passwords
- `SESSION_SECRET`
- `WEBHOOK_SECRET`

## Build

Build images locally or in EasyPanel:

```bash
docker build -f Dockerfile.web -t jahf-comm-web .
docker build -f Dockerfile.worker -t jahf-comm-worker .
```

With Compose:

```bash
docker compose -f docker-compose.production.yml --env-file .env.production build
```

## Migrations

Run migrations before sending traffic to the new version:

```bash
docker compose -f docker-compose.production.yml --env-file .env.production run --rm web pnpm production:migrate
```

Do not run the demo seed in production.

## First Admin

Create the first production owner manually after migrations. Set these variables in `.env.production` or in the EasyPanel command environment:

```bash
ADMIN_EMAIL="owner@example.com"
ADMIN_PASSWORD="use-a-long-random-password"
ADMIN_TENANT_NAME="JAHF Comm"
ADMIN_TENANT_SLUG="jahf-comm"
```

Then run:

```bash
docker compose -f docker-compose.production.yml --env-file .env.production run --rm web pnpm production:seed-admin
```

The script hashes the password, creates the tenant if missing, creates or updates the user, and grants `OWNER` membership. It does not print the password.

## Start Services

```bash
docker compose -f docker-compose.production.yml --env-file .env.production up -d
```

Web should listen internally on port `3000`. In EasyPanel, route `comms.jahfconnect.com` to the web service and enable SSL from the panel/proxy.

## EasyPanel Notes

Recommended setup:

1. Create a project for JAHF Comm.
2. Add PostgreSQL and Redis services, or use the Compose file services.
3. Add a web service built from `Dockerfile.web`.
4. Add a worker service built from `Dockerfile.worker`.
5. Configure all variables from `.env.production.example` in EasyPanel secrets/environment.
6. Point `comms.jahfconnect.com` to the web service.
7. Enable SSL in EasyPanel.
8. Run migrations.
9. Run `production:seed-admin`.
10. Verify health.

## Healthcheck

Verify the app:

```bash
curl https://comms.jahfconnect.com/api/health
```

Expected shape:

```json
{
  "status": "ok",
  "app": "JAHF Comm",
  "timestamp": "2026-07-09T00:00:00.000Z",
  "database": "ok",
  "redis": "ok"
}
```

HTTP `503` means either PostgreSQL or Redis is unreachable.

## Webhook Evolution

After deployment, configure Evolution API to send inbound webhooks to:

```text
https://comms.jahfconnect.com/api/webhooks/evolution
```

Required header:

```text
x-webhook-secret: <WEBHOOK_SECRET>
```

Check `/settings/webhooks` after logging in to confirm incoming webhook logs. Do not use `localhost` for external webhooks.

## Production Checks

Validate required production variables:

```bash
NODE_ENV=production pnpm production:check
```

This fails if required values are missing or if `EVOLUTION_ALLOW_DEMO_FALLBACK=true`.
