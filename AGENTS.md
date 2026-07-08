# AGENTS.md

Rules for agents working on JAHF Comm:

- Every tenant must have isolated data.
- Every business query must be scoped by `tenantId`.
- AI may suggest classifications, summaries, urgency, and next actions.
- AI must not invent payments, sales, warranty, or support data.
- Critical status changes must create audit logs.
- WhatsApp providers must be separated from business logic.
- AI classification must be separated from webhook ingestion.
- Use strict TypeScript.
- Use environment variables.
- Never hardcode secrets.
- Never log API keys.
